import { Ajv } from "ajv";
import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import fixtureSchema from "../contracts/schemas/run-fixture.schema.json" with { type: "json" };
import configSchema from "../contracts/schemas/local-config.schema.json" with { type: "json" };
import type { LocalConfig } from "../contracts/local.js";
import { canonical, git, within } from "./local-files.js";
import { verificationContractIssues } from "../contracts/validation.js";
const ajv = new Ajv({ allErrors: true });
ajv.addSchema(fixtureSchema);
const validate = ajv.compile<LocalConfig>(configSchema);
const relativePath = (s: string): boolean => !!s && !isAbsolute(s) && !s.includes("\\") && !s.split("/").some(p => p === ".." || p === ".") && !s.includes(":") && !s.includes("\0");
export async function readConfig(path: string): Promise<{ config: LocalConfig; baseCommit: string; commonGit: string }> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!validate(value)) throw new Error(ajv.errorsText(validate.errors));
  const config = value;
  const errors = verificationContractIssues(config.verification);
  if (errors.length) throw new Error(errors.join("; "));
  for (const p of [config.repositoryPath, config.workspaceRoot, config.artifactRoot, ...config.blockedReadPaths, ...config.verificationInputs]) {
    if (!isAbsolute(p)) throw new Error(`Absolute path required: ${p}`);
    await canonical(p);
  }
  for (const p of [config.worker.executable, config.sandboxExecutable, ...config.commands.map(c => c.executable)]) if (!isAbsolute(p)) throw new Error("Executable paths must be absolute");
  for (const a of [config.repositoryPath, config.workspaceRoot, config.artifactRoot]) for (const b of [config.repositoryPath, config.workspaceRoot, config.artifactRoot]) {
    if (a !== b && within(a, b)) throw new Error("Repository, workspace, and artifacts must be separate");
  }
  if (new Set([config.repositoryPath, config.workspaceRoot, config.artifactRoot].map(p => resolve(p).toLowerCase())).size !== 3) throw new Error("Directory roots overlap");
  for (const p of [...config.allowedPaths, ...config.protectedPaths]) if (!relativePath(p)) throw new Error(`Invalid relative path: ${p}`);
  for (const spec of config.verification.required) {
    if (!spec.timeoutSeconds || spec.timeoutSeconds <= 0 || spec.timeoutSeconds > 3600) throw new Error("Verification timeout must be bounded");
    if (spec.cwd && !relativePath(spec.cwd)) throw new Error("Verification cwd must stay in the worktree");
  }
  const ids = config.commands.map(c => c.specId);
  if (new Set(ids).size !== ids.length || ids.length !== config.verification.required.length || ids.some(id => !config.verification.required.some(s => s.id === id))) throw new Error("Command bindings must match the verification contract");
  for (const input of [...config.verificationInputs, config.worker.executable, config.sandboxExecutable, ...config.commands.map(c => c.executable)]) if (within(config.workspaceRoot, input)) throw new Error("Programs and verification inputs must be outside the workspace");
  // Wrapper arguments are data only. Codex policy and host settings belong to this adapter.
  if (config.worker.prefixArgs.some(a => a.startsWith("-"))) throw new Error("Worker prefix arguments cannot contain options");
  const knownHome = resolve(process.env.CODEX_HOME ?? join(homedir(), ".codex")).toLowerCase();
  for (const root of [config.repositoryPath, config.workspaceRoot]) {
    for (let dir = resolve(root); ; dir = dirname(dir)) {
      const candidate = join(dir, ".codex", "config.toml");
      if (dirname(candidate).toLowerCase() !== knownHome) {
        let exists = true; try { await access(candidate); } catch { exists = false; }
        if (exists) throw new Error(`Project Codex configuration is not allowed: ${candidate}`);
      }
      if (dirname(dir) === dir) break;
    }
  }
  const baseCommit = git(config.repositoryPath, "rev-parse", "--verify", "--end-of-options", `${config.request.repository.baseRef}^{commit}`);
  const tree = git(config.repositoryPath, "ls-tree", "-r", baseCommit).split("\n");
  if (tree.some(line => line.startsWith("120000 ") || line.startsWith("160000 "))) throw new Error("Base tree links and submodules are not supported");
  if (tree.some(line => line.endsWith("\t.codex/config.toml"))) throw new Error("Base tree contains project Codex configuration");
  const commonGit = resolve(config.repositoryPath, git(config.repositoryPath, "rev-parse", "--git-common-dir"));
  return { config, baseCommit, commonGit };
}
