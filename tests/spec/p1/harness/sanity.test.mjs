import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  fixture,
  git,
  validateConfig,
  validateResult,
  assertLocal,
  assertInvalid,
  assertRejected,
} from "./support.mjs";

test("P1 sanity: canonical config and committed fixture base are valid", () => {
  const f = fixture();
  try {
    assert.equal(validateConfig(f.config), true);
    assert.equal(git(f.repo, "rev-parse", "HEAD"), f.base);
    assert.equal(git(f.repo, "status", "--porcelain"), "");
    const bad = structuredClone(f.config);
    bad.workerCanApprove = true;
    assert.equal(validateConfig(bad), false);
    assert.equal(validateResult({ kind: "not_implemented" }), true);
  } finally {
    f.cleanup();
  }
});

test("P1 sanity: trusted verifier rejects 0 and accepts independently corrected 42", () => {
  const f = fixture();
  try {
    const command = f.config.commands[0];
    const execute = () =>
      spawnSync(command.executable, command.args, {
        cwd: f.repo,
        encoding: "utf8",
        timeout: 10000,
        windowsHide: true,
      });
    const bad = execute();
    assert.ifError(bad.error);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Expected 42; observed 0/);
    writeFileSync(join(f.repo, "src/answer.cjs"), "module.exports = 42;\n");
    const good = execute();
    assert.ifError(good.error);
    assert.equal(good.status, 0);
    assert.match(good.stdout, /verified:42/);
    assert.match(good.stderr, /verifier-stderr/);
  } finally {
    f.cleanup();
  }
});

for (const mode of ["good", "lie", "malformed", "nonzero"]) {
  test(`P1 sanity: ${mode} double exposes its intended Codex wire behavior`, () => {
    const f = fixture({ worker: mode });
    try {
      // This tests only the double's protocol. The mandatory native gate and product scenarios prove restriction.
      const output = join(f.root, "wire-result.json");
      const child = spawnSync(
        f.config.worker.executable,
        [
          ...f.config.worker.prefixArgs,
          "exec",
          "--json",
          "-C",
          f.repo,
          "--output-last-message",
          output,
        ],
        {
          cwd: f.repo,
          encoding: "utf8",
          timeout: 10000,
          windowsHide: true,
        },
      );
      assert.ifError(child.error);
      assert.equal(child.status, mode === "nonzero" ? 9 : 0);
      const events = child.stdout
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line));
      assert.deepEqual(
        events.map((event) => event.type),
        ["thread.started", "item.completed", "turn.completed"],
      );
      assert.equal(events[1].item.text, readFileSync(output, "utf8"));
      if (mode === "malformed") {
        assert.throws(
          () => JSON.parse(readFileSync(output, "utf8")),
          SyntaxError,
        );
      } else {
        assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), {
          kind: "completed",
          message:
            mode === "nonzero"
              ? "claimed complete"
              : "Fixture worker claims completion",
        });
      }
      if (mode === "lie") {
        assert.equal(
          readFileSync(join(f.repo, "src/answer.cjs"), "utf8"),
          "module.exports = 0;\n",
        );
      }
      if (mode === "good") {
        assert.equal(
          readFileSync(join(f.repo, "src/answer.cjs"), "utf8"),
          "module.exports = 42;\n",
        );
      }
    } finally {
      f.cleanup();
    }
  });
}

test("P1 sanity: result oracles reject deliberate false success and contradictory failure", () => {
  const f = fixture();
  try {
    assert.throws(
      () =>
        assertLocal(
          { code: 0, result: { kind: "not_implemented" } },
          f,
          "VERIFIED",
        ),
      assert.AssertionError,
    );
    assert.throws(
      () =>
        assertInvalid({
          code: 0,
          result: { kind: "evidence_check", status: "current", issues: [] },
        }),
      assert.AssertionError,
    );
    assert.throws(
      () =>
        assertRejected({
          code: 2,
          result: {
            kind: "input_error",
            issues: ["invalid"],
            events: [{ type: "AgentInvocationStarted" }],
          },
        }),
      assert.AssertionError,
    );
    assertInvalid({
      code: 1,
      result: {
        kind: "evidence_check",
        status: "invalid",
        issues: ["candidate changed"],
      },
    });
    assertRejected({
      code: 2,
      result: { kind: "input_error", issues: ["invalid"], events: [] },
    });
  } finally {
    f.cleanup();
  }
});
