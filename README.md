# Software factory bootstrap

P0 is an offline CLI that runs one work request through a deterministic kernel. A scripted worker claims an outcome. A separate scripted verifier supplies check results. Only the kernel can mark the unit `VERIFIED`.

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

Run the complete local acceptance gate:

```powershell
node tests/spec/harness/run-gates.mjs
```

This runs typecheck, build, harness sanity checks, architecture checks, and acceptance scenarios. It records logs and a bundle digest under `.p0-proof/latest/`. During implementation, the coordinator runs a pinned copy of this harness outside the product worktree and supplies `FACTORY_CANDIDATE_ROOT` and `P0_PROOF_DIR`.

The project is one npm package. `src/contracts` owns protocol types, schemas, and validation. `src/kernel` owns transitions and orchestration through separate asynchronous worker and verifier ports. `src/adapters` supplies deterministic scripts. `src/cli` reads fixture files and composes these modules. `tests/spec` contains the independently authored acceptance bundle.

Commands in fixtures are opaque labels. P0 does not execute commands, invoke Codex, edit a repository, persist runs, resume decisions, or create PRs. All state and events last for one process. The next phase adds a real worktree, Codex CLI, and factory-owned command verification.

See the [bootstrap plan](docs/bootstrap-plan.md), [public P0 contract](tests/spec/p0-contract.md), and [bootstrap boundaries ADR](docs/adr/bootstrap-boundaries.md).
