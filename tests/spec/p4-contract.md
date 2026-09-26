# P4 bounded local repair

Status: independent preparation on P3 public contracts. This is not accepted P4, and scaffold failures are not definitive red. Before PRODUCT-4 implementation, the exact prior P3 candidate must independently pass every runnable gate. Required live evidence may remain explicitly blocked; that baseline is not accepted. The coordinator records committed behavioral red and freezes the new bundle before handoff.

## Configuration and compatibility

Add optional `LocalConfig.repair = {kind:"local_verification",maxRepairs?:number}`. The limit is an integer from 0 through 100. When this object is present, an omitted limit means one repair. The object requires a durable store. When absent, preserve all accepted P0-P2 shapes and behavior, including terminal `REPAIR_READY`, plus P3 decision behavior. Do not add a `repairs` property or change legacy prompts for unconfigured runs.

The entire configured object belongs to the original immutable run contract. Do not rewrite omitted defaults into that object. Repeated run comparison retains P2 parsed-content semantics; resume cannot replace the budget. P2 `maxStarts` remains the independent total-start limit, default 5. Every reserved worker start consumes it. Waiting, status, verification recovery and decision resolution consume neither budget.

## Atomic reservation and state

Only a fully validated, completed verification in `REPAIR_READY` can cause repair. Verifier errors, missing required records, invalid artifacts, forbidden edits and worker blocked/failed outcomes cannot cause it. Keep the original objective, constraints, verification contract, repository base, workspace and edits. P4 introduces no classifier or replanning.

Use one new fact, `RepairReserved`, with `repairId`, `failedVerificationId`, pinned failure `evidence:Artifact` and ordinary `attempt:AttemptIdentity`. One SQLite transaction appends this fact and updates the projection: append an immutable repair reservation, append the reserved attempt, enter `RUNNING`, and reset the current verification operation to `idle`. This fact replaces `AttemptReserved` for that launch; do not also reserve the same worker through a second event. The prior failed verification and all evidence remain in history.

Initialize `repairs:[]` only for enabled runs. Its entries are the reservation payloads, without `type`. Repair usage is the number of these records; total usage is the number of durable attempts. IDs, completion paths and failed-verification sources cannot be reused. Both budgets must allow the reservation, and no decision can be unresolved. If total starts are exhausted, append existing `RunStopped/worker_start_budget_exhausted`. Otherwise, an exhausted repair allowance appends `RunStopped/repair_budget_exhausted`. Both stop in `FAILED` with the prior evidence retained. Do not use `REPLAN_REQUIRED` for ordinary repeated failure.

Recovery of a reserved or interrupted repair follows P2: uncertain unrecorded completion is an interrupted attempt; retry reserves a new ordinary attempt and consumes another total start. It retains the same repair origin and does not consume another repair allowance. A human continuation during repair follows the same counting rule. Only another completed failed verification can cause a new `RepairReserved`.

## Fresh worker context and exact evidence

For repair-enabled runs, use the existing P3 `DecisionWorkerInput` structured envelope for every worker, even without GitHub decisions. Initial context has no `repair` field. Keep the P1 response schema unless decisions are configured; configuration of repair alone grants no decision authority. Never resume an old Codex conversation.

`ContextPackage.repair` contains `repairId`, `failedVerificationId`, `failedAttemptId`, the pinned failure manifest `evidence`, exact `VerificationResult[]`, and every required recorded command. Each command includes `specId`, the original `ProcessRecord`, and `stdoutBase64`/`stderrBase64` encoding the exact captured bytes. This transports binary and multiline output without granting the worker access to the evidence store. Preserve original paths/digests as evidence identities, not worker write permissions. The trusted producer validates full required coverage, process/result consistency and all artifact digests before constructing context. The DTO is an immutable snapshot of existing truth, not new verification authority.

Include the unchanged request/unit, every prior attempt excluding the current reservation, all accepted human resolutions, prior evidence references and original repository context. Preserve this repair context through interruption and a human wait. A later repair uses its own newly measured failure. Validate the current candidate against the failed snapshot before the initial repair dispatch; after a repair has started, old failure snapshots remain historical evidence and must not be mistaken for a requirement that the workspace never change again.

The current worker's origin is the latest `RepairReserved` at or before its reservation, including an ordinary continuation reservation. It cannot omit that origin or select an older failed verification. Validate the manifest and command artifacts of every historical repair source on every resume, including after a newer successful verification. A corrupted old failure is still `artifact_invalid`.

All worker restrictions and verifier integrity rules remain in force. Repair cannot weaken required checks, change the contract or authorize a protected decision. Completion is still only a claim; run the original trusted verifier after every completed repair worker.

## Acceptance and fault boundaries

Reuse P2 transaction hooks for `RepairReserved` and `VerificationCompleted`. Both precommit cuts must leave neither half of the reservation visible. A committed reservation must retain both charges after restart. No new general fault framework is required.

Run `node tests/spec/p4/harness/run-gates.mjs` from the pinned trusted checkout with `FACTORY_CANDIDATE_ROOT` pointing to the candidate. `P4_PROOF_DIR` selects the evidence directory. The runner includes accepted P3/P2/P1/P0 gates, including their required live proofs, then P4 sanity and scenarios. It records revisions, commands, logs, frozen-bundle digest and before/after source hashes; missing, skipped or cancelled checks block acceptance.

`--preparation` runs typecheck, build, sanity and draft P4 scenarios only. Its report always has `accepted:false`. Scaffold failures are preparation evidence only. For definitive new-phase red, integrate the exact independently validated prior candidate with the new public contract, run the focused P4 suite plus typecheck/build, and retain unchanged source/bundle hashes and the prior cumulative report. This does not require another expensive prior cumulative run solely to establish red. Required live gates remain mandatory and explicitly blocked when unavailable. Final acceptance still requires the independent full cumulative gate above.
