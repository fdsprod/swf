# P5 backpressure handoff

Root owns commits and integration. BP owns public delivery contracts/schemas, the returning `githubCommand` stub and `tests/spec/p5/**`. Root supplied the small `run --github` parsing branch in `src/cli/main.ts`; include it with this preparation. No delivery business implementation is present.

The branch includes BP-only P3/P4 preparation and correction commits, plus isolated Git/CI learning references. Integrate only the new P5 scoped changes onto the exact prior P4 candidate after independent runnable-green validation. Required live may remain explicitly blocked, so that baseline is not accepted. Retain its prior cumulative report.

Preparation command: `C:/nvm4w/nodejs/node.exe tests/spec/p5/harness/run-gates.mjs --preparation`. Typecheck/build and sanity must pass. Stub failures are not definitive red. For implementation handoff, run focused committed P5 red against the integrated prior candidate, typecheck/build, and before/after source/bundle checks. This does not require rerunning every expensive earlier gate solely to establish red.

Final independent exact-candidate acceptance runs the full P5 runner without `--preparation`, including P4/P3/P2/P1/P0 and required live evidence. No skip, missing result or blocked live proof can produce acceptance. Reports retain candidate/trusted revisions, dirty status, bundle digest, source hashes, command lines and logs.

P5 fault observation waits at most 90 seconds, matching the existing CLI bound. The held candidate `2bd27c338f14e2dde9cbd29a412aa1efb57e645cb14178a005660dbe9246cde6` reached `PushConfirmed` at 22,435 ms and the `PrCreated` fault marker at 26,274 ms. Its retained diagnostic is `.p5-proof/product-diagnosis/late-fault.json`. The inherited P2 20-second observer could reject normal progress through these later P5 effects. The P5 observer retains early-exit, marker identity and owned-process cleanup checks. Earlier-phase helpers, the 90-second CLI bound and the 30-second push-hook release bound are unchanged.

The P5 acceptance process has a 60-minute aggregate cap. The measured 64-case run took 27 minutes 41 seconds even though eleven late fault cases stopped at their old observation deadline. Completing their resume checks and the two added checkout cases exceeds the former 30-minute allowance. This cap covers all 66 sequential cases, including multiple CLI processes per recovery case. It does not change behavioral assertions, individual command limits, mandatory live checks or the requirement for zero skipped tests.

Public additions are `delivery.ts`, GitHub input and delivery snapshot schemas, grouped intake/delivery/CI projection, additive facts/errors, and the public GitHub CLI stub. The original local path remains unchanged. Review source/target/base equality, credential handling, checkout representation and historical artifact checks before freeze.
