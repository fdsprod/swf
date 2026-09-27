# Configurable worker skills

Issue: [#8](https://github.com/fdsprod/swf/issues/8). This is a feature validation
report. It does not complete the outstanding live P3/P5 or P6 self-hosting proofs.

The feature adds optional role-based instructions to the existing single worker.
See the [guide](../agent-skills.md) and [editable profile](../../examples/agent-skills.json).
It does not schedule separate designer and tester stages or add a daemon.

## Independent acceptance

The independent author committed the contract and tests before implementation.
The corrected baseline at `316ed43` passed build, typecheck, four harness checks,
and legacy behavior. Sixteen of the 21 behavior cases failed because the baseline
did not accept the new configuration. No tests were skipped.

Stable factory `f9269fb` generated the implementation in run
`8a3cc8dc-63c2-49f6-b34b-8cdf30340609`. Its required native sandbox verifier checked
the complete TypeScript program. An exact separate copy then passed all 21
behavior cases and four harness checks.

Independent review found that the canonical decision/repair input schema still
rejected `context.instructions`. The author added two schema checks at `50279b8`.
The valid-input check failed and the malformed-input controls passed.

The same stable factory corrected only that schema in run
`53c447f3-2667-428e-a4ab-1d215563fdf1`. This run required both typechecking and the
independent schema tests inside the native sandbox. Both passed in one attempt.
The implementation worker could not edit the tests. All product source changes
came from these two factory workers. The coordinator committed and published them.

| Final validation | Result |
| --- | --- |
| Build, typecheck, architecture | Passed |
| Skills behavior | 21 passed |
| Skills harness | 4 passed |
| Canonical input schema | 2 passed |
| Core scenarios | 133 passed |
| Core harness | 19 passed |
| Selected prior P1/P2/P3/P4/P5 regressions | 17 passed |

All 196 tests passed with no failures, skips, cancellations, or todos. The selected
prior cases cover local restrictions, immutable config, changed programs,
restart, decision continuation, repair context, and GitHub delivery. This was a
targeted regression run, not a rerun of every earlier phase gate.

Final source SHA-256:
`c34cffa1e3beb0830436b4376bdd45bd87eb0a018936edde75375f755f1aed91`.
Source and frozen test hashes stayed unchanged during acceptance. A separate
review found no remaining material source issue. The installed operator profile
was also checked against the actual STE, TDD, data design, and tracer skill files.

## Evidence and current limits

Both original generated workspaces remain unchanged. Validation and coordinator
commits used separate copies. Both evidence checks were current before the
operator checkout was updated to the accepted source.

The second verifier pinned schema inputs in the operator checkout at `50279b8`.
Updating that checkout changed those inputs. Its current freshness check now
reports `Verification contract changed`. The old schema bytes were archived
before the update, and the historical manifest and passing results remain intact.
No successful replay from the changed inputs is claimed. Future operator bundles
should use a separate immutable location before they are pinned.

Local receipts are under `.p6-proof/skills/`: `red-corrected`, `schema-red`,
`green-final`, `core-final`, `regression-final`, and `operator`. The before/after
publication receipts record the freshness change explicitly.

The full behavioral suite and PR publication still use the coordinator. The next
automation slice should connect the independent role stages and full acceptance
gate to a persistent runner. A daemon must drive the durable workflow; keeping
the current single-worker loop alive does not supply the missing stages.
