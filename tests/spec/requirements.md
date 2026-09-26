# P0 acceptance requirements

The independent BP-0 agent owns these scenarios. PRODUCT-0 may read and run them but may not edit the frozen acceptance bundle. These checks cover the deterministic P0 slice only.

| ID | Required observation | Runnable proof |
|---|---|---|
| P0-001 | A normalized request creates exactly one deterministic work unit; both checks must pass, in either result order | `cli.test.mjs`: two pass cases |
| AGT-004 | Worker completion cannot directly mark work verified | Dishonest-worker CLI cases; exhaustive state/action matrix; direct `mark_verified` rejection |
| VER-002 | Factory verification follows worker completion and covers every required check | CLI event order and exact spec IDs; coordinator source review of separate worker and verifier ports |
| P0-002 | Exact result-ID coverage and evidence are required; empty or weakened contracts cannot approve work | CLI result-set and schema cases; kernel gate and invalid-contract cases |
| P0-003 | Unsupported transitions and unresolved-decision bypasses reject; blocked/failed work stops | Full eight-state by five-action matrix, outcome-variant matrix, decision and blocked/failed CLI cases |
| P0-004 | Malformed process inputs fail before worker invocation; output obeys a schema | Invalid-input CLI matrix and frozen output-schema validation of every subprocess response |
| ARC-001 | Kernel cannot import adapter code, including through a contracts barrel | Candidate architecture scan; static/export/dynamic/require/external/computed-load negative controls |
| BOOT-004 | Product cannot weaken the checks used to judge it | External runner checks frozen-file hashes before invoking trusted tools and tests against a separate candidate root |

The kernel matrix includes all P0 states and all supported action tags plus the forbidden `mark_verified` tag. Other roadmap states and execution mechanisms are outside P0. Commands are fixture labels, no repository/network accessibility is tested, and run-level decision identity is deferred until P2/P3.

## Commands and evidence

```powershell
npm.cmd install --ignore-scripts --no-audit --no-fund
node tests/spec/harness/run-gates.mjs
```

For the isolated candidate, set `FACTORY_CANDIDATE_ROOT` to its absolute directory and run the same trusted runner from the verifier checkout. Set `P0_PROOF_DIR` to choose the evidence directory. The runner invokes its own TypeScript executable and explicit test paths; it does not trust candidate npm scripts. It records revisions, runtime version, frozen-bundle digest, commands, exit codes, test totals, and full logs. The candidate must retain byte-identical frozen tests, types, schemas, and toolchain configuration. The coordinator records a clean candidate revision after integration and reruns the gate against that revision.

The sanity suite proves the harness can accept a known-good process fixture and reject deliberate defects. Architecture controls likewise include allowed and forbidden dependency graphs. The initial executable stub compiles, validates against the output schema, and returns `not_implemented` with exit 3. Acceptance red must consist of failed behavioral assertions against that result and the rejecting reducer stub, not missing modules or broken fixtures.

Typecheck, build, sanity, architecture, and cumulative acceptance must all pass for P0. Missing, timed-out, skipped, cancelled, or todo checks block acceptance. Full red and green artifacts live under `.p0-proof/`; the committed phase report references their digests and counts. The coordinator reviews actual port wiring in addition to observable events; P0 has no sandbox claim.
