# P2 SQLite learning results

Observed on 2026-09-25 with Node v22.22.3 at `C:\nvm4w\nodejs\node.exe`, built-in SQLite 3.51.3, and Windows. The probes import `node:sqlite` directly. No package or runtime flag is required. Node emits an `ExperimentalWarning`, so the product must pin and test its supported Node version.

Keep these probes as living documentation. They exercise SQLite and Node subprocess behavior. They do not import factory code or replace the P2 acceptance suite.

Run from the repository root:

```powershell
node tests/learning/p2/sqlite-probe.mjs .p2-proof/learning
```

The command creates a new directory below the operating system temp directory. It retains the SQLite files for inspection. It writes a structured result to `.p2-proof/learning/sqlite-observations.json`. Each read and write runs in a fresh Node process. Held writer processes report a named boundary before the parent kills them with `SIGKILL`. On this Windows run, Node reported termination with `code: null` and `signal: "SIGKILL"`.

## Observations

All eight probes passed. The event and projection tables in the probe are a small SQL fixture, not a proposed product schema.

| Probe | Observed result | Implication |
|---|---|---|
| WAL, `synchronous=FULL`, foreign keys | These settings were accepted. Readback returned `wal`, `2`, and `1`. | Set and check durability settings explicitly when opening the store. |
| Connection settings | WAL remained enabled after reopening. A prior connection's NORMAL synchronization, disabled foreign keys, and 123 ms busy timeout did not persist. A new connection returned FULL, enabled foreign keys, and zero timeout. | Configure every connection. Do not infer its settings from an earlier connection. |
| Kill after event insert, before projection update | A concurrent reader saw the prior event and projection. After killing the writer, a fresh reader still saw both prior values. Integrity check returned `ok`. | A transaction can keep the event and projection atomic across process termination. |
| Kill after projection update, before commit | Both writes rolled back. Concurrent and recovery reads agreed. Integrity check returned `ok`. | Include both writes in the same transaction. |
| Kill after commit | Both writes survived. Concurrent and recovery reads agreed. Integrity check returned `ok`. | Treat successful commit as the durable local boundary. |
| Failed SQL statement | A foreign-key error in the projection update left the earlier event insert visible inside the transaction. Explicit rollback removed that insert. | A statement error does not imply transaction rollback. Roll back explicitly on every transaction failure. |
| Append-only triggers | UPDATE and DELETE failed with the fixture's trigger error. | Triggers can catch accidental history mutation. They are not a security boundary against a process that can change the database schema or files. |
| Separate owner database | While one process held `BEGIN IMMEDIATE`, a second process received `ERR_SQLITE_ERROR`, SQLite error code 5, and `database is locked`. That process could acquire the event database independently. After the owner was killed, a fresh process acquired the owner lock. | A separate SQLite file can hold a process-lifetime owner lock without holding an uncommitted event transaction. |
| Intent committed, external effect performed, result absent | After termination, the external marker existed. The event and projection still said `DISPATCH_INTENT`, with start count 1 and a stable effect ID. | SQLite cannot atomically commit an external process or Git action. Persist intent and reconcile the effect on restart. |

The output has eight top-level probe records. The three transaction kill boundaries are separate records. Initialization settings are checked within each relevant record.

## Minimal mechanism supported by these results

Use one local store directory with an event database and a separate owner-lock database. Keep the owner connection open with an uncommitted `BEGIN IMMEDIATE` for the runner's lifetime. Use a zero busy timeout for immediate rejection of another runner. Resolve the store to one canonical path before opening either file. Do not delete or replace the owner-lock file to recover ownership. SQLite releases its lock when the owning process dies.

Commit each state transition as one short event-database transaction. Insert the event, update the projection and its event sequence, then commit. If any statement fails, explicitly roll back before propagating the error. The projection is a cache of event history. Record its sequence and check that both refer to the same transition on load. The database prevents partial commits, but it cannot detect a logically incorrect projection produced by application code.

Reserve an attempt and consume the total worker-start budget in the same committed transition before dispatch. A dispatch intent needs a stable attempt ID and effect ID. A crash after that commit can consume a slot even if dispatch did not happen. This conservative behavior preserves a hard upper bound. A resumed runner must not reset the count or infer success from the intent alone.

Keep transactions short. Do not hold an event transaction while waiting for Codex, Git, a verifier, or a human. An owner lock on the event database itself would either block transition writes from another connection or be released at each commit. The separate owner database avoids that conflict.

Recovery must reconcile workspaces, artifacts, and worker lifetime before starting a replacement attempt. Owner-lock release proves only that the old runner released its SQLite connection. It does not prove that a worker child has stopped. P1's process-lifetime mechanism and P2's process-kill acceptance tests must prove that separately. Stable IDs plus persisted intent are necessary to handle the gap between an external effect and its result record.

## Limits and P2 acceptance work

These are process-termination experiments on the current local Windows filesystem. They do not simulate power loss, disk failure, network shares, or damaged storage. They do not prove the factory's state machine, budget logic, migration logic, artifact integrity, or worker cleanup.

The independent P2 backpressure agent must test real factory processes at its named transition boundaries. It must also test the external-effect gap, concurrent ownership, a surviving or terminated worker, damaged evidence, and budget exhaustion across repeated restarts. A store lock alone is not an exactly-once guarantee for external actions.

The product should treat malformed history, mismatched projection sequence, missing artifacts, and uncertain external effects as explicit recovery failures. Do not repair these conditions by silently deleting the store or resetting attempts.
