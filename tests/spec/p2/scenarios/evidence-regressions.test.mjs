import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { withFixture, start, runArgs, resumeArgs, run, resume, writeConfig, killFactory, fault, waitFor, decode, readStore, ownedProcesses, invocations, git, hash, schema, validateEvidence, assertError } from '../harness/support.mjs';
import { assertDurable, assertArtifacts, assertSnapshot } from '../harness/replay.mjs';
import { holdVerifierSupervisor } from '../harness/verifier-hold.mjs';

function resumeAt(f, point) {
  const marker = join(f.root, 'resume-boundary.json');
  const handle = start(f, resumeArgs(f), { SWF_TEST_FAULT: JSON.stringify({ point, marker }) });
  return { marker, handle };
}
async function boundaryOrExit(resuming, timeout = 25000) {
  await waitFor(() => existsSync(resuming.marker) || resuming.handle.closed, 'Resume did not reach its boundary or return a bounded result', timeout);
  return existsSync(resuming.marker);
}

test('P2-010 active verifier death permits redispatch only after old owned instances exit', async () => withFixture({ verifier: 'active-tree' }, async f => {
  f.config.verification.required[0].timeoutSeconds = 60; writeConfig(f);
  const factory = start(f, runArgs(f)); let held, resuming;
  try {
    held = await holdVerifierSupervisor(f, factory);
    const before = assertSnapshot(readStore(f));
    assert.equal(before.state.status, 'VERIFYING'); assert.equal(before.verification.kind, 'intent');
    await held.terminateFactoryOnly();
    const afterDeath = await held.probe();
    console.log('P2 active-verifier process observation: ' + JSON.stringify(afterDeath));
    resuming = resumeAt(f, 'verification.after_dispatch');
    if (await boundaryOrExit(resuming)) {
      assert.equal(JSON.parse(readFileSync(resuming.marker, 'utf8')).point, 'verification.after_dispatch');
      const old = await held.probe();
      assert.ok(old.every(process => !process.alive), 'No verifier may dispatch while any prior retained supervisor/verifier/descendant instance remains alive');
    } else {
      assertError(decode(resuming.handle), 'ownership_uncertain');
      const old = await held.probe(), permitted = new Set(old.filter(process => process.alive).map(process => process.pid));
      assert.ok(ownedProcesses(f).every(pid => permitted.has(pid)), 'Uncertain cleanup cannot start a new verifier');
    }
    assert.equal(invocations(f).length, 1);
    assert.equal(assertSnapshot(readStore(f)).attempts.length, 1);
  } finally {
    if (resuming && !resuming.handle.closed) await killFactory(resuming.handle);
    if (held) await held.release();
  }
}));

function factoryDescendants(factoryPid) {
  assert.ok(Number.isSafeInteger(factoryPid) && factoryPid > 0);
  const script = `$all = @(Get-CimInstance Win32_Process -OperationTimeoutSec 5); $frontier = @($all | Where-Object { $_.ProcessId -eq ${factoryPid} }); $seen = @{}; $observed = @(); while ($frontier.Count -gt 0) { $next = @(); foreach ($parent in $frontier) { foreach ($entry in $all) { if ($entry.ParentProcessId -eq $parent.ProcessId -and $entry.CreationDate -ge $parent.CreationDate -and -not $seen.ContainsKey([int]$entry.ProcessId)) { $seen[[int]$entry.ProcessId] = $true; $next += $entry; $observed += [pscustomobject]@{ pid=[int]$entry.ProcessId; parentPid=[int]$entry.ParentProcessId; executable=$entry.ExecutablePath; commandLine=$entry.CommandLine; createdAt=$entry.CreationDate.ToUniversalTime().ToFileTimeUtc().ToString(); parentCreatedAt=$parent.CreationDate.ToUniversalTime().ToFileTimeUtc().ToString() } } } }; $frontier = $next }; ConvertTo-Json -InputObject @($observed) -Compress`;
  const observed = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.ifError(observed.error); assert.equal(observed.status, 0, observed.stderr);
  const processes = JSON.parse(observed.stdout); assert.ok(Array.isArray(processes));
  return processes;
}

test('P2-011 WorkerStarted append failure cannot publish completion with an owned process alive', async () => withFixture({ worker: 'always-hang' }, async f => {
  const created = await fault(f, 'transaction.after_commit', 'RunCreated');
  const before = assertSnapshot(readStore(f));
  assert.equal(before.workspace.kind, 'unplanned'); assert.equal(before.attempts.length, 0); assert.deepEqual(ownedProcesses(f), []);
  const nativeConsolePath = join(process.env.SystemRoot || process.env.SYSTEMROOT, 'System32', 'conhost.exe').toLowerCase();
  const consoleSignature = process => JSON.stringify([process.executable.toLowerCase(), process.commandLine.toLowerCase()]);
  const preWorkerConsoles = factoryDescendants(created.child.pid).filter(process => process.parentPid === created.child.pid
    && process.executable?.toLowerCase() === nativeConsolePath
    && process.commandLine?.toLowerCase() === `\\??\\${nativeConsolePath} 0x4`);
  const consoleSignatures = new Set(preWorkerConsoles.map(consoleSignature));
  console.log('P2 pre-worker console control: ' + JSON.stringify(preWorkerConsoles));
  await killFactory(created); assert.deepEqual(ownedProcesses(f), []);
  const db = new DatabaseSync(join(f.store, 'run.sqlite'));
  try {
    db.exec("CREATE TRIGGER p2_reject_worker_started BEFORE INSERT ON events WHEN json_extract(NEW.json,'$.fact.type')='WorkerStarted' BEGIN SELECT RAISE(ABORT,'P2 injected WorkerStarted append failure'); END");
  } finally { db.close(); }
  const resuming = resumeAt(f, 'worker.after_completion_artifact');
  try {
    if (await boundaryOrExit(resuming, 55000)) {
      assert.equal(JSON.parse(readFileSync(resuming.marker, 'utf8')).point, 'worker.after_completion_artifact');
      assert.deepEqual(ownedProcesses(f), [], 'A completion artifact cannot precede cleanup of live fixture-specific worker processes');
      // Exclude only the exact native console host path/argv already observed before this run had a workspace or attempt.
      const candidateProcesses = factoryDescendants(resuming.handle.child.pid).filter(process => !(process.parentPid === resuming.handle.child.pid
        && process.executable && process.commandLine && consoleSignatures.has(consoleSignature(process))));
      assert.deepEqual(candidateProcesses, [], 'A completion artifact cannot precede worker supervisor and descendant cleanup');
    } else {
      const observed = decode(resuming.handle);
      assert.ok(observed.result.kind === 'durable_error' || (observed.result.kind === 'durable_result' && observed.result.projection.state.status === 'FAILED'), 'Storage failure must remain a structured failure');
      assert.notEqual(observed.code, 0);
    }
    assert.deepEqual(ownedProcesses(f), [], 'Storage failure must stop the worker and detached descendants');
    const snapshot = readStore(f); assertSnapshot(snapshot);
    assert.equal(snapshot.events.some(event => event.fact.type === 'WorkerStarted'), false);
  } finally { if (!resuming.handle.closed) await killFactory(resuming.handle); }
}));

test('P2-012 unchanged Git checkout line-ending conversion is not a forbidden worker edit', () => withFixture(f => {
  const committed = 'protected first line\nprotected second line\n';
  writeFileSync(join(f.repo, '.gitattributes'), '*.txt text eol=crlf\n');
  writeFileSync(join(f.repo, 'protected.txt'), committed);
  git(f.repo, 'add', '.gitattributes', 'protected.txt'); git(f.repo, 'commit', '-m', 'pin checkout line-ending transform');
  f.base = git(f.repo, 'rev-parse', 'HEAD');
  assert.equal(git(f.repo, 'show', `${f.base}:protected.txt`), committed.trim());
  f.config.protectedPaths.push('protected.txt'); writeConfig(f);
  const observed = run(f);
  assert.equal(observed.result.kind, 'durable_result'); assert.equal(observed.result.projection.workspace.kind, 'ready');
  const checkout = observed.result.projection.workspace.workspace.path;
  assert.equal(readFileSync(join(checkout, 'protected.txt'), 'utf8'), committed.replaceAll('\n', '\r\n'), 'Fixture must exercise an actual LF-to-CRLF checkout transform');
  assert.equal(readFileSync(join(f.repo, 'protected.txt'), 'utf8'), committed, 'The source checkout must remain unchanged');
  const p = assertDurable(observed, f, 'VERIFIED'), evidence = assertArtifacts(p);
  assert.equal(evidence.changedPaths.includes('protected.txt'), false);
  assertDurable(resume(f), f, 'VERIFIED');
}));

function rebindPassedResults(template, target) {
  const replacements = [[template.attemptId, target.attemptId]];
  for (const original of template.commands) {
    const current = target.commands.find(command => command.specId === original.specId);
    assert.ok(current, 'Each template command must bind to the same required command');
    for (const stream of ['stdout', 'stderr']) {
      const from = original.process[stream], to = current.process[stream];
      replacements.push([from.path, to.path], [pathToFileURL(from.path).href, pathToFileURL(to.path).href], [from.digest, to.digest]);
    }
  }
  replacements.sort((a, b) => b[0].length - a[0].length);
  const bind = value => {
    if (typeof value === 'string') { for (const [from, to] of replacements) value = value.replaceAll(from, to); return value; }
    if (Array.isArray(value)) return value.map(bind);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, bind(entry)]));
    return value;
  };
  return bind(template.verdict.results);
}

test('P2-013 failed required diff capture cannot be promoted by rewriting only a pending verdict', async () => withFixture(async f => {
  let template;
  await withFixture(control => { template = structuredClone(assertArtifacts(assertDurable(run(control), control, 'VERIFIED'))); });
  // A second, complete-diff run proves that template rebinding preserves the public successful result format.
  await withFixture(async control => {
    const ready = await fault(control, 'verification.after_evidence_artifact');
    const p = assertSnapshot(readStore(control)), path = p.verification.evidencePath;
    const pending = JSON.parse(readFileSync(path, 'utf8')); schema(validateEvidence, pending); assert.equal(pending.verdict.status, 'VERIFIED');
    await killFactory(ready);
    const rebound = rebindPassedResults(template, pending);
    assert.deepEqual(rebound, pending.verdict.results, 'The control must reject any invented summary, evidence ID, URI, or digest convention');
    writeFileSync(path, JSON.stringify({ ...pending, verdict: { ...pending.verdict, results: rebound } }));
    assertArtifacts(assertDurable(resume(control), control, 'VERIFIED'));
  });
  const marker = 'P2_REQUIRED_OLD_DIFF_END_06e2c1';
  const oldComment = `/* P2_REQUIRED_OLD_DIFF_BEGIN ${'x'.repeat(17 * 1024 * 1024)} ${marker} */`;
  writeFileSync(join(f.repo, 'src/answer.cjs'), `module.exports = 0;\n${oldComment}\n`);
  git(f.repo, 'add', 'src/answer.cjs'); git(f.repo, 'commit', '-m', 'large durable diff evidence fixture'); f.base = git(f.repo, 'rev-parse', 'HEAD');
  const held = await fault(f, 'verification.after_evidence_artifact');
  const before = readStore(f), p = assertSnapshot(before); assert.equal(p.verification.kind, 'intent');
  const manifestPath = p.verification.evidencePath, pending = JSON.parse(readFileSync(manifestPath, 'utf8'));
  schema(validateEvidence, pending); assert.equal(pending.commands.length, f.config.verification.required.length);
  assert.deepEqual(pending.commands.map(command => command.specId).sort(), f.config.verification.required.map(spec => spec.id).sort());
  for (const command of pending.commands) {
    assert.deepEqual(command.process.termination, { kind: 'exited', exitCode: 0 });
    assert.match(readFileSync(command.process.stdout.path, 'utf8'), /verified:42/);
  }
  const diff = readFileSync(pending.diff.path, 'utf8');
  const completeDiff = diff.includes(`-${oldComment}`) && diff.includes(marker) && diff.includes('-module.exports = 0;') && diff.includes('+module.exports = 42;') && !/capture[_ -]?error|maxBuffer|ENOBUFS|stdout maxBuffer length exceeded/i.test(diff);
  await killFactory(held);
  if (pending.verdict.status === 'VERIFIED') {
    assert.ok(completeDiff, 'Successful verification requires the complete large diff');
    assertArtifacts(assertDurable(resume(f), f, 'VERIFIED'));
    return;
  }
  assert.equal(pending.verdict.status, 'FAILED'); assert.equal(completeDiff, false, 'This branch must exercise failed required diff capture');
  assert.ok(pending.verdict.reason.length > 0);
  const refs = [pending.diff, pending.worker.process.stdout, pending.worker.process.stderr, ...pending.commands.flatMap(command => [command.process.stdout, command.process.stderr])];
  const originalDigests = refs.map(ref => { const digest = hash(readFileSync(ref.path)); assert.equal(digest, ref.digest); return digest; });
  const passedResults = rebindPassedResults(template, pending);
  const replacement = { ...pending, verdict: { status: 'VERIFIED', unit: pending.verdict.unit, results: passedResults } };
  schema(validateEvidence, replacement);
  assert.deepEqual({ ...replacement, verdict: pending.verdict }, pending, 'Only the verdict may change');
  writeFileSync(manifestPath, JSON.stringify(replacement));
  assert.deepEqual(refs.map(ref => hash(readFileSync(ref.path))), originalDigests, 'All artifact bytes and their recorded digests remain unchanged');
  assertError(resume(f), 'artifact_invalid');
  const after = readStore(f); assertSnapshot(after);
  assert.deepEqual(after.events.slice(0, before.events.length), before.events);
  assert.equal(after.events.some(event => event.fact.type === 'VerificationCompleted'), false);
  assert.notEqual(after.projection.state.status, 'VERIFIED');
  assert.equal(invocations(f).length, 1);
}));
