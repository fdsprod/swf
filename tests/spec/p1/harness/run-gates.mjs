import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { candidateRoot, trustedRoot } from "./support.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function files(directory) {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(directory, entry.name))
      : [join(directory, entry.name)],
  );
}
const frozenFiles = (root) =>
  [
    ...files(join(root, "tests/spec")),
    ...files(join(root, "src/contracts/schemas")),
    ...[
      "src/contracts/index.ts",
      "src/contracts/local.ts",
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "tests/learning/p1/sandbox-probe.mjs",
    ].map((path) => join(root, path)),
  ]
    .map((path) => relative(root, path).replaceAll("\\", "/"))
    .sort();
const frozenPaths = frozenFiles(trustedRoot);
const manifest = (root) =>
  Object.fromEntries(
    frozenPaths.map((path) => [
      path,
      existsSync(join(root, path))
        ? hash(readFileSync(join(root, path)))
        : null,
    ]),
  );
const trustedManifest = manifest(trustedRoot);
const candidateManifest = manifest(candidateRoot);
const bundleDigest = hash(JSON.stringify(trustedManifest));
const proofDirectory = resolve(
  process.env.P1_PROOF_DIR || join(trustedRoot, ".p1-proof", "latest"),
);
mkdirSync(proofDirectory, { recursive: true });
writeFileSync(
  join(proofDirectory, "bundle-manifest.json"),
  JSON.stringify(
    { phase: "P1", bundleDigest, files: trustedManifest },
    null,
    2,
  ) + "\n",
);
const differences = frozenPaths.filter(
  (path) => trustedManifest[path] !== candidateManifest[path],
);
const results = [
  { name: "frozen-bundle", exitCode: differences.length ? 1 : 0, differences },
];
const sourceManifest = () =>
  Object.fromEntries(
    files(join(candidateRoot, "src"))
      .sort()
      .map((path) => [
        relative(candidateRoot, path).replaceAll("\\", "/"),
        hash(readFileSync(path)),
      ]),
  );
const sourcesBefore = sourceManifest();
function execute(
  name,
  args,
  { timeout = 120000, env = {}, tests = false } = {},
) {
  const started = Date.now();
  const child = spawnSync(process.execPath, args, {
    cwd: candidateRoot,
    env: { ...process.env, FACTORY_CANDIDATE_ROOT: candidateRoot, ...env },
    encoding: "utf8",
    timeout,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  const log = `${child.stdout || ""}${child.stderr || ""}${child.error ? "\n" + child.error.stack + "\n" : ""}`;
  const logPath = join(proofDirectory, `${name}.log`);
  writeFileSync(logPath, log);
  const summary = Object.fromEntries(
    [
      ...log.matchAll(
        /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\r?$/gm,
      ),
    ].map((match) => [match[1], Number(match[2])]),
  );
  const incomplete =
    tests &&
    (!(summary.tests > 0) ||
      ["pass", "fail", "cancelled", "skipped", "todo"].some(
        (key) => summary[key] === undefined,
      ) ||
      summary.fail !== 0 ||
      summary.cancelled !== 0 ||
      summary.skipped !== 0 ||
      summary.todo !== 0 ||
      summary.pass !== summary.tests);
  const exitCode = child.status === 0 && !incomplete ? 0 : child.status || 1;
  results.push({
    name,
    command: [process.execPath, ...args],
    exitCode,
    processExitCode: child.status,
    signal: child.signal,
    elapsedMs: Date.now() - started,
    summary,
    incomplete: Boolean(incomplete),
    logPath,
  });
  process.stdout.write(
    `${name}: exit ${exitCode}${summary.tests !== undefined ? `; tests ${summary.tests}, pass ${summary.pass}, fail ${summary.fail}` : ""}\n`,
  );
}
if (!differences.length) {
  execute(
    "p0-cumulative",
    [join(trustedRoot, "tests/spec/harness/run-gates.mjs")],
    {
      timeout: 240000,
      env: { P0_PROOF_DIR: join(proofDirectory, "p0") },
    },
  );
  execute(
    "p1-sanity",
    [
      "--test",
      "--test-reporter=tap",
      join(trustedRoot, "tests/spec/p1/harness/sanity.test.mjs"),
    ],
    { tests: true },
  );
  execute(
    "native-sandbox",
    [join(trustedRoot, "tests/learning/p1/sandbox-probe.mjs")],
    {
      timeout: 60000,
      env: { P1_COPY_NODE: "1", P1_NODE_OUTSIDE: "1", P1_SANDBOX_SHELL: "" },
    },
  );
  const scenarioDirectory = join(trustedRoot, "tests/spec/p1/scenarios");
  const scenarios = existsSync(scenarioDirectory)
    ? files(scenarioDirectory)
        .filter((path) => path.endsWith(".test.mjs"))
        .sort()
    : [];
  if (!scenarios.length) {
    results.push({
      name: "p1-acceptance",
      exitCode: 1,
      reason: "No P1 acceptance scenarios exist.",
    });
  } else {
    execute(
      "p1-acceptance",
      ["--test", "--test-reporter=tap", "--test-concurrency=1", ...scenarios],
      { timeout: 900000, tests: true },
    );
  }
}
function git(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}
const sourcesAfter = sourceManifest();
const sourceChanges = [
  ...new Set([...Object.keys(sourcesBefore), ...Object.keys(sourcesAfter)]),
].filter((path) => sourcesBefore[path] !== sourcesAfter[path]);
const frozenChanges = (root) => {
  const after = manifest(root);
  return [...new Set([...frozenPaths, ...frozenFiles(root)])].filter(
    (path) =>
      !Object.hasOwn(trustedManifest, path) ||
      trustedManifest[path] !== after[path],
  );
};
const trustedChanges = frozenChanges(trustedRoot);
const candidateChanges = frozenChanges(candidateRoot);
results.push({
  name: "frozen-bundle-after",
  exitCode: trustedChanges.length || candidateChanges.length ? 1 : 0,
  trustedChanges,
  candidateChanges,
});
results.push({
  name: "candidate-source-stability",
  exitCode: sourceChanges.length ? 1 : 0,
  differences: sourceChanges,
});
const report = {
  phase: "P1",
  trustedRoot,
  candidateRoot,
  trustedRevision: git(trustedRoot, ["rev-parse", "HEAD"]),
  candidateRevision: git(candidateRoot, ["rev-parse", "HEAD"]),
  candidateChanges: git(candidateRoot, [
    "status",
    "--porcelain",
    "--untracked-files=all",
  ]),
  nodeVersion: process.version,
  nodeExecutable: process.execPath,
  bundleDigest,
  candidateSourceDigestBefore: hash(JSON.stringify(sourcesBefore)),
  candidateSourceDigestAfter: hash(JSON.stringify(sourcesAfter)),
  candidateSourcesBefore: sourcesBefore,
  candidateSourcesAfter: sourcesAfter,
  results,
};
writeFileSync(
  join(proofDirectory, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
process.stdout.write(
  `Bundle SHA-256: ${bundleDigest}\nProof: ${proofDirectory}\n`,
);
process.exitCode = results.some((result) => result.exitCode !== 0) ? 1 : 0;
