import test from "node:test";
import assert from "node:assert/strict";
import { fixture, state, states, decision } from "../fixtures/p0.mjs";
import { kernel } from "../harness/support.mjs";

const { transition } = await kernel();
const actions = {
  prepare: { type: "prepare" },
  start: { type: "start" },
  agent_finished: {
    type: "agent_finished",
    outcome: fixture().script.agentOutcome,
  },
  verification_finished: {
    type: "verification_finished",
    results: fixture().script.verificationResults,
  },
  mark_verified: { type: "mark_verified" },
};
const edges = {
  "PENDING:prepare": "READY",
  "READY:start": "RUNNING",
  "RUNNING:agent_finished": "VERIFYING",
  "VERIFYING:verification_finished": "VERIFIED",
};

for (const status of states) {
  for (const [name, action] of Object.entries(actions)) {
    test(`AGT-004 P0-003: ${status} + ${name}`, () => {
      const current = state(status);
      const before = structuredClone({ current, action });
      const result = transition(current, action);
      assert.deepEqual(
        { current, action },
        before,
        "Reducer must not mutate its input",
      );
      const expected = edges[`${status}:${name}`];
      assert.equal(result.kind, expected ? "transitioned" : "rejected");
      if (expected) {
        assert.equal(result.state.status, expected);
        assert.deepEqual(result.state.unit, current.unit);
        if (expected === "VERIFIED") {
          assert.deepEqual(result.state.results, action.results);
        }
      } else {
        assert.ok(result.reason?.trim());
      }
    });
  }
}

for (const kind of ["decision_required", "blocked", "failed"]) {
  for (const status of states) {
    test(`P0-003: ${status} + agent ${kind}`, () => {
      const outcome =
        kind === "decision_required"
          ? { kind, decision: decision() }
          : { kind, reason: "Cannot proceed", evidence: [] };
      const result = transition(state(status), {
        type: "agent_finished",
        outcome,
      });
      assert.equal(
        result.kind,
        status === "RUNNING" ? "transitioned" : "rejected",
      );
      if (status === "RUNNING") {
        assert.equal(
          result.state.status,
          kind === "decision_required" ? "WAITING_FOR_DECISION" : "FAILED",
        );
        if (kind === "decision_required") {
          assert.deepEqual(result.state.decision, outcome.decision);
        } else {
          assert.equal(result.state.reason, outcome.reason);
        }
      }
    });
  }
}

test("P0-003: unknown state rejects instead of creating authority", () => {
  assert.equal(
    transition({ ...state("PENDING"), status: "UNKNOWN" }, actions.prepare)
      .kind,
    "rejected",
  );
});
test("P0-003: wrong decision unit fails", () => {
  const result = transition(state("RUNNING"), {
    type: "agent_finished",
    outcome: {
      kind: "decision_required",
      decision: { ...decision(), unitId: "wrong-unit" },
    },
  });
  assert.equal(result.kind, "transitioned");
  assert.equal(result.state.status, "FAILED");
});

const gateCases = {
  "reversed results": [(results) => results.reverse(), "VERIFIED"],
  "failed first": [
    (results) => {
      results[0].status = "failed";
    },
    "REPAIR_READY",
  ],
  "failed second": [
    (results) => {
      results[1].status = "failed";
    },
    "REPAIR_READY",
  ],
  error: [
    (results) => {
      results[0].status = "error";
    },
    "FAILED",
  ],
  missing: [(results) => results.pop(), "FAILED"],
  duplicate: [(results) => results.push(structuredClone(results[0])), "FAILED"],
  extra: [
    (results) => results.push({ ...results[0], specId: "extra" }),
    "FAILED",
  ],
  "empty evidence": [
    (results) => {
      results[1].evidence = [];
    },
    "FAILED",
  ],
  "invalid evidence": [
    (results) => {
      results[1].evidence = [{}];
    },
    "FAILED",
  ],
  "invalid status": [
    (results) => {
      results[1].status = "skipped";
    },
    "FAILED",
  ],
  "sparse result array": [
    (results) => {
      delete results[1];
    },
    "FAILED",
  ],
  "undefined result entry": [
    (results) => {
      results[1] = undefined;
    },
    "FAILED",
  ],
  "null result entry": [
    (results) => {
      results[1] = null;
    },
    "FAILED",
  ],
};
for (const [name, [mutate, expected]] of Object.entries(gateCases)) {
  test(`P0-002 kernel gate: ${name}`, () => {
    const results = fixture().script.verificationResults;
    mutate(results);
    const outcome = transition(state("VERIFYING"), {
      type: "verification_finished",
      results,
    });
    assert.equal(outcome.kind, "transitioned");
    assert.equal(outcome.state.status, expected);
  });
}

test("P0-002 kernel gate: one required check cannot pass with an entirely sparse result array", () => {
  const current = state("VERIFYING");
  current.unit.verification.required = [current.unit.verification.required[0]];
  const result = transition(current, {
    type: "verification_finished",
    results: Array(1),
  });
  assert.equal(result.kind, "transitioned");
  assert.equal(result.state.status, "FAILED");
});

const invalidContracts = {
  empty: (c) => {
    c.required = [];
  },
  duplicate: (c) => {
    c.required[1].id = c.required[0].id;
  },
  "requireAll false": (c) => {
    c.completionPolicy.requireAll = false;
  },
  malformed: (c) => {
    delete c.required;
  },
};
for (const [name, mutate] of Object.entries(invalidContracts)) {
  for (const [status, action] of [
    ["PENDING", actions.prepare],
    ["VERIFYING", actions.verification_finished],
  ]) {
    test(`P0-002 kernel rejects ${name} contract from ${status}`, () => {
      const current = state(status);
      mutate(current.unit.verification);
      const result = transition(current, action);
      assert.equal(result.kind, "rejected");
      assert.ok(result.reason?.trim());
    });
  }
}
