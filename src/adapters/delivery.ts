import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DurableEvent, DurableFact, DurableProjection } from "../contracts/durable.js";
import type { Artifact } from "../contracts/local.js";
import type { CheckRunObservation, GitHubIntake, PullRequestReceipt } from "../contracts/delivery.js";
import { assertPrIdentity } from "../kernel/delivery.js";
import { stable } from "../kernel/durable.js";
import { save } from "./local-files.js";
import { checkArtifact, checkPrograms, validateManifest } from "./durable-execution.js";
import { DurableError, Faults } from "./durable-store.js";
import { GitHubApi, numberId, object, shaValue, textValue } from "./github-api.js";
import { repositoryIdentity } from "./github-intake.js";
import { auditDeliveryPlan, createCommit, planDelivery, pushCreateOnly, readRemoteRef } from "./git-delivery.js";

type GitHubProjection = Extract<DurableProjection, { intake: GitHubIntake }>;
function receipt(raw: unknown, record: Artifact, p: GitHubProjection): PullRequestReceipt {
  const r = object(raw), head = object(r.head), base = object(r.base), number = numberId(r.number);
  if (r.state !== "open" && r.state !== "closed") throw new Error("Invalid PR state");
  if (r.html_url !== `${p.intake.repository.url}/pull/${number}`) throw new Error("PR URL differs from canonical repository");
  const state = r.merged === true || (typeof r.merged_at === "string" && r.merged_at.length) ? { kind: "merged" as const, mergeCommitSha: shaValue(r.merge_commit_sha) } : { kind: r.state as "open" | "closed" };
  return { id: numberId(r.id), number, url: textValue(r.html_url), authorId: numberId(object(r.user).id), repositoryId: numberId(object(base.repo).id), head: { repositoryId: numberId(object(head.repo).id), ref: textValue(head.ref), sha: shaValue(head.sha) }, base: { repositoryId: numberId(object(base.repo).id), ref: textValue(base.ref), sha: shaValue(base.sha) }, state, record };
}
function checks(raw: unknown): CheckRunObservation[] {
  if (!Array.isArray(raw) || !raw.length) throw new Error("Missing check-run pages");
  let total: number | undefined;
  const result: CheckRunObservation[] = [];
  for (const page of raw) {
    const p = object(page);
    if (!Number.isSafeInteger(p.total_count) || Number(p.total_count) < 0 || !Array.isArray(p.check_runs) || (total !== undefined && total !== p.total_count)) throw new Error("Malformed check-run page");
    total = Number(p.total_count);
    for (const value of p.check_runs) {
      const c = object(value), common = { id: numberId(c.id), name: textValue(c.name), appId: numberId(object(c.app).id), headSha: shaValue(c.head_sha) };
      if (c.status === "completed") {
        if (!["success", "failure", "neutral", "cancelled", "skipped", "timed_out", "action_required", "stale", "startup_failure"].includes(String(c.conclusion))) throw new Error("Invalid completed check conclusion");
        result.push({ ...common, kind: "completed", conclusion: c.conclusion as Extract<CheckRunObservation, { kind: "completed" }>["conclusion"] });
      } else {
        if (!["queued", "in_progress", "waiting", "requested", "pending"].includes(String(c.status)) || c.conclusion !== null) throw new Error("Invalid pending check");
        result.push({ ...common, kind: "pending", status: c.status as Extract<CheckRunObservation, { kind: "pending" }>["status"] });
      }
    }
  }
  if (result.length !== total || new Set(result.map(c => c.id)).size !== result.length) throw new Error("Incomplete or duplicate check-run observations");
  return result;
}
function prBody(p: GitHubProjection): string {
  if (!("plan" in p.delivery)) throw new Error("Missing delivery plan");
  return [`<!-- swf-delivery:${p.runId} -->`, `Run: ${p.runId}`, `Issue: ${p.intake.issue.url}`, `Commit: ${p.delivery.plan.commit.expectedSha}`, `Verification: ${p.delivery.plan.evidence.digest}`].join("\n\n");
}
export async function auditDelivery(p: DurableProjection, events: DurableEvent[]): Promise<void> {
  if (!p.intake) return;
  const captured = async (ref: Artifact): Promise<unknown> => { await checkArtifact(ref); return JSON.parse(await readFile(ref.path, "utf8")); };
  const auditReceipt = async (r: PullRequestReceipt, exact: boolean): Promise<unknown> => {
    const raw = await captured(r.record), parsed = receipt(raw, r.record, p);
    if (stable(parsed) !== stable(r)) throw new Error("PR capture differs from receipt"); assertPrIdentity(p, r, exact); return raw;
  };
  for (const { fact } of events) {
    if (fact.type === "DeliveryPlanned") await auditDeliveryPlan(p, fact.plan);
    if (fact.type === "CommitCreated" || fact.type === "PushConfirmed") { await checkArtifact(fact.receipt.process.stdout); await checkArtifact(fact.receipt.process.stderr); }
    if (fact.type === "PrPlanned") { await checkArtifact(fact.publication.body); if (await readFile(fact.publication.body.path, "utf8") !== prBody(p)) throw new Error("PR publication body changed"); }
    if (fact.type === "PrCreated" || fact.type === "PullRequestObserved") {
      const raw = object(await auditReceipt(fact.receipt, fact.type === "PrCreated"));
      if (fact.type === "PrCreated" && (p.delivery.kind !== "created" || raw.title !== p.delivery.publication.title || raw.body !== prBody(p))) throw new Error("PR creation capture differs from publication intent");
    }
    if (fact.type === "CiObserved") {
      if (stable(checks(await captured(fact.observation.record))) !== stable(fact.observation.checks)) throw new Error("CI capture differs from observed checks");
      await auditReceipt(fact.observation.before, false); await auditReceipt(fact.observation.after, false);
    }
  }
}
export async function deliver(get: () => DurableProjection, append: (fact: DurableFact) => Promise<void>, faults: Faults): Promise<void> {
  const current = (): GitHubProjection => { const p = get(); if (!p.intake) throw new Error("Delivery requires GitHub intake"); return p; };
  let p = current();
  if (p.state.status !== "VERIFIED") return;
  const directory = join(p.contract.config.artifactRoot, p.runId, "delivery"), prefix = `repos/${p.intake.repository.owner}/${p.intake.repository.name}`;
  const api = new GitHubApi(p.intake.input.github, directory), ciApi = new GitHubApi(p.intake.input.github, directory, "ci_gateway_error");
  async function eligible(): Promise<Awaited<ReturnType<typeof validateManifest>>> {
    p = current();
    if (p.state.status !== "VERIFIED" || p.verification.kind !== "completed" || p.decisions?.some(d => d.kind !== "resolved")) throw new DurableError("delivery_error", "Delivery requires complete current verification and resolved decisions");
    let e;
    try { await checkPrograms(p); await checkArtifact(p.verification.evidence); e = await validateManifest(p, p.verification.evidencePath); }
    catch (error) { throw new DurableError("artifact_invalid", String(error)); }
    if (e.verdict.status !== "VERIFIED" || !e.changedPaths.length) throw new DurableError("delivery_error", "Delivery requires a nonempty verified change");
    return e;
  }
  async function recheckRepository(): Promise<void> {
    let observed;
    try { observed = repositoryIdentity((await api.request("GET", prefix)).value); }
    catch (error) { if (error instanceof DurableError) throw error; throw new DurableError("github_gateway_error", String(error)); }
    if (stable(observed) !== stable(p.intake.repository)) throw new DurableError("delivery_error", "Remote repository identity changed");
  }
  if (p.delivery.kind === "unplanned") {
    const evidence = await eligible();
    await append({ type: "DeliveryPlanned", plan: await planDelivery(p, evidence, { operationId: randomUUID(), date: `${Math.floor(Date.now() / 1000)} +0000`, message: `Factory work for ${p.intake.issue.url}\nRun ${p.runId}\n` }) }); p = current();
  }
  if (p.delivery.kind === "planned") {
    await eligible(); const plan = current().delivery;
    if (plan.kind !== "planned") throw new Error("Commit intent changed");
    const created = await createCommit(p, plan.plan); await faults.at("delivery.after_commit_object", p.runId);
    await append({ type: "CommitCreated", operationId: plan.plan.operationId, receipt: created }); p = current();
  }
  if (p.delivery.kind === "committed") { await eligible(); await recheckRepository(); if (p.delivery.kind !== "committed") throw new Error("Commit state changed"); await append({ type: "PushStarted", operationId: p.delivery.plan.operationId }); p = current(); }
  if (p.delivery.kind === "push_started") {
    await eligible(); await recheckRepository(); const d = current().delivery; if (d.kind !== "push_started") throw new Error("Push state changed");
    let remote = await readRemoteRef(p, d.plan);
    if (remote.kind === "present" && remote.sha !== d.commit.sha) throw new DurableError("push_conflict", "Remote ref contains another commit");
    if (remote.kind === "absent") {
      await faults.at("delivery.before_push", p.runId, undefined, [p.contract.config.workspaceRoot]);
      const pushed = await pushCreateOnly(p, d.plan);
      if (pushed.termination.kind === "exited" && pushed.termination.exitCode === 0) await faults.at("delivery.after_push", p.runId);
      remote = await readRemoteRef(p, d.plan);
      if (remote.kind === "present" && remote.sha !== d.commit.sha) throw new DurableError("push_conflict", "Concurrent ref creation refused by create-only push");
      if (remote.kind === "absent") throw new DurableError("delivery_error", "Push did not produce the intended ref");
    }
    await append({ type: "PushConfirmed", operationId: d.plan.operationId, receipt: { ref: `refs/heads/${d.plan.branch}`, sha: remote.sha, process: remote.process } }); p = current();
  }
  if (p.delivery.kind === "pushed") {
    await eligible(); await recheckRepository();
    let publisher;
    try { const raw = object((await api.request("GET", "user")).value); publisher = { id: numberId(raw.id), login: textValue(raw.login) }; }
    catch (error) { if (error instanceof DurableError) throw error; throw new DurableError("github_gateway_error", String(error)); }
    const operationId = randomUUID(), publication = { operationId, publisher, title: `Factory: ${p.contract.config.request.objective.split("\n")[0]}`, body: await save(join(directory, `pr-${operationId}.txt`), prBody(p)) };
    await append({ type: "PrPlanned", publication }); p = current();
  }
  if (p.delivery.kind === "pr_planned") {
    await eligible(); await recheckRepository(); const d = current().delivery; if (d.kind !== "pr_planned") throw new Error("PR plan changed");
    await append({ type: "PrStarted", operationId: d.publication.operationId }); p = current();
    const response = await api.request("POST", `${prefix}/pulls`, { body: { head: d.plan.branch, base: p.intake.base.branch, title: d.publication.title, body: await readFile(d.publication.body.path, "utf8") } });
    await faults.at("delivery.after_pr_create", p.runId);
    let pr;
    try { pr = receipt(response.value, response.record, p); assertPrIdentity(p, pr, true); const raw = object(response.value); if (raw.title !== d.publication.title || raw.body !== prBody(p)) throw new Error("PR response differs from intended content"); }
    catch (error) { throw new DurableError("github_gateway_error", String(error)); }
    await append({ type: "PrCreated", operationId: d.publication.operationId, receipt: pr }); p = current();
  } else if (p.delivery.kind === "pr_started") {
    await eligible(); const d = current().delivery; if (d.kind !== "pr_started") throw new Error("PR intent changed");
    const response = await api.request("GET", `${prefix}/pulls?state=all`, { paginate: true });
    if (!Array.isArray(response.value) || response.value.some(v => !Array.isArray(v))) throw new DurableError("github_gateway_error", "Malformed PR page list");
    const matches: unknown[] = [];
    for (const raw of response.value.flat()) {
      try { const pr = receipt(raw, response.record, p); assertPrIdentity(p, pr, true); const value = object(raw); if (value.title === d.publication.title && value.body === prBody(p)) matches.push(raw); } catch { /* Other authors and repositories cannot establish this publication. */ }
    }
    if (matches.length !== 1) throw new DurableError("pr_uncertain", "Started PR publication has no unique exact authenticated result");
    const record = await save(join(directory, `pr-adopted-${randomUUID()}.json`), JSON.stringify(matches[0]));
    await append({ type: "PrCreated", operationId: d.publication.operationId, receipt: receipt(matches[0], record, p) }); p = current();
  }
  if (p.delivery.kind === "created") {
    const d = p.delivery;
    const readPr = async (): Promise<PullRequestReceipt> => {
      const response = await ciApi.request("GET", `${prefix}/pulls/${d.pullRequest.number}`);
      try { const pr = receipt(response.value, response.record, p); assertPrIdentity(p, pr, false); return pr; }
      catch (error) { throw new DurableError("ci_gateway_error", String(error)); }
    };
    const before = await readPr();
    if (before.state.kind === "closed") { await append({ type: "PullRequestObserved", receipt: before }); return; }
    const observed = await ciApi.request("GET", `${prefix}/commits/${d.commit.sha}/check-runs?filter=all`, { paginate: true });
    let observations;
    try { observations = checks(observed.value); } catch (error) { throw new DurableError("ci_gateway_error", String(error)); }
    const after = await readPr();
    await append({ type: "CiObserved", observation: { headSha: d.commit.sha, before, after, checks: observations, record: observed.record } });
  }
}
