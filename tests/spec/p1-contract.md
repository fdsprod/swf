# P1 local execution contract

Status: draft. The coordinator freezes this contract after the learning probes pass.

P1 adds one local run path. The P0 CLI, public types, schemas, transition rules, and tests remain unchanged. Application code stays in `src/`. Acceptance code stays in `tests/spec/`.

## CLI and configuration

```text
node dist/cli/main.js run --local <configuration.json> --json
node dist/cli/main.js check --evidence <manifest.json> --json
```

Each command emits exactly one JSON line. A verified local run exits 0. A valid run that cannot verify exits 1. Invalid configuration exits 2 before a worker starts. The contract scaffold exits 3 with `not_implemented`. The evidence check exits 0 for `current` and 1 for `invalid`.

The local configuration has version 1 and these required fields:

- `request`: the unchanged P0 WorkRequest.
- `verification`: the unchanged nonempty P0 VerificationContract. Each required command has a bounded positive timeout; `cwd`, when present, is a relative directory contained in the worktree.
- `repositoryPath`: an existing local Git repository. `request.repository.baseRef` must resolve to a commit before execution.
- `workspaceRoot` and `artifactRoot`: separate absolute directories outside the source checkout. Artifacts must be outside the worker's writable worktree.
- `worker`: trusted launch configuration with `executable`, `prefixArgs`, and positive `timeoutSeconds`.
- `sandboxExecutable`: the native Codex executable used to enforce the selected Windows restriction. This is operator configuration, not a worker-controlled value.
- `commands`: one `{specId, executable, args}` binding for each required command, with no missing, duplicate, or extra IDs. The executable and argument vector run directly; command strings are labels, not shell expressions.
- `allowedPaths`: normalized relative exact file paths or directory prefixes ending in `/`.
- `protectedPaths`: normalized relative file or directory paths that the worker may read but cannot write.
- `blockedReadPaths`: absolute credential file or directory paths denied to worker tool commands. The operator includes delivery credentials and Codex authentication files; the Codex host can authenticate before restricting its tools.
- `verificationInputs`: absolute external file or directory roots. Hash all contained files, including imported helpers, before execution and during evidence checks.

The worker wire response has a strict flat object shape: `{kind:"completed"|"blocked"|"failed",message:string}` with a nonempty message and no unknown properties. The adapter translates this into canonical AgentOutcome and preserves the raw transcript. P1 does not accept human decisions through this wire protocol; P3 adds that capability.

The adapter supplies `exec`, `--json`, and a strict `--output-schema`. It validates the final agent message before a unique terminal `turn.completed`; earlier prose messages are permitted. Malformed JSONL, an error or failed turn, duplicate terminal events, a missing final outcome, and nonzero process exit block completion. A final response file is optional and cannot be required at a path denied to the sandboxed process double. Trusted wrapper `prefixArgs` cannot contain Codex policy flags or override the selected sandbox, approval, output, or configuration settings. Named filesystem permissions give root read access, worktree write access, protected paths read-only access, and credential paths denied access. Worker tools have no network access. All owned descendants of workers and verification commands must stop, including detached children after their parent exits.

The `.git` worktree pointer and shared Git metadata are protected regardless of `protectedPaths`. Inherited user/project Codex configuration cannot add MCP servers, host connectors, or override the selected restriction. Verification commands also run with actual restrictions: they cannot rewrite the pinned verifier bundle, factory evidence, original checkout, or read blocked credentials. Required pinned input hashes must still match before the kernel accepts verification.

The pinned Codex launch passes `--ignore-user-config` and a final explicit `-c mcp_servers={}`. Preflight rejects `.codex/config.toml` in the source project and its project ancestors before worktree creation. The known user Codex home is handled by `--ignore-user-config`; it is not mistaken for project configuration. No unverified feature flag or filesystem-only assumption substitutes for disabling host connectors.

The public `runLocal(configPath, signal?: AbortSignal)` function in `dist/cli/local.js` accepts explicit cancellation. An aborted signal stops the worker process tree, records `cancelled`, and prevents verification. The cancellation acceptance wrapper aborts only after its worker child has started.

Unknown object fields are rejected. Paths cannot contain `..`, use an absolute form where a relative path is required, or escape through a symbolic link or junction. A repository or workspace cannot contain the artifact root. Verification programs are trusted operator inputs outside the writable worktree. The program bytes and configuration are pinned before starting the worker.

The launch executable speaks the Codex noninteractive protocol. Deterministic acceptance doubles use the same adapter protocol and execute under the same actual write restriction. No unrestricted fallback is allowed. The worker may write its worktree except its protected paths. It cannot write factory evidence, the source checkout, the protected verification bundle, or an external sentinel. Its command environment excludes delivery credentials and its tool network access is disabled. Failure to establish this restriction fails the run.

## Run and evidence

The factory creates a distinct detached Git worktree from the resolved base commit. The source checkout and its index remain unchanged. The worker receives the request and the unchanged work contract. A successful process exit is not an AgentOutcome. The adapter must validate a structured final outcome; malformed, absent, ambiguous, or unsuccessful process output cannot manufacture completion.

The factory terminates and reaps the worker and its owned child processes before invoking verification. Timeout and cancellation terminate the owned process tree. An incomplete termination cannot permit verification. The verifier runs its pinned commands itself and records executable, arguments, working directory, termination, exit code when present, stdout, and stderr. A timeout or launch error is an error result. A nonzero command exit is a failed result.

Every successful command result has a factory-created evidence reference. Worker evidence cannot replace command evidence. The existing kernel consumes the independently obtained results and remains the sole execution-state authority. Forbidden edits and content mutations during verification block `VERIFIED`, including mutation by a command that exits zero. Worktree content identity covers tracked files, deletions, and added files; an ignored file cannot silently substitute for pinned verifier input.

`local_run_result` contains the unchanged `graph`, `state`, and `events`, plus `workspace: {path, repositoryPath, baseCommit}` and `evidence: {path, digest}`. The evidence manifest resides outside the worktree. It records the candidate content identity, base commit, attempt identity, frozen contract digest, process records, changed paths, diff artifact, and kernel verdict. Artifact references include digests, and all command output is preserved. This is an immutable observation of one attempt, not a second mutable execution state.

The evidence check recomputes candidate content identity, frozen verification program identity, and required artifact integrity. It returns `{kind:"evidence_check",status:"current",issues:[]}` only when the recorded verdict is verified and all identities still match. Otherwise it returns `status:"invalid"` with nonempty issues. Mutation after verification, changed verifier bytes, missing artifacts, tampered output, and a nonverified recorded verdict all invalidate the check. P1 does not commit, push, create a PR, or promise restart recovery.

Evidence checking assumes a trusted manifest outside the worker write boundary. It checks freshness and integrity; it does not authenticate an operator-rewritten manifest. Durable expected manifest digests arrive with P2. Every local result, including failure, carries a manifest with the canonical execution state as its immutable verdict snapshot.

## Acceptance ownership

BP-1 owns this contract, new public schemas and types, launch stubs, fixture repositories, process doubles, independent command programs, and the cumulative gate runner. PRODUCT-1 owns implementation. The active acceptance bundle is copied to a separate trusted directory and pinned by digest before product work starts. P0 scenarios remain cumulative.

The harness first proves that its fixture can be corrected and independently checked, that its assertions reject a lying worker, and that its process controls observe child survival. The product baseline then returns a well-formed `not_implemented` result so required product scenarios fail behaviorally. Live restriction and Codex proofs are required evidence, not optional skips. Infrastructure failures remain distinct from product failures.
