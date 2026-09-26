import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DurableEvent, DurableFact, DurableProjection } from "../contracts/durable.js";
import type { DecisionAnswer, DecisionCommentReceipt, DecisionRecord, GitHubCommentIdentity, GitHubIdentity } from "../contracts/decisions.js";
import type { Artifact } from "../contracts/local.js";
import { stable } from "../kernel/durable.js";
import { save } from "./local-files.js";
import { checkArtifact } from "./durable-execution.js";
import { DurableError, Faults } from "./durable-store.js";
import { processInJob } from "./windows-job.js";

interface Comment { id: number; html_url: string; user: GitHubIdentity; body: string; created_at: string; updated_at: string }
function identity(value: unknown): GitHubIdentity {
  if (!value || typeof value !== "object") throw new Error("Missing GitHub user");
  const v = value as Record<string, unknown>;
  if (!Number.isSafeInteger(v.id) || Number(v.id) <= 0 || typeof v.login !== "string" || !v.login.trim()) throw new Error("Invalid GitHub user identity");
  return { id: Number(v.id), login: v.login };
}
function comment(value: unknown): Comment {
  if (!value || typeof value !== "object") throw new Error("Missing GitHub comment");
  const v = value as Record<string, unknown>;
  identity(v.user);
  if (!Number.isSafeInteger(v.id) || Number(v.id) <= 0 || typeof v.html_url !== "string" || !v.html_url.startsWith("https://github.com/") || typeof v.body !== "string" || typeof v.created_at !== "string" || !Number.isFinite(Date.parse(v.created_at)) || typeof v.updated_at !== "string" || !Number.isFinite(Date.parse(v.updated_at))) throw new Error("Invalid GitHub comment");
  return value as Comment;
}
function commentIdentity(c: Comment): GitHubCommentIdentity { return { id: c.id, url: c.html_url, author: identity(c.user), createdAt: c.created_at, updatedAt: c.updated_at }; }
function marker(p: DurableProjection, d: DecisionRecord): string { return `<!-- swf-decision:${p.runId}:${d.request.id} -->`; }
function body(p: DurableProjection, d: DecisionRecord): string {
  const r = d.request;
  return [marker(p, d), `Decision ${r.id}`, `Run ${p.runId}`, r.question, `Reason: ${r.reason}`, "Options:", ...(r.options ?? []).map(o => `${o.id}: ${o.description}\nConsequences: ${o.consequences.join("; ")}`), `Impact: ${r.impact.join("; ")}`, `Reversible: ${r.reversible}`, `Authorized resolver: ${p.contract.config.decisions!.authorizedResolver.login} (GitHub ID ${p.contract.config.decisions!.authorizedResolver.id})`, "Reply with exactly one JSON object. Do not add fields, Markdown fences, or surrounding text. The answer must be nonblank. Select an option ID when options exist; otherwise use null.", JSON.stringify({ schemaVersion: 1, decisionId: r.id, answer: "Your answer", selectedOptionId: r.options?.[0]?.id ?? null })].join("\n\n");
}
function answer(c: Comment, d: DecisionRecord, p: DurableProjection): DecisionAnswer | undefined {
  if (!("receipt" in d) || c.user.id !== p.contract.config.decisions!.authorizedResolver.id || Date.parse(c.created_at) < Date.parse(d.receipt.comment.createdAt)) return;
  try {
    const v: unknown = JSON.parse(c.body);
    if (!v || typeof v !== "object" || Array.isArray(v)) return;
    const a = v as Record<string, unknown>;
    if (Object.keys(a).sort().join(",") !== "answer,decisionId,schemaVersion,selectedOptionId" || a.schemaVersion !== 1 || a.decisionId !== d.request.id || typeof a.answer !== "string" || !a.answer.trim()) return;
    if (d.request.options?.length ? !d.request.options.some(o => o.id === a.selectedOptionId) : a.selectedOptionId !== null) return;
    return a as unknown as DecisionAnswer;
  } catch { return; }
}
async function captured(ref: Artifact): Promise<unknown> { await checkArtifact(ref); return JSON.parse(await readFile(ref.path, "utf8")); }
async function auditReceipt(ref: DecisionCommentReceipt): Promise<Comment> {
  const c = comment(await captured(ref.record));
  if (stable(commentIdentity(c)) !== stable(ref.comment)) throw new Error("Captured comment identity changed");
  return c;
}
export async function auditDecisions(p: DurableProjection, events: DurableEvent[]): Promise<void> {
  for (const d of p.decisions ?? []) {
    if ("publication" in d) {
      await checkArtifact(d.publication.body);
      if (await readFile(d.publication.body.path, "utf8") !== body(p, d)) throw new Error("Question body differs from decision intent");
    }
    if ("receipt" in d) {
      const c = await auditReceipt(d.receipt);
      if (c.user.id !== d.publication.publisher.id || c.body !== body(p, d)) throw new Error("Question receipt differs from publication");
    }
    if (d.kind === "resolved") {
      const c = await auditReceipt(d.source), a = answer(c, d, p);
      if (!a || a.answer !== d.resolution.answer || a.selectedOptionId !== (d.resolution.selectedOptionId ?? null) || !d.resolution.evidence.some(e => e.uri === d.source.record.path && e.digest === d.source.record.digest)) throw new Error("Resolution differs from authenticated answer");
    }
  }
  for (const { fact } of events) if (fact.type === "DecisionConflictObserved") {
    const raw = await captured(fact.conflict.record);
    if (!Array.isArray(raw)) throw new Error("Conflict capture must be a comment array");
    const comments = raw.flat().map(comment), d = p.decisions?.find(d => d.request.id === fact.decisionId);
    if (!d) throw new Error("Unknown conflict decision");
    const groups = new Set<string>();
    for (const expected of fact.conflict.comments) {
      const c = comments.find(c => c.id === expected.id), a = c && answer(c, d, p);
      if (!c || !a || stable(commentIdentity(c)) !== stable(expected)) throw new Error("Conflict identity differs from authenticated capture");
      groups.add(stable([a.answer, a.selectedOptionId]));
    }
    if (groups.size < 2) throw new Error("Conflict capture contains no conflicting answers");
  }
}

export async function handleDecision(get: () => DurableProjection, append: (fact: DurableFact) => Promise<void>, faults: Faults): Promise<void> {
  const p = get(), config = p.contract.config.decisions;
  if (!config || p.state.status !== "WAITING_FOR_DECISION") return;
  const decisionId = p.state.decision.id;
  const current = (): DecisionRecord => get().decisions!.find(d => d.request.id === decisionId)!;
  const directory = join(p.contract.config.artifactRoot, p.runId, "decisions", current().attemptId);
  await mkdir(directory, { recursive: true });
  const repository = new URL(p.contract.config.request.repository.url).pathname.slice(1).replace(/\.git$/, "");
  const endpoint = `repos/${repository}/issues/${p.contract.config.request.source.externalId}/comments`;
  async function api(method: "GET" | "POST", endpoint: string, input?: unknown): Promise<unknown> {
    try {
      const args = [...config!.prefixArgs, "api", "--hostname", "github.com", "--method", method, endpoint, ...(input === undefined ? (endpoint === "user" ? [] : ["--paginate", "--slurp"]) : ["--input", "-"])];
      const process = await processInJob({ executable: config!.executable, args, cwd: directory, directory, name: `gateway-${randomUUID()}`, timeoutSeconds: config!.timeoutSeconds, trustedGitHub: true, ...(input === undefined ? {} : { input: JSON.stringify(input) }) });
      if (process.termination.kind !== "exited" || process.termination.exitCode !== 0) throw new Error(`GitHub process failed: ${JSON.stringify(process.termination)}`);
      return JSON.parse(await readFile(process.stdout.path, "utf8"));
    } catch (error) { throw new DurableError("decision_gateway_error", String(error)); }
  }
  async function comments(): Promise<Comment[]> {
    try { const raw = await api("GET", endpoint); if (!Array.isArray(raw) || raw.some(page => !Array.isArray(page))) throw new Error("Expected paginated comment arrays"); return raw.flat().map(comment); }
    catch (error) { if (error instanceof DurableError) throw error; throw new DurableError("decision_gateway_error", String(error)); }
  }
  async function receipt(c: Comment): Promise<DecisionCommentReceipt> { return { comment: commentIdentity(c), record: await save(join(directory, `comment-${randomUUID()}.json`), JSON.stringify(c)) }; }
  let d = current();
  if (d.kind === "requested") {
    let publisher;
    try { publisher = identity(await api("GET", "user")); } catch (error) { if (error instanceof DurableError) throw error; throw new DurableError("decision_gateway_error", String(error)); }
    const publication = { operationId: randomUUID(), publisher, body: await save(join(directory, `question-${randomUUID()}.txt`), body(p, d)) };
    await append({ type: "DecisionPublicationPlanned", decisionId, publication }); d = current();
  }
  if (d.kind === "publication_planned") {
    const publication = d.publication;
    await append({ type: "DecisionPublicationStarted", decisionId, operationId: publication.operationId });
    const raw = await api("POST", endpoint, { body: await readFile(publication.body.path, "utf8") });
    await faults.at("decision.after_publish", p.runId);
    let c;
    try { c = comment(raw); if (c.user.id !== publication.publisher.id || c.body !== body(p, d)) throw new Error("GitHub publication receipt does not match intent"); }
    catch (error) { throw new DurableError("decision_gateway_error", String(error)); }
    await append({ type: "DecisionPublished", decisionId, operationId: publication.operationId, receipt: await receipt(c) });
    return;
  }
  if (d.kind === "publication_started") {
    const publisher = d.publication.publisher.id, matches = (await comments()).filter(c => c.user.id === publisher && c.body.includes(marker(p, d)));
    if (matches.length !== 1 || matches[0]!.body !== body(p, d)) throw new DurableError("publication_uncertain", "Started publication cannot be reconciled to one exact authenticated comment");
    await append({ type: "DecisionPublished", decisionId, operationId: d.publication.operationId, receipt: await receipt(matches[0]!) }); d = current();
  }
  if (d.kind !== "published" && d.kind !== "conflicted") return;
  const observed = (await comments()).map(c => ({ c, a: answer(c, d, p) })).filter((v): v is { c: Comment; a: DecisionAnswer } => v.a !== undefined).sort((a, b) => a.c.id - b.c.id);
  if (!observed.length) return;
  const groups = new Set(observed.map(v => stable([v.a.answer, v.a.selectedOptionId])));
  if (groups.size > 1) {
    const bytes = JSON.stringify(observed.map(v => v.c));
    if (d.kind !== "conflicted" || stable(JSON.parse(await readFile(d.conflict.record.path, "utf8"))) !== stable(observed.map(v => v.c))) {
      await append({ type: "DecisionConflictObserved", decisionId, conflict: { comments: observed.map(v => commentIdentity(v.c)), record: await save(join(directory, `conflict-${randomUUID()}.json`), bytes) } });
    }
    throw new DurableError("decision_conflict", "Authorized comments contain conflicting answers");
  }
  const { c, a } = observed[0]!, source = await receipt(c);
  await append({ type: "DecisionResolved", decisionId, source, resolution: { id: `${decisionId}:resolution`, decisionId, answer: a.answer, ...(a.selectedOptionId === null ? {} : { selectedOptionId: a.selectedOptionId }), basis: "human", evidence: [{ id: `${decisionId}:answer:${c.id}`, kind: "human_decision", uri: source.record.path, digest: source.record.digest }], resolvedAt: c.created_at } });
}
