# Required real GitHub decision proof

Status: blocked pending the user's selected repository and configured authorized human resolver. No remote writes are authorized by this file. The coordinator must obtain destination authorization from the user and choose a concrete reviewable synthetic decision.

Run the exact candidate binary from a stable checkout outside its product worktree. Use a disposable local fixture with real GitHub issue identity and the actual `gh` executable. Keep the original start limit and all process restrictions. Retain the immutable configuration, candidate source digest, pinned bundle digest, process commands, process IDs, API snapshots, and artifact digests.

1. Configure the actual authorized resolver's numeric GitHub ID and login. Record how the user authorized the destination and the concrete human question. Do not infer a human answer from the worker or from the factory's authenticated account.
2. Launch with the trusted `decision.after_publish` fault. Confirm through a separate read that the real issue contains the exact multiline question. Retain the marker, terminate the factory, and record its process ID.
3. Resume from a fresh process. Retain the waiting JSON result. Read all issue comments and confirm there is exactly one authenticated exact question. Record the successful resumed publication identity.
4. Have the actual configured human post the specified JSON response. Alternatively, the user may explicitly authorize posting their concrete chosen answer after seeing the exact question; retain that instruction and the comment as the authority record. An automatic factory-created answer must never count as human approval by itself.
5. Resume in another fresh process. Retain its process ID, captured ContextPackage, authenticated response JSON, final durable result, and independent verification artifacts. The original run and workspace must continue, using one additional worker start. Confirm no PR was delivered in P3.
6. Read all issue comments again. Confirm the unique question ID and exact multiline body, author identity, and response identity. The coordinator reviews actual human authorization and the complete evidence chain.

Set `P3_LIVE_PROOF` to an external JSON manifest containing:

```json
{
  "schemaVersion": 1,
  "requirement": "P3-LIVE",
  "candidateSourceDigest": "<P3 runner source digest>",
  "issueUrl": "https://github.com/<owner>/<repo>/issues/<number>",
  "firstFactoryPid": 123,
  "resumedFactoryPid": 456,
  "coordinatorReview": {
    "reviewer": "<reviewer>",
    "reviewedAt": "<timestamp>",
    "actualHumanAuthorizationConfirmed": true
  },
  "humanAuthorizationRecord": {"path":"<record>","digest":"<sha256>"},
  "crashMarker": {"path":"<fault marker>","digest":"<sha256>"},
  "waitingResult": {"path":"<waiting JSON>","digest":"<sha256>"},
  "resumedResult": {"path":"<verified JSON>","digest":"<sha256>"},
  "commentsSnapshot": {"path":"<all API pages JSON>","digest":"<sha256>"},
  "continuationContext": {"path":"<worker input JSON>","digest":"<sha256>"}
}
```

The checker verifies hashes, schemas, replay, artifacts, numeric authority, question uniqueness, candidate identity, fresh process identifiers, and recorded context. It does not independently authenticate a local narrative about a human. The coordinator's review of the actual instruction/comment is therefore a required named manual proof. Keep all referenced evidence files available for the final acceptance rerun.
