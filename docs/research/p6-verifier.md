# P6 prepared-fixture verifier feasibility

Observed on Windows with Node 22.22.3 and the installed native Codex sandbox. This is dependency learning, not P6 acceptance. No product source was read or changed, and the frozen inspect suite was not changed.

The question was whether fixture setup could run on the trusted host before the factory worker, leaving only compilation and read-only CLI assertions inside the restricted verifier. The existing full CLI fixtures create Windows job supervisors through PowerShell `Add-Type`; that setup cannot be assumed to work under constrained language. The proposed split keeps that setup outside without weakening worker restrictions.

## Observations

Two disposable probes used the exact P5 baseline `58edb2d66227db49b4de4bce338cf2befd40ba60` (source digest `859a11b889ea6fab6234cced6d08862cc1b368ea33338ae93795fdbe9c5d837b`). The trusted host prepared a real durable fixture using the baseline CLI. One fixture was VERIFIED; the other held an actual factory at the committed `AttemptReserved` boundary while the sandboxed check ran.

Inside a network-disabled named native sandbox:

- Writes to the external pinned bundle and prepared fixture store failed with `EPERM`.
- The trusted verifier performed a full in-process TypeScript check and emitted 29 source files into a temporary directory inside the candidate directory. External trusted `typeRoots` and the Ajv declaration path resolved the types.
- It copied the required trusted runtime dependency directories into that temporary output and launched the compiled candidate's read-only `status` CLI as a Node child. The complete result matched the host's pinned facts for both VERIFIED and active-owner fixtures. The read-only CLI path did not need nested Windows job setup.
- The P5 `inspect` command still failed as absent, as expected. A deliberately wrong budget expectation was also rejected by the independent assertion.
- It removed temporary output before returning. Full candidate-file snapshots, all prepared fixture bytes, the bundle and the protected sentinel were unchanged. The active fixture owner remained alive during the check and was stopped through its retained owned handle afterward.

The candidate directory came from `git archive` of the baseline, not a new real self-hosted worktree. The probe used the existing `status` command as the read-only execution control because `inspect` is not implemented. These results establish the narrow orchestration mechanism; they do not prove all inspect semantics, the eventual candidate binary, actual factory verifier integration, or P6 self-hosting.

## Retained evidence

The ignored operator research is retained as documentation:

- `.p6-proof/learning-verifier/probe.mjs`: host fixture preparation and native sandbox invocation.
- `.p6-proof/learning-verifier/sandbox-check.mjs`: restricted compilation, read-only child execution, negative controls and cleanup.
- `.p6-proof/learning-verifier/latest.json`: VERIFIED fixture observation, root `C:/Users/fdspr/AppData/Local/Temp/swf-p6-verifier-4PSUWh`.
- `.p6-proof/learning-verifier/active.json`: active-owner observation, root `C:/Users/fdspr/AppData/Local/Temp/swf-p6-verifier-p4rhLx`.

Each retained root contains its report, trusted input, candidate directory and fixture-root reference. The probes made no remote requests, read no credential values, and changed no global configuration. Permission targets existed before invocation. No execution-policy override was used.

## Required preparation before P6 execution

The committed 16 inspect scenarios still prepare fixtures inside their harness. They have **not** been refactored into host preparation and restricted assertion phases. Preserve their assertions and baseline-red evidence when doing that work:

1. The independent host prepares the same local, interrupted, decision, repair, delivery, CI and deliberately damaged states. It derives expected observations from pinned public facts, then seals the corpus and acceptance code as read-only verification inputs.
2. Cases that currently observe two states need separately retained committed snapshots and artifacts. Do not mutate a sealed fixture to advance it during candidate verification. Active-owner cases require a bounded host controller that retains and finally cleans up its exact process handles.
3. The restricted verifier compiles the candidate once into owned temporary output, runs the frozen JSON/human/error assertions against every prepared case, and removes output before returning. Preserve missing-store, malformed-CLI and current/historical corruption checks. It must not silently omit the active-owner or no-side-effect assertions.
4. The host checks the complete prepared corpus and bundle before/after. Bind the result to the candidate and bundle digests. Repeat the existing meaningful red on P5, then candidate green and full independent cumulative verification.

This is a small prepare/assert split, not a new workflow engine. An in-process typecheck plus separately run host tests remains a bootstrap workaround until the complete frozen semantic assertion path is integrated and observed. Human merge/live-baseline prerequisites and the separate two-issue P6 proof remain unchanged.
