import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { withFixture, run, resume, status, cli, runArgs, resumeArgs, statusArgs, fault, killFactory, waitFor, assertError, readStore, invocations, verifierInvocations, workspaces, ownedProcesses, git } from '../harness/support.mjs';
import { assertDurable, assertArtifacts, assertSnapshot } from '../harness/replay.mjs';

for (const point of ['transaction.after_event_insert', 'transaction.after_projection_write']) {
  test(`P2-003 ${point} rolls back attempt reservation and budget together`, async () => withFixture(async f => {
    const held = await fault(f, point, 'AttemptReserved');
    const before = readStore(f), p = assertSnapshot(before);
    assert.equal(p.state.status, 'READY'); assert.equal(p.attempts.length, 0);
    assert.deepEqual(status(f).result.projection, p);
    await killFactory(held); assert.deepEqual(readStore(f), before);
    const final = assertDurable(resume(f), f, 'VERIFIED');
    assert.equal(final.runId, p.runId); assert.equal(final.attempts.length, 1); assert.equal(invocations(f).length, 1);
    assert.deepEqual(readStore(f).events.slice(0, before.events.length), before.events);
  }));
}

for (const [eventType, expectedStatus, expectedAttempts] of [
  ['RunCreated', 'PENDING', 0], ['WorkspaceReady', 'READY', 0], ['AttemptReserved', 'RUNNING', 1],
  ['WorkerCompleted', 'VERIFYING', 1], ['VerificationCompleted', 'VERIFIED', 1],
]) {
  test(`P2-003 committed ${eventType} survives fresh-process recovery`, async () => withFixture(async f => {
    const held = await fault(f, 'transaction.after_commit', eventType);
    const before = readStore(f), p = assertSnapshot(before);
    assert.equal(before.events.at(-1).fact.type, eventType); assert.equal(p.state.status, expectedStatus); assert.equal(p.attempts.length, expectedAttempts);
    await killFactory(held); assert.deepEqual(readStore(f), before);
    const final = assertDurable(resume(f), f, 'VERIFIED'); assertArtifacts(final);
    assert.equal(final.runId, p.runId); assert.equal(final.maxStarts, p.maxStarts);
    assert.equal(final.attempts.length, eventType === 'AttemptReserved' ? 2 : 1);
    assert.equal(invocations(f).length, 1); assert.equal(workspaces(f).length, 1);
    assert.deepEqual(readStore(f).events.slice(0, before.events.length), before.events);
  }));
}

test('P2-004 workspace creation/result gap reuses the exact registered worktree', async () => withFixture(async f => {
  const held = await fault(f, 'workspace.after_create');
  const before = readStore(f), p = assertSnapshot(before);
  assert.equal(p.workspace.kind, 'intent'); assert.equal(p.attempts.length, 0);
  const path = p.workspace.workspace.path; assert.ok(existsSync(join(path, '.git'))); assert.equal(workspaces(f).length, 1);
  await killFactory(held);
  const final = assertDurable(resume(f), f, 'VERIFIED');
  assert.equal(final.workspace.workspace.path, path); assert.equal(final.workspace.operationId, p.workspace.operationId);
  assert.equal(workspaces(f).length, 1); assert.equal(invocations(f).length, 1);
}));

test('P2-004 a moved base branch cannot change the commit pinned by RunCreated', async () => withFixture(async f => {
  const held = await fault(f, 'transaction.after_commit', 'RunCreated');
  const p = assertSnapshot(readStore(f)); assert.equal(p.baseCommit, f.base); assert.equal(p.workspace.kind, 'unplanned');
  await killFactory(held);
  writeFileSync(join(f.repo, 'README.md'), 'later branch revision\n');
  git(f.repo, 'add', 'README.md'); git(f.repo, 'commit', '-m', 'advance mutable base reference');
  assert.notEqual(git(f.repo, 'rev-parse', 'main'), f.base);
  const final = assertDurable(resume(f), f, 'VERIFIED'); assertArtifacts(final);
  assert.equal(final.baseCommit, f.base); assert.equal(git(final.workspace.workspace.path, 'rev-parse', 'HEAD'), f.base);
  assert.equal(readFileSync(join(final.workspace.workspace.path, 'README.md'), 'utf8'), 'fixture\n');
}));

test('P2-004 an unrelated occupied intent path cannot be adopted or deleted', async () => withFixture(async f => {
  const held = await fault(f, 'transaction.after_commit', 'WorkspacePlanned');
  const p = assertSnapshot(readStore(f)), path = p.workspace.workspace.path;
  await killFactory(held);
  mkdirSync(path, { recursive: true }); writeFileSync(join(path, 'unrelated.txt'), 'belongs to another operation');
  assertError(resume(f), 'ownership_uncertain');
  assert.equal(readFileSync(join(path, 'unrelated.txt'), 'utf8'), 'belongs to another operation');
  assert.equal(workspaces(f).length, 0); assert.equal(assertSnapshot(readStore(f)).attempts.length, 0);
}));

test('P2-005 dispatch gap stops old descendants before a replacement worker starts', async () => withFixture({ worker: 'recover' }, async f => {
  const held = await fault(f, 'worker.after_dispatch');
  await waitFor(() => invocations(f).length === 1, 'First worker must execute before its factory is killed');
  const before = readStore(f), p = assertSnapshot(before), workspace = p.workspace.workspace.path;
  const heartbeat = join(workspace, 'src/heartbeat.txt');
  await waitFor(() => existsSync(heartbeat) && ownedProcesses(f).length >= 2, 'Worker descendant must be alive at the dispatch gap');
  assert.equal(p.attempts.length, 1); assert.equal(p.attempts[0].kind, 'reserved');
  await killFactory(held);
  const final = assertDurable(resume(f), f, 'VERIFIED'); assertArtifacts(final);
  assert.equal(final.attempts.length, 2); assert.equal(final.attempts[0].kind, 'interrupted');
  assert.ok(final.attempts[0].artifacts.length > 0, 'Observed interrupted worker must retain command evidence');
  assert.equal(invocations(f).length, 2); assert.deepEqual(ownedProcesses(f), []);
  const stopped = readFileSync(heartbeat, 'utf8'); await delay(500); assert.equal(readFileSync(heartbeat, 'utf8'), stopped);
  assert.deepEqual(readStore(f).events.slice(0, before.events.length), before.events);
}));

for (const configured of [undefined, 2]) {
  test(`P2-005 repeated crashes exhaust ${configured === undefined ? 'default five reservations' : 'configured two real dispatches'} without reset`, async () => withFixture({ worker: configured === 2 ? 'always-hang' : 'good' }, async f => {
    const limit = configured ?? 5;
    let prior;
    for (let ordinal = 1; ordinal <= limit; ordinal += 1) {
      const realDispatch = configured === 2;
      const held = await fault(f, realDispatch ? 'worker.after_dispatch' : 'transaction.after_commit', realDispatch ? undefined : 'AttemptReserved', { args: ordinal === 1 ? runArgs(f, configured) : resumeArgs(f) });
      if (realDispatch) await waitFor(() => invocations(f).length === ordinal && ownedProcesses(f).length >= 2, 'Each counted dispatch must start its worker and descendant');
      const snapshot = readStore(f), p = assertSnapshot(snapshot);
      assert.equal(p.maxStarts, limit); assert.equal(p.attempts.length, ordinal); assert.equal(p.attempts.at(-1).ordinal, ordinal);
      if (prior) { assert.equal(p.runId, prior.projection.runId); assert.deepEqual(snapshot.events.slice(0, prior.events.length), prior.events); }
      await killFactory(held); prior = snapshot;
    }
    const final = assertDurable(resume(f), f, 'FAILED');
    assert.equal(final.attempts.length, limit); assert.ok(final.attempts.every(attempt => attempt.kind === 'interrupted'));
    assert.equal(readStore(f).events.at(-1).fact.reason, 'worker_start_budget_exhausted');
    assert.equal(invocations(f).length, configured === 2 ? 2 : 0); assert.deepEqual(ownedProcesses(f), []);
    const exhausted = readStore(f); assertDurable(resume(f), f, 'FAILED'); assert.deepEqual(readStore(f), exhausted);
  }));
}

test('P2-006 trusted worker completion artifact reconciles without a second worker', async () => withFixture(async f => {
  const held = await fault(f, 'worker.after_completion_artifact');
  const p = assertSnapshot(readStore(f)); assert.equal(p.attempts.length, 1);
  assert.ok(['running', 'reserved'].includes(p.attempts[0].kind)); assert.ok(existsSync(p.attempts[0].completionPath));
  assert.equal(invocations(f).length, 1); await killFactory(held);
  const final = assertDurable(resume(f), f, 'VERIFIED'); assertArtifacts(final);
  assert.equal(final.attempts.length, 1); assert.equal(invocations(f).length, 1);
}));

test('P2-006 incomplete verification reruns with no new worker start', async () => withFixture(async f => {
  const held = await fault(f, 'verification.after_command');
  const p = assertSnapshot(readStore(f)); assert.equal(p.state.status, 'VERIFYING'); assert.equal(p.verification.kind, 'intent');
  assert.equal(p.attempts.length, 1); assert.equal(p.attempts[0].kind, 'completed'); assert.equal(verifierInvocations(f).length, 1);
  await killFactory(held);
  const final = assertDurable(resume(f), f, 'VERIFIED'); assertArtifacts(final);
  assert.equal(final.attempts.length, 1); assert.equal(invocations(f).length, 1);
  assert.ok(verifierInvocations(f).length >= 2, 'Incomplete verification must run again and retain prior output');
}));

test('P2-006 complete evidence/result gap reconciles without repeating verification', async () => withFixture(async f => {
  const held = await fault(f, 'verification.after_evidence_artifact');
  const p = assertSnapshot(readStore(f)); assert.equal(p.verification.kind, 'intent');
  const bytes = readFileSync(p.verification.evidencePath);
  assert.equal(verifierInvocations(f).length, 1); await killFactory(held);
  const final = assertDurable(resume(f), f, 'VERIFIED'); assertArtifacts(final);
  assert.equal(final.attempts.length, 1); assert.equal(invocations(f).length, 1); assert.equal(verifierInvocations(f).length, 1);
  assert.deepEqual(readFileSync(final.verification.evidence.path), bytes);
}));

test('P2-007 one owner includes junction aliases while status reads a consistent snapshot', async () => withFixture(async f => {
  const held = await fault(f, 'transaction.after_commit', 'AttemptReserved');
  const before = readStore(f), p = assertSnapshot(before);
  assertDurable(status(f), f, 'RUNNING', 'durable_status');
  assertError(run(f), 'store_busy'); assertError(resume(f), 'store_busy');
  const alias = join(f.root, 'store-alias'); symlinkSync(f.store, alias, 'junction');
  const aliasFixture = { ...f, store: alias };
  assertError(cli(resumeArgs(aliasFixture)), 'store_busy');
  const viaAlias = cli(statusArgs(aliasFixture)); assert.equal(viaAlias.result.kind, 'durable_status'); assert.deepEqual(viaAlias.result.projection, p);
  assert.deepEqual(readStore(f), before); assert.equal(invocations(f).length, 0);
  await killFactory(held);
  const final = assertDurable(resume(f), f, 'VERIFIED'); assert.equal(final.attempts.length, 2); assert.equal(invocations(f).length, 1);
}));
