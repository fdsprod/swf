# Local execution and recovery boundaries

Status: P1 and P2 accepted. Later phase reports track delivery and live proof.

The bootstrap targets one Windows operator and approved local repositories. A
Git worktree separates changes. It does not restrict access by itself. The
factory must establish process and filesystem restrictions before it starts a
worker. An unavailable restriction is a failed run.

## Worker restrictions

Use the installed native Codex executable with an explicit named permission
profile. The profile permits writes in the worktree, protects selected paths,
and disables tool network access. Exclude shared Git metadata, external
verification inputs, and factory artifacts from writable roots. Remove delivery
credentials from the command environment and deny tool reads of configured
credential paths. The trusted Codex host still needs its own authentication.

The P1 learning probes found that the default workspace-write profile also
permits temporary-directory writes. That profile does not establish the required
boundary. The named profile must pass both an allowed edit and denied access
probes in the same run. Protecting a path in the prompt is insufficient.

The operator owns executable paths and launch configuration. A configurable
executable is not a promise to contain an arbitrary hostile program. Deterministic
worker doubles still run under the actual selected restriction. No unrestricted
fallback may substitute for a failed sandbox test.

## Process lifetime

Create worker and verifier processes inside Windows Job Objects. Assign each
process before it can execute. Closing the job must stop its descendants,
including detached children whose immediate parent has already exited. Verify
termination before accepting a candidate snapshot or launching the next stage.

The learning probe showed that `taskkill /T` cannot find such descendants after
the parent exits. A timeout on the immediate process alone therefore cannot
establish a stable candidate. P2 acceptance also checks termination after the
factory process itself dies.

## Durable ownership

Use short SQLite transactions for events and their current projection. Roll back
explicitly on every statement failure. Configure durability and foreign-key
settings on each connection. Retain a process-lifetime transaction in a separate
owner-lock database so an event commit does not release ownership.

The SQLite owner lock proves exclusive access to the store. It does not prove an
old worker has stopped. Recovery must establish that separately before dispatch.
Persist an attempt and consume its start allowance before launch. Retain this
conservative consumption when a crash leaves dispatch uncertain.

See the [SQLite observations](../research/p2-sqlite.md). The learning scripts are
retained under `tests/learning/`. Separate acceptance tests must prove that the
factory applies these mechanisms correctly.

## GitHub delivery boundary

P5 uses a factory-owned Git directory and index for candidate conversion and
delivery. Initial checkout also excludes configured hooks and inherited
attributes. Filtered base reads and diff capture use the same controlled
policy. Delivery requires checkout bytes and Git modes to match the verified
candidate. Source HEAD and its ordinary index stay unchanged.

The factory uses the pinned target and a create-only push. It retains intent
before remote effects and reconciles uncertain results on resume. The worker
does not receive delivery credentials. Local Git probes and acceptance tests
do not replace the required real HTTPS credential and recovery exercise. See
the [P5 report](../phase-reports/p5.md) for its current proof status.
