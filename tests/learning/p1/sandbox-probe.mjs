// Direct native argv avoids cmd.exe stripping TOML quotes.
// No model call. Tests the installed external Codex sandbox, not factory code.
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  copyFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = mkdtempSync(join(tmpdir(), "swf-p1-sandbox-"));
const repo = join(root, "repo");
mkdirSync(repo);
function git(...args) {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(r.stderr);
  }
}
git("init");
writeFileSync(join(repo, "base.txt"), "baseline");
git("add", "base.txt");
git(
  "-c",
  "user.name=P1 Learning",
  "-c",
  "user.email=p1-learning@example.invalid",
  "commit",
  "-m",
  "fixture",
);
const cwd = join(root, "workspace");
git("worktree", "add", "--detach", cwd, "HEAD");
const sharedGit = join(repo, ".git", "p1-sentinel.txt");
writeFileSync(sharedGit, "git-pinned");
const sentinel = join(root, "protected.txt");
writeFileSync(sentinel, "original");
const fakeCredential = join(root, "fake-delivery-credential.txt");
writeFileSync(fakeCredential, "dummy-not-a-secret");
const protectedInWorkspace = join(cwd, "tests");
mkdirSync(protectedInWorkspace);
const pinnedTest = join(protectedInWorkspace, "sentinel.txt");
writeFileSync(pinnedTest, "pinned");
const probe = join(cwd, "probe.cjs");
const copiedNode = join(
  process.env.P1_NODE_OUTSIDE === "1" ? root : cwd,
  "node.exe",
);
if (process.env.P1_COPY_NODE === "1") {
  copyFileSync(process.execPath, copiedNode);
}
writeFileSync(
  probe,
  `const fs=require('fs'); const result={}; for(const [key,p] of [['allowed','source.txt'],['external',${JSON.stringify(sentinel)}],['pinned',${JSON.stringify(pinnedTest)}],['sharedGit',${JSON.stringify(sharedGit)}]]) {try {fs.writeFileSync(p,'changed');result[key]='wrote'}catch(e){result[key]=e.code}} try{fs.readFileSync(${JSON.stringify(fakeCredential)});result.credentialRead='read'}catch(e){result.credentialRead=e.code} console.log(JSON.stringify(result));`,
);
const executable =
  process.env.P1_CODEX_EXE ??
  "C:/nvm4w/nodejs/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe";
const childArgs =
  process.env.P1_SANDBOX_SHELL === "powershell"
    ? [
        "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
        "-NoProfile",
        "-Command",
        `Set-Content -LiteralPath 'source.txt' -Value 'changed' -ErrorAction Stop; try { Set-Content -LiteralPath '${sentinel}' -Value 'changed' -ErrorAction Stop; Write-Output 'external wrote' } catch { Write-Output $_.Exception.Message }`,
      ]
    : [
        process.env.P1_COPY_NODE === "1"
          ? copiedNode
          : (process.env.P1_NODE_EXE ?? process.execPath),
        probe,
      ];
const permissions = `permissions.p1.filesystem={":root"="read", ":workspace_roots"="write", ${JSON.stringify(protectedInWorkspace.replaceAll("\\", "/"))}="read", ${JSON.stringify(join(repo, ".git").replaceAll("\\", "/"))}="read", ${JSON.stringify(fakeCredential.replaceAll("\\", "/"))}="deny"}`;
const args = [
  "sandbox",
  "-P",
  "p1",
  "-c",
  permissions,
  "-c",
  "permissions.p1.network.enabled=false",
  "-C",
  cwd,
  "--",
  ...childArgs,
];
const result = spawnSync(executable, args, {
  cwd,
  encoding: "utf8",
  timeout: 30_000,
  windowsHide: true,
});
const evidence = {
  root,
  node: process.version,
  args,
  status: result.status,
  stdout: result.stdout,
  stderr: result.stderr,
  error: result.error?.message,
  source: existsSync(join(cwd, "source.txt"))
    ? readFileSync(join(cwd, "source.txt"), "utf8")
    : null,
  sentinel: readFileSync(sentinel, "utf8"),
  pinnedTest: readFileSync(pinnedTest, "utf8"),
  sharedGit: readFileSync(sharedGit, "utf8"),
  worktreeGitFile: readFileSync(join(cwd, ".git"), "utf8"),
};
writeFileSync(join(root, "result.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
process.exitCode =
  result.status === 0 &&
  evidence.sentinel === "original" &&
  evidence.pinnedTest === "pinned" &&
  evidence.sharedGit === "git-pinned" &&
  evidence.source?.trim() === "changed" &&
  (/"external":"E(?:ACCES|PERM)"/.test(result.stdout) ||
    result.stdout.includes("is denied")) &&
  (process.env.P1_SANDBOX_SHELL === "powershell" ||
    /"credentialRead":"E(?:ACCES|PERM)"/.test(result.stdout))
    ? 0
    : 1;
