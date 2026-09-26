# P6 first feature: inspect one durable run

This is the external contract for issue 3. It adds `inspect --store <directory> [--json]`. It adds no run registry, persistence migration, remote operation or new decision policy. The existing `run`, `resume` and `status` contracts remain unchanged.

The command reports a **persisted observation** from one consistent committed event/projection snapshot. It can inspect a store owned by a running factory. It does not claim a fresh remote CI verdict or rerun verification. A running worker may legitimately change its candidate; inspection does not assert that those bytes still match an earlier verification snapshot.

## JSON contract

`inspect.schema.json` is normative. Success is exactly one JSON line with `schemaVersion:1`, `kind:"run_inspection"`, and `observation:"persisted"`:

- `run`: `id`, `requestId`, committed `sequence`, and pinned `baseCommit`.
- `state`: the existing `UnitExecutionState`, unchanged.
- `starts`: `limit`, `consumed`, `remaining`, and existing `DurableAttempt[]` as `attempts`.
- `repair`: `{kind:"disabled"}`, or `{kind:"enabled",limit,consumed,remaining,reservations}` using existing `RepairReservation[]`.
- `verification`: the existing tagged `VerificationOperation`, including evidence references when completed.
- `decisions`: existing `DecisionRecord[]`; an absent decision feature yields `[]`.
- `github`: `{kind:"disabled"}`, or `{kind:"enabled",issue,delivery,ci}` using the existing intake issue identity, `DeliveryProjection` and `CiProjection`.

`starts.limit` is the immutable RunCreated limit. Each `AttemptReserved` or `RepairReserved` consumes one start before dispatch. Completed, running, reserved and interrupted attempts all count. `repair.limit` is the configured maximum, or one only when repair is enabled with its default. Only `RepairReserved` consumes this allowance. Human and interrupted continuations consume total starts without reserving another repair. Remaining values are limit minus consumption; inspection never replenishes budgets.

This response is a derived observation, not another stored authority. Tagged repair and GitHub groups prevent meaningless disabled budgets or delivery without issue/CI context. Existing state types retain their distinctions; all duplicated counters are calculated from the same immutable limits and committed facts at observation time. The explicit persisted marker prevents callers from treating inspection as fresh verification or a remote poll.

## Integrity, effects and exits

Validate the store's event/projection consistency and all current and historical durable artifact references, including nested worker/command outputs, previous failed verification, decision captures and superseded delivery/CI records. Missing or corrupted evidence produces `artifact_invalid`; no success summary may accompany that error. Do not repair state, refresh API data, launch a worker/verifier, or write artifacts. Inspection must leave durable history, projection, worker consumption, worktrees, artifact bytes and gateway calls unchanged.

JSON errors reuse `{kind:"durable_error",code,issues}`. Missing/repeated/unknown arguments are `input_error` (exit 2). Missing run/store is `not_found`, inconsistent/malformed store is `corrupt_store`, and invalid artifacts are `artifact_invalid` (exit 1). A missing store is never created. Successful inspection exits 0 even when its recorded state is failed, waiting or has pending/failed CI. Exit 0 describes the inspection, not the product outcome.

## Human form

Without `--json`, print a concise persisted-state summary, not a raw JSON dump. Keep it under 4096 characters for these bounded fixtures. Include the run ID and separate labeled lines:

```text
Persisted observation
Run: <run ID>
Local: <state.status>
Starts: <consumed>/<limit> (<remaining> remaining)
Repair: disabled
Verification: <verification.kind>
Evidence: <completed evidence path, when present>
Delivery: <delivery.kind, or disabled>
CI: <ci.kind, or disabled>
```

An enabled repair line uses the same consumed/limit/remaining format. `Worker starts` is also accepted. Include every decision ID and its question-comment URL when published. Letter case and whitespace around labels are flexible; labels and their values must remain unambiguous. Delivery and CI must never be inferred from local VERIFIED. Error output must be a diagnostic with the same nonzero exit policy.

## Independent feature validation

The external harness reads public P0–P5 contracts and replays committed facts. It never imports product implementation. Deterministic existing fixtures establish real local, decision, repair and delivery states before invoking the new CLI. Each feature failure on P5 must be an inspect-contract assertion after fixture setup succeeds. The CLI-invalid-input control may already pass on the baseline; count its result honestly.

`run-feature-gates.mjs` runs build/typecheck, three oracle sanity checks and 16 scenarios. It records source and frozen bundle hashes before/after, dirty status, commands and complete logs. It is focused feature validation, not P6 self-hosting acceptance. Keep the prior independent cumulative report and later run the required full cumulative exact-candidate checks. Follow `SELF-HOSTING.md` for the separate real-run evidence gate.
