import test from "node:test";
import assert from "node:assert/strict";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  withFixture,
  runtime,
  writeConfig,
  run,
  runArgs,
  resume,
  readStore,
  rows,
  verified,
  error,
  assertInstructions,
  fault,
  killFactory,
  addAnswer,
  workspaces,
  cli,
} from "../harness/support.mjs";

for (const role of ["tester", "designer", "implementation"]) {
  test(`SKILLS-001: ${role} receives ordered role instructions and protected selected assets`, () =>
    withFixture({ role }, (f) => {
      const { evidence } = verified(f);
      assert.equal(rows(f).length, 1);
      assertInstructions(rows(f)[0], f.profile, evidence.contract.programs);
    }));
}

test("SKILLS-002: provided design replaces designer fallback and is pinned exact text", () =>
  withFixture({ role: "implementation" }, (f) => {
    f.profile.assignment.design = { kind: "provided", path: f.designPath };
    writeFileSync(f.designPath, "\uFEFF# Design\r\nPreserve the BOM and λ.\n");
    writeConfig(f);
    const { evidence } = verified(f);
    assertInstructions(rows(f)[0], f.profile, evidence.contract.programs);
    assert.deepEqual(
      rows(f)[0].input.instructions.skills.map((s) => s.id),
      ["ste"],
    );
  }));

test("SKILLS-003: editable lists and replacement STE preserve first occurrence order", () =>
  withFixture({ role: "implementation" }, (f) => {
    f.profile.catalog.find((s) => s.id === "ste").entrypoint =
      "custom/SKILL.md";
    f.profile.common = ["ste", "custom", "ste"];
    f.profile.byRole.implementation = ["tracer-bullets", "custom"];
    f.profile.byRole.designer = ["data-structure-design", "tracer-bullets"];
    writeConfig(f);
    const { evidence } = verified(f);
    assertInstructions(rows(f)[0], f.profile, evidence.contract.programs);
    assert.deepEqual(
      rows(f)[0].input.instructions.skills.map((s) => s.id),
      ["ste", "custom", "tracer-bullets", "data-structure-design"],
    );
  }));

test("SKILLS-004: legacy absence has no instructions or skill pins", () =>
  withFixture({ skills: false }, (f) => {
    const { evidence } = verified(f);
    const row = rows(f)[0];
    assert.equal(row.input?.instructions, undefined);
    assert.equal(row.input?.context?.instructions, undefined);
    assert.equal(
      evidence.contract.programs.some((a) =>
        a.path.includes("operator-skills"),
      ),
      false,
    );
    assert.equal(evidence.contract.config.skills, undefined);
  }));

test("SKILLS-005: non-durable run and evidence check honor selected pins", () =>
  withFixture({ kind: "local" }, (f) => {
    const { projection, evidence } = verified(f);
    assertInstructions(rows(f)[0], f.profile, evidence.contract.programs);
    assert.equal(
      cli(["check", "--evidence", projection.evidence.path, "--json"]).result
        .status,
      "current",
    );
    appendFileSync(join(f.skillRoot, "ste/SKILL.md"), "changed");
    const checked = cli([
      "check",
      "--evidence",
      projection.evidence.path,
      "--json",
    ]);
    assert.equal(checked.code, 1);
    assert.equal(checked.result.status, "invalid");
  }));

test("SKILLS-006: immutable profile compares parsed config and rejects changed assignment", () =>
  withFixture((f) => {
    verified(f);
    const before = readStore(f);
    writeFileSync(
      f.configPath,
      JSON.stringify(
        Object.fromEntries(Object.entries(f.config).reverse()),
        null,
        3,
      ),
    );
    verified(f);
    assert.deepEqual(readStore(f), before);
    assert.equal(rows(f).length, 1);
    f.profile.assignment = { role: "designer" };
    writeConfig(f);
    error(f, run(f), "config_mismatch");
    assert.deepEqual(readStore(f), before);
    assert.equal(rows(f).length, 1);
  }));

for (const target of ["entry", "asset", "design"]) {
  test(`SKILLS-007: ${target} change after committed creation prevents first dispatch`, () =>
    withFixture({ role: "implementation" }, async (f) => {
      f.profile.assignment.design = { kind: "provided", path: f.designPath };
      writeConfig(f);
      const cut = await fault(f, "transaction.after_commit", "RunCreated", {
        args: runArgs(f),
      });
      await killFactory(cut);
      const before = readStore(f);
      const path =
        target === "entry"
          ? join(f.skillRoot, "ste/SKILL.md")
          : target === "asset"
            ? join(f.skillRoot, "ste/asset.bin")
            : f.designPath;
      if (target === "asset") {
        rmSync(path);
      } else {
        appendFileSync(path, "changed");
      }
      error(f, resume(f), "artifact_invalid");
      assert.equal(rows(f).length, 0);
      assert.deepEqual(readStore(f), before);
    }));
}

test("SKILLS-008: interrupted reserved attempt gets fresh identical instructions", () =>
  withFixture((f) => {
    return (async () => {
      const cut = await fault(
        f,
        "transaction.after_commit",
        "AttemptReserved",
        { args: runArgs(f) },
      );
      await killFactory(cut);
      const { projection, evidence } = verified(f, resume(f));
      assert.equal(projection.attempts.length, 2);
      assert.equal(rows(f).length, 1);
      assertInstructions(rows(f)[0], f.profile, evidence.contract.programs);
    })();
  }));

test("SKILLS-009: decision continuation receives the same skills in fresh context", () =>
  withFixture({ kind: "decision" }, (f) => {
    const first = run(f);
    assert.equal(first.result.kind, "durable_result");
    const waiting = readStore(f).projection;
    assert.equal(waiting.state.status, "WAITING_FOR_DECISION");
    assertInstructions(rows(f)[0], f.profile, waiting.contract.programs);
    addAnswer(f, waiting.state.decision.id);
    const { projection, evidence } = verified(f, resume(f));
    assert.equal(rows(f).length, 2);
    assert.notEqual(rows(f)[0].threadId, rows(f)[1].threadId);
    assert.notEqual(rows(f)[0].pid, rows(f)[1].pid);
    assertInstructions(rows(f)[1], f.profile, evidence.contract.programs);
    assert.equal(rows(f)[1].input.context.decisions.length, 1);
    assert.equal(projection.attempts.length, 2);
  }));

test("SKILLS-010: selected asset mutation during human wait stops continuation", () =>
  withFixture({ kind: "decision" }, (f) => {
    const first = run(f);
    assert.equal(first.result.kind, "durable_result");
    const p = readStore(f).projection;
    assert.equal(p.state.status, "WAITING_FOR_DECISION");
    addAnswer(f, p.state.decision.id);
    appendFileSync(join(f.skillRoot, "tdd/asset.bin"), "changed");
    error(f, resume(f), "artifact_invalid");
    assert.equal(rows(f).length, 1);
    assert.equal(readStore(f).projection.attempts.length, 1);
  }));

test("SKILLS-011: bounded repair retains skill assignment and measured failure context", () =>
  withFixture({ kind: "repair", role: "implementation" }, (f) => {
    const { projection, evidence } = verified(f);
    assert.equal(projection.repairs.length, 1);
    assert.equal(rows(f).length, 2);
    for (const row of rows(f)) {
      assertInstructions(row, f.profile, evidence.contract.programs);
    }
    assert.ok(rows(f)[1].input.context.repair);
    assert.notEqual(rows(f)[0].threadId, rows(f)[1].threadId);
    assert.notEqual(rows(f)[0].pid, rows(f)[1].pid);
  }));

test("SKILLS-012: GitHub runtime carries skills through verified delivery", () =>
  withFixture({ kind: "github" }, (f) => {
    const { projection, evidence } = verified(f);
    assertInstructions(rows(f)[0], f.profile, evidence.contract.programs);
    assert.equal(projection.ci.kind, "passed");
    const g = JSON.parse(readFileSync(f.gatewayPath));
    assert.equal(g.pulls.length, 1);
  }));

test("SKILLS-013: invalid profile shapes fail before effects", async () => {
  const changes = [
    (p) => (p.common = []),
    (p) => (p.common = ["tdd"]),
    (p) => p.common.push("unknown"),
    (p) => p.catalog.push(structuredClone(p.catalog[0])),
    (p) => (p.assignment = { role: "unknown" }),
    (p) => (p.assignment = { role: "implementation" }),
    (p) => (p.assignment = { role: "tester", design: { kind: "none" } }),
    (p) => p.byRole.tester.push("unknown"),
  ];
  for (const change of changes) {
    await withFixture((f) => {
      change(f.profile);
      writeConfig(f);
      error(f, run(f), "input_error");
      assert.equal(rows(f).length, 0);
      assert.deepEqual(workspaces(f), []);
    });
  }
});

test("SKILLS-014: unsafe or missing selected paths fail before reading or dispatch", async () => {
  const changes = [
    (f) => (f.profile.catalog[0].entrypoint = "../external.txt"),
    (f) =>
      (f.profile.catalog[0].entrypoint = join(f.skillRoot, "ste/SKILL.md")),
    (f) => (f.profile.catalog[0].entrypoint = "ste/./SKILL.md"),
    (f) => (f.profile.catalog[0].entrypoint = "missing.md"),
    (f) => (f.profile.catalog[0].entrypoint = "ste"),
    (f) => {
      f.profile.catalog[0].root = f.repo;
      f.profile.catalog[0].entrypoint = "README.md";
      f.profile.catalog[0].assets = [];
    },
    (f) => {
      writeFileSync(join(f.config.workspaceRoot, "skill.md"), "unsafe");
      f.profile.catalog[0].root = f.config.workspaceRoot;
      f.profile.catalog[0].entrypoint = "skill.md";
      f.profile.catalog[0].assets = [];
    },
    (f) => {
      writeFileSync(join(f.config.artifactRoot, "skill.md"), "unsafe");
      f.profile.catalog[0].root = f.config.artifactRoot;
      f.profile.catalog[0].entrypoint = "skill.md";
      f.profile.catalog[0].assets = [];
    },
    (f) => {
      runtime(f).blockedReadPaths.push(join(f.skillRoot, "ste"));
    },
    (f) => {
      f.profile.catalog[0].assets = ["../credentials.txt"];
    },
    (f) => {
      const linked = join(f.root, "linked-skills");
      symlinkSync(f.skillRoot, linked, "junction");
      f.profile.catalog[0].root = linked;
    },
    (f) => {
      f.profile.assignment = {
        role: "implementation",
        design: { kind: "provided", path: join(f.repo, "README.md") },
      };
    },
    (f) => {
      f.profile.assignment = {
        role: "implementation",
        design: { kind: "provided", path: f.designPath },
      };
      runtime(f).blockedReadPaths.push(f.designPath);
    },
  ];
  for (const change of changes) {
    await withFixture((f) => {
      change(f);
      writeConfig(f);
      error(f, run(f), "input_error");
      assert.equal(rows(f).length, 0);
      assert.deepEqual(workspaces(f), []);
    });
  }
});

test("SKILLS-015: entry and design text byte limits and invalid UTF-8 fail closed", async () => {
  const changes = [
    (f) =>
      writeFileSync(join(f.skillRoot, "ste/SKILL.md"), Buffer.alloc(65537, 65)),
    (f) =>
      writeFileSync(join(f.skillRoot, "ste/SKILL.md"), Buffer.from([255, 128])),
    (f) => writeFileSync(join(f.skillRoot, "ste/SKILL.md"), ""),
    (f) => {
      f.profile.assignment = {
        role: "implementation",
        design: { kind: "provided", path: f.designPath },
      };
      writeFileSync(f.designPath, Buffer.alloc(65537, 65));
    },
    (f) => {
      f.profile.assignment = {
        role: "implementation",
        design: { kind: "provided", path: f.designPath },
      };
      writeFileSync(f.designPath, Buffer.from([255]));
    },
    (f) => {
      f.profile.common = f.profile.catalog.map((s) => s.id);
      for (const s of f.profile.catalog) {
        writeFileSync(join(s.root, s.entrypoint), Buffer.alloc(65536, 65));
      }
    },
  ];
  for (const change of changes) {
    await withFixture((f) => {
      change(f);
      writeConfig(f);
      error(f, run(f), "input_error");
      assert.equal(rows(f).length, 0);
    });
  }
});

test("SKILLS-016: only selected inputs affect durable recovery", () =>
  withFixture(async (f) => {
    const cut = await fault(f, "transaction.after_commit", "RunCreated", {
      args: runArgs(f),
    });
    await killFactory(cut);
    appendFileSync(join(f.skillRoot, "custom/SKILL.md"), "unselected change");
    appendFileSync(join(f.skillRoot, "undeclared.txt"), "undeclared change");
    const { evidence } = verified(f, resume(f));
    assertInstructions(rows(f)[0], f.profile, evidence.contract.programs);
  }));

test("SKILLS-017: non-durable malformed profile uses existing input-error shape", () =>
  withFixture({ kind: "local" }, (f) => {
    f.profile.common = [];
    writeConfig(f);
    error(f, run(f), "input_error");
    assert.deepEqual(workspaces(f), []);
    assert.deepEqual(rows(f), []);
  }));
