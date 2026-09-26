# Software factory bootstrap

The factory runs one work request in a restricted Git worktree. Separate verification commands check the exact candidate. Durable history supports restart recovery, human decisions, and bounded local repair. P5 adds GitHub issue intake, one verified commit, pull request delivery, and required CI checks. P5 validation is in progress. Required real GitHub proof is still pending.

Use Node.js 22.22.3 or later and npm. From the repository root:

```powershell
npm.cmd ci
npm.cmd run build
node dist/cli/main.js run --fixture examples/pass.json --json
```

The pass example returns one JSON object with a one-unit graph, the final state, and ordered events. Its state is `VERIFIED` and its exit code is 0.

To reject a false worker completion claim:

```powershell
node dist/cli/main.js run --fixture examples/dishonest-worker.json --json
```

This example returns `REPAIR_READY` and exits with code 1. The worker's evidence cannot replace the verifier's failed result. P0 stops here. Repair execution comes in P4.

For offline fixtures, exit code 1 also covers failed verification and a pending decision. Invalid command usage or fixture data returns `input_error`, an empty event list, and exit code 2. Every required check needs exactly one result. Passed results need evidence. Missing, duplicate, unknown, or invalid results cannot approve a unit.

For a real run, create a configuration from the [P1 contract](tests/spec/p1-contract.md). Set absolute paths for the repository, workspace and artifact directories, native Codex executable, trusted verification programs, and protected credential paths. Then run:

```powershell
node dist/cli/main.js run --local your-config.json --json
node dist/cli/main.js check --evidence <returned-evidence-path> --json
```

The proven runtime is Windows with Node 22.22.3 and Codex CLI 0.157.1. Codex must be authenticated and its native sandbox must work. Configuration does not permit an unrestricted fallback. A verified run exits 0. Failed work exits 1. Invalid input exits 2. `check` exits 1 when the candidate, verification inputs, or required artifacts no longer match.

To retain a run across process exits, add a store directory outside the repository and worker workspace:

```powershell
node dist/cli/main.js run --local your-config.json --store C:/factory-state/run-1 --json
node dist/cli/main.js resume --store C:/factory-state/run-1 --json
node dist/cli/main.js status --store C:/factory-state/run-1 --json
```

The store pins the configuration, base commit, and total worker-start budget. The default budget is five. Set `--max-starts` when creating the run to choose a different limit. Interrupted attempts consume this budget. Status reads committed history without starting work. Resume checks the saved artifacts and current candidate before reusing completed work. See the [P2 contract](tests/spec/p2-contract.md) for recovery errors and fault-test boundaries.

To enable human decisions, configure `decisions` with a pinned GitHub CLI executable and the authorized resolver's numeric ID and login. The request must identify the matching GitHub repository and issue. The factory publishes a question and exits 0 while waiting. Run `resume` after the resolver posts the specified JSON answer. Conflicting answers stop continuation. The answer starts a fresh worker and cannot directly approve its work. See the [P3 contract](tests/spec/p3-contract.md).

To enable bounded repair in a durable local run, add `"repair": { "kind": "local_verification", "maxRepairs": 1 }` to the configuration. The default repair limit is one when the option is present. The repair worker receives the original failed verification and exact command output. It runs under the same checks and the separate total worker-start limit. Omitting `repair` preserves the existing stop at `REPAIR_READY`. See the [P4 contract](tests/spec/p4-contract.md).

For GitHub intake and delivery, create a configuration from the [P5 contract](tests/spec/p5-contract.md). Set the issue, base branch, trusted runtime and verification commands, Git and GitHub CLI programs, commit identity, transport, and required check names with their provider app IDs. The local base must match the observed target base. Keep the store outside the source repository and worker workspace.

```powershell
node dist/cli/main.js run --github github-config.json --store C:/factory-state/github-run-1 --json
node dist/cli/main.js resume --store C:/factory-state/github-run-1 --json
node dist/cli/main.js status --store C:/factory-state/github-run-1 --json
```

The first run snapshots the issue and configuration. Resume uses that saved request, checks the evidence, and continues incomplete work. Status reads the last committed state without network calls or new work. Delivery requires a nonempty allowed change and current verification for its exact bytes. The factory creates a deterministic commit on the original base, creates a branch without overwriting a different ref, and creates or reconciles one pull request. The explicit local bare transport supports offline execution and tests.

Local execution, delivery, and CI have separate states. `VERIFIED` means the local candidate passed its checks. A GitHub run succeeds only when its pull request is open or merged and every required check passes for the exact delivered head and provider. Pending, failed, ambiguous, or stale CI exits 1. A closed, unmerged pull request also exits 1. The exit-0 wait for a human decision is unchanged. The factory does not merge pull requests or repair CI failures.

Run the cumulative P5 acceptance gate:

```powershell
node tests/spec/p5/harness/run-gates.mjs
```

This includes delivery and CI recovery, all earlier acceptance tests, a live Codex call, native sandbox probes, typecheck, build, and architecture checks. Set `P1_CODEX_EXE` if the installed native executable differs from the harness default. Logs and the frozen bundle digest go under `.p5-proof/latest/`. The coordinator uses this trusted runner outside the product worktree with `FACTORY_CANDIDATE_ROOT` and `P5_PROOF_DIR`. Missing required [live P3 evidence](tests/spec/p3/LIVE.md) or [live P5 evidence](tests/spec/p5/LIVE.md) makes the gate fail even when all local checks pass. The offline P0 gate remains `node tests/spec/harness/run-gates.mjs`.

The project is one npm package. `src/contracts` owns protocol types, schemas, and validation. `src/kernel` owns transitions and orchestration through separate worker and verifier ports. `src/adapters` supplies process, filesystem, sandbox, and scripted adapters. `src/cli` composes these modules. `tests/spec` contains the independently authored acceptance bundle.

Commands in P0 fixtures remain opaque labels. Real verification commands use an executable and argument vector.

See the [P5 execution report](docs/phase-reports/p5.md), [P4 local verification report](docs/phase-reports/p4.md), [P3 local verification report](docs/phase-reports/p3.md), [P2 execution report](docs/phase-reports/p2.md), [P1 acceptance report](docs/phase-reports/p1.md), [P0 acceptance report](docs/phase-reports/p0.md), [bootstrap plan](docs/bootstrap-plan.md), and [execution boundaries](docs/adr/local-execution.md).
