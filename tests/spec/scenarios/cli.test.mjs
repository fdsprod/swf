import test from "node:test";
import assert from "node:assert/strict";
import { fixture, decision } from "../fixtures/p0.mjs";
import {
  runFixture,
  assertRun,
  assertInputError,
} from "../harness/support.mjs";

test("P0-001 VER-002: both required checks pass through one deterministic unit", () => {
  const input = fixture();
  const first = runFixture(input);
  assertRun(first, input, "VERIFIED");
  assert.deepEqual(
    runFixture(input),
    first,
    "Fresh processes produce the same observable output",
  );
});

test("P0-001: required results may arrive in reverse order", () => {
  const input = fixture();
  input.script.verificationResults.reverse();
  assertRun(runFixture(input), input, "VERIFIED");
});

for (const failedId of ["check-a", "check-b"]) {
  test(`AGT-004 VER-002: dishonest completion cannot conceal failure of ${failedId}`, () => {
    const input = fixture();
    input.script.agentOutcome.evidence = [
      {
        id: "agent-test-claim",
        kind: "test_result",
        uri: "memory:claimed-success",
      },
    ];
    input.script.verificationResults.find((r) => r.specId === failedId).status =
      "failed";
    assertRun(runFixture(input), input, "REPAIR_READY");
  });
}

const coverageCases = {
  missing: (input) => input.script.verificationResults.pop(),
  duplicate: (input) =>
    input.script.verificationResults.push(
      structuredClone(input.script.verificationResults[0]),
    ),
  unknown: (input) =>
    input.script.verificationResults.push({
      ...input.script.verificationResults[0],
      specId: "unknown",
    }),
  substituted: (input) => {
    input.script.verificationResults[1].specId = "unknown";
  },
  empty: (input) => {
    input.script.verificationResults = [];
  },
  "missing-pass-evidence": (input) => {
    input.script.verificationResults[1].evidence = [];
  },
  timeout: (input) => {
    input.script.verificationResults[1].status = "error";
    input.script.verificationResults[1].summary = "Command timed out";
  },
  "error-before-repair": (input) => {
    input.script.verificationResults[0].status = "failed";
    input.script.verificationResults[1].status = "error";
  },
};
for (const [name, mutate] of Object.entries(coverageCases)) {
  test(`P0-002: ${name} cannot satisfy the frozen verification contract`, () => {
    const input = fixture();
    mutate(input);
    assertRun(runFixture(input), input, "FAILED");
  });
}

test("P0-003: decision-required work waits without invoking verification", () => {
  const input = fixture();
  input.script.agentOutcome = {
    kind: "decision_required",
    decision: decision(),
  };
  assertRun(runFixture(input), input, "WAITING_FOR_DECISION", {
    verification: false,
  });
});

test("P0-003: a decision request for another unit cannot be accepted", () => {
  const input = fixture();
  input.script.agentOutcome = {
    kind: "decision_required",
    decision: { ...decision(), unitId: "unrelated-unit" },
  };
  assertRun(runFixture(input), input, "FAILED", { verification: false });
});

for (const kind of ["blocked", "failed"]) {
  test(`P0-003: ${kind} worker result stops and retains the original reason`, () => {
    const input = fixture();
    input.script.agentOutcome = {
      kind,
      reason: "Fixture worker cannot continue",
      evidence: [],
    };
    const result = runFixture(input);
    assertRun(result, input, "FAILED", { verification: false });
    assert.equal(result.result.state.reason, input.script.agentOutcome.reason);
  });
}

const invalidCases = {
  "schema version": (input) => {
    input.schemaVersion = 2;
  },
  "unknown root key": (input) => {
    input.bypassVerification = true;
  },
  "missing request": (input) => {
    delete input.request;
  },
  "empty objective": (input) => {
    input.request.objective = "  ";
  },
  "unknown source key": (input) => {
    input.request.source.authorized = true;
  },
  "missing source identity": (input) => {
    delete input.request.source.externalId;
  },
  "missing repository": (input) => {
    delete input.request.repository;
  },
  "empty base ref": (input) => {
    input.request.repository.baseRef = "";
  },
  "constraints type": (input) => {
    input.request.constraints = "none";
  },
  "acceptance criterion type": (input) => {
    input.request.acceptanceCriteria = [123];
  },
  "missing metadata": (input) => {
    delete input.request.metadata;
  },
  "unknown worker outcome": (input) => {
    input.script.agentOutcome.kind = "verified";
  },
  "missing outcome summary": (input) => {
    delete input.script.agentOutcome.summary;
  },
  "missing decision question": (input) => {
    input.script.agentOutcome = {
      kind: "decision_required",
      decision: decision(),
    };
    delete input.script.agentOutcome.decision.question;
  },
  "unknown result status": (input) => {
    input.script.verificationResults[0].status = "skipped";
  },
  "invalid evidence": (input) => {
    input.script.verificationResults[0].evidence = [{}];
  },
  "unknown evidence kind": (input) => {
    input.script.verificationResults[0].evidence[0].kind = "agent_confidence";
  },
  "empty evidence URI": (input) => {
    input.script.verificationResults[0].evidence[0].uri = "";
  },
  "empty verification contract": (input) => {
    input.verification.required = [];
  },
  "weakened requireAll": (input) => {
    input.verification.completionPolicy.requireAll = false;
  },
  "duplicate required IDs": (input) => {
    input.verification.required[1].id = input.verification.required[0].id;
  },
  "empty check ID": (input) => {
    input.verification.required[0].id = " ";
  },
  "empty command": (input) => {
    input.verification.required[0].command = "";
  },
  "unknown check kind": (input) => {
    input.verification.required[0].kind = "model_judgment";
  },
  "nonpositive timeout": (input) => {
    input.verification.required[0].timeoutSeconds = 0;
  },
};
for (const [name, mutate] of Object.entries(invalidCases)) {
  test(`P0-004: ${name} fails before graph or worker invocation`, () => {
    const input = fixture();
    mutate(input);
    assertInputError(runFixture(input));
  });
}

test("P0-004: malformed JSON fails before worker invocation", () =>
  assertInputError(runFixture("{broken", { raw: true })));
test("P0-004: absent fixture fails before worker invocation", () =>
  assertInputError(
    runFixture(fixture(), {
      args: ["run", "--fixture", "this-file-does-not-exist.p0.json", "--json"],
    }),
  ));
test("P0-004: unsupported command is rejected", () =>
  assertInputError(runFixture(fixture(), { args: ["deploy", "--json"] })));
