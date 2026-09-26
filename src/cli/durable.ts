import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DurableCliResult, DurableFact, DurableProjection } from "../contracts/durable.js";
import { stable } from "../kernel/durable.js";
import { artifact, contractDigest, git, programs, within } from "../adapters/local-files.js";
import { readConfig } from "../adapters/local-config.js";
import { DurableError, exists, Faults, Store, storePath } from "../adapters/durable-store.js";
import { checkArtifact, checkHistoryArtifacts, completion, performWorker, reconcileWorker, reconcileWorkspace, validateManifest, verificationFacts, verify } from "../adapters/durable-execution.js";

function parse(args: string[]): { command: "run" | "resume" | "status"; store: string; local?: string; limit?: number } {
  const command = args[0]; if (command !== "run" && command !== "resume" && command !== "status") throw new DurableError("input_error", "Unknown durable command");
  const options = new Map<string, string>(); let json = false;
  for (let i = 1; i < args.length; i++) {
    const key = args[i]!;
    if (key === "--json") { if (json) throw new DurableError("input_error", "Repeated --json argument"); json = true; continue; }
    if (!["--store", ...(command === "run" ? ["--local", "--max-starts"] : [])].includes(key) || options.has(key) || !args[i + 1] || args[i + 1]!.startsWith("--")) throw new DurableError("input_error", `Invalid or repeated argument: ${key}`);
    options.set(key, args[++i]!);
  }
  const store = options.get("--store"), local = options.get("--local"), limitText = options.get("--max-starts");
  if (!json || !store || (command === "run" && !local)) throw new DurableError("input_error", "Required durable command arguments are missing");
  let limit: number | undefined;
  if (limitText !== undefined) { limit = Number(limitText); if (!/^\d+$/.test(limitText) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new DurableError("input_error", "Worker-start limit must be an integer from 1 through 100"); }
  return { command, store, ...(local ? { local } : {}), ...(limit !== undefined ? { limit } : {}) };
}
async function pathExists(path: string): Promise<boolean> { try { await stat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
async function checkPlacement(path: string, config: DurableProjection["contract"]["config"]): Promise<void> {
  for (const root of [config.repositoryPath, config.workspaceRoot]) if (within(await storePath(root), path)) throw new DurableError("input_error", "Store must be outside the repository and writable workspace root");
}
export async function durableCommand(args: string[]): Promise<DurableCliResult> {
  let store: Store | undefined;
  try {
    const options = parse(args), faults = new Faults(), path = await storePath(options.store), hasDatabase = await exists(join(path, "run.sqlite"));
    if (options.command !== "run" && !hasDatabase) throw new DurableError("not_found", "No durable run exists at this store");
    let supplied: unknown;
    if (options.local) {
      try { supplied = JSON.parse(await readFile(options.local, "utf8")); }
      catch (error) { throw new DurableError("input_error", `Cannot read configuration: ${String(error)}`); }
    }
    let prepared: Awaited<ReturnType<typeof readConfig>> | undefined;
    if (!hasDatabase) {
      try { prepared = await readConfig(options.local!); await checkPlacement(path, prepared.config); }
      catch (error) { if (error instanceof DurableError) throw error; throw new DurableError("input_error", String(error)); }
    }
    store = await Store.open(path, options.command !== "status", faults);
    let current = store.read().projection;
    if (!current) {
      if (options.command !== "run") throw new DurableError("not_found", "Store has no committed run");
      prepared ??= await readConfig(options.local!); await checkPlacement(path, prepared.config);
      const config = prepared.config, pinned = await programs(config), request = config.request;
      const unit = { id: `${request.id}:unit:1`, objective: request.objective, constraints: request.constraints, verification: config.verification, metadata: request.metadata };
      current = await store.append(randomUUID(), { type: "RunCreated", contract: { digest: contractDigest(config, pinned), config, programs: pinned }, graph: { id: `${request.id}:graph`, requestId: request.id, units: [unit], dependencies: [] }, baseCommit: prepared.baseCommit, maxStarts: options.limit ?? 5 });
    }
    let p: DurableProjection = current;
    if (options.command === "status") { const result = store.read(); return { kind: "durable_status", projection: result.projection!, events: result.events }; }
    await checkPlacement(path, p.contract.config);
    if (options.command === "run" && (stable(supplied) !== stable(p.contract.config) || (options.limit !== undefined && options.limit !== p.maxStarts))) throw new DurableError("config_mismatch", "Run configuration and worker-start limit are immutable");
    const append = async (fact: DurableFact): Promise<void> => { p = await store!.append(p.runId, fact); };
    try { await checkHistoryArtifacts(p); } catch (error) { throw new DurableError("artifact_invalid", String(error)); }
    if (p.verification.kind === "completed") {
      try { await checkArtifact(p.verification.evidence); await validateManifest(p, p.verification.evidencePath); }
      catch (error) { throw new DurableError("artifact_invalid", String(error)); }
    } else if (p.state.status !== "FAILED" && p.state.status !== "REPAIR_READY") {
      if (p.workspace.kind === "unplanned") {
        const operationId = randomUUID();
        await append({ type: "WorkspacePlanned", operationId, workspace: { path: join(p.contract.config.workspaceRoot, operationId), repositoryPath: p.contract.config.repositoryPath, baseCommit: p.baseCommit } });
      }
      if (p.workspace.kind === "intent") {
        const operation = p.workspace, workspace = operation.workspace;
        if (await pathExists(workspace.path)) await reconcileWorkspace(workspace);
        else {
          await mkdir(dirname(workspace.path), { recursive: true });
          git(workspace.repositoryPath, "-c", "core.autocrlf=false", "worktree", "add", "--detach", workspace.path, p.baseCommit);
          await faults.at("workspace.after_create", p.runId); await reconcileWorkspace(workspace);
        }
        await append({ type: "WorkspaceReady", operationId: operation.operationId });
      }
      if (p.workspace.kind === "ready") await reconcileWorkspace(p.workspace.workspace);
      if (p.state.status === "RUNNING") {
        const a = p.attempts.at(-1)!; const artifacts = await reconcileWorker(a);
        if (await exists(a.completionPath)) {
          try {
            const record = await completion(a.completionPath, a.id);
            await append({ type: "WorkerCompleted", attemptId: a.id, outcome: record.outcome, record: await artifact(a.completionPath) });
          } catch (error) { throw new DurableError("artifact_invalid", String(error)); }
        } else await append({ type: "AttemptInterrupted", attemptId: a.id, reason: "Factory stopped before a trusted worker completion was committed", artifacts });
      }
      if (p.state.status === "READY") {
        if (p.attempts.length >= p.maxStarts) await append({ type: "RunStopped", reason: "worker_start_budget_exhausted", message: `Worker-start budget exhausted after ${p.maxStarts} reservations` });
        else {
          const id = randomUUID(), attempt = { id, ordinal: p.attempts.length + 1, completionPath: join(p.contract.config.artifactRoot, p.runId, id, "completion.json") };
          await append({ type: "AttemptReserved", attempt });
          const record = await performWorker(p, p.attempts.at(-1)!, async process => {
            await faults.at("worker.after_dispatch", p.runId);
            await append({ type: "WorkerStarted", attemptId: id, process });
          });
          await faults.at("worker.after_completion_artifact", p.runId);
          await append({ type: "WorkerCompleted", attemptId: id, outcome: record.outcome, record: await artifact(attempt.completionPath) });
        }
      }
      if (p.state.status === "VERIFYING") {
        const a = p.attempts.at(-1)!;
        if (p.verification.kind === "idle") {
          const operationId = randomUUID();
          await append({ type: "VerificationPlanned", operationId, attemptId: a.id, evidencePath: join(p.contract.config.artifactRoot, p.runId, a.id, "verification", "evidence.json") });
        }
        if (p.verification.kind !== "intent") throw new DurableError("corrupt_store", "Missing verification intent");
        const operation = p.verification;
        let evidence;
        if (await exists(operation.evidencePath)) {
          try { evidence = await validateManifest(p, operation.evidencePath); }
          catch (error) { throw new DurableError("artifact_invalid", String(error)); }
        } else {
          evidence = await verify(p, faults);
          await faults.at("verification.after_evidence_artifact", p.runId);
        }
        await append({ type: "VerificationCompleted", operationId: operation.operationId, ...verificationFacts(evidence), evidence: await artifact(operation.evidencePath) });
      }
    }
    const result = store.read(); return { kind: "durable_result", projection: result.projection!, events: result.events };
  } catch (error) {
    return { kind: "durable_error", code: error instanceof DurableError ? error.code : "corrupt_store", issues: [String(error)] };
  } finally { store?.close(); }
}
