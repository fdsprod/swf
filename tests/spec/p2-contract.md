# P2 durable execution contract

Status: preparation. Freeze only after P1 acceptance and a committed P2 behavioral-red run.

P2 adds restart recovery to the accepted P1 path. P0 and P1 behavior remains cumulative. There is one immutable run per store directory and one active runner per store. P2 does not add human decisions, repair after failed verification, or delivery.

## Commands and results

```text
node dist/cli/main.js run --local <config.json> --store <directory> [--max-starts <integer>] --json
node dist/cli/main.js resume --store <directory> --json
node dist/cli/main.js status --store <directory> --json
```

`run` accepts a P1 configuration. An initial `--max-starts` is an integer from 1 through 100, default 5. A repeat `run` with the same parsed configuration resumes the existing run. JSON object property order and whitespace do not change its identity; array order still matters. It cannot replace its configuration, resolved base commit, pinned program bytes, or limit. If the repeat supplies a different limit or configuration, return `config_mismatch` before a worker starts. Omitting the limit on a repeat retains the stored limit. `resume` reads only the stored configuration and rejects new configuration or limit arguments. Missing, repeated, or unknown command arguments are input errors.

`run` and `resume` return `durable_result` with the projection and complete ordered event history. They exit 0 only for current, valid `VERIFIED` evidence; other valid run states exit 1. `status` returns `durable_status` and exits 0 for any valid stored projection. It reads one consistent snapshot while a runner owns the store and does not append events, launch children, validate the current candidate as a new observation, or repair state. Errors use `durable_error`, a named code, and nonempty diagnostic issues. `input_error` exits 2; other errors exit 1. The contract stub emits `not_implemented` and exits 3. Each command emits exactly one JSON line.

An empty or missing store returns `not_found` from resume/status. Malformed history or a projection that disagrees with replay returns `corrupt_store`. Invalid required evidence returns `artifact_invalid`; it cannot silently cause a new run or discard history. Failure to establish that an earlier worker has stopped returns `ownership_uncertain`. Concurrent runners return `store_busy`. Error output does not imply that historical `VERIFIED` has become fresh evidence.

## Durable authority and data

`src/contracts/durable.ts` and `durable-result.schema.json` define the public boundary. The factory generates a run ID distinct from the request ID. Its graph retains P0's single-unit naming. Attempt IDs, workspace operation IDs, and verification operation IDs remain stable across retries of their own operation. A new worker start reserves a new attempt with an increasing ordinal and a stable completion-artifact path.

The authoritative history contains facts, not copies of the current state. `RunCreated` pins the graph, resolved contract, resolved `baseCommit`, and limit. Preserve the original configuration's `baseRef`; a branch moving after this commit must not change the run's base. Workspace facts record intent and observed creation, and their base must match the pinned commit. Attempt facts record reservation, observed process identity, interruption, and durable completion. Verification facts record intent, required command results, integrity violations, and manifest identity. `RunStopped` records exhaustion or a recovery failure. Events have contiguous positive sequence numbers and one run ID. The projection is an explicit cache produced by replaying those facts. Its `sequence` is the last committed event sequence.

The replay rules are part of the contract:

- `RunCreated` produces `PENDING`, an unplanned workspace, no attempts, and idle verification.
- `WorkspacePlanned` records the exact base commit and intended path. `WorkspaceReady` changes intent to ready and execution to `READY`.
- `AttemptReserved` appends a reserved attempt and changes execution to `RUNNING`. Its ordinal equals the new attempt count and cannot exceed the original limit.
- `WorkerStarted` records an OS-observed process identity for that reserved attempt. This identity includes PID, executable path, and creation identity; a bare worker-written PID is not authority.
- `AttemptInterrupted` replaces a reserved or running attempt with an interrupted attempt, retains its evidence, and returns execution to `READY`.
- `WorkerCompleted` replaces that attempt with a completed attempt and pins a trusted `WorkerCompletion` artifact. Completed agent outcomes enter `VERIFYING`; blocked/failed outcomes enter `FAILED` with the outcome reason. P1's wire protocol cannot produce a decision. P3 adds decision continuation.
- `VerificationPlanned` records the completed attempt and stable manifest path. `VerificationCompleted` records independent results and integrity issues. Nonempty issues, missing/duplicate/unknown required IDs, or error results produce `FAILED`; a failed required check produces `REPAIR_READY`; every required check passed with evidence produces `VERIFIED`. For deterministic replay, a fatal reason is the issues joined by `; ` when present, otherwise `Invalid verification result coverage` for a coverage mismatch, otherwise error-result summaries joined by `; `, otherwise `Missing verification evidence` for a passed result without evidence. The saved P1 manifest verdict must match that derived state; preserve an existing P1 fatal reason as one issue when needed.
- `RunStopped` changes execution to `FAILED` with its message. An exhausted budget cannot append another reservation.

Events are append-only. P2 exposes a small SQLite inspection boundary for independent acceptance: `<store>/run.sqlite` contains `events(sequence INTEGER PRIMARY KEY, run_id TEXT, json TEXT)` and `projection(id INTEGER PRIMARY KEY, sequence INTEGER, json TEXT)`, with one projection row at ID 1. Event JSON is the complete `DurableEvent` envelope. Projection JSON is `DurableProjection`. Additional private tables are allowed. Event and projection writes share one transaction. Configure and check WAL and FULL synchronization on each writing connection; roll back every failed transaction. UPDATE/DELETE of an existing event must be rejected by the database's append-only rule. An ordinary new SQLite connection must also reject `INSERT OR REPLACE` that conflicts with an existing event sequence, preserving the exact event rows and history without relying on caller-specific trigger settings.

Use a separate `<store>/owner.sqlite` process-lifetime lock or an equivalent mechanism that does not hold the event transaction open. Resolve existing ancestors and directory aliases to the same canonical store before ownership. Do not delete/recreate a lock file to reclaim ownership. A store must be outside the repository and every writable workspace root. Its path must not alias such a location through a junction. Worker and candidate-executing verifier restrictions must deny writes to the store. Delivery credentials remain denied under P1.

## Recovery and evidence

Commit side-effect intent before creating a worktree or dispatching a worker. After a creation/result gap, verify and reuse the exact intended worktree; never create a second workspace for the same operation. Mismatched Git registration, base commit, or an occupied unrelated path returns `ownership_uncertain`. Resume must not delete that path or guess it belongs to this run.

Reserve each worker start durably before dispatch. Consumed budget is the count of reservations, including reservations whose dispatch is uncertain. A crash can consume a slot without starting a worker. Resume and status alone consume no slots. Incomplete verification reruns with no worker start. Neither restarting the CLI nor replacing a configuration file resets the limit. P2 automatically retries interrupted attempts within this limit; it does not retry explicit blocked/failed outcomes or `REPAIR_READY`.

The owner lock proves that the old factory exited; it does not prove that its descendants exited. Stop and confirm the old owned worker tree, including detached descendants, before starting another worker or verification. Cleanup is bounded and tied to trusted process ownership. Failure to confirm cleanup blocks with evidence. No operation may kill an unrelated process because a stale or worker-written PID claims ownership.

Write a trusted completion artifact only after the worker tree has stopped and its process result/outcome has been validated. An existing valid completion artifact at the reserved path permits reconciliation after a completion/result gap. An exit code without that durable artifact does not: mark the attempt interrupted and reserve a new start when budget permits. Never claim exactly-once worker execution across this gap.

Write P1 evidence outside the worktree and pin its expected digest in durable history. A complete manifest at the planned path can reconcile the manifest/result gap only after full validation against the recorded attempt, contract, candidate, and process artifacts. This includes exact required command coverage and agreement between process terminations and results. A schema-valid pending manifest with missing commands, an unknown command ID, or a nonzero process exit cannot authorize recovery merely because its saved verdict still says `VERIFIED`. Reject it with `artifact_invalid` and do not append a verification-completion fact. A recorded complete current verification is retained; repeat run/resume does not repeat its worker or verifier. Incomplete verification may run again without a new worker. Missing, changed, or malformed required artifacts, changed verifier inputs, a mutated candidate, or a rewritten manifest block advancement. Resume must not accept an operator-rewritten manifest merely because P1 can parse it: the recorded expected digest is authoritative. Old logs and evidence references survive interrupted retries.

## Trusted fault interface

Acceptance passes `SWF_TEST_FAULT` as a JSON object with `point`, optional `eventType`, and an absolute `marker` path. This is a test-only factory hook. Strip this variable before worker/verifier launch; never accept it through worker output or run configuration. At the selected boundary, atomically write a marker containing `point`, `runId`, and the selected `eventType` when applicable, then wait without progressing until the harness kills the actual factory process. Invalid hook configuration is an input error, not permission to weaken execution restrictions.

Supported points are `transaction.after_event_insert`, `transaction.after_projection_write`, `transaction.after_commit`, `workspace.after_create`, `worker.after_dispatch`, `worker.after_completion_artifact`, `verification.after_command`, and `verification.after_evidence_artifact`. Transaction points select the first matching event type. `verification.after_command` means one command has completed but whole verification has not been committed. The artifact points occur after the complete trusted file exists and before its completion event commits. `worker.after_dispatch` occurs after launch and before `WorkerStarted` commits; the child may execute while the factory waits. Markers remain outside worker write scope.

## Acceptance map and limits

| ID | Required observation |
|---|---|
| P2-001 | Fresh run, status, unchanged repeat run/resume retain generated identity, one workspace, attempts, events, and current evidence. |
| P2-002 | Independent fact replay equals SQL projection and CLI output; malformed/mismatched storage fails closed; event mutation is rejected. |
| P2-003 | Both precommit transaction cuts at attempt reservation roll back event, projection, and budget together; representative postcommit cuts retain all three. |
| P2-004 | Workspace creation/result gap reuses the exact worktree; an unrelated occupied intent path is not replaced or adopted. |
| P2-005 | Dispatch crash stops descendants before a new attempt; reservations and interruption evidence persist through repeated crashes and budget exhaustion. |
| P2-006 | A trusted completion artifact prevents repeated worker execution; incomplete verification adds no worker start; complete evidence is reused. |
| P2-007 | Concurrent ownership, including a store junction alias, permits only one runner; status sees a consistent committed snapshot. |
| P2-008 | Missing/tampered artifacts, manifest replacement, candidate mutation, and changed verifier bytes prevent resumed success. |
| P2-009 | Immutable input and limit validation, terminal blocked/failed behavior, store placement, and factory-only fault environment preserve boundaries. |

The matrix checks precommit cuts at `AttemptReserved`, which changes both budget and execution state. Postcommit checks cover `RunCreated`, `WorkspaceReady`, `AttemptReserved`, `WorkerCompleted`, and `VerificationCompleted`; their payloads exercise initialization, external-effect completion, budget reservation, outcome, and final evidence. Dedicated gap tests cover workspace intent, dispatch intent, and verification intent. Equivalent cuts at `WorkerStarted` and `VerificationPlanned` are not repeated; the same transaction writer and independent replay checks cover their atomic writes. `AttemptInterrupted` is covered by the repeated-crash chain and `RunStopped` by exhausted-budget resume. This is process-termination evidence on the supported local Windows filesystem, not proof against power loss or hostile database administrators.

The retained SQLite learning proof used Node 22.22.3. P2's supported minimum must be pinned to a tested runtime that provides `node:sqlite`; the earlier package minimum of 22.12 is not sufficient evidence. The coordinator owns any frozen toolchain revision.
