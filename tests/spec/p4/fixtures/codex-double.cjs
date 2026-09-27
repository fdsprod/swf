const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const [mode, ...args] = process.argv.slice(2);
const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const cwd = flag("-C") || flag("--cd") || process.cwd();
const raw = args.at(-1) === "-" ? fs.readFileSync(0, "utf8") : args.at(-1);
const input = JSON.parse(raw);
if (
  input.schemaVersion !== 1 ||
  !input.attemptId ||
  !input.runId ||
  !input.context?.unit
) {
  throw Error("Structured fresh context required");
}
const partialPath = path.join(cwd, "src/p4-repair-partial.txt");
const row = {
  pid: process.pid,
  threadId: crypto.randomUUID(),
  args,
  input,
  partialBefore: fs.existsSync(partialPath)
    ? fs.readFileSync(partialPath, "utf8")
    : null,
  deliveryEnvironment: [
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "GIT_ASKPASS",
    "SSH_AUTH_SOCK",
    "SWF_TEST_FAULT",
  ].filter((k) => process.env[k]),
};
fs.appendFileSync(
  path.join(cwd, "src/p4-contexts.jsonl"),
  JSON.stringify(row) + "\n",
);
const repair = input.context.repair;
const decisions = input.context.decisions;
const question = {
  kind: "decision_required",
  decision: {
    question: "Which value should the module export?",
    reason: "Preserve human authority during repair.",
    options: [
      {
        id: "forty-two",
        description: "Export 42.",
        consequences: ["The answer is 42."],
      },
    ],
    impact: ["Changes the fixture answer."],
    reversible: true,
  },
};
let outcome = {
  kind: "completed",
  message: "Candidate edit ready for independent checks.",
};
if (mode === "blocked") {
  outcome = { kind: "blocked", message: "Cannot proceed." };
} else if (
  (mode === "decision-before" && !decisions.length) ||
  (mode === "decision-during" && repair && !decisions.length)
) {
  outcome = question;
} else if (repair) {
  if (
    !repair.results.some((r) => r.status === "failed") ||
    repair.results.some((r) => r.status === "error")
  ) {
    throw Error("Measured command failure required");
  }
  const required = input.context.unit.verification.required.map((s) => s.id);
  if (
    required.length !== repair.commands.length ||
    required.some((id) => !repair.commands.some((c) => c.specId === id))
  ) {
    throw Error("Exact required command coverage missing");
  }
  let failed = false;
  for (const c of repair.commands) {
    for (const s of ["stdout", "stderr"]) {
      const b = Buffer.from(c[s + "Base64"], "base64");
      if (
        crypto.createHash("sha256").update(b).digest("hex") !==
        c.process[s].digest
      ) {
        throw Error("Captured output digest mismatch");
      }
    }
    if (
      c.process.termination.kind === "exited" &&
      c.process.termination.exitCode === 7
    ) {
      const out = Buffer.from(c.stdoutBase64, "base64").toString("utf8");
      const err = Buffer.from(c.stderrBase64, "base64").toString("utf8");
      if (
        !/failure-token:[a-f0-9-]+/.test(out) ||
        !out.includes("raw-output:\u0000\u03bb\r\n") ||
        !err.includes("Expected 42; observed 0")
      ) {
        throw Error("Exact observed failure missing");
      }
      failed = true;
    }
  }
  if (
    !failed ||
    fs.readFileSync(path.join(cwd, "src/preserved.txt"), "utf8") !==
      "keep-first-edit"
  ) {
    throw Error("Failure or existing edit lost");
  }
  if (mode === "repair-interrupt") {
    if (!fs.existsSync(partialPath)) {
      fs.writeFileSync(partialPath, "partial repair must survive");
      setInterval(() => {}, 1000);
      return;
    }
    if (
      fs.readFileSync(partialPath, "utf8") !== "partial repair must survive"
    ) {
      throw Error("Interrupted repair edits changed");
    }
  }
  if (mode !== "always-fail") {
    fs.writeFileSync(
      path.join(cwd, "src/answer.cjs"),
      "module.exports = 42;\n",
    );
  }
} else {
  fs.writeFileSync(path.join(cwd, "src/preserved.txt"), "keep-first-edit");
  fs.writeFileSync(path.join(cwd, "src/answer.cjs"), "module.exports = 0;\n");
}
const response = mode.startsWith("decision-") ? { outcome } : outcome;
process.stdout.write(
  JSON.stringify({ type: "thread.started", thread_id: row.threadId }) + "\n",
);
process.stdout.write(
  JSON.stringify({
    type: "item.completed",
    item: { type: "agent_message", text: JSON.stringify(response) },
  }) + "\n",
);
process.stdout.write(
  JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 },
  }) + "\n",
);
