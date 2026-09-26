// Learning probe only. This file has no dependency on factory product code.
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';

const [mode, databasePath, detail] = process.argv.slice(2);
const db = new DatabaseSync(databasePath);
if (mode !== 'raw-settings') {
  db.exec('PRAGMA busy_timeout = 0; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;');
}

function report(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function pause(value) {
  report(value);
  // The parent forcibly kills this process at an observed SQL boundary.
  setInterval(() => {}, 1000);
}

if (mode === 'raw-settings') {
  report({ journal: db.prepare('PRAGMA journal_mode').get(), synchronous: db.prepare('PRAGMA synchronous').get(), foreignKeys: db.prepare('PRAGMA foreign_keys').get(), busyTimeout: db.prepare('PRAGMA busy_timeout').get() });
  db.close();
} else if (mode === 'set-connection-settings') {
  db.exec('PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = OFF; PRAGMA busy_timeout = 123;');
  report({ synchronous: db.prepare('PRAGMA synchronous').get(), foreignKeys: db.prepare('PRAGMA foreign_keys').get(), busyTimeout: db.prepare('PRAGMA busy_timeout').get() });
  db.close();
} else if (mode === 'initialize') {
  const journal = db.prepare('PRAGMA journal_mode = WAL').get();
  db.exec(`
    CREATE TABLE events (
      sequence INTEGER PRIMARY KEY,
      event_id TEXT UNIQUE NOT NULL,
      payload TEXT NOT NULL CHECK(json_valid(payload))
    ) STRICT;
    CREATE TABLE projection (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      sequence INTEGER NOT NULL REFERENCES events(sequence),
      state TEXT NOT NULL CHECK(json_valid(state))
    ) STRICT;
    CREATE TRIGGER events_no_update BEFORE UPDATE ON events
      BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
    CREATE TRIGGER events_no_delete BEFORE DELETE ON events
      BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
    BEGIN IMMEDIATE;
    INSERT INTO events VALUES (1, 'event-1', '{"status":"READY","starts":0}');
    INSERT INTO projection VALUES (1, 1, '{"status":"READY","starts":0}');
    COMMIT;
  `);
  report({ journal, synchronous: db.prepare('PRAGMA synchronous').get(), foreignKeys: db.prepare('PRAGMA foreign_keys').get() });
  db.close();
} else if (mode === 'read') {
  report({
    events: db.prepare('SELECT * FROM events ORDER BY sequence').all(),
    projection: db.prepare('SELECT * FROM projection').get(),
    integrity: db.prepare('PRAGMA integrity_check').get(),
    journal: db.prepare('PRAGMA journal_mode').get(),
    synchronous: db.prepare('PRAGMA synchronous').get(),
  });
  db.close();
} else if (mode === 'transition') {
  db.exec('BEGIN IMMEDIATE');
  const payload = JSON.stringify({ status: 'RUNNING', starts: 1 });
  db.prepare('INSERT INTO events VALUES (?, ?, ?)').run(2, 'event-2', payload);
  if (detail === 'after-event') {
    pause({ ready: detail });
  } else {
    db.prepare('UPDATE projection SET sequence = ?, state = ? WHERE singleton = 1').run(2, payload);
    if (detail === 'after-projection') {
      pause({ ready: detail });
    } else {
      db.exec('COMMIT');
      pause({ ready: 'after-commit' });
    }
  }
} else if (mode === 'hold-lock') {
  db.exec('BEGIN IMMEDIATE');
  pause({ ready: 'lock-held' });
} else if (mode === 'try-lock') {
  const start = performance.now();
  try {
    db.exec('BEGIN IMMEDIATE');
    report({ acquired: true, elapsedMs: performance.now() - start });
    db.exec('ROLLBACK');
  } catch (error) {
    report({ acquired: false, code: error.code, errcode: error.errcode, errstr: error.errstr, message: error.message, elapsedMs: performance.now() - start });
  }
  db.close();
} else if (mode === 'constraint-rollback') {
  db.exec('BEGIN IMMEDIATE');
  db.prepare('INSERT INTO events VALUES (?, ?, ?)').run(2, 'event-2', '{"status":"RUNNING"}');
  let failure;
  try {
    db.prepare('UPDATE projection SET sequence = ? WHERE singleton = 1').run(999);
  } catch (error) {
    failure = { code: error.code, errcode: error.errcode, message: error.message };
  }
  // Observation: a statement error does not roll back this transaction.
  const visibleInsideTransaction = db.prepare('SELECT count(*) AS count FROM events').get();
  db.exec('ROLLBACK');
  report({ failure, visibleInsideTransaction, visibleAfterRollback: db.prepare('SELECT count(*) AS count FROM events').get() });
  db.close();
} else if (mode === 'append-only') {
  const results = [];
  for (const sql of ['UPDATE events SET payload = payload WHERE sequence = 1', 'DELETE FROM events WHERE sequence = 1']) {
    try {
      db.exec(sql);
      results.push({ blocked: false });
    } catch (error) {
      results.push({ blocked: true, message: error.message });
    }
  }
  report(results);
  db.close();
} else if (mode === 'commit-intent-then-effect') {
  db.exec('BEGIN IMMEDIATE');
  const payload = JSON.stringify({ status: 'DISPATCH_INTENT', starts: 1, effectId: 'worker-start-1' });
  db.prepare('INSERT INTO events VALUES (?, ?, ?)').run(2, 'event-2', payload);
  db.prepare('UPDATE projection SET sequence = ?, state = ? WHERE singleton = 1').run(2, payload);
  db.exec('COMMIT');
  // This external marker models a side effect that SQLite cannot roll back.
  writeFileSync(detail, 'effect occurred\n', { flag: 'wx' });
  pause({ ready: 'effect-without-result' });
} else {
  throw new Error(`Unknown probe mode: ${mode}`);
}
