// External Codex configuration probe. Five small live calls, outside acceptance.
// Retain as documentation. No user config, persisted trust, or real MCP changes.
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const codex =
  process.env.P1_CODEX_EXE ??
  "C:/nvm4w/nodejs/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe";
const root = mkdtempSync(join(tmpdir(), "swf-p1-config-"));
const repo = join(root, "repo");
mkdirSync(join(repo, ".codex"), { recursive: true });
const git = (...args) => {
  const result = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr);
  }
};
git("init");
writeFileSync(join(repo, "source.txt"), "disposable config probe\n");
git("add", "source.txt");
git(
  "-c",
  "user.name=P1 Learning",
  "-c",
  "user.email=p1-learning@example.invalid",
  "commit",
  "-m",
  "probe baseline",
);
const server = join(root, "dummy-mcp.cjs");
writeFileSync(
  server,
  `const fs = require('node:fs');
fs.writeFileSync(process.argv[2], JSON.stringify({pid:process.pid, startedAt:new Date().toISOString()}));
const lines = require('node:readline').createInterface({input:process.stdin});
lines.on('line', line => {
  let request; try { request = JSON.parse(line); } catch { return; }
  if (request.id === undefined) return;
  const result = request.method === 'initialize'
    ? {protocolVersion:request.params.protocolVersion, capabilities:{tools:{}}, serverInfo:{name:'p1-dummy',version:'1'}}
    : request.method === 'tools/list' ? {tools:[]} : {};
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\\n');
});
lines.on('close', () => process.exit(0));
setTimeout(() => process.exit(0), 60000);
`,
);
const version = spawnSync(codex, ["--version"], {
  encoding: "utf8",
  windowsHide: true,
}).stdout.trim();
const results = [];
console.log(JSON.stringify({ root, codex, version, node: process.version }));
const cases = [
  "project_only",
  "cli_enabled",
  "cli_disabled",
  "cli_empty_table",
  "cli_apps_disabled",
];
const modes = process.env.P1_CONFIG_CASE ? [process.env.P1_CONFIG_CASE] : cases;
if (modes.some((mode) => !cases.includes(mode))) {
  throw new Error("Unknown P1_CONFIG_CASE");
}
for (const mode of modes) {
  const artifacts = join(root, mode);
  mkdirSync(artifacts);
  const sentinel = join(artifacts, "mcp-started.json");
  const slash = (value) => value.replaceAll("\\", "/");
  const serverArgs = [slash(server), slash(sentinel)];
  const command = slash(process.execPath);
  writeFileSync(
    join(repo, ".codex", "config.toml"),
    `[mcp_servers.p1_probe]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(serverArgs)}\nenabled = true\nstartup_timeout_sec = 10\n`,
  );
  const args = [
    "--no-daemon",
    "--ask-for-approval",
    "never",
    "exec",
    "--ignore-user-config",
    "-c",
    'windows.sandbox="elevated"',
    "-c",
    'default_permissions="p1"',
    "-c",
    `permissions.p1.filesystem={":root"="read", ":workspace_roots"="write", ${JSON.stringify(slash(join(repo, ".git")))}="read"}`,
    "-c",
    "permissions.p1.network.enabled=false",
  ];
  // This explicit host configuration authorizes only this disposable dummy.
  // It is a positive control, not a project trust override or sandbox fallback.
  if (mode !== "project_only") {
    args.push(
      "-c",
      `mcp_servers.p1_probe.command=${JSON.stringify(command)}`,
      "-c",
      `mcp_servers.p1_probe.args=${JSON.stringify(serverArgs)}`,
      "-c",
      `mcp_servers.p1_probe.enabled=${mode !== "cli_disabled"}`,
    );
  }
  if (mode === "cli_empty_table") {
    args.push("-c", "mcp_servers={}");
  }
  if (mode === "cli_apps_disabled") {
    args.push("-c", "features.apps=false");
  }
  args.push(
    "--ephemeral",
    "--cd",
    repo,
    "--json",
    "--color",
    "never",
    "--output-last-message",
    join(artifacts, "final.txt"),
    "-",
  );
  const child = spawn(codex, args, {
    cwd: repo,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(
    "This is a disposable configuration probe. Respond exactly OK. Do not use any tools or inspect files.",
  );
  const timer = setTimeout(() => {
    timedOut = true;
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
    });
  }, 90000);
  const exit = await new Promise((resolveExit) => {
    child.on("error", (error) =>
      resolveExit({ code: null, error: error.message }),
    );
    child.on("close", (code, signal) => resolveExit({ code, signal }));
  });
  clearTimeout(timer);
  writeFileSync(join(artifacts, "stdout.jsonl"), stdout);
  writeFileSync(join(artifacts, "stderr.txt"), stderr);
  const result = {
    mode,
    ...exit,
    timedOut,
    serverStarted: existsSync(sentinel),
    final: existsSync(join(artifacts, "final.txt"))
      ? readFileSync(join(artifacts, "final.txt"), "utf8")
      : null,
    args,
    stderr,
  };
  writeFileSync(
    join(artifacts, "result.json"),
    JSON.stringify(result, null, 2),
  );
  results.push(result);
  console.log(
    JSON.stringify({
      mode,
      code: result.code,
      timedOut,
      serverStarted: result.serverStarted,
      final: result.final,
      stderr,
    }),
  );
}
writeFileSync(
  join(root, "result.json"),
  JSON.stringify(
    { root, codex, version, node: process.version, results },
    null,
    2,
  ),
);
// No absence-only conclusion: the explicit positive control must start the server.
process.exitCode = results.every(
  (result) =>
    result.code === 0 &&
    !result.timedOut &&
    (result.mode !== "cli_enabled" || result.serverStarted) &&
    (result.mode !== "cli_disabled" || !result.serverStarted),
)
  ? 0
  : 1;
// A selected supplemental case relies on the retained full-run positive control.
// Preserve this exact disposable root and evidence for review. Never delete by glob.
