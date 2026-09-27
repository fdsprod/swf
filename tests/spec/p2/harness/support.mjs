import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import Ajv from "ajv";
import {
  fixture as p1Fixture,
  trustedRoot,
  candidateRoot,
  hash,
  git,
  ownedProcesses,
} from "../../p1/harness/support.mjs";
export { trustedRoot, candidateRoot, hash, git, ownedProcesses };

const ajv = new Ajv({ strict: true, allErrors: true });
for (const name of [
  "run-fixture",
  "cli-result",
  "local-config",
  "local-result",
  "local-evidence",
  "durable-result",
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
export const validateResult = ajv.getSchema(
  "https://swf.local/schemas/p2/durable-result.schema.json",
);
export const validateEvent = ajv.compile({
  $ref: "https://swf.local/schemas/p2/durable-result.schema.json#/definitions/event",
});
export const validateProjection = ajv.compile({
  $ref: "https://swf.local/schemas/p2/durable-result.schema.json#/definitions/projection",
});
export const validateCompletion = ajv.compile({
  $ref: "https://swf.local/schemas/p2/durable-result.schema.json#/definitions/workerCompletion",
});
export const validateEvidence = ajv.getSchema(
  "https://swf.local/schemas/p1/local-evidence.schema.json",
);
export function schema(validator, value) {
  assert.ok(validator(value), ajv.errorsText(validator.errors));
}

export function fixture({ worker = "good", verifier = "good" } = {}) {
  const f = p1Fixture();
  f.store = join(f.root, "store");
  f.configPath = join(f.root, "p2-config.json");
  f.handles = new Set();
  copyFileSync(
    join(trustedRoot, "tests/spec/p2/fixtures/codex-double.cjs"),
    join(f.trusted, "p2-worker.cjs"),
  );
  copyFileSync(
    join(trustedRoot, "tests/spec/p2/fixtures/verifier.cjs"),
    join(f.trusted, "p2-verifier.cjs"),
  );
  f.config.worker.prefixArgs = [
    join(f.trusted, "p2-worker.cjs"),
    worker,
    f.root,
  ];
  f.config.worker.timeoutSeconds = 40;
  f.config.commands[0].args = [
    join(f.trusted, "p2-verifier.cjs"),
    verifier,
    f.root,
  ];
  writeConfig(f);
  return f;
}
export function writeConfig(f) {
  writeFileSync(f.configPath, JSON.stringify(f.config));
}
export async function withFixture(options, action) {
  if (typeof options === "function") {
    action = options;
    options = {};
  }
  const f = fixture(options);
  try {
    return await action(f);
  } finally {
    for (const handle of f.handles) {
      if (!handle.closed) {
        await killFactory(handle);
      }
    }
    f.cleanup();
  }
}
export const runArgs = (f, maxStarts) => [
  "run",
  "--local",
  f.configPath,
  "--store",
  f.store,
  ...(maxStarts === undefined ? [] : ["--max-starts", String(maxStarts)]),
  "--json",
];
export const resumeArgs = (f) => ["resume", "--store", f.store, "--json"];
export const statusArgs = (f) => ["status", "--store", f.store, "--json"];
export function decode(child) {
  assert.equal(
    child.signal,
    null,
    `Factory signal: ${child.signal}\n${child.stderr}`,
  );
  assert.match(
    child.stdout,
    /^\{[^\r\n]*\}\r?\n$/,
    `One JSON result required: ${child.stdout}\n${child.stderr}`,
  );
  const result = JSON.parse(child.stdout);
  schema(validateResult, result);
  return { code: child.code, result, stderr: child.stderr };
}
export function cli(args, { env = {}, timeout = 90000 } = {}) {
  const child = spawnSync(
    process.execPath,
    [join(candidateRoot, "dist/cli/main.js"), ...args],
    {
      cwd: candidateRoot,
      encoding: "utf8",
      env: { ...process.env, SWF_TEST_FAULT: "", ...env },
      timeout,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  assert.ifError(child.error);
  return decode({ ...child, code: child.status });
}
export const run = (f, maxStarts) => cli(runArgs(f, maxStarts));
export const resume = (f) => cli(resumeArgs(f));
export const status = (f) => cli(statusArgs(f));
export function start(
  f,
  args,
  env = {},
  entrypoint = join(candidateRoot, "dist/cli/main.js"),
) {
  const child = spawn(process.execPath, [entrypoint, ...args], {
    cwd: candidateRoot,
    env: { ...process.env, SWF_TEST_FAULT: "", ...env },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const handle = {
    child,
    stdout: "",
    stderr: "",
    closed: false,
    code: null,
    signal: null,
  };
  for (const stream of ["stdout", "stderr"]) {
    child[stream].on("data", (data) => {
      handle[stream] += data.toString();
      if (handle[stream].length > 16 * 1024 * 1024) {
        child.kill("SIGKILL");
      }
    });
  }
  handle.done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      Object.assign(handle, { closed: true, code, signal });
      resolve(handle);
    });
  });
  f.handles.add(handle);
  return handle;
}
export async function waitFor(predicate, message, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) {
      return;
    }
    await delay(50);
  }
  assert.fail(message);
}
export async function fault(
  f,
  point,
  eventType,
  { args = runArgs(f), env = {}, entrypoint } = {},
) {
  const marker = join(f.root, `fault-${randomUUID()}.json`);
  const definition = { point, ...(eventType ? { eventType } : {}), marker };
  const handle = start(
    f,
    args,
    { ...env, SWF_TEST_FAULT: JSON.stringify(definition) },
    entrypoint,
  );
  await waitFor(
    () => {
      if (existsSync(marker)) {
        return true;
      }
      assert.equal(
        handle.closed,
        false,
        `Factory must reach ${point}/${eventType || ""}; exited ${handle.code}: ${handle.stdout}\n${handle.stderr}`,
      );
      return false;
    },
    `Factory did not reach ${point}/${eventType || ""}`,
  );
  const observed = JSON.parse(readFileSync(marker, "utf8"));
  assert.equal(observed.point, point);
  assert.ok(observed.runId);
  if (eventType) {
    assert.equal(observed.eventType, eventType);
  }
  return { ...handle, marker, observed, original: handle };
}
export async function killFactory(handle) {
  handle = handle.original || handle;
  if (!handle.closed) {
    assert.equal(handle.child.kill("SIGKILL"), true);
  }
  await waitFor(
    () => handle.closed,
    "Owned factory did not exit after termination",
    10000,
  );
  await handle.done;
}
export function readStore(f) {
  const path = join(f.store, "run.sqlite");
  assert.ok(existsSync(path), "Durable SQLite database must exist");
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec("BEGIN");
    assert.equal(
      db.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    assert.equal(db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
    const rows = db
      .prepare("SELECT sequence, run_id, json FROM events ORDER BY sequence")
      .all();
    const projectionRows = db
      .prepare("SELECT id, sequence, json FROM projection ORDER BY id")
      .all();
    assert.equal(projectionRows.length, rows.length ? 1 : 0);
    if (!rows.length) {
      return { events: [], projection: null };
    }
    assert.equal(projectionRows[0].id, 1);
    const events = rows.map((row) => {
      const event = JSON.parse(row.json);
      schema(validateEvent, event);
      assert.equal(event.sequence, row.sequence);
      assert.equal(event.runId, row.run_id);
      return event;
    });
    const projection = JSON.parse(projectionRows[0].json);
    schema(validateProjection, projection);
    assert.equal(projection.sequence, projectionRows[0].sequence);
    return { events, projection };
  } finally {
    db.close();
  }
}
export function workspaces(f) {
  return git(f.repo, "worktree", "list", "--porcelain")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice(9))
    .filter(
      (path) =>
        path.replaceAll("\\", "/").toLowerCase() !==
        f.repo.replaceAll("\\", "/").toLowerCase(),
    );
}
export function invocations(f) {
  return workspaces(f).flatMap((workspace) => {
    const path = join(workspace, "src/p2-invocations.jsonl");
    return existsSync(path)
      ? readFileSync(path, "utf8")
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
  });
}
export function artifactFiles(directory) {
  return existsSync(directory)
    ? readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? artifactFiles(join(directory, entry.name))
          : [join(directory, entry.name)],
      )
    : [];
}
export function verifierInvocations(f) {
  return [
    ...new Set(
      artifactFiles(f.config.artifactRoot).flatMap((path) =>
        [
          ...readFileSync(path, "utf8").matchAll(
            /p2-verifier-invocation:([a-f0-9-]+)/g,
          ),
        ].map((match) => match[1]),
      ),
    ),
  ];
}
export function assertError(observed, code) {
  assert.equal(observed.result.kind, "durable_error");
  assert.equal(observed.result.code, code);
  assert.equal(observed.code, code === "input_error" ? 2 : 1);
  assert.ok(observed.result.issues.length);
}
