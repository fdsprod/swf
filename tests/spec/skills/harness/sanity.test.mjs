import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  withFixture,
  expected,
  assertInstructions,
  trustedRoot,
} from "./support.mjs";

function rowFor(profile) {
  const instructions = expected(profile);
  return {
    input: { instructions },
    observations: [
      ...instructions.skills.flatMap((s) => [s.entrypoint, ...s.assets]),
      ...(instructions.assignment.design?.kind === "provided"
        ? [instructions.assignment.design.artifact]
        : []),
    ].map((a) => ({
      path: a.path,
      base64: readFileSync(a.path).toString("base64"),
      write: "EPERM",
    })),
  };
}
const pins = (row) => [
  ...new Map(
    row.input.instructions.skills
      .flatMap((s) => [s.entrypoint, ...s.assets])
      .map((a) => [a.path, a]),
  ).values(),
];

test("SKILLS-S1: independent instruction oracle rejects missing, wrong-order, and wrong-text delivery", () =>
  withFixture((f) => {
    const good = rowFor(f.profile);
    const programs = pins(good);
    assertInstructions(good, f.profile, programs);
    for (const change of [
      (r) => delete r.input.instructions,
      (r) => r.input.instructions.skills.reverse(),
      (r) => (r.input.instructions.skills[0].text += "wrong"),
    ]) {
      const bad = structuredClone(good);
      change(bad);
      assert.throws(() => assertInstructions(bad, f.profile, programs));
    }
  }));
test("SKILLS-S2: oracle rejects missing pins, unreadable asset bytes and writable skill files", () =>
  withFixture((f) => {
    const good = rowFor(f.profile);
    const programs = pins(good);
    assert.throws(() => assertInstructions(good, f.profile, programs.slice(1)));
    for (const change of [
      (r) => (r.observations[0].base64 = ""),
      (r) => (r.observations[0].write = "opened"),
    ]) {
      const bad = structuredClone(good);
      change(bad);
      assert.throws(() => assertInstructions(bad, f.profile, programs));
    }
  }));
test("SKILLS-S3: implementation fallback and provided-design selection are independent", () =>
  withFixture({ role: "implementation" }, (f) => {
    assert.deepEqual(
      expected(f.profile).skills.map((s) => s.id),
      ["ste", "data-structure-design", "tracer-bullets"],
    );
    f.profile.assignment.design = { kind: "provided", path: f.designPath };
    const e = expected(f.profile);
    assert.deepEqual(
      e.skills.map((s) => s.id),
      ["ste"],
    );
    assert.equal(e.assignment.design.text, readFileSync(f.designPath, "utf8"));
  }));
test("SKILLS-S4: actual capture fixture emits valid terminal outcome and exact prompt", () => {
  const root = mkdtempSync(join(tmpdir(), "swf-skills-sanity-"));
  try {
    mkdirSync(join(root, "src"));
    const prompt = {
      instructions: { assignment: { role: "tester" }, skills: [] },
    };
    const p = spawnSync(
      process.execPath,
      [
        join(trustedRoot, "tests/spec/skills/fixtures/worker.cjs"),
        "good",
        "-C",
        root,
        JSON.stringify(prompt),
      ],
      { encoding: "utf8", timeout: 10000, windowsHide: true },
    );
    assert.ifError(p.error);
    assert.equal(p.status, 0, p.stderr);
    const events = p.stdout.trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(events.at(-1).type, "turn.completed");
    assert.equal(
      JSON.parse(events.find((e) => e.type === "item.completed").item.text)
        .kind,
      "completed",
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(root, "src/skills-contexts.jsonl"), "utf8"))
        .input,
      prompt,
    );
    assert.equal(
      readFileSync(join(root, "src/answer.cjs"), "utf8"),
      "module.exports = 42;\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
