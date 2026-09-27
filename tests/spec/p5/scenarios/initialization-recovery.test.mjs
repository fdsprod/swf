import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  withFixture,
  run,
  runArgs,
  fault,
  killFactory,
  readStore,
  workspaces,
  invocations,
  ownedProcesses,
  assertNoDelivery,
  remoteRefs,
  posts,
} from "../harness/support.mjs";
import { assertDurable, assertArtifacts } from "../harness/replay.mjs";
import { assertDeliveredTree } from "../harness/git-oracle.mjs";

test("P5-001/007: original GitHub run recovers an empty store after RunCreated rollback", async () =>
  withFixture(async (f) => {
    const originalConfig = readFileSync(f.configPath);
    const held = await fault(
      f,
      "transaction.after_event_insert",
      "RunCreated",
      { args: runArgs(f) },
    );
    await killFactory(held);
    assert.deepEqual(
      readStore(f),
      { events: [], projection: null },
      "First RunCreated transaction must roll back completely",
    );
    assert.deepEqual(workspaces(f), []);
    assert.deepEqual(invocations(f), []);
    assert.deepEqual(ownedProcesses(f), []);
    assertNoDelivery(f);
    assert.deepEqual(readFileSync(f.configPath), originalConfig);
    // An empty store has no persisted input for resume. Retry the original command
    // with its original input and the same existing store, without deleting it.
    const p = assertDurable(run(f), f, "VERIFIED");
    assertArtifacts(p);
    assertDeliveredTree(p, f);
    assert.equal(p.ci.kind, "passed");
    const after = readStore(f);
    assert.equal(
      after.events.filter((e) => e.fact.type === "RunCreated").length,
      1,
    );
    assert.equal(
      after.events.filter((e) => e.fact.type === "CommitCreated").length,
      1,
    );
    assert.equal(invocations(f).length, 1);
    assert.equal(workspaces(f).length, 1);
    assert.equal(remoteRefs(f).length, 1);
    assert.equal(posts(f).length, 1);
  }));
