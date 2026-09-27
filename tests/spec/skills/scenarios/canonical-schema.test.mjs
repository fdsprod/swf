import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import { candidateRoot } from "../harness/support.mjs";

// Candidate schemas are the subject under test. The expected data is defined here
// from the independent public contract, without importing candidate code.
function validator() {
  const ajv = new Ajv({ strict: true, allErrors: true });
  const directory = join(candidateRoot, "src/contracts/schemas");
  for (const name of readdirSync(directory)
    .filter((n) => n.endsWith(".schema.json"))
    .sort()) {
    ajv.addSchema(JSON.parse(readFileSync(join(directory, name), "utf8")));
  }
  const validate = ajv.getSchema(
    "https://swf.local/schemas/p3/decision-worker-input.schema.json",
  );
  assert.ok(validate, "Canonical structured worker schema must exist");
  return { validate, errors: () => ajv.errorsText(validate.errors) };
}
const artifact = {
  path: "C:/operator/skills/ste/SKILL.md",
  digest: "a".repeat(64),
};
const instructions = {
  assignment: { role: "tester" },
  skills: [
    {
      id: "ste",
      entrypoint: artifact,
      text: "# STE\r\nUse direct sentences.\n",
      assets: [
        { path: "C:/operator/skills/ste/reference.md", digest: "b".repeat(64) },
      ],
    },
  ],
};
function context() {
  const request = {
    id: "schema-request",
    source: { provider: "fixture", externalId: "schema" },
    repository: { url: "C:/schema/repo", baseRef: "main" },
    objective: "Prove the public input shape.",
    constraints: [],
    acceptanceCriteria: ["The required check passes."],
    metadata: {},
  };
  const verification = {
    required: [
      {
        kind: "command",
        id: "check",
        command: "node check.cjs",
        timeoutSeconds: 2,
      },
    ],
    completionPolicy: { requireAll: true },
  };
  return {
    schemaVersion: 1,
    runId: "schema-run",
    attemptId: "schema-attempt",
    workspace: {
      path: "C:/schema/worktree",
      repositoryPath: "C:/schema/repo",
      baseCommit: "c".repeat(40),
    },
    context: {
      request,
      unit: {
        id: "schema-unit",
        objective: request.objective,
        constraints: [],
        verification,
        metadata: {},
      },
      priorAttempts: [],
      decisions: [],
      evidence: [],
      repositoryContext: [],
    },
  };
}

test("SKILLS-SCHEMA-001: canonical structured input accepts legacy and each valid skill assignment", () => {
  const { validate, errors } = validator();
  assert.equal(validate(context()), true, errors());
  const assignments = [
    { role: "tester" },
    { role: "designer" },
    { role: "implementation", design: { kind: "none" } },
    {
      role: "implementation",
      design: {
        kind: "provided",
        artifact: { path: "C:/operator/design.md", digest: "d".repeat(64) },
        text: "Exact provided design.\n",
      },
    },
  ];
  for (const assignment of assignments) {
    const input = context();
    input.context.instructions = {
      ...structuredClone(instructions),
      assignment,
    };
    assert.equal(
      validate(input),
      true,
      `Valid ${JSON.stringify(assignment)} instructions must be accepted: ${errors()}`,
    );
  }
});

test("SKILLS-SCHEMA-002: canonical structured input rejects malformed instruction branches and artifacts", () => {
  const { validate } = validator();
  const mutations = [
    (i) => delete i.assignment,
    (i) => (i.assignment = { role: "unknown" }),
    (i) => (i.assignment = { role: "implementation" }),
    (i) => (i.assignment = { role: "tester", design: { kind: "none" } }),
    (i) =>
      (i.assignment = {
        role: "implementation",
        design: { kind: "provided", text: "Missing artifact" },
      }),
    (i) =>
      (i.assignment = {
        role: "implementation",
        design: { kind: "none", text: "Unexpected text" },
      }),
    (i) => delete i.skills,
    (i) => (i.skills = "not an array"),
    (i) => delete i.skills[0].text,
    (i) => (i.skills[0].text = 42),
    (i) => (i.skills[0].entrypoint.digest = "invalid digest"),
    (i) => (i.skills[0].assets[0] = { path: "C:/operator/reference.md" }),
    (i) => (i.skills[0].extraAuthority = true),
    (i) => (i.extraAuthority = true),
  ];
  for (const mutate of mutations) {
    const input = context();
    input.context.instructions = structuredClone(instructions);
    mutate(input.context.instructions);
    assert.equal(
      validate(input),
      false,
      `Malformed instructions must be rejected: ${JSON.stringify(input.context.instructions)}`,
    );
  }
  for (const value of [null, [], {}, "instructions"]) {
    const input = context();
    input.context.instructions = value;
    assert.equal(validate(input), false);
  }
});
