import { loadSkills, SkillArtifactError } from "../adapters/skills.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Ajv } from "ajv";
import type { AgentOutcome, VerificationResult } from "../contracts/index.js";
import type { Artifact, LocalCliResult, LocalEvidence, ProcessRecord } from "../contracts/local.js";
import { run } from "../kernel/run.js";
import { readConfig } from "../adapters/local-config.js";
import { artifact, canonical, captureDiff, changes, contractDigest, git, programs, save, snapshot } from "../adapters/local-files.js";
import { commandResult, executeRestricted, outcome, workerArgs } from "../adapters/local-execution.js";
import fixtureSchema from "../contracts/schemas/run-fixture.schema.json" with { type: "json" };
import resultSchema from "../contracts/schemas/cli-result.schema.json" with { type: "json" };
import localConfigSchema from "../contracts/schemas/local-config.schema.json" with { type: "json" };
import localResultSchema from "../contracts/schemas/local-result.schema.json" with { type: "json" };
import evidenceSchema from "../contracts/schemas/local-evidence.schema.json" with { type: "json" };

export async function runLocal(path: string, signal?: AbortSignal): Promise<LocalCliResult> {
  let prepared: Awaited<ReturnType<typeof readConfig>>;
  let pinned: Awaited<ReturnType<typeof programs>>;
  try { prepared = await readConfig(path); if (prepared.config.decisions || prepared.config.repair) throw new Error("Decisions and repair require a durable store"); pinned = await programs(prepared.config); }
  catch (error) { return { kind: "input_error", issues: [String(error)], events: [] }; }
  const { config, baseCommit, commonGit } = prepared;
  const attemptId = randomUUID();
  const workspace = { path: join(config.workspaceRoot, attemptId), repositoryPath: config.repositoryPath, baseCommit };
  const directory = join(config.artifactRoot, attemptId);
  let before: LocalEvidence["candidate"];
  try {
    await mkdir(config.workspaceRoot, { recursive: true }); await mkdir(directory, { recursive: true });
    git(config.repositoryPath, "-c", "core.autocrlf=false", "worktree", "add", "--detach", workspace.path, baseCommit);
    before = await snapshot(workspace.path);
  } catch (error) { return { kind: "input_error", issues: [`Cannot prepare worktree: ${String(error)}`], events: [] }; }
  let candidate = before;
  let changedPaths: string[] = [];
  let workerProcess: ProcessRecord;
  let workerOutcome: AgentOutcome;
  let diff: Artifact | undefined;
  const commands: LocalEvidence["commands"] = [];
  const schema = await save(join(directory, "worker-schema.json"), JSON.stringify({ type: "object", additionalProperties: false, required: ["kind", "message"], properties: { kind: { type: "string", enum: ["completed", "blocked", "failed"] }, message: { type: "string" } } }));
  const result = await run(config.request, config.verification, {
    async execute(unit) {
      let instructions = {};
      try { const loaded = await loadSkills(config, pinned); if (loaded) instructions = { instructions: loaded.instructions }; }
      catch (error) { throw new SkillArtifactError(String(error)); }
      const args = workerArgs(config, workspace.path, commonGit, schema.path);
      workerProcess = await executeRestricted(config, workspace.path, commonGit, directory, "worker", config.worker.executable, args, config.worker.timeoutSeconds, signal, JSON.stringify({ request: config.request, unit, ...instructions }), resolve(config.worker.executable).toLowerCase() === resolve(config.sandboxExecutable).toLowerCase());
      workerOutcome = await outcome(workerProcess);
      try {
        candidate = await snapshot(workspace.path); changedPaths = changes(before, candidate);
        if (changedPaths.some(p => !config.allowedPaths.some(a => a.endsWith("/") ? p.startsWith(a) : p === a))) throw new Error("Worker changed a forbidden path");
        if (contractDigest(config, await programs(config)) !== contractDigest(config, pinned)) throw new Error("Pinned verification inputs changed");
        if (signal?.aborted) throw new Error("Run cancelled");
      } catch (error) { workerOutcome = { kind: "failed", reason: String(error), evidence: [] }; }
      return workerOutcome;
    },
  }, {
    async verify(_unit, specs) {
      const results: VerificationResult[] = [];
      for (const spec of specs) {
        const binding = config.commands.find(c => c.specId === spec.id)!;
        let record: ProcessRecord;
        try {
          const cwd = join(workspace.path, spec.cwd ?? ""); await canonical(cwd);
          record = await executeRestricted(config, workspace.path, commonGit, directory, `command-${results.length}`, binding.executable, binding.args, spec.timeoutSeconds!, signal, undefined, false, cwd);
        } catch (error) {
          const empty = await save(join(directory, `command-${results.length}.empty`), "");
          record = { executable: binding.executable, args: binding.args, cwd: workspace.path, termination: { kind: "launch_error", reason: String(error) }, stdout: empty, stderr: empty };
        }
        commands.push({ specId: spec.id, process: record });
        let result = commandResult(attemptId, spec.id, record);
        try {
          if ((await snapshot(workspace.path)).digest !== candidate.digest) throw new Error("Candidate changed during verification");
          if (contractDigest(config, await programs(config)) !== contractDigest(config, pinned)) throw new Error("Verification inputs changed during verification");
          if (signal?.aborted) throw new Error("Run cancelled");
        } catch (error) { result = { ...result, status: "error", summary: String(error) }; }
        results.push(result);
      }
      // Required evidence must exist before the kernel can accept passed checks.
      const captured = await captureDiff(workspace.path, baseCommit, join(directory, "diff.json"), before, candidate, changedPaths);
      diff = captured.artifact;
      if (captured.issues.length) return results.map(result => ({ ...result, status: "error", summary: `Required diff evidence is incomplete: ${captured.issues.join("; ")}` }));
      return results;
    },
  });
  diff ??= (await captureDiff(workspace.path, baseCommit, join(directory, "diff.json"), before, candidate, changedPaths)).artifact;
  const evidence: LocalEvidence = { schemaVersion: 1, kind: "local_evidence", attemptId, workspace, candidate, contract: { digest: contractDigest(config, pinned), config, programs: pinned }, worker: { process: workerProcess!, outcome: workerOutcome! }, commands, changedPaths, diff, verdict: result.state };
  const manifest = await save(join(directory, "evidence.json"), JSON.stringify(evidence));
  return { kind: "local_run_result", graph: result.graph, state: result.state, events: result.events, workspace, evidence: manifest };
}

export async function checkEvidence(path: string): Promise<LocalCliResult> {
  const issues: string[] = [];
  try {
    const ajv = new Ajv({ allErrors: true });
    for (const schema of [fixtureSchema, resultSchema, localConfigSchema, localResultSchema, evidenceSchema]) ajv.addSchema(schema);
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    const validate = ajv.getSchema<LocalEvidence>(evidenceSchema.$id)!;
    if (!validate(value)) throw new Error(ajv.errorsText(validate.errors));
    const evidence = value as LocalEvidence;
    if (evidence.verdict.status !== "VERIFIED") issues.push("The recorded verdict is not VERIFIED");
    if ((await snapshot(evidence.workspace.path)).digest !== evidence.candidate.digest) issues.push("Candidate content changed");
    if (git(evidence.workspace.path, "rev-parse", "HEAD") !== evidence.workspace.baseCommit) issues.push("Workspace base changed");
    if (contractDigest(evidence.contract.config, await programs(evidence.contract.config)) !== evidence.contract.digest) issues.push("Verification contract changed");
    for (const ref of [evidence.diff, evidence.worker.process.stdout, evidence.worker.process.stderr, ...evidence.commands.flatMap(c => [c.process.stdout, c.process.stderr])]) {
      if ((await artifact(ref.path)).digest !== ref.digest) issues.push(`Artifact changed: ${ref.path}`);
    }
  } catch (error) { issues.push(String(error)); }
  return { kind: "evidence_check", status: issues.length ? "invalid" : "current", issues };
}
