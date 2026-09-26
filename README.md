# Software factory bootstrap

The factory runs one work request through a deterministic kernel. It runs Codex in a restricted Git worktree, executes separate verification commands, and saves evidence for the exact candidate. Only the kernel can mark the unit `VERIFIED`. P2 adds durable history and restart recovery. P0's offline fixtures remain available.

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

Exit code 1 also covers failed verification and a pending decision. Invalid command usage or fixture data returns `input_error`, an empty event list, and exit code 2. Every required check needs exactly one result. Passed results need evidence. Missing, duplicate, unknown, or invalid results cannot approve a unit.

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

Run the cumulative acceptance gate:

```powershell
node tests/spec/p2/harness/run-gates.mjs
```

This includes process-kill recovery, concurrent ownership, evidence checks, a live Codex call, actual sandbox probes, P0/P1 tests, typecheck, build, and architecture checks. Set `P1_CODEX_EXE` if the installed native executable differs from the harness default. Logs and the frozen bundle digest go under `.p2-proof/latest/`. The coordinator uses this trusted runner outside the product worktree with `FACTORY_CANDIDATE_ROOT` and `P2_PROOF_DIR`. The offline P0 gate remains `node tests/spec/harness/run-gates.mjs`.

The project is one npm package. `src/contracts` owns protocol types, schemas, and validation. `src/kernel` owns transitions and orchestration through separate worker and verifier ports. `src/adapters` supplies process, filesystem, sandbox, and scripted adapters. `src/cli` composes these modules. `tests/spec` contains the independently authored acceptance bundle.

Commands in P0 fixtures remain opaque labels. Real verification commands use an executable and argument vector. Durable recovery does not yet resolve human decisions, repair failed verification, or create PRs. These capabilities follow in P3 through P5.

See the [P2 execution report](docs/phase-reports/p2.md), [P1 acceptance report](docs/phase-reports/p1.md), [P0 acceptance report](docs/phase-reports/p0.md), [bootstrap plan](docs/bootstrap-plan.md), and [execution boundaries](docs/adr/local-execution.md).
