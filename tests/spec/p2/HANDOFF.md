# P2 backpressure preparation

Prepared independently from the public P0/P1 contracts and the SQLite learning results. No PRODUCT-1 implementation was read. These files are not yet a frozen acceptance baseline. Accept P1 first, merge this preparation, pin the supported runtime, and record committed P2 red before starting PRODUCT-2.

The preparation is in branch `p2-backpressure`, based on `7075094`, under `.worktrees/backpressure-p2`. No commits were made. New files are confined to `tests/spec/p2/**`, `tests/spec/p2-contract.md`, the durable contract/schema, and the throwing-equivalent CLI stub. The only existing file changed is `src/cli/main.ts` for routing and exit codes. Preserve accepted P1's CLI changes when merging that small patch.

## Observed preparation checks

| Check | Result |
|---|---|
| TypeScript typecheck and build | Exit 0 on Node 22.22.3. |
| P2 harness sanity | 4 passed; no failures, skips, cancellations, or TODOs. |
| P2 acceptance against the runnable scaffold | 36 failed assertions, 0 passes; no skips, cancellations, or TODOs. Each failure reports absent durable behavior through `not_implemented`. |

The ignored `.p2-proof/preparation/` directory contains `sanity.log`, `acceptance.log`, and `report.json`. This preparation result does not replace red against accepted P1 or the final cumulative gate. The full runner deliberately includes P0/P1, including P1's native restriction and live Codex checks.

```powershell
node tests/spec/p2/harness/run-gates.mjs
```

Use `FACTORY_CANDIDATE_ROOT` to judge an isolated candidate and `P2_PROOF_DIR` for the evidence directory. The runner pins the full test bundle, schemas, canonical contracts, and toolchain. It records source hashes before and after execution and rejects changed tests, changed sources, missing tests, skipped tests, or timed-out checks.

## Handoff boundaries

- [p2-contract.md](../p2-contract.md) defines the commands, storage inspection boundary, fact semantics, error behavior, fault hooks, and requirement map.
- The independent replay oracle derives state from facts. It does not compare one product-generated state snapshot with another.
- The crash matrix includes both precommit cuts at attempt reservation, five distinct committed transitions, three effect/result gaps, incomplete verification, canonical store ownership, and exhausted budgets. A separate moved-base-reference test requires the base SHA pinned by `RunCreated`.
- The process oracle uses a fixture-specific executable path and OS creation time. It does not use worker-written PIDs as authority for cleanup. Its negative control detects a child that survives a killed parent.
- The coordinator must raise the frozen runtime minimum to a tested Node version with `node:sqlite`; the learning and preparation runs used 22.22.3. No dependency or package files were changed here.

PRODUCT-2 may implement the new CLI and adapters, but must not change these checks or public contracts. Contract changes return to BP-2 with new red evidence.

## Independent regression additions

Two regression groups strengthen existing P2-002 and P2-008 requirements. One attempts to replace a committed event through ordinary `INSERT OR REPLACE` and requires rejection with unchanged rows. The other kills the factory after writing a pending verification manifest and tests three false success claims: missing command records, an unknown command ID, and a nonzero process exit paired with a passed result. Each must produce `artifact_invalid` without durable verification completion.

These additions bring the P2 acceptance suite to 40 cases. They were authored from the requirements without reading PRODUCT-2 source. The coordinator must record targeted behavioral red against a runnable PRODUCT-2 candidate before those fixes proceed; the original scaffold cannot demonstrate these specific defects.

## Final lifecycle and evidence checks

Four checks in `scenarios/evidence-regressions.test.mjs` bring the suite to 44 cases. They cover active-verifier termination, WorkerStarted persistence failure while a worker is active, Git checkout line endings, and a failed large-diff capture with a forged pending verdict. The last case accepts complete capture; it does not impose a fixed capture limit.

The active-verifier fixture loads candidate code and starts a detached descendant. A narrow native helper retains exact OS process identities, suspends the owned PowerShell supervisor, and terminates only the retained factory process. The helper resumes and cleans up those exact instances in `finally`. On the observed candidate, both Node SIGKILL and native factory-only termination stopped the old supervisor, verifier, and descendant despite the suspension. The attempted held-survivor setup therefore did not demonstrate an uncertain-cleanup defect in this environment. The retained acceptance check observes process lifetime and dispatch ordering; it must not be reported as a reproduced red for that unavailable setup.
