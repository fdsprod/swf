import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import {
  withFixture,
  run,
  resume,
  updateGateway,
  gateway,
  posts,
  readStore,
  assertError,
  writeConfig,
} from "../harness/support.mjs";
import { assertDurable, assertDeliveryArtifacts } from "../harness/replay.mjs";

for (const [mode, expected] of [
  ["missing", "pending"],
  ["pending", "pending"],
  ["wrong-head", "pending"],
  ["wrong-app", "pending"],
  ["wrong-name", "pending"],
  ["repeated", "pending"],
  ["multiple-success", "pending"],
  ["failed", "failed"],
  ["skipped", "failed"],
  ["paged", "passed"],
  ["head-changed", "stale_head"],
]) {
  test(`P5-006: ${mode} check-run observation yields ${expected} for the delivered head`, () =>
    withFixture((f) => {
      updateGateway(f, (d) => {
        d.checkMode = mode;
      });
      const p = assertDurable(run(f), f, "VERIFIED");
      assert.equal(p.ci.kind, expected);
      assert.equal(p.state.status, "VERIFIED");
      assert.equal(posts(f).length, 1);
      const query = gateway(f).calls.find((c) =>
        c.endpoint?.includes("/check-runs"),
      );
      assert.ok(
        query.endpoint.includes("/commits/" + p.delivery.commit.sha + "/"),
      );
      assert.ok(query.endpoint.includes("filter=all"));
      assert.ok(query.args.includes("--paginate"));
      assert.ok(query.args.includes("--slurp"));
    }));
}

test("P5-006: CI polling advances pending to passed and then records failure separately", () =>
  withFixture((f) => {
    updateGateway(f, (d) => {
      d.checkMode = "pending";
    });
    let p = assertDurable(run(f), f, "VERIFIED");
    assert.equal(p.ci.kind, "pending");
    const attempts = p.attempts.length;
    const commit = p.delivery.commit.sha;
    updateGateway(f, (d) => {
      d.checkMode = "success";
    });
    p = assertDurable(resume(f), f, "VERIFIED");
    assert.equal(p.ci.kind, "passed");
    updateGateway(f, (d) => {
      d.checkMode = "failed";
    });
    p = assertDurable(resume(f), f, "VERIFIED");
    assert.equal(p.ci.kind, "failed");
    assert.equal(p.attempts.length, attempts);
    assert.equal(p.delivery.commit.sha, commit);
    assert.equal(posts(f).length, 1);
  }));

test("P5-005/006: closure between CI reads cannot publish passed CI", () =>
  withFixture((f) => {
    updateGateway(f, (d) => {
      d.checkMode = "closed-during-read";
    });
    const result = run(f);
    const p = assertDurable(result, f, "VERIFIED");
    assert.equal(result.code, 1);
    assert.equal(p.delivery.pullRequest.state.kind, "closed");
    assert.deepEqual(p.ci, { kind: "unobserved" });
    assert.equal(posts(f).length, 1);
    const fact = readStore(f).events.findLast(
      (e) => e.fact.type === "CiObserved",
    ).fact;
    assert.equal(fact.observation.before.state.kind, "open");
    assert.equal(fact.observation.after.state.kind, "closed");
    assert.equal(
      fact.observation.before.head.sha,
      fact.observation.after.head.sha,
    );
    assert.equal(fact.observation.checks[0].conclusion, "success");
  }));

test("P5-006: every configured required pair must pass", () =>
  withFixture((f) => {
    f.githubConfig.delivery.requiredChecks.push({
      name: "required-lint",
      appId: 302,
    });
    writeConfig(f);
    updateGateway(f, (d) => {
      d.checkMode = "mixed-pending";
    });
    const result = run(f);
    const p = assertDurable(result, f, "VERIFIED");
    assert.equal(result.code, 1);
    assert.equal(p.ci.kind, "pending");
    assert.equal(p.ci.observation.checks.length, 2);
    assert.equal(p.ci.observation.checks[0].conclusion, "success");
    assert.equal(p.ci.observation.checks[1].kind, "pending");
    assert.equal(posts(f).length, 1);
  }));

for (const mode of ["api-error", "malformed"]) {
  test(`P5-006: ${mode} CI response is an error, never empty success`, () =>
    withFixture((f) => {
      updateGateway(f, (d) => {
        d.checkMode = mode;
      });
      assertError(run(f), "ci_gateway_error");
      const p = readStore(f).projection;
      assert.equal(p.state.status, "VERIFIED");
      assert.equal(p.delivery.kind, "created");
      assert.equal(p.ci.kind, "unobserved");
      assert.equal(posts(f).length, 1);
    }));
}

test("P5-005/006: closed and merged PRs remain the same delivery with explicit exit policy", () =>
  withFixture((f) => {
    const original = assertDurable(run(f), f, "VERIFIED");
    updateGateway(f, (d) => {
      d.pulls[0].state = "closed";
    });
    const closed = assertDurable(resume(f), f, "VERIFIED");
    assert.equal(closed.delivery.pullRequest.state.kind, "closed");
    assert.equal(closed.ci.kind, "unobserved");
    updateGateway(f, (d) => {
      d.pulls[0].merged = true;
      d.pulls[0].merged_at = "2026-09-26T01:00:00Z";
      d.pulls[0].merge_commit_sha = original.delivery.commit.sha;
    });
    const merged = assertDurable(resume(f), f, "VERIFIED");
    assert.equal(merged.delivery.pullRequest.state.kind, "merged");
    assert.equal(merged.ci.kind, "passed");
    assert.equal(
      merged.delivery.pullRequest.id,
      original.delivery.pullRequest.id,
    );
    assert.equal(posts(f).length, 1);
  }));

for (const target of ["old-pr", "old-ci"]) {
  test(`P5-007: current observation cannot hide tampered ${target} history`, () =>
    withFixture((f) => {
      updateGateway(f, (d) => {
        if (target === "old-ci") {
          d.checkMode = "pending";
        }
      });
      const initial = assertDurable(run(f), f, "VERIFIED");
      const old =
        target === "old-pr"
          ? readStore(f).events.find((e) => e.fact.type === "PrCreated").fact
              .receipt.record
          : initial.ci.observation.record;
      updateGateway(f, (d) => {
        if (target === "old-pr") {
          d.pulls[0].state = "closed";
        } else {
          d.checkMode = "success";
        }
      });
      const current = assertDurable(resume(f), f, "VERIFIED");
      const now =
        target === "old-pr"
          ? current.delivery.pullRequest.record
          : current.ci.observation.record;
      assert.notEqual(old.digest, now.digest);
      const before = readStore(f);
      const calls = gateway(f).calls.length;
      appendFileSync(old.path, "tampered historical observation");
      assert.throws(
        () => assertDeliveryArtifacts(before.events),
        assert.AssertionError,
      );
      assertError(resume(f), "artifact_invalid");
      assert.deepEqual(readStore(f), before);
      assert.equal(gateway(f).calls.length, calls);
    }));
}
