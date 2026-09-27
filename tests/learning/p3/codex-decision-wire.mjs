// Learning probe only: two live synthetic responses, no product acceptance claim.
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import Ajv from "ajv";

const codex =
  process.env.P3_CODEX_EXE ??
  "C:/nvm4w/nodejs/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe";
const root = mkdtempSync(join(tmpdir(), "swf-p3-wire-"));
const workspace = join(root, "workspace");
const artifacts = join(root, "artifacts");
mkdirSync(workspace);
mkdirSync(artifacts);
const text = { type: "string" };
const strings = { type: "array", items: text };
const closed = (properties) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const schema = closed({
  outcome: {
    anyOf: [
      closed({
        kind: { type: "string", enum: ["completed", "blocked", "failed"] },
        message: text,
      }),
      closed({
        kind: { type: "string", const: "decision_required" },
        decision: closed({
          question: text,
          reason: text,
          options: {
            type: "array",
            items: closed({
              id: text,
              description: text,
              consequences: strings,
            }),
          },
          impact: strings,
          reversible: { type: "boolean" },
        }),
      }),
    ],
  },
});
const schemaPath = join(artifacts, "wire.schema.json");
const schemaBytes = JSON.stringify(schema, null, 2) + "\n";
writeFileSync(schemaPath, schemaBytes);
const validate = new Ajv({ strict: true, allErrors: true }).compile(schema);
const version = spawnSync(codex, ["--version"], {
  encoding: "utf8",
  windowsHide: true,
  timeout: 15000,
});
if (version.status !== 0) {
  throw new Error(`Cannot read Codex version: ${version.stderr}`);
}
const cases = [
  {
    name: "decision",
    expected: {
      outcome: {
        kind: "decision_required",
        decision: {
          question: "Which color should the synthetic preview use?",
          reason: "The preview color requires an operator choice.",
          options: [
            {
              id: "blue",
              description: "Use blue.",
              consequences: ["The preview uses blue."],
            },
            {
              id: "green",
              description: "Use green.",
              consequences: ["The preview uses green."],
            },
          ],
          impact: ["Changes only the synthetic preview color."],
          reversible: true,
        },
      },
    },
  },
  {
    name: "completed",
    expected: {
      outcome: {
        kind: "completed",
        message: "Synthetic probe completed without actions.",
      },
    },
  },
];
console.log(
  JSON.stringify({ root, codex: version.stdout.trim(), node: process.version }),
);
const results = [];
for (const scenario of cases) {
  const directory = join(artifacts, scenario.name);
  mkdirSync(directory);
  const finalPath = join(directory, "final.json");
  const permissions =
    'permissions.p3wire.filesystem={":root"="read", ":workspace_roots"="write"}';
  const args = [
    "--no-daemon",
    "--ask-for-approval",
    "never",
    "exec",
    "--ignore-user-config",
    "-c",
    'windows.sandbox="elevated"',
    "-c",
    'default_permissions="p3wire"',
    "-c",
    permissions,
    "-c",
    "permissions.p3wire.network.enabled=false",
    "-c",
    "mcp_servers={}",
    "--ephemeral",
    "--skip-git-repo-check",
    "--cd",
    workspace,
    "--json",
    "--color",
    "never",
    "--output-schema",
    schemaPath,
    "--output-last-message",
    finalPath,
    "-",
  ];
  const prompt = `This is a harmless synthetic structured-output learning probe. Do not use any tool, inspect any file, edit any repository, or perform any external action. Return exactly this JSON object, with the specified nested branch and values: ${JSON.stringify(scenario.expected)}`;
  writeFileSync(join(directory, "prompt.txt"), prompt);
  const started = new Date().toISOString();
  const child = spawn(codex, args, {
    cwd: workspace,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let outputLimit = false;
  const terminate = () => {
    if (child.exitCode === null && child.pid) {
      spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        timeout: 15000,
      });
    }
  };
  const collect = (current, chunk) => {
    const next = current + chunk;
    if (next.length > 8 * 1024 * 1024) {
      outputLimit = true;
      terminate();
    }
    return next;
  };
  child.stdout.on("data", (chunk) => {
    stdout = collect(stdout, chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr = collect(stderr, chunk);
  });
  child.stdin.end(prompt);
  const timer = setTimeout(() => {
    timedOut = true;
    terminate();
  }, 180000);
  const exit = await new Promise((resolveExit) => {
    child.on("error", (error) =>
      resolveExit({ code: null, signal: null, error: error.message }),
    );
    child.on("close", (code, signal) => resolveExit({ code, signal }));
  });
  clearTimeout(timer);
  writeFileSync(join(directory, "stdout.jsonl"), stdout);
  writeFileSync(join(directory, "stderr.txt"), stderr);
  let final = null;
  let parseError = null;
  try {
    final = JSON.parse(readFileSync(finalPath, "utf8"));
  } catch (error) {
    parseError = error.message;
  }
  const events = stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { invalidJsonLine: line };
      }
    });
  const schemaValid = final !== null && validate(final);
  const exactExpected =
    schemaValid && JSON.stringify(final) === JSON.stringify(scenario.expected);
  const commandItems = events.filter(
    (event) => event.item?.type === "command_execution",
  );
  const passed =
    exit.code === 0 &&
    !timedOut &&
    !outputLimit &&
    schemaValid &&
    exactExpected &&
    commandItems.length === 0 &&
    readdirSync(workspace).length === 0;
  const result = {
    case: scenario.name,
    started,
    ended: new Date().toISOString(),
    args,
    ...exit,
    timedOut,
    outputLimit,
    final,
    parseError,
    schemaValid,
    validationErrors: validate.errors,
    exactExpected,
    commandItems: commandItems.length,
    eventTypes: events.map((event) => event.type),
    workspaceEntries: readdirSync(workspace),
    passed,
  };
  writeFileSync(
    join(directory, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  results.push(result);
  console.log(
    JSON.stringify({
      case: scenario.name,
      exit: exit.code,
      schemaValid,
      exactExpected,
      passed,
      final,
    }),
  );
}
const report = {
  root,
  node: process.version,
  codex: version.stdout.trim(),
  executable: codex,
  schemaPath,
  schemaDigest: createHash("sha256").update(schemaBytes).digest("hex"),
  results,
  passed: results.every((result) => result.passed),
};
writeFileSync(
  join(root, "result.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    root,
    passed: report.passed,
    schemaDigest: report.schemaDigest,
  }),
);
process.exitCode = report.passed ? 0 : 1;
// Retain the uniquely named temp fixture and evidence; no broad cleanup.
