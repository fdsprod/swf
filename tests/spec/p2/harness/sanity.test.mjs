import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  withFixture,
  trustedRoot,
  fault,
  killFactory,
  ownedProcesses,
  waitFor,
  readStore,
  validateResult,
  schema,
} from "./support.mjs";
import { replay, assertSnapshot } from "./replay.mjs";

function trace(f) {
  const unit = {
    id: "p1-request:unit:1",
    objective: f.config.request.objective,
    constraints: f.config.request.constraints,
    verification: f.config.verification,
    metadata: f.config.request.metadata,
  };
  const graph = {
    id: "p1-request:graph",
    requestId: f.config.request.id,
    units: [unit],
    dependencies: [],
  };
  const artifact = {
    path: join(f.root, "synthetic-artifact.json"),
    digest: "a".repeat(64),
  };
  const attempt = {
    id: "sanity-attempt-1",
    ordinal: 1,
    completionPath: artifact.path,
  };
  const facts = [
    {
      type: "RunCreated",
      contract: { config: f.config, digest: "b".repeat(64), programs: [] },
      graph,
      baseCommit: f.base,
      maxStarts: 1,
    },
    {
      type: "WorkspacePlanned",
      operationId: "workspace-op",
      workspace: {
        repositoryPath: f.repo,
        path: join(f.config.workspaceRoot, "one"),
        baseCommit: f.base,
      },
    },
    { type: "WorkspaceReady", operationId: "workspace-op" },
    { type: "AttemptReserved", attempt },
    {
      type: "WorkerCompleted",
      attemptId: attempt.id,
      outcome: { kind: "completed", summary: "fixture", evidence: [] },
      record: artifact,
    },
    {
      type: "VerificationPlanned",
      operationId: "verification-op",
      attemptId: attempt.id,
      evidencePath: artifact.path,
    },
    {
      type: "VerificationCompleted",
      operationId: "verification-op",
      results: [
        {
          specId: "answer",
          status: "passed",
          summary: "independent fixture assertion",
          evidence: [
            { id: "proof", kind: "test_result", uri: "file:///proof" },
          ],
        },
      ],
      issues: [],
      evidence: artifact,
    },
  ];
  return facts.map((fact, index) => ({
    sequence: index + 1,
    runId: "sanity-run",
    fact,
  }));
}

test("P2 sanity: independent replay accepts fact history and rejects false approval", () =>
  withFixture((f) => {
    const events = trace(f);
    const projection = replay(events);
    assert.equal(projection.state.status, "VERIFIED");
    schema(validateResult, { kind: "durable_result", projection, events });
    assertSnapshot({ projection, events });
    const badProjection = structuredClone(projection);
    badProjection.maxStarts = 99;
    assert.throws(
      () => assertSnapshot({ projection: badProjection, events }),
      assert.AssertionError,
    );
    const badEvents = structuredClone(events);
    badEvents.at(-1).fact.results[0].status = "failed";
    assert.equal(replay(badEvents).state.status, "REPAIR_READY");
    assert.throws(
      () => assertSnapshot({ projection, events: badEvents }),
      assert.AssertionError,
    );
    const noEvidence = structuredClone(events);
    noEvidence.at(-1).fact.results[0].evidence = [];
    assert.equal(replay(noEvidence).state.status, "FAILED");
    const gap = structuredClone(events);
    gap[2].sequence = 4;
    assert.throws(() => replay(gap), assert.AssertionError);
    const reused = structuredClone(events);
    reused[5].fact.operationId = "workspace-op";
    assert.throws(() => replay(reused), assert.AssertionError);
  }));

test("P2 sanity: SQLite inspection rejects event/projection disagreement", () =>
  withFixture((f) => {
    mkdirSync(f.store);
    const events = trace(f).slice(0, 4);
    const projection = replay(events);
    const db = new DatabaseSync(join(f.store, "run.sqlite"));
    try {
      db.exec(
        "PRAGMA journal_mode=WAL; CREATE TABLE events(sequence INTEGER PRIMARY KEY,run_id TEXT,json TEXT); CREATE TABLE projection(id INTEGER PRIMARY KEY,sequence INTEGER,json TEXT)",
      );
      const insert = db.prepare("INSERT INTO events VALUES(?,?,?)");
      for (const event of events) {
        insert.run(event.sequence, event.runId, JSON.stringify(event));
      }
      db.prepare("INSERT INTO projection VALUES(1,?,?)").run(
        projection.sequence,
        JSON.stringify(projection),
      );
      assertSnapshot(readStore(f));
      projection.attempts = [];
      db.prepare("UPDATE projection SET json=? WHERE id=1").run(
        JSON.stringify(projection),
      );
      assert.throws(() => assertSnapshot(readStore(f)), assert.AssertionError);
    } finally {
      db.close();
    }
  }));

test("P2 sanity: wrapper fixtures count real invocations and preserve independent behavior checks", () =>
  withFixture((f) => {
    // Direct execution proves the fixture, not a product sandbox boundary.
    const verifier = f.config.commands[0];
    const check = () =>
      spawnSync(verifier.executable, verifier.args, {
        cwd: f.repo,
        encoding: "utf8",
        windowsHide: true,
        timeout: 10000,
      });
    const bad = check();
    assert.ifError(bad.error);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Expected 42; observed 0/);
    const output = join(f.root, "wire.json");
    const worker = spawnSync(
      f.config.worker.executable,
      [
        ...f.config.worker.prefixArgs,
        "exec",
        "--json",
        "-C",
        f.repo,
        "-o",
        output,
      ],
      { cwd: f.repo, encoding: "utf8", windowsHide: true, timeout: 10000 },
    );
    assert.ifError(worker.error);
    assert.equal(worker.status, 0);
    assert.equal(JSON.parse(readFileSync(output, "utf8")).kind, "completed");
    const starts = readFileSync(
      join(f.repo, "src/p2-invocations.jsonl"),
      "utf8",
    )
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.equal(starts.length, 1);
    assert.equal(starts[0].ordinal, 1);
    const good = check();
    assert.ifError(good.error);
    assert.equal(good.status, 0);
    assert.match(good.stdout, /verified:42/);
    const firstId = bad.stdout.match(
      /p2-verifier-invocation:([a-f0-9-]+)/,
    )?.[1];
    const secondId = good.stdout.match(
      /p2-verifier-invocation:([a-f0-9-]+)/,
    )?.[1];
    assert.ok(firstId && secondId);
    assert.notEqual(firstId, secondId);
  }));

test("P2 sanity: owned process kill and OS identity observer detect a surviving child", async () =>
  withFixture(async (f) => {
    const held = await fault(f, "worker.after_dispatch", undefined, {
      entrypoint: join(trustedRoot, "tests/spec/p2/fixtures/fault-process.mjs"),
      env: { P2_SANITY_CHILD_EXE: join(f.root, "node.exe") },
      args: [],
    });
    await waitFor(
      () => ownedProcesses(f).length > 0,
      "Sanity child must become observable",
    );
    await killFactory(held);
    assert.ok(
      ownedProcesses(f).length > 0,
      "Killing a factory alone must not fool the child-cleanup oracle",
    );
    assert.throws(
      () => assert.deepEqual(ownedProcesses(f), []),
      assert.AssertionError,
    );
  }));
