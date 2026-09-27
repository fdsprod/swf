import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import {
  candidateRoot,
  trustedRoot,
  readStore,
  invocations,
  verifierInvocations,
  artifactFiles,
  hash,
  git,
} from "../../p2/harness/support.mjs";
import { assertSnapshot } from "../../p5/harness/replay.mjs";
export { candidateRoot, trustedRoot, readStore, hash };
const ajv = new Ajv({ strict: true, allErrors: true });
for (const name of [
  "run-fixture",
  "cli-result",
  "local-config",
  "local-result",
  "local-evidence",
  "durable-result",
]) {
  ajv.addSchema(
    JSON.parse(
      readFileSync(
        join(trustedRoot, `src/contracts/schemas/${name}.schema.json`),
        "utf8",
      ),
    ),
  );
}
export const validate = ajv.compile(
  JSON.parse(
    readFileSync(
      join(trustedRoot, "tests/spec/p6/inspect.schema.json"),
      "utf8",
    ),
  ),
);
export function launch(args, { json = true } = {}) {
  const child = spawnSync(
    process.execPath,
    [join(candidateRoot, "dist/cli/main.js"), ...args],
    {
      cwd: candidateRoot,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, SWF_TEST_FAULT: "" },
    },
  );
  assert.ifError(child.error);
  assert.equal(child.signal, null);
  if (!json) {
    return { code: child.status, text: child.stdout, stderr: child.stderr };
  }
  assert.match(
    child.stdout,
    /^\{[^\r\n]*\}\r?\n$/,
    "CLI must emit exactly one JSON result",
  );
  return {
    code: child.status,
    result: JSON.parse(child.stdout),
    stderr: child.stderr,
  };
}
export const inspect = (f, options = {}) =>
  launch(
    [
      "inspect",
      "--store",
      f.store,
      ...(options.json === false ? [] : ["--json"]),
    ],
    options,
  );
export function expected(snapshot) {
  const p = assertSnapshot(snapshot);
  const created = snapshot.events[0].fact;
  const starts = snapshot.events.filter((e) =>
    ["AttemptReserved", "RepairReserved"].includes(e.fact.type),
  ).length;
  const repairs = snapshot.events.filter(
    (e) => e.fact.type === "RepairReserved",
  ).length;
  assert.equal(p.attempts.length, starts);
  assert.equal(p.repairs?.length ?? 0, repairs);
  const policy = created.contract.config.repair;
  const limit = policy ? (policy.maxRepairs ?? 1) : 0;
  return {
    schemaVersion: 1,
    kind: "run_inspection",
    observation: "persisted",
    run: {
      id: p.runId,
      requestId: created.contract.config.request.id,
      sequence: p.sequence,
      baseCommit: p.baseCommit,
    },
    state: p.state,
    starts: {
      limit: created.maxStarts,
      consumed: starts,
      remaining: created.maxStarts - starts,
      attempts: p.attempts,
    },
    repair: policy
      ? {
          kind: "enabled",
          limit,
          consumed: repairs,
          remaining: limit - repairs,
          reservations: p.repairs,
        }
      : { kind: "disabled" },
    verification: p.verification,
    decisions: p.decisions ?? [],
    github: p.intake
      ? {
          kind: "enabled",
          issue: p.intake.issue,
          delivery: p.delivery,
          ci: p.ci,
        }
      : { kind: "disabled" },
  };
}
export function assertInspection(observed, snapshot) {
  assert.equal(observed.result.kind, "run_inspection");
  assert.equal(observed.code, 0);
  assert.ok(validate(observed.result), ajv.errorsText(validate.errors));
  assert.deepEqual(observed.result, expected(snapshot));
  return observed.result;
}
export function assertError(observed, code) {
  assert.equal(observed.result.kind, "durable_error");
  assert.equal(observed.result.code, code);
  assert.equal(observed.code, code === "input_error" ? 2 : 1);
  assert.ok(validate(observed.result), ajv.errorsText(validate.errors));
}
export function effects(f) {
  return {
    store: readStore(f),
    workers: invocations(f),
    verifiers: verifierInvocations(f),
    gateway:
      f.gatewayPath && existsSync(f.gatewayPath)
        ? readFileSync(f.gatewayPath, "utf8")
        : null,
    worktrees: git(f.repo, "worktree", "list", "--porcelain"),
    artifacts: artifactFiles(f.config.artifactRoot)
      .sort()
      .map((path) => ({ path, digest: hash(readFileSync(path)) })),
  };
}
export function assertReadOnly(f, action) {
  const before = effects(f);
  const value = action();
  assert.deepEqual(
    effects(f),
    before,
    "Inspection must not change durable state, artifacts, workers, verification or gateway calls",
  );
  return value;
}
export function assertHuman(observed, view) {
  assert.equal(observed.code, 0);
  assert.ok(
    observed.text.length > 0 && observed.text.length < 4096,
    "Human summary must be concise",
  );
  assert.doesNotMatch(observed.text.trim(), /^\{/);
  assert.match(observed.text, /persisted/i);
  assert.ok(observed.text.includes(view.run.id));
  assert.ok(observed.text.includes(view.state.status));
  assert.match(
    observed.text,
    new RegExp("^Local\\s*:\\s*" + view.state.status + "\\b", "mi"),
  );
  assert.match(
    observed.text,
    new RegExp(
      "^(?:Worker )?Starts\\s*:\\s*" +
        view.starts.consumed +
        "\\s*/\\s*" +
        view.starts.limit +
        "\\s*\\(\\s*" +
        view.starts.remaining +
        " remaining\\s*\\)",
      "mi",
    ),
  );
  assert.match(
    observed.text,
    new RegExp("^Verification\\s*:\\s*" + view.verification.kind + "\\b", "mi"),
  );
  assert.match(
    observed.text,
    view.repair.kind === "disabled"
      ? /^Repair\s*:\s*disabled\b/im
      : new RegExp(
          "^Repair\\s*:\\s*" +
            view.repair.consumed +
            "\\s*/\\s*" +
            view.repair.limit +
            "\\s*\\(\\s*" +
            view.repair.remaining +
            " remaining\\s*\\)",
          "mi",
        ),
  );
  if (view.verification.kind === "completed") {
    assert.ok(observed.text.includes(view.verification.evidence.path));
  }
  for (const d of view.decisions) {
    assert.ok(observed.text.includes(d.request.id));
    if (d.receipt) {
      assert.ok(observed.text.includes(d.receipt.comment.url));
    }
  }
  const delivery =
    view.github.kind === "enabled" ? view.github.delivery.kind : "disabled";
  const ci = view.github.kind === "enabled" ? view.github.ci.kind : "disabled";
  assert.match(
    observed.text,
    new RegExp("^Delivery\\s*:\\s*" + delivery + "\\b", "mi"),
  );
  assert.match(observed.text, new RegExp("^CI\\s*:\\s*" + ci + "\\b", "mi"));
}
