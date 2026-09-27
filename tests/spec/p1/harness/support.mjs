import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import Ajv from "ajv";
export const trustedRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
export const candidateRoot = resolve(
  process.env.FACTORY_CANDIDATE_ROOT || trustedRoot,
);
export const codexPath =
  process.env.P1_CODEX_EXE ||
  "C:/nvm4w/nodejs/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe";
export const hash = (value) => createHash("sha256").update(value).digest("hex");
const ajv = new Ajv({ strict: true, allErrors: true });
for (const name of [
  "run-fixture",
  "cli-result",
  "local-config",
  "local-result",
  "local-evidence",
]) {
  ajv.addSchema(
    JSON.parse(
      readFileSync(
        join(trustedRoot, `src/contracts/schemas/${name}.schema.json`),
        "utf8",
      ),
    ),
  );
}
export const validateConfig = ajv.getSchema(
  "https://swf.local/schemas/p1/local-config.schema.json",
);
export const validateResult = ajv.getSchema(
  "https://swf.local/schemas/p1/local-result.schema.json",
);
export const validateEvidence = ajv.getSchema(
  "https://swf.local/schemas/p1/local-evidence.schema.json",
);
export function git(cwd, ...args) {
  const p = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });
  assert.ifError(p.error);
  assert.equal(p.status, 0, `git ${args.join(" ")}: ${p.stderr}`);
  return p.stdout.trim();
}
export function fixture({ worker = "good", verifier = "good" } = {}) {
  const createdAt = Date.now();
  const root = mkdtempSync(join(tmpdir(), "swf-p1-"));
  const repo = join(root, "repo");
  const trusted = join(root, "trusted");
  for (const d of [
    repo,
    trusted,
    join(repo, "src"),
    join(repo, "tests"),
    join(root, "workspaces"),
    join(root, "artifacts"),
  ]) {
    mkdirSync(d, { recursive: true });
  }
  copyFileSync(process.execPath, join(root, "node.exe"));
  copyFileSync(
    join(trustedRoot, "tests/spec/p1/fixtures/codex-double.cjs"),
    join(trusted, "codex-double.cjs"),
  );
  copyFileSync(
    join(trustedRoot, "tests/spec/p1/fixtures/verifier.cjs"),
    join(trusted, "verifier.cjs"),
  );
  writeFileSync(join(trusted, "helper.cjs"), "module.exports = 42;\n");
  writeFileSync(join(repo, "src", "answer.cjs"), "module.exports = 0;\n");
  writeFileSync(
    join(repo, "tests", "protected.cjs"),
    'throw new Error("Candidate test is not the trusted judge");\n',
  );
  writeFileSync(join(repo, "README.md"), "fixture\n");
  writeFileSync(join(root, "external.txt"), "external-original");
  writeFileSync(join(root, "credentials.txt"), "fake-delivery-credential");
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "BP Fixture");
  git(repo, "config", "user.email", "bp@example.invalid");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "fixture baseline");
  writeFileSync(join(repo, ".git", "protected.txt"), "git-original");
  const base = git(repo, "rev-parse", "HEAD");
  const config = {
    schemaVersion: 1,
    request: {
      id: "p1-request",
      source: { provider: "fixture", externalId: "p1" },
      repository: { url: repo, baseRef: "main" },
      objective: "Set src/answer.cjs to export the number 42.",
      constraints: ["Only edit src/"],
      acceptanceCriteria: ["Trusted answer check passes"],
      metadata: {},
    },
    verification: {
      required: [
        {
          kind: "command",
          id: "answer",
          command: "external answer assertion",
          timeoutSeconds: 2,
        },
      ],
      completionPolicy: { requireAll: true },
    },
    repositoryPath: repo,
    workspaceRoot: join(root, "workspaces"),
    artifactRoot: join(root, "artifacts"),
    worker: {
      executable: join(root, "node.exe"),
      prefixArgs: [join(trusted, "codex-double.cjs"), worker, root],
      timeoutSeconds: worker.startsWith("hang") ? 2 : 20,
    },
    sandboxExecutable: codexPath,
    commands: [
      {
        specId: "answer",
        executable: join(root, "node.exe"),
        args: [join(trusted, "verifier.cjs"), verifier, root],
      },
    ],
    allowedPaths: ["src/"],
    protectedPaths: ["tests"],
    blockedReadPaths: [join(root, "credentials.txt")],
    verificationInputs: [trusted],
  };
  assert.ok(validateConfig(config), ajv.errorsText(validateConfig.errors));
  return {
    root,
    repo,
    trusted,
    base,
    config,
    createdAt,
    cleanup() {
      // Never trust a worker-written PID. Match OS executable identity and creation time.
      const exe = join(root, "node.exe").replaceAll("'", "''");
      spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${exe}' -and $_.CreationDate.ToUniversalTime() -ge [DateTimeOffset]::FromUnixTimeMilliseconds(${createdAt}).UtcDateTime } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
        ],
        { windowsHide: true, encoding: "utf8", timeout: 15000 },
      );
      const rel = relative(resolve(tmpdir()), resolve(root));
      assert.ok(
        rel &&
          !rel.startsWith("..") &&
          !isAbsolute(rel) &&
          root.includes("swf-p1-"),
      );
      rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    },
  };
}
export function ownedProcesses(f) {
  const exe = join(f.root, "node.exe").replaceAll("'", "''");
  const p = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${exe}' -and $_.CreationDate.ToUniversalTime() -ge [DateTimeOffset]::FromUnixTimeMilliseconds(${f.createdAt}).UtcDateTime } | ForEach-Object { $_.ProcessId }`,
    ],
    { windowsHide: true, encoding: "utf8", timeout: 15000 },
  );
  assert.ifError(p.error);
  assert.equal(p.status, 0, p.stderr);
  return (p.stdout.match(/\b\d+\b/g) || []).map(Number);
}
export function launch(
  args,
  {
    env = {},
    timeoutMs = 90000,
    entrypoint = join(candidateRoot, "dist/cli/main.js"),
  } = {},
) {
  const p = spawnSync(process.execPath, [entrypoint, ...args], {
    cwd: candidateRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  assert.ifError(p.error);
  assert.equal(p.signal, null);
  assert.match(
    p.stdout,
    /^\{[^\r\n]*\}\r?\n$/,
    `One JSON line required: ${p.stdout}\n${p.stderr}`,
  );
  const result = JSON.parse(p.stdout);
  assert.ok(validateResult(result), ajv.errorsText(validateResult.errors));
  return { code: p.status, result, stderr: p.stderr };
}
export function run(f, options) {
  const p = join(f.root, "config.json");
  writeFileSync(p, JSON.stringify(f.config));
  return launch(["run", "--local", p, "--json"], options);
}
export function check(path) {
  return launch(["check", "--evidence", path, "--json"]);
}
export function assertLocal(o, f, status) {
  assert.equal(o.result.kind, "local_run_result");
  assert.equal(o.result.state.status, status);
  assert.equal(o.code, status === "VERIFIED" ? 0 : 1);
  assert.equal(o.result.workspace.repositoryPath, f.repo);
  assert.equal(o.result.workspace.baseCommit, f.base);
  assert.notEqual(o.result.workspace.path, f.repo);
  assert.equal(git(f.repo, "status", "--porcelain"), "");
  assert.equal(
    readFileSync(join(f.repo, "src", "answer.cjs"), "utf8"),
    "module.exports = 0;\n",
  );
  const bytes = readFileSync(o.result.evidence.path);
  assert.equal(hash(bytes), o.result.evidence.digest);
  const manifest = JSON.parse(bytes);
  assert.ok(
    validateEvidence(manifest),
    ajv.errorsText(validateEvidence.errors),
  );
  assert.deepEqual(manifest.verdict, o.result.state);
  assert.deepEqual(manifest.workspace, o.result.workspace);
  for (const artifact of [
    manifest.diff,
    manifest.worker.process.stdout,
    manifest.worker.process.stderr,
    ...manifest.commands.flatMap((c) => [c.process.stdout, c.process.stderr]),
  ]) {
    assert.equal(hash(readFileSync(artifact.path)), artifact.digest);
  }
  return manifest;
}
export function assertRejected(o) {
  assert.equal(o.code, 2);
  assert.equal(o.result.kind, "input_error");
  assert.deepEqual(o.result.events, []);
  assert.ok(o.result.issues.length);
}
export function assertInvalid(o) {
  assert.equal(o.code, 1);
  assert.equal(o.result.kind, "evidence_check");
  assert.equal(o.result.status, "invalid");
  assert.ok(o.result.issues.length);
}
