import test from "node:test";
import assert from "node:assert/strict";
import { withFixture, run, readStore } from "../../p2/harness/support.mjs";
import {
  expected,
  validate,
  assertInspection,
  assertHuman,
} from "./support.mjs";

test("P6 sanity: baseline facts produce a valid view and reject invented consumption or verification", () =>
  withFixture((f) => {
    assert.equal(run(f).result.projection.state.status, "VERIFIED");
    const snapshot = readStore(f);
    const view = expected(snapshot);
    assertInspection({ code: 0, result: view }, snapshot);
    for (const mutate of [
      (v) => {
        v.starts.consumed = 0;
        v.starts.remaining = 5;
      },
      (v) => {
        v.starts.limit = 6;
        v.starts.remaining = 5;
      },
      (v) => {
        v.verification.kind = "idle";
      },
      (v) => {
        v.run.sequence++;
      },
    ]) {
      const bad = structuredClone(view);
      mutate(bad);
      assert.throws(
        () => assertInspection({ code: 0, result: bad }, snapshot),
        assert.AssertionError,
      );
    }
  }));

test("P6 sanity: feature groups and persisted observation are closed schema states", () =>
  withFixture((f) => {
    run(f);
    const view = expected(readStore(f));
    assert.equal(validate(view), true);
    for (const mutate of [
      (v) => {
        delete v.observation;
      },
      (v) => {
        v.observation = "fresh";
      },
      (v) => {
        v.repair = { kind: "disabled", remaining: 1 };
      },
      (v) => {
        v.github = { kind: "enabled", ci: { kind: "unobserved" } };
      },
      (v) => {
        v.github = { kind: "disabled", delivery: { kind: "unplanned" } };
      },
      (v) => {
        v.health = "green";
      },
    ]) {
      const bad = structuredClone(view);
      mutate(bad);
      assert.equal(validate(bad), false);
    }
  }));

test("P6 sanity: human oracle rejects a raw dump or misleading CI label", () =>
  withFixture((f) => {
    run(f);
    const view = expected(readStore(f));
    const text = `Persisted observation\nRun: ${view.run.id}\nLocal: VERIFIED\nStarts: 1/5 (4 remaining)\nRepair: disabled\nVerification: completed\nEvidence: ${view.verification.evidence.path}\nDelivery: disabled\nCI: disabled\n`;
    assertHuman({ code: 0, text }, view);
    assert.throws(
      () => assertHuman({ code: 0, text: JSON.stringify(view) }, view),
      assert.AssertionError,
    );
    assert.throws(
      () =>
        assertHuman(
          { code: 0, text: text.replace("CI: disabled", "CI: passed") },
          view,
        ),
      assert.AssertionError,
    );
  }));
