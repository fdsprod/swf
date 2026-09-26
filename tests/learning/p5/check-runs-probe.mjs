// Retained dependency research. Only GET requests to public cli/cli are used.
// No product imports, remote writes, credentials, issue bodies, or check output.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'swf-p5-check-runs-'));
const reportPath = resolve(process.argv[2] || join(root, 'observations.json'));
const observations = { observedAt: new Date().toISOString(), node: process.version, repository: 'cli/cli', pullNumber: 14517 };
const calls = [];
function gh(args) {
  const child = spawnSync('gh', args, {
    shell: false, windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_PAGER: 'cat', GH_DEBUG: '', DEBUG: '' },
  });
  calls.push({ args, exitCode: child.status, signal: child.signal, launchError: child.error?.code || null });
  // Do not retain stderr: inherited authentication or transport failures must
  // not make this research report a credential/debug-log capture.
  assert.equal(child.error, undefined, `gh launch failed: ${child.error?.code}`);
  assert.equal(child.status, 0, `gh exited ${child.status}; endpoint ${args.find(x => x.startsWith('repos/')) || 'version'}`);
  return child.stdout;
}
function api(endpoint, flags = []) {
  assert.ok(endpoint.startsWith('repos/cli/cli/'));
  return JSON.parse(gh(['api', '--hostname', 'github.com', '--method', 'GET', endpoint, ...flags]));
}
function summarize(run, expectedSha) {
  assert.ok(Number.isSafeInteger(run.id) && run.id > 0);
  assert.equal(run.head_sha, expectedSha);
  assert.ok(Number.isSafeInteger(run.app?.id) && run.app.id > 0);
  assert.ok(typeof run.name === 'string' && run.name.length > 0);
  assert.ok(typeof run.status === 'string');
  for (const key of ['started_at', 'completed_at']) assert.ok(run[key] === null || Number.isFinite(Date.parse(run[key])));
  return { id: run.id, name: run.name, headSha: run.head_sha,
    app: { id: run.app.id, slug: run.app.slug }, checkSuiteId: run.check_suite?.id ?? null,
    status: run.status, conclusion: run.conclusion, startedAt: run.started_at, completedAt: run.completed_at,
    hasCreatedAtField: Object.hasOwn(run, 'created_at'), hasRunAttemptField: Object.hasOwn(run, 'run_attempt') };
}
try {
  observations.ghVersion = gh(['--version']).split(/\r?\n/)[0];
  const pr = api('repos/cli/cli/pulls/14517');
  assert.equal(pr.number, 14517);
  assert.match(pr.head.sha, /^[a-f0-9]{40}$/);
  observations.pull = { number: pr.number, state: pr.state, headSha: pr.head.sha,
    headRepository: pr.head.repo?.full_name ?? null, baseRepository: pr.base.repo.full_name };
  const endpoint = `repos/cli/cli/commits/${pr.head.sha}/check-runs`;
  // Inspect one bounded fixture before forcing smaller pages. Do not search
  // more commits or PRs if this public fixture has no repeat history.
  const first = api(`${endpoint}?filter=all&per_page=100`);
  assert.ok(Number.isInteger(first.total_count) && first.total_count > 0 && first.total_count <= 100,
    'Fixture outside bounded 1..100 check-run scope; choose a new fixture in a separate research task.');
  assert.ok(Array.isArray(first.check_runs));
  const pages = api(`${endpoint}?filter=all&per_page=5`, ['--paginate', '--slurp']);
  assert.ok(Array.isArray(pages) && pages.length > 0);
  for (const page of pages) {
    assert.ok(!Array.isArray(page) && Array.isArray(page.check_runs));
    assert.equal(page.total_count, first.total_count);
  }
  const all = pages.flatMap(page => page.check_runs).map(run => summarize(run, pr.head.sha));
  assert.equal(all.length, first.total_count);
  assert.equal(new Set(all.map(run => run.id)).size, all.length);
  assert.deepEqual(all.map(run => run.id).sort((a, b) => a - b), first.check_runs.map(run => run.id).sort((a, b) => a - b));
  if (first.total_count > 5) assert.ok(pages.length > 1);
  observations.pagination = { filter: 'all', perPage: 5, pageCount: pages.length,
    pageSizes: pages.map(page => page.check_runs.length), reportedTotals: pages.map(page => page.total_count),
    shape: 'outer array of objects, each containing check_runs array', allIdsUnique: true };
  observations.checkRuns = all;
  const grouped = new Map();
  for (const run of all) {
    const key = JSON.stringify([run.app.id, run.name]);
    grouped.set(key, [...(grouped.get(key) || []), run]);
  }
  observations.repeatedProviderNames = [...grouped.values()].filter(group => group.length > 1).map(group => ({
    appId: group[0].app.id, name: group[0].name,
    records: group.map(({ id, checkSuiteId, startedAt, completedAt, status, conclusion }) => ({ id, checkSuiteId, startedAt, completedAt, status, conclusion })),
  }));
  const latestPages = api(`${endpoint}?filter=latest&per_page=100`, ['--paginate', '--slurp']);
  const latest = latestPages.flatMap(page => page.check_runs).map(run => summarize(run, pr.head.sha));
  observations.latestComparison = { allCount: all.length, latestCount: latest.length,
    latestIds: latest.map(run => run.id), allOnlyIds: all.filter(run => !latest.some(x => x.id === run.id)).map(run => run.id) };
  observations.selectionLimit = observations.repeatedProviderNames.length
    ? 'Repeated provider/name records are observations, not a guarantee that ID or timestamp order defines the factory selection policy.'
    : 'No repeated provider/name groups in this one commit. Retry ordering and latest-attempt selection were not observed.';
  observations.result = 'observed';
} catch (error) {
  observations.result = 'probe_failed'; observations.failure = error.message; process.exitCode = 1;
} finally {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({ observations, calls }, null, 2) + '\n');
  console.log(JSON.stringify({ reportPath, result: observations.result, version: observations.ghVersion,
    checkRuns: observations.checkRuns?.length, pages: observations.pagination?.pageCount,
    repeatedProviderNameGroups: observations.repeatedProviderNames?.length, failure: observations.failure }, null, 2));
}
