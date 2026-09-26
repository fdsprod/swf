# P4 backpressure handoff

BP owns the public contract additions and `tests/spec/p4/**`. Product implementation is deliberately absent. Root owns integration and commits.

The preparation branch starts on P3's public scaffold and includes P3 authority/evidence corrections. Before freeze, integrate the exact prior P3 candidate after an independent pass of every runnable gate. Required live proof may remain explicitly blocked, so that prior baseline is not accepted. Preserve its cumulative report. Record definitive committed red with the focused P4 suite plus typecheck/build, and verify source/bundle stability. Do not weaken earlier checks or repeat the expensive prior cumulative suite solely to establish new red.

Prepare with `C:/nvm4w/nodejs/node.exe tests/spec/p4/harness/run-gates.mjs --preparation`. Scaffold failures remain preparation only. Final acceptance omits `--preparation`, runs the independent full cumulative gate, and requires P3's reviewed live proof. Missing live evidence remains blocked, never skipped or passed. The runner records proof under `.p4-proof` unless `P4_PROOF_DIR` is set.

Public additions: optional immutable repair configuration, `RepairReserved`, optional repair projection history, repair exhaustion reason, and exact captured command output in fresh worker context. There is no new CLI verb, workflow engine or implementation stub beyond the inherited runnable scaffold.
