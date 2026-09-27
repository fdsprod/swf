import test from "node:test";
import assert from "node:assert/strict";
import {
  withFixture,
  run,
  resume,
  addAnswer,
  assertError,
  readStore,
  gateway,
  updateGateway,
  contexts,
  posts,
} from "../harness/support.mjs";
import { assertDurable } from "../harness/replay.mjs";

test("P3-004: conflict JSON property order cannot append duplicate observations", () =>
  withFixture((f) => {
    const p = assertDurable(run(f), f, "WAITING_FOR_DECISION");
    const id = p.state.decision.id;
    addAnswer(f, id);
    addAnswer(f, id, { answer: "Use zero.", selectedOptionId: "zero" });
    assertError(resume(f), "decision_conflict");
    const before = readStore(f);
    const comments = gateway(f).comments;
    assert.equal(
      before.events.filter((e) => e.fact.type === "DecisionConflictObserved")
        .length,
      1,
    );
    const reorder = (value) =>
      Array.isArray(value)
        ? value.map(reorder)
        : value !== null && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value)
                .reverse()
                .map(([key, child]) => [key, reorder(child)]),
            )
          : value;
    updateGateway(f, (data) => {
      data.comments = reorder(data.comments);
    });
    assert.deepEqual(gateway(f).comments, comments);
    assert.notEqual(
      JSON.stringify(gateway(f).comments),
      JSON.stringify(comments),
    );
    assertError(resume(f), "decision_conflict");
    assert.deepEqual(
      readStore(f),
      before,
      "Unchanged comment values cannot create another conflict observation",
    );
    assert.equal(contexts(f).length, 1);
    assert.equal(posts(f).length, 1);
  }));
