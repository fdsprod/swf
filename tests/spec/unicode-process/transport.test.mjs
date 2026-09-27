import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.env.FACTORY_CANDIDATE_ROOT ?? process.cwd());
const { processInJob } = await import(
  pathToFileURL(join(root, "dist/adapters/windows-job.js")).href
);
async function observe({ unicodePath = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "swf-unicode-process-"));
  const cwd = join(directory, unicodePath ? "working—café-日本語" : "working");
  mkdirSync(cwd);
  const child = join(directory, "echo.cjs");
  writeFileSync(
    child,
    "process.stdout.write(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()})+'\\n');\n",
  );
  const args = [
    child,
    "plain-ascii-control",
    "Software Factory — Conceptual Specification.md",
    "café 日本語 😀",
    'space and "quotes" — preserved',
  ];
  const record = await processInJob({
    executable: process.execPath,
    args,
    cwd,
    directory,
    name: "owned-child",
    timeoutSeconds: 15,
  });
  return {
    directory,
    cwd,
    args,
    record,
    stdout: readFileSync(record.stdout.path, "utf8"),
    stderr: readFileSync(record.stderr.path, "utf8"),
  };
}
test("UNICODE-001: owned process preserves exact Unicode argv observed by the child", async () => {
  const result = await observe();
  assert.deepEqual(
    result.record.termination,
    { kind: "exited", exitCode: 0 },
    JSON.stringify({ directory: result.directory, stderr: result.stderr }),
  );
  const child = JSON.parse(result.stdout);
  assert.equal(
    child.args[0],
    "plain-ascii-control",
    "ASCII process launch control must pass",
  );
  assert.deepEqual(
    child.args,
    result.args.slice(1),
    "The actual child must receive exact Unicode argument strings",
  );
  assert.equal(child.cwd, result.cwd);
});
test("UNICODE-002: owned process preserves a Unicode working directory path", async () => {
  const result = await observe({ unicodePath: true });
  assert.deepEqual(
    result.record.termination,
    { kind: "exited", exitCode: 0 },
    "Existing Unicode cwd must launch: " +
      JSON.stringify({ directory: result.directory, stderr: result.stderr }),
  );
  const child = JSON.parse(result.stdout);
  assert.equal(child.cwd, result.cwd);
  assert.deepEqual(child.args, result.args.slice(1));
});
