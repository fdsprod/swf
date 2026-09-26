# P5 check-run API learning

Observed on 2026-09-26 at 07:11 UTC with GitHub CLI 2.92.0 and Node 22.22.3 on Windows. The retained [probe](../../tests/learning/p5/check-runs-probe.mjs) calls the installed CLI against public `cli/cli` data. Every API call uses explicit `--hostname github.com --method GET`. It performs no remote writes and records no credentials, issue bodies, or check output.

Keep this script as dependency documentation outside the product acceptance suite:

```powershell
node tests/learning/p5/check-runs-probe.mjs
```

An optional first argument selects the evidence file. Otherwise the script leaves its JSON report in a new temporary directory. The successful report is `C:/Users/fdspr/AppData/Local/Temp/swf-p5-check-runs-D6KggO/observations.json`. It contains selected API identities, timestamps, results, pagination observations, and command arguments. It excludes raw stderr and disables CLI debug output for its child processes.

## Scope and pagination

The probe used closed PR 14517 and its head `362a5eb03dcc16af5e313ab8ae5a0cfdc4569e46`. Both PR head and base repositories were `cli/cli`. It examined this one commit only. A first request with `per_page=100` limits the fixture to at most 100 check runs before the smaller-page exercise.

```text
gh api --hostname github.com --method GET repos/cli/cli/commits/362a5eb03dcc16af5e313ab8ae5a0cfdc4569e46/check-runs?filter=all&per_page=5 --paginate --slurp
```

The installed CLI returned an outer array of three **objects**, each with `total_count` and a `check_runs` array. Page sizes were 5, 5, and 4. Every page reported total count 14. Flattening `page.check_runs` produced 14 unique IDs, matching the single larger-page response. This differs from issue-comment pagination, where each page itself is an array.

## Identity and timestamp observations

Every record contained the requested `head_sha`, a numeric `id`, an exact string `name`, and `app.id=15368` with slug `github-actions`. The sample included completed checks with both `success` and `skipped` conclusions.

| Check | ID | Suite ID | Started | Completed | Conclusion |
| --- | --- | --- | --- | --- | --- |
| `build (windows-latest)` | 107892413799 | 97699540730 | 2026-09-25T00:28:08Z | 2026-09-25T00:37:45Z | success |
| `close-unmet-requirements` | 107892447593 | 97699538175 | 2026-09-25T00:28:14Z | 2026-09-25T00:28:05Z | skipped |

The second record's completion timestamp precedes its start timestamp. This is the actual observed payload. The probe does not reject it or infer a reason. None of the 14 records had a `created_at` or `run_attempt` field. The records therefore do not supply those fields as a general attempt-ordering mechanism.

## Repeated runs and policy limits

There were no repeated `(app.id, name)` groups on this head. A separate explicit `filter=latest` request returned the same 14 IDs as `filter=all`. This sample does not establish how the filter selects among repeated checks, whether numeric IDs define a latest attempt, or how re-requested checks change identity. The probe did not search additional history to find retries.

A factory rule for selecting repeated check runs must be an explicit policy with independent fixtures. It cannot be described as behavior proved by this sample. The same applies to accepting `skipped` or `neutral`, treating missing checks as pending, and handling ambiguous matches. This research establishes available identity fields and the observed page shape. It does not approve those policy choices.

## Documented filter behavior, separate from observation

GitHub's official reference says the `filter` parameter selects by `completed_at`, that `latest` returns recent check runs, and that `latest` is the default. The allowed values are `latest` and `all`. The endpoint accepts a commit SHA and provides `check_name` and `app_id` query parameters. These are documented API properties, not additional probe findings. See [List check runs for a Git reference](https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference).

The parameter description does not specify a client-side ID ordering rule, a tie-break rule, or a uniqueness guarantee for `(app.id, name)`. It also does not explain selection between a completed record and a pending repeat. The bounded fixture cannot resolve those details.

One possible P5 policy is to request `filter=latest` explicitly and use the server's selection. Then validate the exact head, app ID, and name locally. Multiple matching records can remain ambiguous/pending instead of selecting the largest ID or sorting timestamps. This is a proposed factory policy, not an observed guarantee. Independent fixtures would still need to prove its handling of missing, duplicate, pending, and wrong-provider records.

No pending checks, transient failures, rate limits, changing PR heads, remote writes, or live retry transitions were exercised. Public fixture data can change. A failed future probe should prompt a review of the new response, not a silent change to product policy.
