# P5 backpressure handoff

Root owns commits and integration. BP owns public delivery contracts/schemas, the returning `githubCommand` stub and `tests/spec/p5/**`. Root supplied the small `run --github` parsing branch in `src/cli/main.ts`; include it with this preparation. No delivery business implementation is present.

The branch includes BP-only P3/P4 preparation and correction commits, plus isolated Git/CI learning references. Integrate only the new P5 scoped changes onto the exact prior P4 candidate after independent runnable-green validation. Required live may remain explicitly blocked, so that baseline is not accepted. Retain its prior cumulative report.

Preparation command: `C:/nvm4w/nodejs/node.exe tests/spec/p5/harness/run-gates.mjs --preparation`. Typecheck/build and sanity must pass. Stub failures are not definitive red. For implementation handoff, run focused committed P5 red against the integrated prior candidate, typecheck/build, and before/after source/bundle checks. This does not require rerunning every expensive earlier gate solely to establish red.

Final independent exact-candidate acceptance runs the full P5 runner without `--preparation`, including P4/P3/P2/P1/P0 and required live evidence. No skip, missing result or blocked live proof can produce acceptance. Reports retain candidate/trusted revisions, dirty status, bundle digest, source hashes, command lines and logs.

Public additions are `delivery.ts`, GitHub input and delivery snapshot schemas, grouped intake/delivery/CI projection, additive facts/errors, and the public GitHub CLI stub. The original local path remains unchanged. Review source/target/base equality, credential handling, checkout representation and historical artifact checks before freeze.
