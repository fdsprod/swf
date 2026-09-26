# P4 backpressure handoff

BP owns the public contract additions and `tests/spec/p4/**`. Product implementation is deliberately absent. Root owns integration and commits.

The preparation branch starts on P3's public scaffold and includes P3 authority/evidence corrections. Before freeze, integrate the accepted P3 product and cumulative test changes, rerun this bundle, and record meaningful red against that exact baseline. Do not weaken any earlier checks.

Prepare with `C:/nvm4w/nodejs/node.exe tests/spec/p4/harness/run-gates.mjs --preparation`. Final acceptance omits `--preparation` and requires P3's reviewed live proof. The runner records proof under `.p4-proof` unless `P4_PROOF_DIR` is set.

Public additions: optional immutable repair configuration, `RepairReserved`, optional repair projection history, repair exhaustion reason, and exact captured command output in fresh worker context. There is no new CLI verb, workflow engine or implementation stub beyond the inherited runnable scaffold.
