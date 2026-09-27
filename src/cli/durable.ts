import { auditIntake, githubInput, intakeGitHub } from "../adapters/github-intake.js";
import { auditDelivery, deliver } from "../adapters/delivery.js";
import { createGitWorkspace } from "../adapters/git-delivery.js";
import type { GitHubIntake } from "../contracts/delivery.js";
import { auditDecisions, handleDecision } from "../adapters/decision-gateway.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DurableCliResult, DurableFact, DurableProjection } from "../contracts/durable.js";
import { stable } from "../kernel/durable.js";
import { artifact, contractDigest, git, programs, within } from "../adapters/local-files.js";
import { readConfig } from "../adapters/local-config.js";
import { DurableError, exists, Faults, Store, storePath } from "../adapters/durable-store.js";
import { checkArtifact, checkHistoryArtifacts, checkInitialRepairCandidate, checkRepairArtifacts, completion, performWorker, reconcileWorker, reconcileWorkspace, validateManifest, verificationFacts, verify } from "../adapters/durable-execution.js";

function parse(args: string[]): { command: "run" | "resume" | "status"; store: string; local?: string; github?: string; limit?: number } {
  const command = args[0]; if (command !== "run" && command !== "resume" && command !== "status") throw new DurableError("input_error", "Unknown durable command");
  const options = new Map<string, string>(); let json = false;
  for (let i = 1; i < args.length; i++) {
    const key = args[i]!;
    if (key === "--json") { if (json) throw new DurableError("input_error", "Repeated --json argument"); json = true; continue; }
    if (!["--store", ...(command === "run" ? ["--local", "--github", "--max-starts"] : [])].includes(key) || options.has(key) || !args[i + 1] || args[i + 1]!.startsWith("--")) throw new DurableError("input_error", `Invalid or repeated argument: ${key}`);
    options.set(key, args[++i]!);
  }
  const store = options.get("--store"), local = options.get("--local"), github = options.get("--github"), limitText = options.get("--max-starts");
  if (!json || !store || (command === "run" && ((!local && !github) || (local && github)))) throw new DurableError("input_error", "Required durable command arguments are missing");
  let limit: number | undefined;
  if (limitText !== undefined) { limit = Number(limitText); if (!/^\d+$/.test(limitText) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new DurableError("input_error", "Worker-start limit must be an integer from 1 through 100"); }
  return { command, store, ...(local ? { local } : {}), ...(github ? { github } : {}), ...(limit !== undefined ? { limit } : {}) };
}
async function pathExists(path: string): Promise<boolean> { try { await stat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
async function checkPlacement(path: string, config: Pick<DurableProjection["contract"]["config"], "repositoryPath" | "workspaceRoot">): Promise<void> {
  for (const root of [config.repositoryPath, config.workspaceRoot]) if (within(await storePath(root), path)) throw new DurableError("input_error", "Store must be outside the repository and writable workspace root");
}
export async function durableCommand(args: string[]): Promise<DurableCliResult> {
  let store: Store | undefined;
  try {
    const options = parse(args), faults = new Faults(), path = await storePath(options.store), hasDatabase = await exists(join(path, "run.sqlite"));
    if (options.command !== "run" && !hasDatabase) throw new DurableError("not_found", "No durable run exists at this store");
    let supplied: unknown;
    if (options.local || options.github) {
      try { supplied = JSON.parse(await readFile((options.local ?? options.github)!, "utf8")); }
      catch (error) { throw new DurableError("input_error", `Cannot read configuration: ${String(error)}`); }
    }
    const proposedRunId = randomUUID();
    let intake: GitHubIntake | undefined;
    let prepared: Awaited<ReturnType<typeof readConfig>> | undefined;
    if (!hasDatabase) {
      try {
        if (options.github) {
          const input = await githubInput(supplied); await checkPlacement(path, input.runtime);
          ({ prepared, intake } = await intakeGitHub(input, proposedRunId));
        } else prepared = await readConfig(options.local!);
        await checkPlacement(path, prepared.config);
      }
      catch (error) { if (error instanceof DurableError) throw error; throw new DurableError("input_error", String(error)); }
    }
    store = await Store.open(path, options.command !== "status", faults);
    let current = store.read().projection;
    if (!current) {
      if (options.command !== "run") throw new DurableError("not_found", "Store has no committed run");
      if (!prepared) {
        if (options.github) {
          const input = await githubInput(supplied); await checkPlacement(path, input.runtime);
          ({ prepared, intake } = await intakeGitHub(input, proposedRunId));
        } else prepared = await readConfig(options.local!);
      }
      await checkPlacement(path, prepared.config);
      const config = prepared.config, request = config.request;
      let pinned: Awaited<ReturnType<typeof programs>>;
      try { pinned = await programs(config, intake ? [intake.input.github.executable, intake.input.git.executable] : []); }
      catch (error) { if (!config.skills) throw error; throw new DurableError("input_error", String(error)); }
      const unit = { id: `${request.id}:unit:1`, objective: request.objective, constraints: request.constraints, verification: config.verification, metadata: request.metadata };
      current = await store.append(proposedRunId, { type: "RunCreated", ...(intake ? { intake } : {}), contract: { digest: contractDigest(config, pinned), config, programs: pinned }, graph: { id: `${request.id}:graph`, requestId: request.id, units: [unit], dependencies: [] }, baseCommit: prepared.baseCommit, maxStarts: options.limit ?? 5 });
    }
    let p: DurableProjection = current;
    if (options.command === "status") { const result = store.read(); return { kind: "durable_status", projection: result.projection!, events: result.events }; }
    await checkPlacement(path, p.contract.config);
    if (options.command === "run" && (stable(supplied) !== stable(options.github ? p.intake?.input : p.contract.config) || (options.limit !== undefined && options.limit !== p.maxStarts))) throw new DurableError("config_mismatch", "Run configuration and worker-start limit are immutable");
    const append = async (fact: DurableFact): Promise<void> => { p = await store!.append(p.runId, fact); };
    try { await checkHistoryArtifacts(p); await auditDecisions(p, store.read().events); await checkRepairArtifacts(p, store.read().events); await auditIntake(p); await auditDelivery(p, store.read().events); } catch (error) { throw new DurableError("artifact_invalid", String(error)); }
    if (p.verification.kind === "completed") {
      try { await checkArtifact(p.verification.evidence); await validateManifest(p, p.verification.evidencePath); }
      catch (error) { throw new DurableError("artifact_invalid", String(error)); }
    }
    if (p.state.status !== "FAILED" && p.state.status !== "VERIFIED" && (p.state.status !== "REPAIR_READY" || p.contract.config.repair)) {
      if (p.workspace.kind === "unplanned") {
        const operationId = randomUUID();
        await append({ type: "WorkspacePlanned", operationId, workspace: { path: join(p.contract.config.workspaceRoot, operationId), repositoryPath: p.contract.config.repositoryPath, baseCommit: p.baseCommit } });
      }
      if (p.workspace.kind === "intent") {
        const operation = p.workspace, workspace = operation.workspace;
        if (await pathExists(workspace.path)) await reconcileWorkspace(workspace);
        else {
          await mkdir(dirname(workspace.path), { recursive: true });
          if (p.intake) await createGitWorkspace(p, workspace);
          else git(workspace.repositoryPath, "-c", "core.autocrlf=false", "worktree", "add", "--detach", workspace.path, p.baseCommit);
          await faults.at("workspace.after_create", p.runId); await reconcileWorkspace(workspace);
        }
        await append({ type: "WorkspaceReady", operationId: operation.operationId });
      }
      if (p.workspace.kind === "ready") await reconcileWorkspace(p.workspace.workspace);
      if (p.state.status === "RUNNING") {
        const a = p.attempts.at(-1)!; const artifacts = await reconcileWorker(a);
        try { await checkInitialRepairCandidate(p, a, store.read().events, artifacts); }
        catch (error) { throw new DurableError("artifact_invalid", String(error)); }
        if (await exists(a.completionPath)) {
          try {
            const record = await completion(a.completionPath, a.id, p);
            await append({ type: "WorkerCompleted", attemptId: a.id, outcome: record.outcome, record: await artifact(a.completionPath) });
          } catch (error) { throw new DurableError("artifact_invalid", String(error)); }
        } else await append({ type: "AttemptInterrupted", attemptId: a.id, reason: "Factory stopped before a trusted worker completion was committed", artifacts });
      }
      const attemptIdentity = () => {
        const id = randomUUID();
        return { id, ordinal: p.attempts.length + 1, completionPath: join(p.contract.config.artifactRoot, p.runId, id, "completion.json") };
      };
      const stopForStarts = async () => append({ type: "RunStopped", reason: "worker_start_budget_exhausted", message: "Worker-start budget exhausted after " + p.maxStarts + " reservations" });
      const status = () => p.state.status;
      // Recovery above handles only work inherited from the previous factory. New reservations dispatch here.
      while (true) {
        if (status() === "WAITING_FOR_DECISION") {
          await handleDecision(() => p, append, faults);
          if (status() === "WAITING_FOR_DECISION") break;
        }
        if (status() === "REPAIR_READY") {
          if (!p.contract.config.repair) break;
          if (p.verification.kind !== "completed") throw new DurableError("corrupt_store", "Repair requires completed verification");
          try { await checkArtifact(p.verification.evidence); await validateManifest(p, p.verification.evidencePath); }
          catch (error) { throw new DurableError("artifact_invalid", String(error)); }
          if (p.attempts.length >= p.maxStarts) { await stopForStarts(); break; }
          const limit = p.contract.config.repair.maxRepairs ?? 1;
          if (p.repairs!.length >= limit) {
            await append({ type: "RunStopped", reason: "repair_budget_exhausted", message: "Repair budget exhausted after " + limit + " reservations" }); break;
          }
          await append({ type: "RepairReserved", repairId: randomUUID(), failedVerificationId: p.verification.operationId, evidence: p.verification.evidence, attempt: attemptIdentity() });
        }
        if (status() === "READY") {
          if (p.attempts.length >= p.maxStarts) { await stopForStarts(); break; }
          await append({ type: "AttemptReserved", attempt: attemptIdentity() });
        }
        if (status() === "RUNNING") {
          const attempt = p.attempts.at(-1)!;
          const record = await performWorker(p, attempt, async process => {
            await faults.at("worker.after_dispatch", p.runId);
            await append({ type: "WorkerStarted", attemptId: attempt.id, process });
          }, store.read().events);
          await faults.at("worker.after_completion_artifact", p.runId);
          await append({ type: "WorkerCompleted", attemptId: attempt.id, outcome: record.outcome, record: await artifact(attempt.completionPath) });
        }
        if (status() === "WAITING_FOR_DECISION") {
          await handleDecision(() => p, append, faults); break;
        }
        if (status() === "VERIFYING") {
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
        if (!p.contract.config.repair || status() !== "REPAIR_READY") break;
      }
    }
    if (p.intake && p.state.status === "VERIFIED") await deliver(() => p, append, faults);
    const result = store.read(); return { kind: "durable_result", projection: result.projection!, events: result.events };
  } catch (error) {
    return { kind: "durable_error", code: error instanceof DurableError ? error.code : "corrupt_store", issues: [String(error)] };
  } finally { store?.close(); }
}
