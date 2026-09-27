import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixture, git, run, assertLocal, check } from "../harness/support.mjs";

test("P1-016 verifier cwd keeps protected paths anchored to the worktree root", () => {
  const f = fixture();
  try {
    const protectedDirectory = join(f.repo, "src", "protected");
    mkdirSync(protectedDirectory);
    writeFileSync(
      join(protectedDirectory, "sentinel.txt"),
      "protected-original",
    );
    git(f.repo, "add", "src/protected/sentinel.txt");
    git(f.repo, "commit", "-m", "protected verifier subdirectory fixture");
    f.base = git(f.repo, "rev-parse", "HEAD");
    f.config.protectedPaths.push("src/protected");
    f.config.verification.required[0].cwd = "src";
    f.config.verification.required[0].timeoutSeconds = 5;
    const verifier = join(f.trusted, "subdirectory-verifier.cjs");
    writeFileSync(
      verifier,
      `
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const sentinel=path.join(process.cwd(),'protected','sentinel.txt');
let write='wrote';
try {fs.writeFileSync(sentinel,'BREACH');}catch(error){write=error.code;}
const observed=require(path.join(process.cwd(),'answer.cjs'));
const report={cwd:process.cwd(),write,sentinel:fs.readFileSync(sentinel,'utf8'),answer:observed};
console.log('subdirectory-report:'+JSON.stringify(report));
assert.equal(observed,42);
assert.match(write,/^E(ACCES|PERM)$/);
assert.equal(report.sentinel,'protected-original');
`,
    );
    f.config.commands[0].args = [verifier];

    const observed = run(f);
    assert.equal(observed.result.kind, "local_run_result");
    const manifest = JSON.parse(
      readFileSync(observed.result.evidence.path, "utf8"),
    );
    assert.equal(
      manifest.commands.length,
      1,
      "A valid subdirectory command must execute",
    );
    const output = readFileSync(
      manifest.commands[0].process.stdout.path,
      "utf8",
    );
    const line = output
      .split(/\r?\n/)
      .find((line) => line.startsWith("subdirectory-report:"));
    assert.ok(
      line,
      `Verifier must emit its independent observation: ${output}`,
    );
    const report = JSON.parse(line.slice("subdirectory-report:".length));
    assert.equal(report.cwd, join(observed.result.workspace.path, "src"));
    assert.equal(report.answer, 42);
    assert.match(
      report.write,
      /^E(ACCES|PERM)$/,
      "The real restriction must deny the write from a subdirectory cwd",
    );
    assert.equal(report.sentinel, "protected-original");
    assert.equal(
      readFileSync(
        join(observed.result.workspace.path, "src/protected/sentinel.txt"),
        "utf8",
      ),
      "protected-original",
    );
    const accepted = assertLocal(observed, f, "VERIFIED");
    assert.equal(
      accepted.commands[0].process.cwd,
      join(observed.result.workspace.path, "src"),
    );
    assert.deepEqual(accepted.commands[0].process.termination, {
      kind: "exited",
      exitCode: 0,
    });
    assert.equal(check(observed.result.evidence.path).result.status, "current");
  } finally {
    f.cleanup();
  }
});
