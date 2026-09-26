# First live repository runs

Date: 2026-09-26. Repository: [fdsprod/swf](https://github.com/fdsprod/swf).

The factory generated a repair for its first real delivery blocker. The repair is
in [PR #7](https://github.com/fdsprod/swf/pull/7), awaiting human review and merge.
The complete GitHub delivery and self-hosting milestones are not yet accepted.

## Work and current state

| Work | Result |
| --- | --- |
| [#1: Human decision and restart](https://github.com/fdsprod/swf/issues/1) | The factory published one real question, stopped after publication, and resumed without duplicating it. The actual human answer is still pending. |
| [#2: Bootstrap CI and PR delivery](https://github.com/fdsprod/swf/issues/2) | The actual Codex worker wrote the requested workflow. A Unicode process-argument bug stopped the factory before verification and delivery. Preserve this failed run and retry after the repair is reviewed. |
| [#3: P6 inspect](https://github.com/fdsprod/swf/issues/3) | Independent contract and tests prepared. All 16 feature scenarios fail meaningfully on the previous runner; three harness sanity checks pass. No product implementation. |
| [#4: P6 explain](https://github.com/fdsprod/swf/issues/4) | Written up; depends on inspect acceptance and promotion. |
| [#5: Missing sandbox deny targets](https://github.com/fdsprod/swf/issues/5) | A disposable probe confirmed that a nonexistent file-shaped deny target becomes a directory. Live configuration now uses existing targets. Product preflight repair remains open. |
| [#6: Unicode process arguments](https://github.com/fdsprod/swf/issues/6) | The factory's local execution path generated the one-line repair in PR #7. Independent tests passed. |

## Independent checks and real authority

The CI workflow's separate backpressure author committed its contract and semantic
YAML verifier before the worker ran. Twenty sanity checks passed; the absent
workflow failed the verifier. Acceptance revision: `da41859`.

Before the real worker launch, credential probes compared the factory context
with both native worker and verification sandbox policies. The factory could
access its GitHub credential. Restricted processes could not read credential
files, obtain a credential through `gh`, or read the two real GitHub credential
slots through the Windows credential API. Probe output contains only booleans and
error numbers. No credential values or hashes were retained.

The first sandbox setup probe created empty directories at nonexistent deny
targets, including the repository's `.codex/config.toml`. The user noticed that
path. The coordinator removed only empty directories tied to the probe, preserved
the existing user-level config file, and corrected the concrete configuration.
An independent temporary-path probe reproduced the behavior for issue #5.

## Factory-authored Unicode repair

The failed GitHub run is `2cc8a91b-9456-4436-ab8c-b582461fcf89`, on base `da41859`.
It remains failed. Its state, source output, and evidence were not patched.

Independent regression tests were committed as `86bf96f` before implementation.
All three failed on stable runner `58edb2d`: exact Unicode arguments, a Unicode
working directory, and P5 delivery with an unchanged Unicode base filename.

The same stable runner then used its durable local path to generate the repair.
Run `053ae1d1-ef9d-4ad1-a239-0800ced06d1d` used base `86bf96f` and could change only
`src/adapters/windows-job.ts`. Its pinned external verifier performed a complete
in-process TypeScript typecheck inside the native sandbox. The generated change
reads the process configuration explicitly as UTF-8.

The coordinator built that exact output. A separate backpressure agent checked
the real process and delivery behavior outside the worker sandbox.

| Validation | Result |
| --- | --- |
| Build, typecheck, architecture | Passed |
| Core scenarios | 133 passed |
| Core harness sanity | 19 passed |
| Independent Unicode, process cleanup, restart, checkout checks | 13 passed, no failures, skips, or cancellations |
| Native sandbox probe | Passed |

Source SHA-256 stayed
`507bf1f0c87a7598ffb5b01201f49fc2ac2fa7a6a1fff3ad98e21114307fdbc4`.
The coordinator archived the temporary `node_modules` and `dist` directories
created for host-side validation. All 185 recorded candidate files remained
unchanged, and the original evidence check returned `current` afterward.
No product source or verification result was manually patched.

The coordinator committed and published the generated change as `02f0154`.
That commit advanced the workspace HEAD. A later freshness check therefore
reported `Workspace base changed`; the evidence was current immediately before
the coordinator commit. The recorded source bytes and historical evidence remain
unchanged. No successful continuation from the committed workspace is claimed.
This is local factory generation plus independent acceptance and coordinator PR
publication. It is not a completed P5 HTTPS delivery or P6 self-hosting proof.
The complete 407-case cumulative gate was not rerun for this one-line repair;
the table above records its actual validation scope. CI remains pending in #2.

## Retained local evidence and next steps

Evidence is retained locally under these ignored paths:

- `.p5-proof/live-operator/`: configuration, process receipts, credential probes,
  failed CI run, successful local generation, and the pending human decision.
- `.p5-proof/unicode-process-red/` and `.p5-proof/unicode-process-independent/`:
  independent red/green reports, exact source and bundle hashes, and logs.
- `.p5-proof/deny-path-learning/`: isolated reproduction for issue #5.
- `.p6-proof/inspect-baseline-red/`: P6 contract and meaningful baseline failures.

The [bootstrap plan](../bootstrap-plan.md) requires human review and merge before
promoting the new factory binary. After that review, build a separate stable
runner and retry #2 in a fresh store. Complete #1 with the actual human answer.
Retain the required live manifests before accepting the live baseline or claiming
P6 self-hosting. P6 must keep its independent verifier outside worker authority.
