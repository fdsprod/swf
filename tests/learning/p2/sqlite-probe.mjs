// Retained learning documentation. Run directly, outside the product test suite.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const childFile = fileURLToPath(new URL('./sqlite-child.mjs', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'swf-p2-sqlite-learning-'));
const observations = [];

function child(mode, database, detail) {
  const processHandle = spawn(process.execPath, [childFile, mode, database, ...(detail ? [detail] : [])], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '';
  let stderr = '';
  let readyResolve;
  let readyReject;
  let readySeen = false;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  processHandle.stdout.on('data', (chunk) => {
    stdout += chunk;
    const line = stdout.split('\n').find((item) => item.startsWith('{"ready":'));
    if (line && !readySeen) {
      readySeen = true;
      readyResolve(JSON.parse(line));
    }
  });
  processHandle.stderr.on('data', (chunk) => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    processHandle.once('error', (error) => { readyReject(error); reject(error); });
    processHandle.once('close', (code, signal) => {
      // Only callers that expect a held process use ready. Avoid a rejected
      // unused promise for ordinary commands.
      if (!readySeen) readyResolve({ exited: true, code, signal });
      resolve({ code, signal, stdout, stderr });
    });
  });
  const timeout = setTimeout(() => { processHandle.kill('SIGKILL'); }, 15000);
  done.finally(() => clearTimeout(timeout));
  return { processHandle, ready, done };
}

async function run(mode, database, detail) {
  const result = await child(mode, database, detail).done;
  assert.equal(result.code, 0, `${mode}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

async function hold(mode, database, detail) {
  const handle = child(mode, database, detail);
  const ready = await handle.ready;
  assert.equal(ready.exited, undefined, `Child exited before its fault boundary: ${JSON.stringify(ready)}`);
  return handle;
}

async function kill(handle) {
  assert.equal(handle.processHandle.kill('SIGKILL'), true);
  const result = await handle.done;
  assert.notEqual(result.code, 0);
  return { code: result.code, signal: result.signal };
}

async function initialize(name) {
  const database = join(directory, `${name}.sqlite`);
  const settings = await run('initialize', database);
  assert.equal(settings.journal.journal_mode, 'wal');
  assert.equal(settings.synchronous.synchronous, 2);
  assert.equal(settings.foreignKeys.foreign_keys, 1);
  return database;
}

const versionDb = new DatabaseSync(':memory:');
const version = { node: process.version, sqlite: versionDb.prepare('SELECT sqlite_version() AS version').get().version, platform: process.platform, executable: process.execPath };
versionDb.close();

{
  const database = await initialize('settings');
  const changed = await run('set-connection-settings', database);
  const reopened = await run('raw-settings', database);
  assert.equal(changed.synchronous.synchronous, 1);
  assert.equal(changed.foreignKeys.foreign_keys, 0);
  assert.equal(changed.busyTimeout.timeout, 123);
  assert.equal(reopened.journal.journal_mode, 'wal');
  assert.equal(reopened.synchronous.synchronous, 2);
  assert.equal(reopened.foreignKeys.foreign_keys, 1);
  assert.equal(reopened.busyTimeout.timeout, 0);
  observations.push({ probe: 'pragma-scope', changed, reopened });
}

for (const boundary of ['after-event', 'after-projection', 'after-commit']) {
  const database = await initialize(boundary);
  const writer = await hold('transition', database, boundary);
  const concurrent = await run('read', database);
  const expected = boundary === 'after-commit' ? 2 : 1;
  assert.equal(concurrent.events.length, expected);
  assert.equal(concurrent.projection.sequence, expected);
  const termination = await kill(writer);
  const recovered = await run('read', database);
  assert.equal(recovered.events.length, expected);
  assert.equal(recovered.projection.sequence, expected);
  assert.equal(recovered.integrity.integrity_check, 'ok');
  assert.deepEqual(JSON.parse(recovered.projection.state), JSON.parse(recovered.events.at(-1).payload));
  observations.push({ probe: 'kill-transaction', boundary, concurrent, termination, recovered });
}

{
  const database = await initialize('rollback');
  const result = await run('constraint-rollback', database);
  assert.match(result.failure.message, /FOREIGN KEY/);
  assert.equal(result.visibleInsideTransaction.count, 2);
  assert.equal(result.visibleAfterRollback.count, 1);
  observations.push({ probe: 'statement-error-needs-rollback', result });
  const resultAppend = await run('append-only', database);
  assert.equal(resultAppend.every((item) => item.blocked), true);
  observations.push({ probe: 'append-only-triggers', result: resultAppend });
}

{
  const database = await initialize('owner-main');
  const ownerDatabase = join(directory, 'owner-lock.sqlite');
  const owner = await hold('hold-lock', ownerDatabase);
  const duplicate = await run('try-lock', ownerDatabase);
  assert.equal(duplicate.acquired, false);
  assert.equal(duplicate.errcode, 5);
  // A separate lock database does not hold a transaction on the event store.
  const mainStore = await run('try-lock', database);
  assert.equal(mainStore.acquired, true);
  await kill(owner);
  const replacement = await run('try-lock', ownerDatabase);
  assert.equal(replacement.acquired, true);
  observations.push({ probe: 'separate-owner-lock', duplicate, mainStore, replacement });
}

{
  const database = await initialize('effect-gap');
  const effect = join(directory, 'external-effect.txt');
  const writer = await hold('commit-intent-then-effect', database, effect);
  await kill(writer);
  const recovered = await run('read', database);
  assert.equal(JSON.parse(recovered.projection.state).starts, 1);
  assert.equal(JSON.parse(recovered.projection.state).status, 'DISPATCH_INTENT');
  assert.equal(readFileSync(effect, 'utf8'), 'effect occurred\n');
  observations.push({ probe: 'external-effect-gap', recovered, effectExists: true });
}

const result = { version, directory, observations };
if (process.argv[2]) {
  mkdirSync(process.argv[2], { recursive: true });
  writeFileSync(join(process.argv[2], 'sqlite-observations.json'), `${JSON.stringify(result, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
