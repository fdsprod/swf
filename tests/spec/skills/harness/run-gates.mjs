import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { trustedRoot, candidateRoot, hash } from "./support.mjs";
const files = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
      )
    : [];
const manifest = (root, paths) =>
  Object.fromEntries(
    paths
      .sort()
      .map((p) => [
        relative(root, p).replaceAll("\\", "/"),
        hash(readFileSync(p)),
      ]),
  );
const trusted = () =>
  manifest(trustedRoot, [
    ...files(join(trustedRoot, "tests/spec")),
    ...["package.json", "package-lock.json", "tsconfig.json"].map((p) =>
      join(trustedRoot, p),
    ),
  ]);
const source = () => manifest(candidateRoot, files(join(candidateRoot, "src")));
const frozenBefore = trusted();
const sourceBefore = source();
const directory = resolve(
  process.env.SKILLS_PROOF_DIR || join(trustedRoot, ".p6-proof/skills/latest"),
);
mkdirSync(directory, { recursive: true });
const results = [];
function gate(name, args, { tests, timeout = 120000 } = {}) {
  const started = Date.now();
  const p = spawnSync(process.execPath, args, {
    cwd: candidateRoot,
    env: { ...process.env, FACTORY_CANDIDATE_ROOT: candidateRoot },
    encoding: "utf8",
    windowsHide: true,
    timeout,
    maxBuffer: 32 * 1024 * 1024,
  });
  const log =
    (p.stdout || "") + (p.stderr || "") + (p.error ? "\n" + p.error.stack : "");
  writeFileSync(join(directory, name + ".log"), log);
  const summary = Object.fromEntries(
    [
      ...log.matchAll(
        /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\r?$/gm,
      ),
    ].map((m) => [m[1], Number(m[2])]),
  );
  const complete =
    !tests ||
    (summary.tests === tests &&
      summary.pass + summary.fail === tests &&
      ["cancelled", "skipped", "todo"].every((k) => summary[k] === 0));
  results.push({
    name,
    command: [process.execPath, ...args],
    exitCode: p.status === 0 && complete ? 0 : p.status || 1,
    processExitCode: p.status,
    signal: p.signal,
    complete,
    summary,
    elapsedMs: Date.now() - started,
  });
  process.stdout.write(
    `${name}: ${results.at(-1).exitCode}, ${JSON.stringify(summary)}\n`,
  );
}
gate("typecheck", [
  join(trustedRoot, "node_modules/typescript/bin/tsc"),
  "--project",
  join(candidateRoot, "tsconfig.json"),
  "--noEmit",
]);
gate("build", [
  join(trustedRoot, "node_modules/typescript/bin/tsc"),
  "--project",
  join(candidateRoot, "tsconfig.json"),
]);
gate(
  "sanity",
  [
    "--test",
    "--test-reporter=tap",
    join(trustedRoot, "tests/spec/skills/harness/sanity.test.mjs"),
  ],
  { tests: 4 },
);
gate(
  "acceptance",
  [
    "--test",
    "--test-reporter=tap",
    "--test-concurrency=1",
    join(trustedRoot, "tests/spec/skills/scenarios/instructions.test.mjs"),
  ],
  { tests: 21, timeout: 1800000 },
);
gate(
  "canonical-schema",
  [
    "--test",
    "--test-reporter=tap",
    join(trustedRoot, "tests/spec/skills/scenarios/canonical-schema.test.mjs"),
  ],
  { tests: 2 },
);
const frozenAfter = trusted();
const sourceAfter = source();
for (const [name, before, after] of [
  ["frozen-tests", frozenBefore, frozenAfter],
  ["candidate-source", sourceBefore, sourceAfter],
]) {
  const changes = [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].filter((p) => before[p] !== after[p]);
  results.push({ name, exitCode: changes.length ? 1 : 0, changes });
}
function git(root, ...args) {
  const p = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  return p.status === 0 ? p.stdout.trim() : null;
}
const report = {
  feature: "skills",
  passed: results.every((r) => r.exitCode === 0),
  trustedRoot,
  candidateRoot,
  trustedRevision: git(trustedRoot, "rev-parse", "HEAD"),
  candidateRevision: git(candidateRoot, "rev-parse", "HEAD"),
  trustedStatus: git(trustedRoot, "status", "--porcelain"),
  candidateStatus: git(candidateRoot, "status", "--porcelain"),
  nodeVersion: process.version,
  bundleDigest: hash(JSON.stringify(frozenBefore)),
  candidateSourceDigestBefore: hash(JSON.stringify(sourceBefore)),
  candidateSourceDigestAfter: hash(JSON.stringify(sourceAfter)),
  frozenBefore,
  frozenAfter,
  sourceBefore,
  sourceAfter,
  results,
};
writeFileSync(
  join(directory, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
process.stdout.write(`Proof: ${directory}\n`);
process.exitCode = report.passed ? 0 : 1;
