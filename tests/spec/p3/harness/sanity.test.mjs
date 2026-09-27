import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  withFixture,
  validateWire,
  validateAnswer,
  gateway,
  addAnswer,
  resolver,
  hash,
} from "./support.mjs";
import {
  replay,
  assertSnapshot,
  assertHistoricalDecisionArtifacts,
} from "./replay.mjs";

export function trace(f) {
  const unit = {
    id: `${f.config.request.id}:unit:1`,
    objective: f.config.request.objective,
    constraints: f.config.request.constraints,
    verification: f.config.verification,
    metadata: f.config.request.metadata,
  };
  const graph = {
    id: `${f.config.request.id}:graph`,
    requestId: f.config.request.id,
    units: [unit],
    dependencies: [],
  };
  const artifact = {
    path: join(f.root, "synthetic.json"),
    digest: "a".repeat(64),
  };
  const request = {
    id: "decision-1",
    runId: "sanity-run",
    unitId: unit.id,
    question: "Which answer?",
    reason: "Protected choice",
    options: [{ id: "forty-two", description: "42", consequences: [] }],
    impact: [],
    reversible: true,
    evidence: [],
  };
  const question = {
    id: 1000,
    url: "https://github.com/factory-fixture/decisions/issues/7#issuecomment-1000",
    author: { id: 201, login: "factory-fixture" },
    createdAt: "2026-09-25T01:00:00Z",
    updatedAt: "2026-09-25T01:00:00Z",
  };
  const facts = [
    {
      type: "RunCreated",
      contract: { config: f.config, digest: "b".repeat(64), programs: [] },
      graph,
      baseCommit: f.base,
      maxStarts: 2,
    },
    {
      type: "WorkspacePlanned",
      operationId: "workspace-1",
      workspace: {
        repositoryPath: f.repo,
        path: join(f.config.workspaceRoot, "one"),
        baseCommit: f.base,
      },
    },
    { type: "WorkspaceReady", operationId: "workspace-1" },
    {
      type: "AttemptReserved",
      attempt: { id: "attempt-1", ordinal: 1, completionPath: artifact.path },
    },
    {
      type: "WorkerCompleted",
      attemptId: "attempt-1",
      outcome: { kind: "decision_required", decision: request },
      record: artifact,
    },
    {
      type: "DecisionPublicationPlanned",
      decisionId: request.id,
      publication: {
        operationId: "publication-1",
        publisher: question.author,
        body: artifact,
      },
    },
    {
      type: "DecisionPublicationStarted",
      decisionId: request.id,
      operationId: "publication-1",
    },
    {
      type: "DecisionPublished",
      decisionId: request.id,
      operationId: "publication-1",
      receipt: { comment: question, record: artifact },
    },
    {
      type: "DecisionResolved",
      decisionId: request.id,
      resolution: {
        id: "resolution-1",
        decisionId: request.id,
        answer: "Use 42.",
        selectedOptionId: "forty-two",
        basis: "human",
        evidence: [
          {
            id: "human-evidence",
            kind: "human_decision",
            uri: "file:///snapshot",
            digest: "a".repeat(64),
          },
        ],
        resolvedAt: "2026-09-25T02:00:00Z",
      },
      source: {
        comment: {
          ...question,
          id: 1001,
          author: resolver,
          createdAt: "2026-09-25T02:00:00Z",
          updatedAt: "2026-09-25T02:00:00Z",
        },
        record: artifact,
      },
    },
  ];
  return JSON.parse(
    JSON.stringify(
      facts.map((fact, index) => ({
        sequence: index + 1,
        runId: "sanity-run",
        fact,
      })),
    ),
  );
}
test("P3 sanity: historical conflict oracle rejects altered evidence after current conflict is gone", () =>
  withFixture((f) => {
    const comment = {
      id: 1001,
      html_url:
        "https://github.com/factory-fixture/decisions/issues/7#issuecomment-1001",
      user: resolver,
      body: "captured answer",
      created_at: "2026-09-25T02:00:00Z",
      updated_at: "2026-09-25T02:00:00Z",
    };
    const path = join(f.root, "historical-conflict.json");
    const bytes = JSON.stringify([comment]);
    writeFileSync(path, bytes);
    const events = [
      {
        fact: {
          type: "DecisionConflictObserved",
          conflict: {
            record: { path, digest: hash(bytes) },
            comments: [
              {
                id: comment.id,
                url: comment.html_url,
                author: resolver,
                createdAt: comment.created_at,
                updatedAt: comment.updated_at,
              },
            ],
          },
        },
      },
    ];
    assertHistoricalDecisionArtifacts(events);
    writeFileSync(path, bytes + "altered");
    assert.throws(
      () => assertHistoricalDecisionArtifacts(events),
      assert.AssertionError,
    );
  }));
test("P3 sanity: independent replay accepts authenticated resolution and rejects authority/bypass defects", () =>
  withFixture((f) => {
    const events = trace(f);
    const projection = replay(events);
    assert.equal(projection.state.status, "READY");
    assertSnapshot({ events, projection });
    for (const mutation of [
      (e) => {
        e.at(-1).fact.source.comment.author.id = 999;
      },
      (e) => {
        e.at(-1).fact.decisionId = "wrong";
      },
      (e) => {
        e.at(-1).fact.resolution.selectedOptionId = "wrong";
      },
      (e) => {
        e.at(-1).fact.source.comment.createdAt = "2000-01-01T00:00:00Z";
      },
      (e) => {
        e[7].fact.receipt.comment.author.id = 999;
      },
    ]) {
      const bad = structuredClone(events);
      mutation(bad);
      assert.throws(() => replay(bad), assert.AssertionError);
    }
    const repeated = [
      ...events,
      {
        sequence: events.length + 1,
        runId: "sanity-run",
        fact: events.at(-1).fact,
      },
    ];
    assert.throws(() => replay(repeated), assert.AssertionError);
    const forged = structuredClone(projection);
    forged.state = { status: "VERIFIED", unit: forged.state.unit, results: [] };
    assert.throws(
      () => assertSnapshot({ events, projection: forged }),
      assert.AssertionError,
    );
  }));

test("P3 sanity: live-probed wire and answer schemas reject extra authority and wrong branch shape", () => {
  assert.equal(
    validateWire({ outcome: { kind: "completed", message: "done" } }),
    true,
  );
  const good = {
    outcome: {
      kind: "decision_required",
      decision: {
        question: "Which?",
        reason: "Human choice",
        options: [],
        impact: [],
        reversible: true,
      },
    },
  };
  assert.equal(validateWire(good), true);
  const bad = structuredClone(good);
  bad.outcome.decision.authorizedResolver = resolver;
  assert.equal(validateWire(bad), false);
  assert.equal(
    validateWire({
      outcome: {
        kind: "completed",
        message: "done",
        decision: good.outcome.decision,
      },
    }),
    false,
  );
  assert.equal(
    validateAnswer({
      schemaVersion: 1,
      decisionId: "one",
      answer: "yes",
      selectedOptionId: null,
    }),
    true,
  );
  assert.equal(
    validateAnswer({
      schemaVersion: 1,
      decisionId: "one",
      answer: "yes",
      selectedOptionId: null,
      author: resolver,
    }),
    false,
  );
});

test("P3 sanity: persisted API double exposes all pages and records a lost successful POST", () =>
  withFixture((f) => {
    const invoke = (args, input) =>
      spawnSync(
        f.config.decisions.executable,
        [
          ...f.config.decisions.prefixArgs,
          "api",
          "--hostname",
          "github.com",
          ...args,
        ],
        { encoding: "utf8", input, windowsHide: true, timeout: 10000 },
      );
    const wrongRealm = spawnSync(
      f.config.decisions.executable,
      [...f.config.decisions.prefixArgs, "api", "--method", "GET", "user"],
      {
        encoding: "utf8",
        env: { ...process.env, GH_HOST: "hostile.example.invalid" },
        windowsHide: true,
        timeout: 10000,
      },
    );
    assert.equal(wrongRealm.status, 1);
    assert.match(wrongRealm.stderr, /identity realm/);
    const who = invoke(["--method", "GET", "user"]);
    assert.equal(who.status, 0);
    assert.equal(JSON.parse(who.stdout).id, 201);
    const created = invoke(
      [
        "--method",
        "POST",
        "repos/factory-fixture/decisions/issues/7/comments",
        "--input",
        "-",
      ],
      JSON.stringify({ body: "Exact\nmultiline question" }),
    );
    assert.equal(created.status, 0);
    addAnswer(f, "decision-1");
    const list = invoke([
      "--method",
      "GET",
      "repos/factory-fixture/decisions/issues/7/comments?per_page=100",
      "--paginate",
      "--slurp",
    ]);
    assert.equal(list.status, 0);
    const pages = JSON.parse(list.stdout);
    assert.equal(pages.length, 2);
    assert.equal(pages.flat()[0].body, "Exact\nmultiline question");
    assert.equal(pages.flat()[1].user.id, resolver.id);
    const state = gateway(f);
    state.mode = "post-response-lost";
    writeFileSync(f.gatewayPath, JSON.stringify(state));
    const lost = invoke(
      [
        "--method",
        "POST",
        "repos/factory-fixture/decisions/issues/7/comments",
        "--input",
        "-",
      ],
      JSON.stringify({ body: "lost response" }),
    );
    assert.equal(lost.status, 1);
    assert.equal(gateway(f).comments.at(-1).body, "lost response");
  }));

test("P3 sanity: worker requires recorded answer and external verifier rejects its uncorrected tree", () =>
  withFixture((f) => {
    const input = {
      schemaVersion: 1,
      runId: "sanity-run",
      attemptId: "one",
      workspace: { path: f.repo, repositoryPath: f.repo, baseCommit: f.base },
      context: {
        request: f.config.request,
        unit: {},
        priorAttempts: [],
        decisions: [],
        evidence: [],
        repositoryContext: [],
      },
    };
    const invoke = () =>
      spawnSync(
        f.config.worker.executable,
        [
          ...f.config.worker.prefixArgs,
          "exec",
          "--json",
          "-C",
          f.repo,
          JSON.stringify(input),
        ],
        { encoding: "utf8", windowsHide: true, timeout: 10000 },
      );
    const first = invoke();
    assert.equal(first.status, 0);
    assert.equal(
      JSON.parse(JSON.parse(first.stdout.trim().split("\n")[1]).item.text)
        .outcome.kind,
      "decision_required",
    );
    const check = () =>
      spawnSync(f.config.commands[0].executable, f.config.commands[0].args, {
        cwd: f.repo,
        encoding: "utf8",
        windowsHide: true,
        timeout: 10000,
      });
    assert.equal(check().status, 1);
    input.attemptId = "two";
    input.context.decisions = [
      {
        answer: "Use 42.\nApproved.",
        selectedOptionId: "forty-two",
        basis: "human",
        evidence: [{ id: "proof" }],
      },
    ];
    assert.equal(invoke().status, 0);
    assert.equal(check().status, 0);
    input.context.decisions[0].answer = "different";
    assert.notEqual(invoke().status, 0);
  }));
