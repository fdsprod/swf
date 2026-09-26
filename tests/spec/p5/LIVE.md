# P5 required live proof

Status: blocked until the operator selects the real GitHub repository, issue, authorized credentials, base branch, required check names/numeric app IDs, and delivery policy. Offline fixtures cannot replace this proof.

Use the exact candidate revision and the real HTTPS transport. Start from a local base that equals the recorded target base. Use a small approved issue with deterministic trusted verification. Enable the configured repair/decision features needed by that issue. Confirm the worker lacks delivery credentials and cannot push or publish.

Hold at `delivery.after_push`, retain the marker and a read-only status snapshot, stop that factory, and resume in a fresh process. Confirm one planned commit, one run branch and one real PR. Observe required exact-head CI until it passes. Run one further resume to prove the same commit and PR persist. Do not merge automatically or delete/replace remote results as part of this proof.

The coordinator reviews the actual remote actions and credential boundary. No global Git config mutation, tokens in recorded argv/artifacts, or worker credential access is allowed. Record only the authorization reference, never a secret value.

Set `P5_LIVE_PROOF` to a JSON manifest with `schemaVersion:1`, `requirement:"P5-LIVE"`, exact `candidateSourceDigest`, and coordinator review `{reviewer,reviewedAt,realRemoteActionsConfirmed:true,credentialBoundaryReviewed:true}`. Artifact references are `{path,digest}` SHA-256 pairs. Required fields:

- `authorizationRecord`, `crashMarker`, `afterPushStatus`, `resumedResult`, `repeatResult`: retained authorization, hook marker and complete CLI JSON artifacts.
- `firstFactoryPid`, `resumedFactoryPid`: distinct observed process IDs for the two executions.
- `remoteRead`: a captured successful `ProcessRecord` for exact pinned-remote `ls-remote`; stdout contains the delivered SHA and full branch ref.
- `deliveredCheckout`: JSON `{commitSha,files:[{path,mode,digest,content:Artifact}]}` captured from the actual pushed commit under the supported checkout policy.
- `baseTreeRead`: a captured successful `ProcessRecord` for `git ls-tree -rz --full-tree <pinned base SHA>`. Its raw stdout binds surviving Git modes to the original tree; new files must use `100644`. Legacy filesystem permission strings are not Git modes.
- `allStatePullRequests`: full paginated API response showing exactly one matching publisher/repository/head/base/title/body identity across every state.

The checker validates the retained data and hashes; it does not replace the coordinator's observation that these are real remote effects. The final full cumulative run also requires all earlier live gates. An unavailable or failed proof is blocked/failed, never a test skip.
