# P1 requirement map

P0 remains cumulative. Run the pinned `node tests/spec/p1/harness/run-gates.mjs` with `FACTORY_CANDIDATE_ROOT` set to the product checkout. The runner records the frozen bundle, source digests, exact commands, revisions, logs, and test totals. Unavailable, skipped, cancelled, or timed-out gates block acceptance.

| ID | Obligation | Executable proof |
|---|---|---|
| P1-001 | Isolated Git worktree, original checkout unchanged, factory command, exact evidence | `scenarios/local.test.mjs` successful edit |
| P1-002 / AGT-004 | Completion claim cannot approve wrong behavior | Dishonest worker exports 0, independent verifier fails |
| P1-003 | Closed valid Codex outcome, process success does not imply completion | Missing/malformed outcome, malformed JSONL, duplicate terminal, failed turn, nonzero, blocked, failed, intermediate prose cases |
| P1-004 / VER-002 | Commands execute independently with bounded termination | Command nonzero and timeout |
| P1-005 | Only allowed product paths can pass | README edit outside `src/` |
| P1-006 / BOOT-004 | Candidate test changes cannot manufacture acceptance | Protected candidate test write plus wrong product |
| P1-007 | Actual worker write/read restrictions and no inherited delivery environment | Positive edit with denied external/source/protected/Git-pointer/Git-metadata writes and credential read |
| P1-008 / BOOT-001 | Content cannot change during verification | Passing command mutates candidate |
| P1-009 / BOOT-001 | Evidence refers to exact candidate, verification programs, and artifacts | Modified/added/deleted source; changed verifier/helper; tampered/missing command output |
| P1-010 | Owned worker and verifier descendants stop | Timeout child, detached child after worker exit, detached verifier child; OS process identity and heartbeat checks |
| P1-011 | Reject invalid configuration before invocation | Schema, binding, path, overlap, policy injection, base revision, timeout cases |
| P1-012 | Path aliases cannot escape restrictions | Directory junction to source repository |
| P1-013 | Candidate code in verifier cannot rewrite trusted judge or factory state | Actual denied verifier writes/read |
| P1-014 | Explicit cancellation stops owned descendants | AbortSignal after child startup, no verifier invocation |
| P1-015 | Project/user configuration cannot add host connector authority | Reject project/ancestor config; double asserts ignored user config and explicit empty MCP table |
| P1-LIVE | Real Codex can implement the fixture behavior | `scenarios/live.test.mjs`, model process plus independent assertion |
| P1-SANITY | Harness detects known bad work and accepts corrected work | `harness/sanity.test.mjs`, independent verifier and double wire controls |
| P1-NATIVE | Selected Windows restriction works in this environment | Pinned `tests/learning/p1/sandbox-probe.mjs`, copied Node outside worktree |
| ARC-001 | Kernel stays independent of adapters | Cumulative P0 architecture suite |

The canonical `LocalEvidence.verdict` is an immutable snapshot of the kernel state. It cannot mix a failed state with successful results. The manifest records observed process facts, while `check` recomputes freshness rather than storing another eligibility flag. P1 trusts the manifest's factory-owned location; P2 will persist its expected digest and run ownership.

The root coordinator reviews source wiring and the recorded runtime research for host-level Codex configuration boundaries. A passing filesystem sandbox probe alone does not prove MCP or other host connectors are disabled.
