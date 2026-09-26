# GitHub CLI learning probes

These probes inform P3 decisions and P5 delivery. They do not approve either phase. Keep the scripts and selected observations as dependency documentation. No remote writes were made. A target repository has not been selected.

Run `node tests/learning/github/read-only-probe.mjs` from the repository root. Add `--record` to replace the adjacent `observed.json` with a fresh observation. The probe uses authenticated GET requests to public `cli/cli` data and reads the authenticated login. It does not print tokens or full comment bodies. Run it separately from product tests. Public fixture data can change.

The probe passed on 2026-09-26 UTC with Node 22.22.3 and GitHub CLI 2.92.0. Authentication resolved to `fdsprod`.

| Question | Observed behavior | Implementation consequence |
|---|---|---|
| Can structured arguments preserve JSON filters on Windows? | `spawnSync('gh', args, {shell:false})` preserved the quoted key in `has("pull_request")`. A direct PowerShell native call lost those inner quotes. | Call the executable with an argv array. Send JSON request bodies through stdin or a file. |
| Are issue responses always ordinary issues? | `/issues/14517` returned a PR, with `pull_request` present. | Intake must explicitly accept or reject PR-shaped issue records. |
| What does paginated comment data contain? | `--paginate --slurp` returned two page arrays for issue 14522 at `per_page=1`. Both comments had numeric IDs, author login and numeric ID, timestamps, and string bodies. | Flatten every page. Bind authority to API author identity, not names embedded in body text. |
| Can slurp and jq be combined? | CLI exit 1: `--slurp` is not supported with `--jq` or `--template`. | Parse the slurped JSON in Node and select fields there. |
| Can a failed call still emit JSON? | Missing issue 999999999 returned exit 1, a JSON body with status `404`, and `HTTP 404` on stderr. | Validate process result before accepting response data. A 404 is not an empty successful query. |
| Can an existing PR be found by intended identity? | Querying `state=all`, head `cli:bagtoad/readme-seo`, base `trunk` found closed PR 14517. | Reconcile all states, then check repository, exact branch, base, marker, and head commit. |
| Does `gh pr checks` prove the head? | Its JSON contained names, buckets, workflows, and links, but no head SHA. It returned exit 0 with both `pass` and `skipping` buckets. | Do not use its exit code as the factory's CI verdict. |
| Is combined commit status enough? | Head `362a5eb03dcc16af5e313ab8ae5a0cfdc4569e46` had 14 check runs, while combined status was `pending` with no legacy statuses. | Check runs and legacy commit statuses are separate inputs. |
| Can check runs be tied to a commit and provider? | Every fetched record included the exact `head_sha`; GitHub Actions had app ID 15368. Records included name, status, and conclusion. | Match configured check names and provider against the delivered head. Missing or pending checks must stay pending. |
| What does required-check filtering return here? | `gh pr checks --required` returned three build checks for macOS, Windows, and Ubuntu. | This is an observation of this public repository, not the future target's policy. Configure the target's requirements explicitly. |

Installed `gh api --help` says that fields change the default request method from GET to POST. The probe always sets GET. It also documents `--input -` for JSON stdin and paginated page output. General CLI exit codes are 0 success, 1 failure, 2 cancellation, and 4 authentication required. `gh pr checks` additionally documents 8 for pending checks. Only success and API/argument failure were exercised here. See [API command documentation](https://cli.github.com/manual/gh_api), [exit codes](https://cli.github.com/manual/gh_help_exit-codes), and [checks documentation](https://cli.github.com/manual/gh_pr_checks).

## Write semantics to prove in the selected sandbox

The issue-comment API creates a comment with POST and a `body`; documented success is HTTP 201. Its documented request has no idempotency-key field. This supports a design that stores publication intent first, embeds a deterministic run/decision marker, and reconciles all comments after an uncertain response. This is a design inference, not a proved retry guarantee. A marker alone does not establish authority: also check the expected publisher's API identity and the expected content. Multiple conflicting matches must stop publication. See [issue-comment API](https://docs.github.com/en/rest/issues/comments).

The PR API accepts an explicit head, base, title, and body. Its list endpoint filters by head and base and can include all states. Use these fields with a deterministic run marker to find a prior result before retrying a create. Do not adopt a conflicting branch or PR. No exactly-once creation guarantee was established by these read-only probes. See [pull-request API](https://docs.github.com/en/rest/pulls/pulls).

For P5, first confirm that the PR head equals the stored delivered commit. Fetch checks using that commit SHA and re-read the PR head before recording a verdict. Treat a changed head as stale evidence. Match the configured provider and check name, then apply an explicit conclusion policy. Do not silently equate skipped or neutral checks with success. The REST check-run endpoint supports pagination and defaults to its latest filter; retries and duplicate names still need a tested selection rule. Legacy status contexts need their own handling. See [check-run API](https://docs.github.com/en/rest/checks/runs) and [commit-status API](https://docs.github.com/en/rest/commits/statuses).

The real integration proof still needs an authorized target repository, authorized resolver, and required CI policy. It must exercise comment creation, exact multiline body round trips, decision resolution from a new process, interrupted publication reconciliation, deterministic push/PR creation, and current-head CI. It must also establish what happens after a confirmed absent result following an uncertain write. These probes did not test remote writes, transient network failure, API rate limits, duplicate create requests, branch protection, or Git credential inheritance.
