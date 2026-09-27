// Retained external-dependency research. This is not a product acceptance test.
// All API calls below use GET against public cli/cli data or the authenticated login.
// No credentials, full issue bodies, or full comments are printed or retained.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const observations = {
  observedAt: new Date().toISOString(),
  node: process.version,
};
function gh(args, expected = 0) {
  // An argv array avoids PowerShell/cmd quote removal and shell expansion.
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_PAGER: "cat" },
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, expected, result.stderr);
  return result;
}
function api(endpoint, args = []) {
  return JSON.parse(gh(["api", endpoint, "--method", "GET", ...args]).stdout);
}

observations.ghVersion = gh(["--version"]).stdout.split(/\r?\n/)[0];
observations.login = api("user", ["--jq", "{login}"]).login;

// Observation: issue endpoints also return PRs, identified by pull_request.
const issue = api("repos/cli/cli/issues/14517", [
  "--jq",
  '{id,number,state,title,comments,user:{id:.user.id,login:.user.login},isPullRequest:has("pull_request"),bodyType:(.body|type)}',
]);
assert.equal(issue.number, 14517);
assert.equal(issue.isPullRequest, true);
observations.issue = issue;

// Select a small existing conversation to prove that pagination crosses pages.
const issues = api("repos/cli/cli/issues?state=closed&per_page=100", [
  "--jq",
  '[.[]|select(.comments>=2 and .comments<=5)|{number,comments,isPullRequest:has("pull_request")}]',
]);
assert.ok(
  issues.length > 0,
  "No small public conversation available; choose another read-only fixture.",
);
const conversation = issues[0];
const pages = api(
  `repos/cli/cli/issues/${conversation.number}/comments?per_page=1`,
  ["--paginate", "--slurp"],
);
assert.ok(pages.length >= 2);
assert.ok(pages.every(Array.isArray));
const comments = pages.flat();
assert.equal(new Set(comments.map((x) => x.id)).size, comments.length);
observations.comments = {
  issueNumber: conversation.number,
  pageCount: pages.length,
  records: comments.map((x) => ({
    id: x.id,
    author: { id: x.user.id, login: x.user.login },
    createdAt: x.created_at,
    updatedAt: x.updated_at,
    bodyType: typeof x.body,
  })),
};

// Observation: installed gh rejects --slurp plus --jq before an HTTP request.
const incompatible = gh(
  [
    "api",
    "repos/cli/cli/issues/14517/comments",
    "--method",
    "GET",
    "--paginate",
    "--slurp",
    "--jq",
    ".",
  ],
  1,
);
assert.match(incompatible.stderr, /--slurp.*not supported.*--jq/);
observations.slurpWithJq = {
  exitCode: incompatible.status,
  firstErrorLine: incompatible.stderr.split(/\r?\n/)[0],
};

const pr = api("repos/cli/cli/pulls/14517", [
  "--jq",
  "{number,state,head:{sha:.head.sha,ref:.head.ref,repo:.head.repo.full_name},base:{sha:.base.sha,ref:.base.ref}}",
]);
observations.pr = pr;
const matches = api(
  `repos/cli/cli/pulls?state=all&head=${encodeURIComponent(`cli:${pr.head.ref}`)}&base=${encodeURIComponent(pr.base.ref)}&per_page=100`,
  ["--paginate", "--slurp"],
);
assert.ok(matches.flat().some((x) => x.number === pr.number));
observations.prReconciliationQuery = matches
  .flat()
  .map((x) => ({ number: x.number, state: x.state, headSha: x.head.sha }));

// The REST check-run records bind conclusions to head_sha and provider app.id.
const runs = api(
  `repos/cli/cli/commits/${pr.head.sha}/check-runs?per_page=100`,
  ["--paginate", "--slurp"],
);
observations.checkRuns = runs
  .flatMap((page) => page.check_runs)
  .map((x) => ({
    id: x.id,
    name: x.name,
    headSha: x.head_sha,
    status: x.status,
    conclusion: x.conclusion,
    appId: x.app.id,
    appSlug: x.app.slug,
  }));
assert.ok(observations.checkRuns.length > 0);
assert.ok(observations.checkRuns.every((x) => x.headSha === pr.head.sha));
observations.combinedStatus = api(
  `repos/cli/cli/commits/${pr.head.sha}/status`,
  ["--jq", "{sha,state,total_count,statuses:[.statuses[]|{id,context,state}]}"],
);
// Do not assert an aggregate green: check-runs and legacy statuses are distinct.

const checks = gh([
  "pr",
  "checks",
  String(pr.number),
  "--repo",
  "cli/cli",
  "--json",
  "name,state,bucket,workflow,link",
]);
observations.prChecks = {
  exitCode: checks.status,
  records: JSON.parse(checks.stdout),
};
assert.ok(
  observations.prChecks.records.every((x) => !Object.hasOwn(x, "headSha")),
);
observations.requiredPrChecks = JSON.parse(
  gh([
    "pr",
    "checks",
    String(pr.number),
    "--repo",
    "cli/cli",
    "--required",
    "--json",
    "name,state,bucket",
  ]).stdout,
);

// A syntactically valid JSON body does not make a failed API invocation successful.
const missing = gh(
  ["api", "repos/cli/cli/issues/999999999", "--method", "GET"],
  1,
);
const missingBody = JSON.parse(missing.stdout);
assert.equal(missingBody.status, "404");
assert.match(missing.stderr, /HTTP 404/);
observations.notFound = {
  exitCode: missing.status,
  body: missingBody,
  stderr: missing.stderr.trim(),
};

const output = JSON.stringify(observations, null, 2) + "\n";
if (process.argv.includes("--record")) {
  writeFileSync(new URL("./observed.json", import.meta.url), output);
  console.log(
    "Recorded read-only GitHub observations in tests/learning/github/observed.json",
  );
} else {
  process.stdout.write(output);
}
