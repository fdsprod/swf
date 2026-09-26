# BP-3 preparation handoff

This bundle is preparation, not accepted P3 and not final red on accepted P2. The worktree starts at `2af3a2fdc1c003724e70110314a4ebdd7e13223c`, where durable execution is the inherited public `not_implemented` scaffold. No product logic or CLI behavior was added. The coordinator owns commits and integration.

BP-3 read the bootstrap plan, source specifications, public contracts, accepted tests, dependency research, and necessary CLI scaffold wiring. It did not inspect PRODUCT-2 source or its implementation plan. Existing P0/P1/P2 acceptance files remain unchanged.

## Frozen scope

- `tests/spec/p3-contract.md`: CLI, config, process, persistence, publication, response, context, budget, and recovery contract.
- `src/contracts/decisions.ts`, additive `local.ts`/`durable.ts` fields, additive existing schema fields, and three P3 schemas: public shape scaffolding only.
- `tests/spec/p3/`: deterministic API/worker fixtures, independent replay, sanity controls, product scenarios, requirement map, external runner, and required live evidence instructions/checker.

The exact wire schema matches the retained successful live learning digest `f1af7887ede9407a4696c3fc728c4b6854de48d487206ab52c163806ca6ea87b`. Its ordinary string types need the documented semantic checks for nonempty text and unique option IDs. Existing flat P1 outcomes remain valid.

The new persistence definitions are embedded in the already-registered local/durable schemas. Older harness schema registration therefore still works. Existing unconfigured runs must omit the new decision projection collection. The optional decision configuration and facts do not rewrite old histories.

## Preparation evidence

Run from this verifier worktree:

```text
node tests/spec/p3/harness/run-gates.mjs --preparation
```

The report lives at `.p3-proof/latest/report.json`, with full logs and the bundle manifest alongside it. It records revisions, uncommitted file state, tool versions, commands, exit codes, test totals, source digests, and bundle hashes before/after execution. The final handoff message supplies that run's digest.

Expected preparation result: typecheck and build pass; all four harness sanity checks pass; the 36 required product scenarios fail against well-formed `not_implemented` output or because the scaffold exits before a required product fault point. There are no missing imports, compilation failures, or fixture failures. Real GitHub proof is explicitly blocked, and the runner records `accepted:false`.

A separate compatibility check ran the unchanged P0 CLI/transition/architecture suite and P2 harness sanity: 137 tests passed. The full cumulative P1 live/P2 product acceptance is intentionally deferred to accepted P2 integration.

## Coordinator steps before product assignment

1. Accept and integrate P2, then integrate this preparation and the P3 dependency research. Resolve additive contract changes without editing accepted P2 tests.
2. Commit the contract/test bundle and rerun meaningful P3 red against the accepted P2 behavior or a narrowly wired P3 scaffold. Record a separate committed final-red report and copy the pinned verifier checkout outside the product worktree.
3. Freeze checks, fixture inputs, schemas, configuration, and command. Assign PRODUCT-3 its own worktree; it may run but not edit this bundle.
4. BP-3 reruns the exact product candidate using the full `run-gates.mjs` command, which includes cumulative checks and required live evidence.

The real target and actual authorized human answer remain prerequisites to P3-LIVE. A deterministic fake author is not live authority, and a factory-posted synthetic answer is not a human answer without the user's explicit instruction. Missing live evidence blocks P3 acceptance even when every deterministic check passes. See `LIVE.md`.
