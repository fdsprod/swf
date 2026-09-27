import assert from "node:assert/strict";
import { readFileSync, readdirSync, lstatSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const commands = [
  "npm ci",
  "npm run typecheck",
  "npm run build",
  "npm test",
  "npm run test:sanity",
  "npm run check:architecture",
];
const headRef = "${{ github.event.pull_request.head.sha || github.sha }}";
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function keys(value, allowed, label) {
  assert.ok(object(value), label + " must be a mapping");
  assert.ok(
    Object.keys(value).every((key) => allowed.includes(key)),
    label + " has unsupported keys",
  );
}
function name(value) {
  if (value !== undefined) {
    assert.ok(
      typeof value === "string" && value.trim(),
      "Step/workflow names must be nonempty strings",
    );
  }
}

export function validateWorkflow(text, parseDocument) {
  assert.ok(
    Buffer.byteLength(text) <= 32768,
    "Workflow exceeds the bootstrap size limit",
  );
  const document = parseDocument(text, {
    version: "1.2",
    strict: true,
    uniqueKeys: true,
    stringKeys: true,
  });
  assert.deepEqual(
    document.errors.map((error) => error.message),
    [],
    "Workflow must be valid YAML with unique keys",
  );
  assert.deepEqual(
    document.warnings.map((error) => error.message),
    [],
    "Workflow must not depend on unsupported YAML tags",
  );
  const workflow = document.toJS({ maxAliasCount: 0 });
  keys(workflow, ["name", "on", "permissions", "jobs"], "Workflow");
  name(workflow.name);
  assert.deepEqual(
    workflow.permissions,
    { contents: "read" },
    "Workflow permissions must be contents: read only",
  );
  keys(workflow.on, ["pull_request", "push"], "Triggers");
  assert.ok(
    Object.hasOwn(workflow.on, "pull_request"),
    "Every pull request must trigger the workflow",
  );
  assert.ok(
    workflow.on.pull_request === null ||
      (object(workflow.on.pull_request) &&
        Object.keys(workflow.on.pull_request).length === 0),
    "Pull request trigger must not filter or omit default events",
  );
  assert.deepEqual(
    workflow.on.push,
    { branches: ["main"] },
    "Push trigger must target only main",
  );
  assert.deepEqual(
    Object.keys(workflow.jobs ?? {}),
    ["bootstrap-checks"],
    "Exactly one stable bootstrap job is required",
  );
  const job = workflow.jobs["bootstrap-checks"];
  keys(job, ["name", "runs-on", "steps", "timeout-minutes"], "Job");
  assert.equal(
    job.name,
    "bootstrap-checks",
    "The displayed check name must remain stable",
  );
  assert.equal(
    job["runs-on"],
    "windows-latest",
    "Bootstrap checks must run on Windows",
  );
  if (job["timeout-minutes"] !== undefined) {
    assert.ok(
      Number.isInteger(job["timeout-minutes"]) &&
        job["timeout-minutes"] >= 1 &&
        job["timeout-minutes"] <= 30,
      "Optional job timeout must be between 1 and 30 minutes",
    );
  }
  assert.ok(Array.isArray(job.steps), "Job steps must be an array");
  assert.equal(
    job.steps.length,
    commands.length + 2,
    "Use two setup steps and one separate step for each required command",
  );
  const [checkout, node, ...runs] = job.steps;
  keys(checkout, ["name", "uses", "with"], "Checkout step");
  name(checkout.name);
  assert.equal(checkout.uses, "actions/checkout@v4");
  assert.deepEqual(
    checkout.with,
    { ref: headRef, "persist-credentials": false },
    "Checkout must select the exact candidate and discard checkout credentials",
  );
  keys(node, ["name", "uses", "with"], "Node setup step");
  name(node.name);
  assert.equal(node.uses, "actions/setup-node@v4");
  keys(node.with, ["node-version", "cache"], "Node setup inputs");
  assert.equal(
    node.with["node-version"],
    "22.22.3",
    "Node version must be pinned",
  );
  if (node.with.cache !== undefined) {
    assert.equal(node.with.cache, "npm");
  }
  runs.forEach((step, index) => {
    keys(step, ["name", "run", "shell"], "Command step");
    name(step.name);
    if (step.shell !== undefined) {
      assert.equal(
        step.shell,
        "pwsh",
        "Only the normal Windows PowerShell step shell is supported",
      );
    }
    assert.equal(typeof step.run, "string");
    assert.equal(
      step.run.trim().replace(/^npm\.cmd /, "npm "),
      commands[index],
      "Each required command must run once, alone, and in order",
    );
  });
  return { job: "bootstrap-checks", node: "22.22.3", commands };
}

export function loadParser(yamlRoot) {
  const root = resolve(yamlRoot);
  const packageInfo = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  assert.equal(packageInfo.name, "yaml");
  assert.equal(
    packageInfo.version,
    "2.8.1",
    "Use the frozen external YAML parser",
  );
  return createRequire(import.meta.url)(join(root, "dist/index.js"))
    .parseDocument;
}
export function verifyDirectory(candidateRoot, yamlRoot) {
  const directory = join(resolve(candidateRoot), ".github", "workflows");
  const path = join(directory, "bootstrap.yml");
  assert.ok(existsSync(path), "Required bootstrap workflow is missing");
  assert.ok(
    lstatSync(directory).isDirectory() &&
      !lstatSync(directory).isSymbolicLink(),
    "Workflow directory must be regular",
  );
  assert.deepEqual(
    readdirSync(directory).sort(),
    ["bootstrap.yml"],
    "Bootstrap adds exactly one workflow",
  );
  assert.ok(
    lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(),
    "Workflow must be a regular file",
  );
  const bytes = readFileSync(path);
  assert.ok(
    Buffer.from(bytes.toString("utf8")).equals(bytes),
    "Workflow must be UTF-8",
  );
  return validateWorkflow(bytes.toString("utf8"), loadParser(yamlRoot));
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    assert.equal(
      process.argv.length,
      4,
      "Usage: node verify.mjs --yaml-root <pinned yaml package directory>",
    );
    assert.equal(process.argv[2], "--yaml-root");
    const details = verifyDirectory(process.cwd(), process.argv[3]);
    process.stdout.write(
      JSON.stringify({
        status: "passed",
        specId: "workflow-structure",
        ...details,
      }) + "\n",
    );
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        status: "failed",
        specId: "workflow-structure",
        reason: String(error),
      }) + "\n",
    );
    process.exitCode = 1;
  }
}
