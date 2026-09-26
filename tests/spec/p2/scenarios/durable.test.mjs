import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { withFixture, run, resume, status, cli, runArgs, resumeArgs, statusArgs, writeConfig, assertError, readStore, invocations, verifierInvocations, workspaces, hash } from '../harness/support.mjs';
import { assertDurable, assertArtifacts, assertSnapshot } from '../harness/replay.mjs';

test('P2-001 fresh run, status, repeat run and resume retain one verified execution', () => withFixture(f => {
  const first = run(f), p = assertDurable(first, f, 'VERIFIED');
  assert.equal(p.maxStarts, 5); assert.equal(p.attempts.length, 1); assert.equal(p.attempts[0].kind, 'completed');
  assert.equal(p.workspace.kind, 'ready'); assert.equal(p.verification.kind, 'completed');
  assert.equal(invocations(f).length, 1); assert.equal(verifierInvocations(f).length, 1); assert.equal(workspaces(f).length, 1);
  assertArtifacts(p);
  const snapshot = readStore(f), manifest = readFileSync(p.verification.evidence.path);
  assertDurable(status(f), f, 'VERIFIED', 'durable_status');
  writeFileSync(f.configPath, JSON.stringify(Object.fromEntries(Object.entries(f.config).reverse()), null, 2));
  for (const observed of [resume(f), run(f)]) {
    assertDurable(observed, f, 'VERIFIED'); assert.deepEqual(observed.result.events, snapshot.events);
    assert.deepEqual(observed.result.projection, p);
  }
  assert.deepEqual(readFileSync(p.verification.evidence.path), manifest);
  assert.deepEqual(readStore(f), snapshot); assert.equal(invocations(f).length, 1); assert.equal(verifierInvocations(f).length, 1);
}));

test('P2-002 database rejects event updates/deletes and detects a mismatched projection', () => withFixture(f => {
  const p = assertDurable(run(f), f, 'VERIFIED');
  const db = new DatabaseSync(join(f.store, 'run.sqlite'));
  try {
    assert.throws(() => db.exec("UPDATE events SET json='{}' WHERE sequence=1"));
    assert.throws(() => db.exec('DELETE FROM events WHERE sequence=1'));
    const wrong = structuredClone(p); wrong.maxStarts += 1;
    db.prepare('UPDATE projection SET json=? WHERE id=1').run(JSON.stringify(wrong));
  } finally { db.close(); }
  assertError(status(f), 'corrupt_store'); assertError(resume(f), 'corrupt_store');
  assert.equal(invocations(f).length, 1);
}));

test('P2-002 INSERT OR REPLACE cannot replace an existing event sequence', () => withFixture(f => {
  assertDurable(run(f), f, 'VERIFIED');
  const before = readStore(f);
  const db = new DatabaseSync(join(f.store, 'run.sqlite'));
  try {
    const rows = () => db.prepare('SELECT sequence, run_id, json FROM events ORDER BY sequence').all();
    const originalRows = rows(), first = originalRows[0];
    const replacement = JSON.parse(first.json);
    assert.equal(replacement.fact.type, 'RunCreated');
    replacement.fact.maxStarts += 1;
    // Use an ordinary new SQLite connection. No trigger or schema changes are permitted.
    assert.throws(() => db.prepare('INSERT OR REPLACE INTO events(sequence,run_id,json) VALUES(?,?,?)')
      .run(first.sequence, first.run_id, JSON.stringify(replacement)), 'Append-only history must reject replacement inserts');
    assert.deepEqual(rows(), originalRows, 'Every stored event row must remain byte-for-byte unchanged');
  } finally { db.close(); }
  assert.deepEqual(readStore(f), before);
  assertDurable(status(f), f, 'VERIFIED', 'durable_status');
  assert.equal(invocations(f).length, 1);
}));

test('P2-002 malformed projection is a recovery diagnostic, not a reset', () => withFixture(f => {
  assertDurable(run(f), f, 'VERIFIED');
  const before = readStore(f);
  const db = new DatabaseSync(join(f.store, 'run.sqlite'));
  try { db.prepare('UPDATE projection SET json=? WHERE id=1').run('{malformed'); } finally { db.close(); }
  assertError(resume(f), 'corrupt_store'); assert.equal(invocations(f).length, 1);
  const read = new DatabaseSync(join(f.store, 'run.sqlite'), { readOnly: true });
  try { assert.equal(read.prepare('SELECT COUNT(*) AS count FROM events').get().count, before.events.length); } finally { read.close(); }
}));

for (const mutation of ['missing-output', 'changed-output', 'missing-manifest', 'changed-manifest', 'changed-worker-record', 'changed-candidate', 'changed-program']) {
  test(`P2-008 ${mutation} cannot manufacture resumed success`, () => withFixture(f => {
    const p = assertDurable(run(f), f, 'VERIFIED'), evidence = assertArtifacts(p);
    if (mutation === 'missing-output') rmSync(evidence.commands[0].process.stderr.path);
    if (mutation === 'changed-output') writeFileSync(evidence.commands[0].process.stdout.path, 'forged pass');
    if (mutation === 'missing-manifest') rmSync(p.verification.evidence.path);
    if (mutation === 'changed-worker-record') writeFileSync(p.attempts[0].record.path, '{"kind":"completed"}');
    if (mutation === 'changed-manifest') {
      // Still-valid JSON and state cannot replace the digest recorded in durable history.
      const replacement = structuredClone(evidence); replacement.worker.outcome.summary = 'operator rewrote manifest';
      writeFileSync(p.verification.evidence.path, JSON.stringify(replacement));
      assert.notEqual(hash(readFileSync(p.verification.evidence.path)), p.verification.evidence.digest);
    }
    if (mutation === 'changed-candidate') writeFileSync(join(p.workspace.workspace.path, 'src/answer.cjs'), 'module.exports = 7;\n');
    if (mutation === 'changed-program') writeFileSync(join(f.trusted, 'helper.cjs'), 'module.exports = 7;\n');
    assertError(resume(f), 'artifact_invalid'); assertError(run(f), 'artifact_invalid');
    assert.equal(invocations(f).length, 1);
    const after = assertSnapshot(readStore(f)); assert.equal(after.attempts.length, 1);
    assert.deepEqual(after.verification, p.verification);
  }));
}

test('P2-009 configuration and start limit remain fixed; resume ignores edited input file', () => withFixture(f => {
  const p = assertDurable(run(f, 2), f, 'VERIFIED'); assert.equal(p.maxStarts, 2);
  assertDurable(run(f), f, 'VERIFIED');
  assertError(run(f, 3), 'config_mismatch');
  const original = structuredClone(f.config);
  f.config.request.objective = 'changed objective'; writeConfig(f);
  assertError(run(f), 'config_mismatch');
  f.config = original;
  const resumed = assertDurable(resume(f), f, 'VERIFIED'); assert.equal(resumed.maxStarts, 2);
  assert.equal(invocations(f).length, 1); assert.deepEqual(resumed, p);
}));

for (const [worker, expected] of [['blocked', 'FAILED'], ['failed', 'FAILED'], ['lie', 'REPAIR_READY']]) {
  test(`P2-009 explicit ${worker} outcome is terminal until a later phase supplies continuation`, () => withFixture({ worker }, f => {
    const p = assertDurable(run(f), f, expected); assertArtifacts(p);
    const before = readStore(f);
    assertDurable(resume(f), f, expected); assertDurable(status(f), f, expected, 'durable_status');
    assert.deepEqual(readStore(f), before); assert.equal(invocations(f).length, 1);
  }));
}

test('P2-009 missing store and invalid start-limit arguments fail before worker dispatch', () => withFixture(f => {
  assertError(resume(f), 'not_found'); assertError(status(f), 'not_found'); assert.equal(existsSync(f.store), false);
  for (const limit of ['0', '101', '1.5', 'NaN']) assertError(cli(runArgs(f, limit)), 'input_error');
  assertError(cli([...resumeArgs(f).slice(0, -1), '--max-starts', '2', '--json']), 'input_error');
  assertError(cli([...statusArgs(f), '--extra']), 'input_error');
  assertError(cli(runArgs(f), { env: { SWF_TEST_FAULT: '{malformed' } }), 'input_error');
  assert.equal(workspaces(f).length, 0);
}));

for (const location of ['repository', 'workspace-root', 'junction']) {
  test(`P2-009 reject store under ${location} before any worker`, () => withFixture(f => {
    if (location === 'repository') f.store = join(f.repo, 'factory-state');
    if (location === 'workspace-root') f.store = join(f.config.workspaceRoot, 'factory-state');
    if (location === 'junction') {
      const alias = join(f.root, 'repository-alias'); symlinkSync(f.repo, alias, 'junction'); f.store = join(alias, 'factory-state');
    }
    assertError(run(f), 'input_error'); assert.equal(workspaces(f).length, 0);
  }));
}

test('P2-009 actual worker restriction protects SQLite store and removes factory-only fault controls', () => withFixture({ worker: 'store-restriction' }, f => {
  mkdirSync(f.store); writeFileSync(join(f.store, 'worker-sentinel.txt'), 'original');
  const observed = cli(runArgs(f), { env: { SWF_TEST_FAULT: JSON.stringify({ point: 'transaction.after_commit', eventType: 'RunStopped', marker: join(f.root, 'unused-fault.json') }) } });
  const p = assertDurable(observed, f, 'VERIFIED'), evidence = assertArtifacts(p);
  assert.equal(readFileSync(join(f.store, 'worker-sentinel.txt'), 'utf8'), 'original');
  const restriction = JSON.parse(readFileSync(join(p.workspace.workspace.path, 'src/store-restriction.json'), 'utf8'));
  assert.match(restriction.observation, /^E(ACCES|PERM)$/);
  assert.equal(invocations(f)[0].factoryFaultInherited, false);
  const output = readFileSync(evidence.commands[0].process.stdout.path, 'utf8');
  assert.match(output, /p2-factory-fault-inherited:false/);
}));
