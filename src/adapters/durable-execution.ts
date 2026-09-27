import { loadSkills } from "./skills.js";
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Artifact, LocalEvidence, LocalWorkspace, ProcessRecord } from "../contracts/local.js";
import type { DurableAttempt, DurableEvent, DurableProjection, ProcessIdentity, WorkerCompletion } from "../contracts/durable.js";
import type { DecisionWorkerInput } from "../contracts/decisions.js";
import type { RepairContext, RepairReservation } from "../contracts/repair.js";
import type { VerificationResult } from "../contracts/index.js";
import { durableVerdict, replay, stable } from "../kernel/durable.js";
import { artifact, canonical, captureDiff, changes, contractDigest, git, hash, programs, save, snapshot } from "./local-files.js";
import { commandResult, executeRestricted, outcome, workerArgs } from "./local-execution.js";
import { jobIsStopped } from "./windows-job.js";
import { atomicWrite, DurableError, exists, Faults, validateStored } from "./durable-store.js";
import { gitBaseSnapshot, gitCandidateDiff } from "./git-delivery.js";

export async function checkArtifact(ref: Artifact): Promise<void> { if ((await artifact(ref.path)).digest !== ref.digest) throw new Error(`Artifact changed: ${ref.path}`); }
export async function checkPrograms(p: DurableProjection): Promise<void> {
  if (contractDigest(p.contract.config, await programs(p.contract.config, p.intake ? [p.intake.input.github.executable, p.intake.input.git.executable] : [])) !== p.contract.digest) throw new Error("Pinned execution or verification inputs changed");
}
export async function completion(path: string, attemptId: string, p?: DurableProjection): Promise<WorkerCompletion> {
  const value: unknown = JSON.parse(await readFile(path, "utf8")); validateStored("completion", value); const record = value as WorkerCompletion;
  if (record.attemptId !== attemptId) throw new Error("Worker completion identity is invalid");
  await checkArtifact(record.process.stdout); await checkArtifact(record.process.stderr);
  // A policy rejection may narrow a completed process outcome to failed. It cannot promote failure.
  const parsed = await outcome(record.process, p?.contract.config.decisions ? { runId: p.runId, unitId: p.graph.units[0]!.id, attemptId } : undefined);
  if (record.outcome.kind !== "failed" && stable(parsed) !== stable(record.outcome)) throw new Error("Completion does not match process output");
  return record;
}
export async function checkHistoryArtifacts(p: DurableProjection): Promise<void> {
  await checkPrograms(p);
  for (const a of p.attempts) {
    if (a.kind === "interrupted") for (const ref of a.artifacts) await checkArtifact(ref);
    if (a.kind === "completed") {
      await checkArtifact(a.record); const record = await completion(a.record.path, a.id, p);
      if (stable(a.outcome) !== stable(record.outcome)) throw new Error("Completion outcome changed");
    }
  }
}
export function commonGit(workspace: LocalWorkspace): string { return resolve(workspace.repositoryPath, git(workspace.repositoryPath, "rev-parse", "--git-common-dir")); }
export async function reconcileWorkspace(workspace: LocalWorkspace): Promise<void> {
  try {
    await canonical(workspace.path);
    const paths = git(workspace.repositoryPath, "worktree", "list", "--porcelain").split(/\r?\n/).filter(l => l.startsWith("worktree ")).map(l => resolve(l.slice(9)).toLowerCase());
    if (!paths.includes(resolve(workspace.path).toLowerCase()) || git(workspace.path, "rev-parse", "--show-toplevel").replaceAll("\\", "/").toLowerCase() !== resolve(workspace.path).replaceAll("\\", "/").toLowerCase() || git(workspace.path, "rev-parse", "HEAD") !== workspace.baseCommit || commonGit({ ...workspace, repositoryPath: workspace.path }).toLowerCase() !== commonGit(workspace).toLowerCase()) throw new Error("Git worktree identity does not match its intent");
  } catch (error) { throw new DurableError("ownership_uncertain", String(error)); }
}
async function baseSnapshot(workspace: LocalWorkspace): Promise<LocalEvidence["candidate"]> {
  const files: LocalEvidence["candidate"]["files"] = [];
  const tree = execFileSync("git", ["-C", workspace.repositoryPath, "ls-tree", "-r", "-z", workspace.baseCommit], { windowsHide: true }).toString("utf8");
  for (const entry of tree.split("\0").filter(Boolean)) {
    const tab = entry.indexOf("\t"), [mode, type, object] = entry.slice(0, tab).split(" "), path = entry.slice(tab + 1);
    if (type !== "blob" || !object || (mode !== "100644" && mode !== "100755")) throw new Error("Unsupported base tree entry");
    const bytes = execFileSync("git", ["-C", workspace.repositoryPath, "-c", "core.autocrlf=false", `--attr-source=${workspace.baseCommit}`, "cat-file", "--filters", `${workspace.baseCommit}:${path}`], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    files.push({ path, digest: hash(bytes), mode: String(process.platform === "win32" ? 0o666 : mode === "100755" ? 0o755 : 0o644) });
  }
  files.sort((a, b) => a.path.localeCompare(b.path)); return { digest: hash(JSON.stringify(files)), files };
}
async function repairEvidence(reservation: RepairReservation, events: DurableEvent[]): Promise<LocalEvidence> {
  const index = events.findIndex(e => e.fact.type === "VerificationCompleted" && e.fact.operationId === reservation.failedVerificationId);
  if (index < 0) throw new Error("Missing repair source verification");
  const source = replay(events.slice(0, index + 1));
  if (source.state.status !== "REPAIR_READY" || source.verification.kind !== "completed" || stable(source.verification.evidence) !== stable(reservation.evidence)) throw new Error("Repair source is not the recorded failed verification");
  await checkArtifact(reservation.evidence);
  const evidence = await validateManifest(source, reservation.evidence.path, "historical");
  if (stable(evidence.verdict) !== stable(source.state)) throw new Error("Repair evidence disagrees with durable verification results");
  return evidence;
}
export async function checkRepairArtifacts(p: DurableProjection, events: DurableEvent[]): Promise<void> {
  for (const reservation of p.repairs ?? []) await repairEvidence(reservation, events);
}
export async function checkInitialRepairCandidate(p: DurableProjection, a: DurableAttempt, events: DurableEvent[], recoveredArtifacts: Artifact[] = []): Promise<void> {
  const origin = p.repairs?.findLast(r => r.attempt.ordinal <= a.ordinal);
  if (!origin) return;
  const startedPath = (attempt: DurableAttempt) => join(dirname(attempt.completionPath), "worker.started.json");
  const dispatched = recoveredArtifacts.some(ref => ref.path === startedPath(a)) || p.attempts.some(prior =>
    prior.ordinal >= origin.attempt.ordinal && prior.ordinal <= a.ordinal &&
    (prior.kind === "running" || prior.kind === "completed" || (prior.kind === "interrupted" && prior.artifacts.some(ref => ref.path === startedPath(prior)))));
  if (dispatched) return;
  const evidence = await repairEvidence(origin, events);
  if (stable(await snapshot(evidence.workspace.path)) !== stable(evidence.candidate)) throw new Error("Candidate changed before the first repair dispatch");
}
async function workerInput(p: DurableProjection, a: DurableAttempt, events: DurableEvent[]): Promise<string> {
  const config = p.contract.config, unit = p.graph.units[0]!;
  const loaded = await loadSkills(config, p.contract.programs);
  const instructions = loaded ? { instructions: loaded.instructions } : {};
  if (!config.decisions && !config.repair) return JSON.stringify({ request: config.request, unit, ...instructions });
  if (p.workspace.kind !== "ready") throw new Error("Worker context requires a ready workspace");
  const input: DecisionWorkerInput = {
    schemaVersion: 1, runId: p.runId, attemptId: a.id, workspace: p.workspace.workspace,
    context: {
      ...instructions,
      request: config.request, unit, priorAttempts: p.attempts.filter(prior => prior.ordinal < a.ordinal),
      decisions: (p.decisions ?? []).flatMap(d => d.kind === "resolved" ? [d.resolution] : []),
      evidence: p.attempts.flatMap(prior => prior.kind === "completed" && prior.ordinal < a.ordinal ? [{ id: prior.id, kind: "file" as const, uri: prior.record.path, digest: prior.record.digest }] : []),
      repositoryContext: [{ path: p.workspace.workspace.path, baseCommit: p.baseCommit }],
    },
  };
  const origin = p.repairs?.findLast(r => r.attempt.ordinal <= a.ordinal);
  if (origin) {
    const evidence = await repairEvidence(origin, events);
    if (evidence.verdict.status !== "REPAIR_READY") throw new Error("Invalid repair verdict");
    const repair: RepairContext = { repairId: origin.repairId, failedVerificationId: origin.failedVerificationId, failedAttemptId: evidence.attemptId, evidence: origin.evidence, results: evidence.verdict.results, commands: [] };
    for (const command of evidence.commands) repair.commands.push({ ...command, stdoutBase64: (await readFile(command.process.stdout.path)).toString("base64"), stderrBase64: (await readFile(command.process.stderr.path)).toString("base64") });
    input.context.repair = repair;
    input.context.evidence.push({ id: origin.failedVerificationId, kind: "test_result", uri: origin.evidence.path, digest: origin.evidence.digest });
  }
  return JSON.stringify(input);
}
export async function performWorker(p: DurableProjection, a: DurableAttempt, started: (identity: ProcessIdentity) => Promise<void>, events: DurableEvent[] = []): Promise<WorkerCompletion> {
  if (p.workspace.kind !== "ready") throw new Error("Worker requires a ready workspace");
  const config = p.contract.config, workspace = p.workspace.workspace, directory = dirname(a.completionPath);
  await mkdir(directory, { recursive: true });
  const schema = await save(join(directory, "worker-schema.json"), (config.decisions ? await readFile(new URL("../contracts/schemas/decision-wire.schema.json", import.meta.url), "utf8") : JSON.stringify({ type: "object", additionalProperties: false, required: ["kind", "message"], properties: { kind: { type: "string", enum: ["completed", "blocked", "failed"] }, message: { type: "string" } } })));
  const args = workerArgs(config, workspace.path, commonGit(workspace), schema.path);
  let input: string;
  try { await checkInitialRepairCandidate(p, a, events); input = await workerInput(p, a, events); } catch (error) { throw new DurableError("artifact_invalid", String(error)); }
  const record = await executeRestricted(config, workspace.path, commonGit(workspace), directory, "worker", config.worker.executable, args, config.worker.timeoutSeconds, undefined, input, resolve(config.worker.executable).toLowerCase() === resolve(config.sandboxExecutable).toLowerCase(), workspace.path, started);
  let result = await outcome(record, config.decisions ? { runId: p.runId, unitId: p.graph.units[0]!.id, attemptId: a.id } : undefined);
  try {
    const changed = changes(p.intake ? await gitBaseSnapshot(p) : await baseSnapshot(workspace), await snapshot(workspace.path));
    if (changed.some(path => !config.allowedPaths.some(a => a.endsWith("/") ? path.startsWith(a) : path === a))) throw new Error("Worker changed a forbidden path");
    await checkPrograms(p);
  } catch (error) { result = { kind: "failed", reason: String(error), evidence: [] }; }
  const completed: WorkerCompletion = { schemaVersion: 1, kind: "worker_completion", attemptId: a.id, process: record, outcome: result };
  await atomicWrite(a.completionPath, completed); return completed;
}
const powerShell = join(process.env.SystemRoot ?? "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
function processAlive(identity: ProcessIdentity): boolean {
  if (!Number.isSafeInteger(identity.pid) || identity.pid <= 0 || !identity.createdAt || !identity.executable) throw new Error("Malformed process identity");
  const encoded = Buffer.from(JSON.stringify(identity)).toString("base64");
  const script = `$i=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))|ConvertFrom-Json;try{$p=[Diagnostics.Process]::GetProcessById($i.pid);if($p.StartTime.ToUniversalTime().ToString('o') -eq $i.createdAt -and $p.MainModule.FileName -eq $i.executable){'alive'}else{'different'}}catch [ArgumentException]{'absent'}`;
  const result = execFileSync(powerShell, ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, encoding: "utf8", timeout: 10000 }).trim();
  if (result !== "alive" && result !== "absent" && result !== "different") throw new Error("Cannot inspect recorded process identity");
  return result === "alive";
}
export async function reconcileWorker(a: DurableAttempt): Promise<Artifact[]> {
  const stem = join(dirname(a.completionPath), "worker");
  if (!(await exists(`${stem}.json`))) return [];
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await exists(`${stem}.supervisor.json`)) {
      const identity = JSON.parse(await readFile(`${stem}.supervisor.json`, "utf8")) as ProcessIdentity;
      if (!processAlive(identity) && await exists(`${stem}.started.json`)) {
        const worker = JSON.parse(await readFile(`${stem}.started.json`, "utf8")) as ProcessIdentity;
        // A killed supervisor can lose its terminal file. The named Job and observed child must both be stopped.
        if (processAlive(worker) || !jobIsStopped(stem)) { await new Promise(done => setTimeout(done, 100)); continue; }
        const refs: Artifact[] = [];
        for (const suffix of ["stdout", "stderr", "termination", "started.json", "supervisor.json"]) if (await exists(`${stem}.${suffix}`)) refs.push(await artifact(`${stem}.${suffix}`));
        return refs;
      }
    }
    await new Promise(done => setTimeout(done, 100));
  }
  throw new DurableError("ownership_uncertain", "Previous worker supervisor has not confirmed cleanup");
}
export async function verify(p: DurableProjection, faults: Faults): Promise<LocalEvidence> {
  if (p.workspace.kind !== "ready" || p.verification.kind !== "intent") throw new Error("Missing verification intent");
  const a = p.attempts.at(-1)!; if (a.kind !== "completed") throw new Error("Verification requires completed worker");
  const worker = await completion(a.record.path, a.id, p), workspace = p.workspace.workspace, config = p.contract.config;
  const before = p.intake ? await gitBaseSnapshot(p) : await baseSnapshot(workspace), candidate = await snapshot(workspace.path), changedPaths = changes(before, candidate);
  const directory = join(dirname(p.verification.evidencePath), `check-${randomUUID()}`); await mkdir(directory, { recursive: true });
  const commands: LocalEvidence["commands"] = [], results: VerificationResult[] = [], issues: string[] = [];
  if (changedPaths.some(path => !config.allowedPaths.some(a => a.endsWith("/") ? path.startsWith(a) : path === a))) issues.push("Candidate changed a forbidden path");
  for (const spec of config.verification.required) {
    const binding = config.commands.find(c => c.specId === spec.id)!;
    let record: ProcessRecord;
    try {
      const cwd = join(workspace.path, spec.cwd ?? ""); await canonical(cwd);
      record = await executeRestricted(config, workspace.path, commonGit(workspace), directory, `command-${results.length}`, binding.executable, binding.args, spec.timeoutSeconds!, undefined, undefined, false, cwd, async () => { await faults.at("verification.after_dispatch", p.runId); });
    } catch (error) {
      const empty = await save(join(directory, `command-${results.length}.empty`), "");
      record = { executable: binding.executable, args: binding.args, cwd: workspace.path, termination: { kind: "launch_error", reason: String(error) }, stdout: empty, stderr: empty };
    }
    commands.push({ specId: spec.id, process: record });
    let result = commandResult(a.id, spec.id, record);
    try { if ((await snapshot(workspace.path)).digest !== candidate.digest) throw new Error("Candidate changed during verification"); await checkPrograms(p); }
    catch (error) { result = { ...result, status: "error", summary: String(error) }; }
    results.push(result);
    await faults.at("verification.after_command", p.runId);
  }
  const diff = await captureDiff(workspace.path, p.baseCommit, join(directory, "diff.json"), before, candidate, changedPaths, p.intake ? () => gitCandidateDiff(p) : undefined); issues.push(...diff.issues);
  const evidence: LocalEvidence = { schemaVersion: 1, kind: "local_evidence", attemptId: a.id, workspace, candidate, contract: p.contract, worker: { process: worker.process, outcome: worker.outcome }, commands, changedPaths, diff: diff.artifact, verdict: durableVerdict(p.graph.units[0]!, results, issues) };
  await atomicWrite(p.verification.evidencePath, evidence); return evidence;
}
export async function validateManifest(p: DurableProjection, path: string, scope: "current" | "historical" = "current"): Promise<LocalEvidence> {
  const value: unknown = JSON.parse(await readFile(path, "utf8")); validateStored("evidence", value); const e = value as LocalEvidence;
  if (p.workspace.kind !== "ready" || p.verification.kind === "idle" || e.attemptId !== p.verification.attemptId || stable(e.contract) !== stable(p.contract) || stable(e.workspace) !== stable(p.workspace.workspace)) throw new Error("Evidence does not match recorded intent");
  const a = p.attempts.at(-1)!; if (a.kind !== "completed") throw new Error("Evidence has no completed worker");
  const worker = await completion(a.record.path, a.id, p);
  if (stable(e.worker) !== stable({ process: worker.process, outcome: worker.outcome })) throw new Error("Manifest worker record changed");
  await reconcileWorkspace(e.workspace); await checkPrograms(p);
  if (scope === "current" && stable(await snapshot(e.workspace.path)) !== stable(e.candidate)) throw new Error("Candidate content changed");
  for (const ref of [e.diff, e.worker.process.stdout, e.worker.process.stderr, ...e.commands.flatMap(c => [c.process.stdout, c.process.stderr])]) await checkArtifact(ref);
  const diff: unknown = JSON.parse(await readFile(e.diff.path, "utf8"));
  if (!diff || typeof diff !== "object" || !("issues" in diff) || !Array.isArray(diff.issues) || diff.issues.some(issue => typeof issue !== "string")) throw new Error("Invalid required diff evidence");
  if (diff.issues.length && (e.verdict.status !== "FAILED" || e.verdict.reason !== diff.issues.join("; "))) throw new Error("Manifest verdict omits required diff capture failures");
  const facts = verificationFacts(e);
  if (stable(durableVerdict(p.graph.units[0]!, facts.results, facts.issues)) !== stable(e.verdict)) throw new Error("Manifest verdict does not match independent results");
  return e;
}
export function verificationFacts(e: LocalEvidence): { results: VerificationResult[]; issues: string[] } {
  const config = e.contract.config, ids = e.commands.map(c => c.specId);
  if (ids.length !== config.verification.required.length || new Set(ids).size !== ids.length || config.verification.required.some(s => !ids.includes(s.id))) throw new Error("Evidence commands do not cover each required verification exactly once");
  const results: VerificationResult[] = e.commands.map(c => {
    const spec = config.verification.required.find(s => s.id === c.specId)!, binding = config.commands.find(b => b.specId === c.specId)!;
    if (c.process.executable !== binding.executable || stable(c.process.args) !== stable(binding.args) || c.process.cwd !== join(e.workspace.path, spec.cwd ?? "")) throw new Error("Evidence command differs from its pinned binding");
    return commandResult(e.attemptId, c.specId, c.process);
  });
  if (e.verdict.status === "VERIFIED" || e.verdict.status === "REPAIR_READY") {
    if (stable(e.verdict.results) !== stable(results)) throw new Error("Manifest verdict results disagree with observed command records");
    return { results, issues: [] };
  }
  if (e.verdict.status === "FAILED") return { results, issues: [e.verdict.reason] };
  throw new Error("Evidence does not contain a final verification verdict");
}
