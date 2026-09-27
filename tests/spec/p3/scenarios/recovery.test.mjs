import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
import {
  withFixture,
  run,
  resume,
  status,
  fault,
  killFactory,
  runArgs,
  resumeArgs,
  readStore,
  gateway,
  updateGateway,
  posts,
  addAnswer,
  contexts,
  assertError,
  cli,
  hash,
} from "../harness/support.mjs";
import {
  assertDurable,
  assertSnapshot,
  assertArtifacts,
  assertHistoricalDecisionArtifacts,
} from "../harness/replay.mjs";

test("P3-003/007: hostile GH_HOST cannot change publisher or resolver identity realm", () =>
  withFixture((f) => {
    const env = { GH_HOST: "hostile.example.invalid" };
    const p = assertDurable(
      cli(runArgs(f), { env }),
      f,
      "WAITING_FOR_DECISION",
    );
    addAnswer(f, p.state.decision.id);
    assertDurable(cli(resumeArgs(f), { env }), f, "VERIFIED");
    const calls = gateway(f).calls;
    assert.ok(calls.some((c) => c.endpoint === "user"));
    assert.ok(calls.some((c) => c.method === "POST"));
    for (const call of calls) {
      assert.equal(call.hostname, "github.com");
      assert.equal(
        call.args[call.args.indexOf("--hostname") + 1],
        "github.com",
      );
    }
  }));

test("P3-006/009: distinct decision executable bytes are pinned and mutation blocks resume", () =>
  withFixture((f) => {
    const p = assertDurable(run(f), f, "WAITING_FOR_DECISION");
    assert.notEqual(f.config.decisions.executable, f.config.worker.executable);
    assert.ok(
      p.contract.programs.some(
        (a) =>
          a.path === f.config.decisions.executable &&
          a.digest === hash(readFileSync(a.path)),
      ),
      "Decision executable must be a pinned immutable program",
    );
    const before = readStore(f);
    const calls = gateway(f).calls.length;
    appendFileSync(f.config.decisions.executable, "changed executable bytes");
    assertError(resume(f), "artifact_invalid");
    assert.deepEqual(readStore(f), before);
    assert.equal(gateway(f).calls.length, calls);
    assert.equal(contexts(f).length, 1);
  }));

test("P3-004/006: resolved decision still validates historical conflict capture", () =>
  withFixture((f) => {
    const p = assertDurable(run(f), f, "WAITING_FOR_DECISION");
    const id = p.state.decision.id;
    addAnswer(f, id);
    const contradictory = addAnswer(f, id, {
      answer: "Use zero.",
      selectedOptionId: "zero",
    });
    assertError(resume(f), "decision_conflict");
    const conflict = readStore(f).events.find(
      (e) => e.fact.type === "DecisionConflictObserved",
    ).fact.conflict;
    updateGateway(f, (g) => {
      g.comments = g.comments.filter((c) => c.id !== contradictory.id);
    });
    const done = assertDurable(resume(f), f, "VERIFIED");
    assert.equal(done.decisions[0].kind, "resolved");
    assert.equal(Object.hasOwn(done.decisions[0], "conflict"), false);
    const before = readStore(f);
    const calls = gateway(f).calls.length;
    assertHistoricalDecisionArtifacts(before.events);
    appendFileSync(conflict.record.path, "tampered history");
    assert.throws(
      () => assertHistoricalDecisionArtifacts(before.events),
      assert.AssertionError,
    );
    assertError(resume(f), "artifact_invalid");
    assert.deepEqual(readStore(f), before);
    assert.equal(gateway(f).calls.length, calls);
    assert.equal(contexts(f).length, 2);
  }));

for (const point of [
  "transaction.after_event_insert",
  "transaction.after_projection_write",
]) {
  test(`P3-006: ${point} rolls decision publication intent back atomically`, async () =>
    withFixture(async (f) => {
      const held = await fault(f, point, "DecisionPublicationPlanned");
      await killFactory(held);
      const before = readStore(f);
      assertSnapshot(before);
      assert.equal(
        before.events.some((e) => e.fact.type === "DecisionPublicationPlanned"),
        false,
      );
      assert.equal(before.projection.state.status, "WAITING_FOR_DECISION");
      assert.equal(posts(f).length, 0);
      const resumed = assertDurable(resume(f), f, "WAITING_FOR_DECISION");
      assert.equal(resumed.decisions[0].kind, "published");
      assert.equal(posts(f).length, 1);
      assert.equal(contexts(f).length, 1);
    }));
  test(`P3-006: ${point} rolls resolution and READY state back together`, async () =>
    withFixture(async (f) => {
      const p = assertDurable(run(f), f, "WAITING_FOR_DECISION");
      addAnswer(f, p.state.decision.id);
      const held = await fault(f, point, "DecisionResolved", {
        args: resumeArgs(f),
      });
      await killFactory(held);
      const before = readStore(f);
      assertSnapshot(before);
      assert.equal(
        before.events.some((e) => e.fact.type === "DecisionResolved"),
        false,
      );
      assert.equal(before.projection.state.status, "WAITING_FOR_DECISION");
      assert.equal(before.projection.attempts.length, 1);
      const done = assertDurable(resume(f), f, "VERIFIED");
      assert.equal(done.attempts.length, 2);
      assert.equal(
        readStore(f).events.filter((e) => e.fact.type === "DecisionResolved")
          .length,
        1,
      );
    }));
}
for (const eventType of [
  "WorkerCompleted",
  "DecisionPublicationPlanned",
  "DecisionPublished",
]) {
  test(`P3-006: committed ${eventType} survives a fresh process`, async () =>
    withFixture(async (f) => {
      const held = await fault(f, "transaction.after_commit", eventType);
      await killFactory(held);
      const before = readStore(f);
      assertSnapshot(before);
      assert.equal(before.events.at(-1).fact.type, eventType);
      const resumed = assertDurable(resume(f), f, "WAITING_FOR_DECISION");
      assert.equal(resumed.decisions[0].kind, "published");
      assert.equal(posts(f).length, 1);
      assert.equal(contexts(f).length, 1);
      assertArtifacts(resumed);
    }));
}

test("P3-006: committed resolution survives without polling edited remote text again", async () =>
  withFixture(async (f) => {
    const p = assertDurable(run(f), f, "WAITING_FOR_DECISION");
    addAnswer(f, p.state.decision.id);
    const held = await fault(
      f,
      "transaction.after_commit",
      "DecisionResolved",
      { args: resumeArgs(f) },
    );
    await killFactory(held);
    const before = readStore(f);
    assertSnapshot(before);
    assert.equal(before.projection.state.status, "READY");
    assert.equal(before.projection.attempts.length, 1);
    updateGateway(f, (g) => {
      g.comments = [];
    });
    const calls = gateway(f).calls.length;
    const done = assertDurable(resume(f), f, "VERIFIED");
    assert.equal(done.attempts.length, 2);
    assert.equal(gateway(f).calls.length, calls);
    assertArtifacts(done);
  }));

test("P3-006/007: crash after remote publication reconciles all pages without another POST", async () =>
  withFixture(async (f) => {
    const held = await fault(f, "decision.after_publish");
    await killFactory(held);
    const before = readStore(f);
    assertSnapshot(before);
    assert.equal(before.projection.decisions[0].kind, "publication_started");
    assert.equal(posts(f).length, 1);
    const question = gateway(f).comments[0];
    updateGateway(f, (g) => {
      g.comments.unshift({
        ...question,
        id: 1,
        user: { id: 999, login: "copycat" },
      });
    });
    const p = assertDurable(resume(f), f, "WAITING_FOR_DECISION");
    assert.equal(p.decisions[0].receipt.comment.id, question.id);
    assert.equal(posts(f).length, 1);
    assertArtifacts(p);
  }));

test("P3-007: started publication with absent result remains uncertain without retries", async () =>
  withFixture(async (f) => {
    const held = await fault(
      f,
      "transaction.after_commit",
      "DecisionPublicationStarted",
    );
    await killFactory(held);
    const before = readStore(f);
    assertSnapshot(before);
    assert.equal(posts(f).length, 0);
    assertError(resume(f), "publication_uncertain");
    assertError(resume(f), "publication_uncertain");
    assert.deepEqual(readStore(f), before);
    assert.equal(posts(f).length, 0);
    assert.equal(contexts(f).length, 1);
  }));

for (const defect of ["duplicate", "changed-body"]) {
  test(`P3-007: ${defect} publication match cannot be adopted`, async () =>
    withFixture(async (f) => {
      const held = await fault(f, "decision.after_publish");
      await killFactory(held);
      updateGateway(f, (g) => {
        if (defect === "duplicate") {
          g.comments.push({ ...g.comments[0], id: g.nextId++ });
        } else {
          g.comments[0].body += "\nALTERED";
        }
      });
      assertError(resume(f), "publication_uncertain");
      assert.equal(posts(f).length, 1);
      assert.equal(contexts(f).length, 1);
    }));
}

for (const mode of ["api-failure", "malformed"]) {
  test(`P3-007: ${mode} comment reads are errors, not absent authorization`, () =>
    withFixture((f) => {
      const p = assertDurable(run(f), f, "WAITING_FOR_DECISION");
      updateGateway(f, (g) => {
        g.mode = mode;
      });
      assertError(resume(f), "decision_gateway_error");
      assert.deepEqual(
        assertDurable(status(f), f, "WAITING_FOR_DECISION", "durable_status"),
        p,
      );
      assert.equal(contexts(f).length, 1);
    }));
}

test("P3-007: failed POST response does not hide the successfully created question", () =>
  withFixture((f) => {
    updateGateway(f, (g) => {
      g.mode = "post-response-lost";
    });
    assertError(run(f), "decision_gateway_error");
    assert.equal(posts(f).length, 1);
    updateGateway(f, (g) => {
      g.mode = "normal";
    });
    const p = assertDurable(resume(f), f, "WAITING_FOR_DECISION");
    assert.equal(p.decisions[0].kind, "published");
    assert.equal(posts(f).length, 1);
  }));

test("P3-006: changed question artifact cannot be used for publication or resumed authority", () =>
  withFixture((f) => {
    const p = assertDurable(run(f), f, "WAITING_FOR_DECISION");
    appendFileSync(p.decisions[0].publication.body.path, "tampered");
    assertError(resume(f), "artifact_invalid");
    assert.equal(contexts(f).length, 1);
    assert.equal(posts(f).length, 1);
  }));

test("P3-006: changed authenticated answer snapshot blocks continuation after resolution commit", async () =>
  withFixture(async (f) => {
    const p = assertDurable(run(f), f, "WAITING_FOR_DECISION");
    addAnswer(f, p.state.decision.id);
    const held = await fault(
      f,
      "transaction.after_commit",
      "DecisionResolved",
      { args: resumeArgs(f) },
    );
    await killFactory(held);
    appendFileSync(
      readStore(f).projection.decisions[0].source.record.path,
      "tampered",
    );
    assertError(resume(f), "artifact_invalid");
    assert.equal(contexts(f).length, 1);
  }));
