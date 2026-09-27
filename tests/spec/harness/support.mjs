import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import Ajv from "ajv";
import { tmpdir } from "node:os";
import {
  dirname,
  resolve,
  join,
  relative,
  basename,
  isAbsolute,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const trustedRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
export const candidateRoot = resolve(
  process.env.FACTORY_CANDIDATE_ROOT ?? trustedRoot,
);
export const cliPath = join(candidateRoot, "dist/cli/main.js");
const ajv = new Ajv({ allErrors: true, strict: true });
export const inputSchema = JSON.parse(
  readFileSync(
    join(trustedRoot, "src/contracts/schemas/run-fixture.schema.json"),
    "utf8",
  ),
);
export const outputSchema = JSON.parse(
  readFileSync(
    join(trustedRoot, "src/contracts/schemas/cli-result.schema.json"),
    "utf8",
  ),
);
export const validateInput = ajv.compile(inputSchema);
export const validateOutput = ajv.compile(outputSchema);

export function removeFixtureDirectory(directory) {
  const absolute = resolve(directory);
  const child = relative(resolve(tmpdir()), absolute);
  assert.ok(
    child &&
      !child.startsWith("..") &&
      !isAbsolute(child) &&
      basename(absolute).startsWith("swf-p0-"),
    "Cleanup must remain inside the P0 temporary directory",
  );
  rmSync(absolute, { recursive: true, force: true });
}

export function launch(entrypoint, args, cwd = candidateRoot) {
  const child = spawnSync(process.execPath, [entrypoint, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
  assert.ifError(child.error);
  assert.equal(child.signal, null, `Process signal: ${child.signal}`);
  assert.notEqual(child.status, null, "Process must exit");
  assert.match(
    child.stdout,
    /^\{[^\r\n]*\}\r?\n$/,
    `Exactly one JSON output line required: ${child.stdout}`,
  );
  const result = JSON.parse(child.stdout);
  assert.ok(
    validateOutput(result),
    `Output schema: ${ajv.errorsText(validateOutput.errors)}`,
  );
  return { code: child.status, result, stderr: child.stderr };
}

export function runFixture(input, { raw = false, args } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "swf-p0-"));
  try {
    const path = join(directory, "fixture.json");
    writeFileSync(path, raw ? input : JSON.stringify(input));
    return launch(cliPath, args ?? ["run", "--fixture", path, "--json"]);
  } finally {
    removeFixtureDirectory(directory);
  }
}

export async function kernel() {
  return import(
    pathToFileURL(join(candidateRoot, "dist/kernel/index.js")).href
  );
}

export function assertInputError(observed) {
  assert.equal(observed.code, 2);
  assert.equal(observed.result.kind, "input_error");
  assert.deepEqual(observed.result.events, []);
  assert.ok(
    Array.isArray(observed.result.issues) && observed.result.issues.length > 0,
  );
  for (const issue of observed.result.issues) {
    assert.ok(typeof issue === "string" && issue.trim().length > 0);
  }
}

export function assertRun(
  observed,
  input,
  status,
  { verification = true } = {},
) {
  assert.equal(observed.code, status === "VERIFIED" ? 0 : 1);
  const result = observed.result;
  assert.equal(result.kind, "run_result");
  assert.equal(result.state.status, status);
  assert.equal(result.graph.id, `${input.request.id}:graph`);
  assert.equal(result.graph.requestId, input.request.id);
  assert.equal(result.graph.units.length, 1);
  assert.deepEqual(result.graph.dependencies, []);
  const work = result.graph.units[0];
  assert.equal(work.id, `${input.request.id}:unit:1`);
  assert.equal(work.objective, input.request.objective);
  assert.deepEqual(work.constraints, input.request.constraints);
  assert.deepEqual(work.metadata, input.request.metadata);
  assert.deepEqual(work.verification, input.verification);
  assert.deepEqual(result.state.unit, work);
  const events = result.events;
  assert.equal(events.filter((e) => e.type === "WorkGraphCreated").length, 1);
  assert.deepEqual(events[0], {
    type: "WorkGraphCreated",
    graphId: result.graph.id,
    unitIds: [work.id],
  });
  for (const event of events.slice(1)) {
    assert.equal(event.unitId, work.id);
  }
  assert.ok(
    events.every((e) => !/deliver|push|commit|pullrequest/i.test(e.type)),
    "No delivery event is permitted",
  );
  const path = [
    "PENDING",
    "READY",
    "RUNNING",
    ...(verification ? ["VERIFYING"] : []),
    status,
  ];
  assert.deepEqual(
    events
      .filter((e) => e.type === "UnitStateChanged")
      .map((e) => [e.from, e.to]),
    path.slice(1).map((to, i) => [path[i], to]),
  );
  for (const kind of ["AgentInvocationStarted", "AgentInvocationFinished"]) {
    assert.equal(events.filter((e) => e.type === kind).length, 1);
  }
  assert.deepEqual(
    events.find((e) => e.type === "AgentInvocationFinished").outcome,
    input.script.agentOutcome,
  );
  const index = (kind) => events.findIndex((e) => e.type === kind);
  const running = events.findIndex(
    (e) => e.type === "UnitStateChanged" && e.to === "RUNNING",
  );
  assert.ok(running < index("AgentInvocationStarted"));
  assert.ok(index("AgentInvocationStarted") < index("AgentInvocationFinished"));
  for (const kind of ["VerificationStarted", "VerificationFinished"]) {
    assert.equal(
      events.filter((e) => e.type === kind).length,
      verification ? 1 : 0,
    );
  }
  if (verification) {
    const verifying = events.findIndex(
      (e) => e.type === "UnitStateChanged" && e.to === "VERIFYING",
    );
    assert.ok(index("AgentInvocationFinished") < verifying);
    assert.ok(verifying < index("VerificationStarted"));
    assert.ok(index("VerificationStarted") < index("VerificationFinished"));
    assert.ok(
      index("VerificationFinished") <
        events.findIndex(
          (e) => e.type === "UnitStateChanged" && e.to === status,
        ),
    );
    assert.deepEqual(
      events.find((e) => e.type === "VerificationStarted").specIds,
      input.verification.required.map((s) => s.id),
    );
    assert.deepEqual(
      events.find((e) => e.type === "VerificationFinished").results,
      input.script.verificationResults,
    );
    if (status === "VERIFIED" || status === "REPAIR_READY") {
      assert.deepEqual(result.state.results, input.script.verificationResults);
    }
  }
  if (status === "FAILED") {
    assert.ok(result.state.reason?.trim());
  }
  if (status === "WAITING_FOR_DECISION") {
    assert.deepEqual(result.state.decision, input.script.agentOutcome.decision);
  }
}
