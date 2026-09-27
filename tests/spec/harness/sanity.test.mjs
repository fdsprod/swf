import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fixture, unit, state } from "../fixtures/p0.mjs";
import {
  assertRun,
  assertInputError,
  launch,
  trustedRoot,
  validateInput,
  validateOutput,
  removeFixtureDirectory,
} from "./support.mjs";
import { checkArchitecture } from "./architecture.mjs";

function knownGood() {
  const input = fixture();
  const work = unit();
  const event = (type, extra = {}) => ({ type, unitId: work.id, ...extra });
  const change = (from, to) => event("UnitStateChanged", { from, to });
  return {
    code: 0,
    result: {
      kind: "run_result",
      graph: {
        id: `${input.request.id}:graph`,
        requestId: input.request.id,
        units: [work],
        dependencies: [],
      },
      state: state("VERIFIED"),
      events: [
        {
          type: "WorkGraphCreated",
          graphId: `${input.request.id}:graph`,
          unitIds: [work.id],
        },
        change("PENDING", "READY"),
        change("READY", "RUNNING"),
        event("AgentInvocationStarted"),
        event("AgentInvocationFinished", {
          outcome: input.script.agentOutcome,
        }),
        change("RUNNING", "VERIFYING"),
        event("VerificationStarted", {
          specIds: input.verification.required.map((s) => s.id),
        }),
        event("VerificationFinished", {
          results: input.script.verificationResults,
        }),
        change("VERIFYING", "VERIFIED"),
      ],
    },
  };
}

test("Harness sanity: valid fixture, output schema, process launcher, and pass oracle agree", () => {
  const input = fixture();
  const good = knownGood();
  assert.equal(validateInput(input), true);
  assert.equal(validateOutput(good.result), true);
  const observed = launch(
    join(trustedRoot, "tests/spec/fixtures/process-fixture.mjs"),
    [JSON.stringify(good.result), "0"],
    trustedRoot,
  );
  assertRun(observed, input, "VERIFIED");
});

test("Harness sanity: not_implemented stub is a valid process result", () => {
  assert.equal(validateOutput({ kind: "not_implemented" }), true);
  const observed = launch(
    join(trustedRoot, "tests/spec/fixtures/process-fixture.mjs"),
    ['{"kind":"not_implemented"}', "3"],
    trustedRoot,
  );
  assert.equal(observed.code, 3);
  assert.equal(observed.result.kind, "not_implemented");
});

const defects = {
  "worker bypasses verification": (good) => {
    good.result.events = good.result.events.filter(
      (e) => !e.type.startsWith("Verification"),
    );
  },
  "two work units": (good) => {
    good.result.graph.units.push(unit());
  },
  "verification before worker finishes": (good) => {
    [good.result.events[4], good.result.events[6]] = [
      good.result.events[6],
      good.result.events[4],
    ];
  },
  "substituted verification evidence": (good) => {
    good.result.events.find((e) => e.type === "VerificationFinished").results =
      [];
  },
  "delivery from execution": (good) => {
    good.result.events.push({ type: "PullRequestCreated", unitId: unit().id });
  },
  "missing required verifier invocation": (good) => {
    good.result.events.find((e) => e.type === "VerificationStarted").specIds = [
      "check-a",
    ];
  },
};
for (const [name, mutate] of Object.entries(defects)) {
  test(`Harness negative control rejects: ${name}`, () => {
    const bad = knownGood();
    mutate(bad);
    assert.throws(
      () => assertRun(bad, fixture(), "VERIFIED"),
      assert.AssertionError,
    );
  });
}

test("Harness negative control: input error cannot hide a worker invocation", () => {
  assert.throws(
    () =>
      assertInputError({
        code: 2,
        result: {
          kind: "input_error",
          issues: ["bad input"],
          events: [{ type: "AgentInvocationStarted" }],
        },
      }),
    assert.AssertionError,
  );
});

test("Schema negative controls reject unknown input and contradictory output", () => {
  const input = fixture();
  input.workerMayApprove = true;
  assert.equal(validateInput(input), false);
  const bad = knownGood().result;
  bad.state.decision = { id: "unresolved" };
  assert.equal(validateOutput(bad), false);
});

function architectureFixture(contents) {
  const directory = mkdtempSync(join(tmpdir(), "swf-p0-architecture-"));
  try {
    for (const [path, body] of Object.entries(contents)) {
      const target = join(directory, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, body);
    }
    return checkArchitecture(directory);
  } finally {
    removeFixtureDirectory(directory);
  }
}

test("ARC-001 sanity permits kernel-to-contract imports", () => {
  assert.deepEqual(
    architectureFixture({
      "src/kernel/index.ts": "import type { X } from '../contracts/index.js';",
      "src/contracts/index.ts": "export type X = string;",
    }),
    [],
  );
});
for (const [name, source] of Object.entries({
  static: "import '../adapter-scripted/index.js';",
  export: "export * from '../adapter-scripted/index.js';",
  dynamic: "void import('../adapter-scripted/index.js');",
  require: "require('../adapter-scripted/index.js');",
  computed: "void import(adapterPath);",
  external: "import '@swf/adapter-scripted';",
})) {
  test(`ARC-001 negative control rejects ${name} adapter dependency`, () => {
    assert.ok(
      architectureFixture({ "src/kernel/index.ts": source }).length > 0,
    );
  });
}
test("ARC-001 negative control catches an adapter hidden behind a contracts barrel", () => {
  assert.ok(
    architectureFixture({
      "src/kernel/index.ts": "import '../contracts/index.js';",
      "src/contracts/index.ts": "export * from '../adapter-scripted/index.js';",
    }).length > 0,
  );
});
test("ARC-001 negative control rejects a contracts-to-kernel dependency", () => {
  assert.ok(
    architectureFixture({
      "src/kernel/index.ts": "import '../contracts/index.js';",
      "src/contracts/index.ts": "import '../kernel/index.js';",
    }).length > 0,
  );
});
