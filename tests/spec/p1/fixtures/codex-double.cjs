// Protocol double, not a verifier. The factory must restrict this real process.
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const [mode, fixtureRoot, ...args] = process.argv.slice(2);
const find = (flag) =>
  args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
const cwd = find("-C") || find("--cd") || process.cwd();
process.chdir(cwd);
fs.writeFileSync(path.join(cwd, "src", "worker-started.txt"), "started");
const resultPath = find("--output-last-message") || find("-o");
function finish(value, code = 0) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  process.stdout.write(
    JSON.stringify({ type: "thread.started", thread_id: "fixture-thread" }) +
      "\n",
  );
  if (mode === "intermediate") {
    process.stdout.write(
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "I will inspect the source now." },
      }) + "\n",
    );
  }
  if (mode === "malformed-events") {
    process.stdout.write("not-json\n");
  }
  process.stdout.write(
    JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text },
    }) + "\n",
  );
  if (mode === "turn-failed") {
    process.stdout.write(
      JSON.stringify({
        type: "turn.failed",
        error: { message: "injected provider failure" },
      }) + "\n",
    );
  }
  process.stdout.write(
    JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 },
    }) + "\n",
  );
  if (mode === "duplicate-terminal") {
    process.stdout.write(
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 },
      }) + "\n",
    );
  }
  if (resultPath) {
    fs.writeFileSync(resultPath, text);
  }
  process.stderr.write("worker-stderr\n");
  process.exit(code);
}
function child() {
  const script = `const fs=require('fs'); setInterval(()=>fs.writeFileSync(${JSON.stringify(path.join(cwd, "src", "heartbeat.txt"))},String(Date.now())),50);`;
  const proc = cp.spawn(process.execPath, ["-e", script], {
    detached: true,
    stdio: "ignore",
    cwd,
  });
  proc.unref();
  fs.writeFileSync(path.join(cwd, "src", "child.pid"), String(proc.pid));
}
if (mode === "hang" || mode === "hang-child") {
  if (mode === "hang-child") {
    child();
  }
  setInterval(() => {}, 1000);
} else if (mode === "absent") {
  process.exit(0);
} else if (mode === "malformed") {
  finish("{not-json");
} else if (mode === "nonzero") {
  finish({ kind: "completed", message: "claimed complete" }, 9);
} else if (mode === "blocked" || mode === "failed") {
  finish({ kind: mode, message: "fixture worker cannot complete" });
} else {
  if (mode !== "lie") {
    fs.writeFileSync(
      path.join(cwd, "src", "answer.cjs"),
      "module.exports = 42;\n",
    );
  }
  if (mode === "forbidden") {
    fs.writeFileSync(path.join(cwd, "README.md"), "forbidden edit\n");
  }
  if (mode === "tamper-tests") {
    try {
      fs.writeFileSync(
        path.join(cwd, "tests", "protected.cjs"),
        "process.exit(0);\n",
      );
    } catch {}
    fs.writeFileSync(
      path.join(cwd, "src", "answer.cjs"),
      "module.exports = 0;\n",
    );
  }
  if (mode === "detached") {
    child();
  }
  if (mode === "restrictions") {
    const report = {};
    for (const [name, target] of [
      ["external", path.join(fixtureRoot, "external.txt")],
      ["protected", path.join(cwd, "tests", "protected.cjs")],
      ["source", path.join(fixtureRoot, "repo", "src", "answer.cjs")],
      ["git", path.join(fixtureRoot, "repo", ".git", "protected.txt")],
      ["gitPointer", path.join(cwd, ".git")],
    ]) {
      try {
        fs.writeFileSync(target, "BREACH");
        report[name] = "wrote";
      } catch (error) {
        report[name] = error.code;
      }
    }
    try {
      fs.readFileSync(path.join(fixtureRoot, "credentials.txt"));
      report.credentials = "read";
    } catch (error) {
      report.credentials = error.code;
    }
    report.deliveryEnvironment = [
      "GH_TOKEN",
      "GITHUB_TOKEN",
      "GIT_ASKPASS",
      "SSH_AUTH_SOCK",
      "CODEX_API_KEY",
      "OPENAI_API_KEY",
    ].filter((key) => process.env[key]);
    report.args = args;
    fs.writeFileSync(
      path.join(cwd, "src", "restrictions.json"),
      JSON.stringify(report),
    );
  }
  finish({ kind: "completed", message: "Fixture worker claims completion" });
}
