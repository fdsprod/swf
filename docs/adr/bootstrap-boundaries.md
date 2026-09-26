# Bootstrap boundaries

Status: P0 implementation decision.

P0 proves that an agent completion claim cannot bypass factory verification. It uses one request, one unit, one attempt, and in-memory state. The CLI accepts a validated fixture, the kernel invokes a scripted worker, and a separate scripted verifier provides results. Only the transition reducer selects the next execution state.

## One package with module boundaries

Use one npm package and a flat `src` tree instead of the conceptual specification's separate packages. `contracts` contains types and JSON schemas. `kernel` owns domain state and orchestration. `adapters` contains the scripted port implementations. `cli` owns file input, command parsing, composition, and process output. Kernel imports stay within kernel and contracts. This keeps the first executable small while retaining boundaries that later adapters need.

The worker and verifier use separate Promise-returning ports. The kernel passes copies of its unit and verification specifications across these ports. A worker cannot mutate the authoritative contract through a shared reference. Scripted adapters select no transitions and receive no delivery authority.

## State and evidence

The existing discriminated state union passes the data-shape checks. A pending decision appears only on `WAITING_FOR_DECISION`, verification results accompany `VERIFIED` or `REPAIR_READY`, and failure requires a reason. Delivery and CI remain separate future concerns. Event history records observed calls and accepted transitions. It is an in-memory record, not a second state authority.

Validate fixture data against the canonical JSON schema with Ajv before graph creation. Check unique verification IDs separately because JSON Schema item uniqueness does not express uniqueness of one property. The pure reducer repeats contract checks for direct callers. It checks exact result coverage, valid statuses and evidence, and nonempty evidence for each pass. Errors block verification even when another result is repairable. A worker's completion claim only allows `RUNNING` to become `VERIFYING`.

P0 does not bind evidence to a candidate Git tree or contract digest. P1 introduces those identities with real command execution. P0 checks a decision's unit ID. Durable run identity and human decision authority come later. No P0 event or state asserts delivery.

## Bootstrap order and independent checks

Bring the minimum schemas and architecture checks forward into P0. Later runtime code must not depend on checks that arrive after it. Move bounded repair before self-hosting so the first useful factory can recover from failed implementation. Treat the first useful self-hosted PRs as a milestone separate from the larger reliability gate needed for advanced features. These decisions refine implementation order without changing the source specifications.

Each phase has a separate backpressure agent and product agent. The backpressure agent writes checks and records meaningful red evidence before implementation. The coordinator pins the contract, fixtures, toolchain, test bundle, and check command. The product agent may read and run the checks but cannot change them. The backpressure agent reruns the pinned checks against the candidate revision before phase acceptance.

The active acceptance bundle stays outside the product worktree. The runner checks its digest and frozen files independently of candidate npm scripts. Git worktrees separate edits but are not a security sandbox. P1 must establish and test execution restrictions before a real coding agent gets access to a target repository.

Durability, real processes, command execution, decision resume, repair, delivery, CI, parallel scheduling, and semantic supervision remain outside P0. The useful result is a runnable deterministic contract for the next slice.
