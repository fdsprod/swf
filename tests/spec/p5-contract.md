# P5 issue intake, delivery and CI

Status: independent contract and test preparation. There is no P5 product implementation. Preserve the accepted P0-P2 behavior and the independently validated P3/P4 local behavior. Required live gates remain mandatory; an unavailable live prerequisite means the baseline is not accepted. It can still support authorized local implementation after the coordinator records exact-candidate runnable-green evidence and definitive committed new-phase red.

## CLI and immutable input

Add `run --github <config.json> --store <directory> [--max-starts N] --json`. Keep `resume` and read-only `status`. The new `GitHubRunConfig` has an issue locator, base branch, trusted constraints/acceptance criteria, runtime settings, pinned GitHub and Git programs, optional decision resolver and repair configuration, and required delivery policy. There is no second WorkRequest in the input. Local mode retains its existing output and behavior and does not deliver.

Every API call uses `gh api --hostname github.com`, explicit methods, argv arrays, bounded execution and JSON stdin for mutations. Pin the executable bytes of both the GitHub program and Git program in immutable `contract.programs`, even when decisions are absent. Changing configuration on repeat run is `config_mismatch`; changed pinned bytes on resume are `artifact_invalid`. Object key order and JSON formatting do not change parsed configuration identity. Arrays retain order.

Resolve the repository's numeric ID and canonical owner/name/URL, the issue's numeric ID/number/URL, and the target base branch SHA. The initial local base must equal that observed target SHA; unrelated ancestry cannot enter the PR without verification. Reject mismatched identities, PR-shaped issue payloads, an empty title, and unequal initial bases as `input_error` before worker dispatch. API failures and malformed transport responses are `github_gateway_error`.

The first `RunCreated` snapshots the original parsed input and raw repository, issue and base responses in optional `intake`. Normalize the request exactly: ID `github:<repositoryId>:issue:<issueId>`; source provider `github`, decimal issue number and issue URL; repository canonical HTTPS URL plus `.git` and configured base branch; objective `title + "\n\n" + (body ?? "")`; trusted input constraints and acceptance criteria; metadata `{githubRepositoryId,githubIssueId}`. Generate LocalConfig from the runtime settings, this request, and configured repair/decisions. A decision adapter uses the same pinned gateway and configured resolver. These are an explicit input snapshot and normalized executable contract, not competing authority. Resume/repeat must not refetch issue text to replace the request.

Transport is explicit policy: `github_https` resolves to the canonical repository `.git` URL; `local_bare` resolves to a canonical existing bare-directory path. Store that resolved transport. Never follow a mutable named remote or URL rewrite from worker/source configuration. The local bare transport runs the same delivery path for offline use and tests; it is not a test-only bypass. Recheck numeric repository identity before remote effects. Later target base advancement is allowed and recorded in PR observations; the original commit parent, repository ID and base branch stay fixed.

## State and delivery eligibility

Projection is a base plus one exclusive feature group: legacy runs have none of `intake`, `delivery`, `ci`; GitHub runs have all three. Initialize delivery as `unplanned` and CI as `unobserved`. Both TypeScript and JSON schema reject partial groups. Delivery and CI have separate tagged lifecycles. Local execution remains `VERIFIED` when delivery or CI fails.

Before commit, push or PR dispatch, require current complete verification for the exact candidate, a nonempty allowed diff, the pinned contract/base/programs, no unresolved decision, and the configured destination. Failed checks, missing evidence, forbidden changes or candidate drift cannot advance delivery. Stale/corrupt evidence is `artifact_invalid`; unsupported representation or other delivery-policy rejection is `delivery_error`. Neither starts another worker or repairs CI automatically.

Delivery supports regular Git files with modes `100644` and `100755`, including standard text/EOL attributes whose produced checkout bytes equal the verified candidate. Reject custom filter drivers, nonempty repository info attributes, modified attributes, symlinks, gitlinks/submodules and other unsupported representations before remote writes. Never silently omit paths. Exclude hooks, custom filters, global/system attributes and inherited Git/source configuration from trusted delivery behavior. Do not run worker-selected code with factory credentials. Source HEAD and ordinary index remain unchanged; adding Git objects is allowed.

GitHub HTTPS delivery uses the authenticated pinned gateway/factory credential path without changing global Git configuration. Do not use global `auth setup-git`, record tokens in argv/artifacts, or pass delivery credentials to the worker. The contract does not prescribe an unproved credential mechanism; the actual HTTPS credential boundary requires live proof.

## Facts and exact commit representation

All events and projection changes use P2 atomic transactions and append-only storage. Public types are in `src/contracts/delivery.ts`; input and snapshot schemas alias canonical definitions in the durable schema so earlier frozen schema loaders remain valid.

| Fact | Required observation and projection |
|---|---|
| `DeliveryPlanned` | Pin verification ID/manifest, candidate digest, repository/transport, original base, branch `swf/<SHA256(runId)>`, immutable file snapshot, and exact commit inputs. Enter `planned`. |
| `CommitCreated` | Confirm the planned commit SHA and successful Git ProcessRecord. Enter `committed`. |
| `PushStarted` | Durable intent immediately before the conditional push. Enter `push_started`. |
| `PushConfirmed` | Exact full ref/SHA plus successful authoritative `ls-remote` ProcessRecord. Enter `pushed`. |
| `PrPlanned` | Pin publisher numeric ID, title and exact UTF-8 body artifact with a unique run marker, issue URL, commit SHA and verification digest. Enter `pr_planned`. |
| `PrStarted` | Durable intent before one POST. Enter `pr_started`. |
| `PrCreated` | Exact authenticated PR identity and raw API receipt. Enter `created`. |
| `PullRequestObserved` | Replace the current receipt for that same PR and reset CI to `unobserved`; prior receipts stay in immutable history. |
| `CiObserved` | Record exact check-run observations, full raw paginated response, and PR reads before/after; derive CI state and update current PR receipt to the final observation. |

`DeliverySnapshot` stores every verified file's path, Git mode, digest and immutable content artifact. It must cover the exact candidate file set. Preserve the pinned base tree's `100644` or `100755` mode for surviving tracked regular files. New regular files use `100644`; deleted paths remain absent. Windows filesystem permission strings in legacy LocalEvidence are not Git modes and cannot request an executable-bit change. Bind snapshot paths/content digests to that unchanged evidence, then independently bind Git modes to the pinned base tree. Snapshot and resulting commit checkout bytes/modes must agree; object hashing alone does not prove the correct checkout. Repeated repository/transport/base fields in plans must equal intake/RunCreated authority. PR base SHA is a later remote observation and may differ; base repository and branch may not.

Commit inputs fix tree, exactly one original parent, message bytes, author and committer name/email/date. Dates use raw Git form `<unix seconds> +0000`. Derive `expectedSha` from exact canonical commit bytes before creating the commit object. Planning must not depend on a later wall-clock timestamp or ambient Git identity. Lost commit receipts reconcile that same object; do not append another commit sequence. Signing and hooks cannot alter it.

## Push and PR uncertainty

The push policy is creation without overwriting a different ref. Use the learned exact empty expected-ref lease or an equally proved atomic create-only operation. An already identical ref is harmless/adoptable. Any differing SHA, even an ancestor inserted after an absence read, is `push_conflict` and remains unchanged. Plain non-force push alone is insufficient. No unconditional force, broad refspec, deletion or rewriting is allowed.

After an uncertain push, query the exact pinned target/ref. The intended SHA confirms the effect. Absence allows retry of only the same create-only push and same planned commit. A different SHA stops. `PushConfirmed.process` records authoritative `ls-remote`, whether reached normally or during recovery.

A planned unstarted PR can POST once. A started PR must scan all states and all pages. Adopt exactly one matching numeric repository identity, head repository/ref/SHA, base repository/branch, pinned publisher ID, exact title/body and run marker. Zero or multiple exact matches are `pr_uncertain` with no retry POST. Copied markers from another author/repository are not authority. A POST error does not prove failure: return `github_gateway_error`, then reconcile on resume. Never automatically replace or reopen a closed PR.

PR lifecycle is `open`, `closed` (unmerged), or `merged` with merge commit SHA. Closed unmerged delivery returns exit 1 and resets CI to unobserved; it remains the same delivery. Merged status may report success when the exact delivered head's required checks pass. No merge operation is part of P5. Failed remote reads return errors, not fresh success; `status` reports the last durable observation without network activity.

## CI authority and exit status

Required checks are a nonempty unique list of exact `{name,appId}` pairs. Read PR identity/head, then `commits/<delivered SHA>/check-runs?filter=all` using `--paginate --slurp`, then reread PR identity/head. Check pages are objects containing `check_runs`, not arrays of comments. Validate complete page shapes and observations before committing a result. A wrong repository/head/provider/name is not authority. Duplicate copies of the same check ID are malformed; distinct IDs matching one requirement are ambiguous.

For each requirement, no matching check, one incomplete check, or multiple distinct matching check IDs is pending. Exactly one completed `success` passes. Exactly one completed other conclusion fails. Any failed requirement makes CI failed; otherwise all configured pairs must pass. A PR that closes unmerged during these reads follows the closed-PR policy: preserve the observation in history, update its receipt, set CI to `unobserved` and exit 1 even when the head is unchanged and every check passed. Otherwise changed PR head makes `stale_head`. The duplicate-attempt policy is a deliberate bootstrap limitation: do not infer chronology from IDs or timestamps, and do not use old success to approve a pending repeat. No remote repair or automatic merge follows failure.

For GitHub runs, exit 0 means delivery exists, PR is open/merged and required exact-head CI passed. Preserve P3's explicit exit-0 human-wait result. Pending, failed or stale-head CI and closed-unmerged PRs exit 1 while retaining local VERIFIED. Input errors exit 2; structured transport/integrity/delivery errors exit 1. Status remains a read-only exit-0 snapshot. Legacy local exit policies stay unchanged.

## Artifact integrity and fault boundaries

Validate all current and historical intake responses, file snapshots, commit messages, command outputs, PR plans/receipts and CI captures on resume, including observations superseded by later success or closure. A missing or changed old artifact is `artifact_invalid` before any new API or Git effect. Recheck candidate/evidence eligibility after `CommitCreated` and `PushConfirmed` too; a durable delivery plan does not authorize stale evidence. Leave previously confirmed remote effects intact while refusing later effects. Retain P3 decision and P4 failed-repair artifact checks.

Reuse P2 transaction hooks. Add `delivery.after_commit_object`, `delivery.after_push`, and `delivery.after_pr_create`, each after the actual effect and before its durable receipt. They use the existing trusted marker-and-wait contract and are stripped from workers. Add one releaseable race hook, `delivery.before_push`, after durable `PushStarted` and the final successful remote-absence read, immediately before the atomic create-only push. Its trusted fault definition includes `release`, a path outside worker writable roots. Write the normal marker, wait at most 30 seconds for that release file, then dispatch the push in the same factory process without another absence preflight. Timeout is a structured error with no push. The harness inserts a differing ancestor ref during this hold, releases the same process and verifies that the actual push refuses to advance it. This proves more than a conflict discovered during a later resume. The matrix covers representative precommit rollback, committed receipts, all three effect/result gaps, create-only conflicts and PR uncertainty.

## Validation and handoff

`node tests/spec/p5/harness/run-gates.mjs --preparation` runs typecheck/build, seven sanity checks and the draft suite against the runnable scaffold. Such failures are not definitive red. For handoff, integrate the exact prior P4 candidate that independently passed every runnable gate; live may remain explicitly blocked and the baseline unaccepted. Run focused committed P5 red plus typecheck/build, retain the prior cumulative report, and verify frozen bundle/source hashes. Do not rerun an expensive prior cumulative suite solely to establish red.

Final acceptance omits `--preparation` and runs the independent full P4/P3/P2/P1/P0 cumulative gate plus P5 checks and mandatory real proof. Missing live requirements remain blocked, never skipped or passed. `FACTORY_CANDIDATE_ROOT`, `P5_PROOF_DIR` and `P5_LIVE_PROOF` identify the exact candidate and retained evidence. See `p5/requirements.md` and `p5/LIVE.md`.
