import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { hash, git, updateGateway } from "./support.mjs";
import { artifact, commitSha } from "./replay.mjs";

export function gitResult(f, args, input) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
  );
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "NUL",
    GIT_ATTR_NOSYSTEM: "1",
  });
  const child = spawnSync(
    f.gitExe,
    ["-c", "core.autocrlf=false", "-c", "core.attributesFile=NUL", ...args],
    {
      cwd: f.root,
      env,
      input,
      encoding: null,
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  assert.ifError(child.error);
  return child;
}
export function observedGit(f, args, input) {
  const child = gitResult(f, args, input);
  assert.equal(child.status, 0, child.stderr?.toString());
  return child.stdout;
}
export function treeRecords(bytes) {
  return bytes
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((raw) => {
      const tab = raw.indexOf("\t");
      const [mode, type, oid] = raw.slice(0, tab).split(" ");
      return { path: raw.slice(tab + 1), mode, type, oid };
    });
}
export function assertGitModes(snapshot, base) {
  for (const file of snapshot.files) {
    const prior = base.find((b) => b.path === file.path);
    if (prior) {
      assert.equal(prior.type, "blob");
      assert.ok(["100644", "100755"].includes(prior.mode));
    }
    assert.equal(
      file.mode,
      prior?.mode ?? "100644",
      "Pinned base/new-file Git mode: " + file.path,
    );
  }
}
export function assertDeliveredTree(p, f) {
  assert.equal(p.delivery.kind, "created");
  const { plan, commit, push, pullRequest } = p.delivery;
  assert.equal(commit.sha, commitSha(plan.commit));
  assert.equal(push.sha, commit.sha);
  assert.equal(pullRequest.head.sha, commit.sha);
  const args = ["--git-dir", f.remote];
  const records = treeRecords(
    observedGit(f, [...args, "ls-tree", "-rz", "--full-tree", commit.sha]),
  );
  const evidence = JSON.parse(artifact(plan.evidence));
  const snapshot = JSON.parse(artifact(plan.snapshot));
  assert.equal(snapshot.schemaVersion, 1);
  assert.deepEqual(
    records.map((f) => f.path).sort(),
    evidence.candidate.files.map((f) => f.path).sort(),
  );
  assertGitModes(
    snapshot,
    treeRecords(
      observedGit(f, [...args, "ls-tree", "-rz", "--full-tree", p.baseCommit]),
    ),
  );
  assert.deepEqual(
    records
      .map(({ path, mode }) => ({ path, mode }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    snapshot.files
      .map(({ path, mode }) => ({ path, mode }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  );
  for (const file of records) {
    assert.equal(file.type, "blob");
    assert.ok(["100644", "100755"].includes(file.mode));
    const expected = snapshot.files.find((f) => f.path === file.path);
    assert.ok(expected);
    const bytes = observedGit(f, [
      ...args,
      "--attr-source=" + commit.sha,
      "cat-file",
      "--filters",
      commit.sha + ":" + file.path,
    ]);
    assert.equal(
      hash(bytes),
      expected.digest,
      "Delivered checkout bytes: " + file.path,
    );
    assert.deepEqual(bytes, artifact(expected.content));
  }
  const raw = observedGit(f, [
    ...args,
    "cat-file",
    "commit",
    commit.sha,
  ]).toString("utf8");
  assert.equal(
    raw.split("\n").filter((line) => line.startsWith("parent ")).length,
    1,
  );
  assert.ok(raw.includes("\nparent " + p.baseCommit + "\n"));
  assert.equal(
    observedGit(f, [
      ...args,
      "rev-list",
      "--count",
      p.baseCommit + ".." + commit.sha,
    ])
      .toString()
      .trim(),
    "1",
  );
  assert.notEqual(
    observedGit(f, [
      ...args,
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      commit.sha,
    ])
      .toString()
      .trim(),
    "",
  );
}
export function commitFixture(f, message) {
  git(f.repo, "add", "-A");
  git(f.repo, "commit", "-m", message);
  f.base = git(f.repo, "rev-parse", "HEAD");
  git(f.repo, "push", "origin", "HEAD:refs/heads/main");
  updateGateway(f, (d) => {
    d.base.commit.sha = f.base;
  });
}
