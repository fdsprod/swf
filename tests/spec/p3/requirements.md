# P3 requirement map

BP-3 owns these checks. PRODUCT-3 cannot alter or relax the pinned bundle.

| ID | Required observation | Proof |
|---|---|---|
| P3-001 / DEC-003 | Persist request before publication; stop worker; exit normally while waiting; no verifier/delivery | `scenarios/decisions.test.mjs`, durable pause scenario and API-call fact snapshots |
| P3-002 | Wrong/missing/stale/malformed/invalid-option responses remain waiting; free answers work | Response matrix and free-answer scenario |
| P3-003 / BOOT-005 | API numeric author identity supplies authority; body/worker claims do not | Unauthorized name impersonation, textual claim, forged wire scenario, copied publisher marker recovery |
| P3-004 | Duplicate responses have one effect; conflict evidence is durable/idempotent; accepted answers are immutable | Duplicate/deletion scenario, conflict/correction scenario, resolution postcommit recovery |
| P3-005 | Fresh process and worker receive recorded answer and independently verify same run/workspace | Fresh-context scenario, external answer verifier, preserved source and partial edits |
| P3-006 / RUN-001 | Atomic decision writes and publication reconciliation survive termination; artifacts retain integrity | Precommit/postcommit crash matrix, publication/result gap, tampered question and answer snapshots |
| P3-007 | Complete pagination and remote errors cannot be mistaken for authority or safe repost | API failure/malformed matrix, late-page publication, duplicate/altered matches, uncertain absence, lost POST response |
| P3-008 | Polling costs no starts; continuation costs one; sequential decisions and restart retain total bound | Exhausted budget, sequential decisions, resolution restart scenarios; cumulative P2 budget suite |
| P3-009 | Legacy schemas/wire/shapes remain accepted; decision inputs reject injected authority | Legacy flat response, invalid drafts, changed authority, cumulative P0-P2 gates |
| P3-LIVE | Real issue question and actual human resolution survive process exit and publication crash | `LIVE.md`, `harness/live-proof.mjs`, reviewed external evidence manifest |
| P3-003/007 | Every API call pins the github.com identity realm despite inherited GH_HOST | Hostile-host scenario and mandatory hostname transport assertion, including `/user` |
| P3-006/009 | Gateway executable bytes join the immutable program contract | Distinct gateway executable and post-pause executable mutation scenario |
| P3-004/006 | Resolved decisions retain integrity of every historical conflict capture | Conflict, resolution, historical tamper scenario and historical-artifact oracle |
| BOOT-004 / ARC-001 | Independent pinned checks and unchanged source/bundle judge candidate | External P3 runner hashes, inherited cumulative architecture controls |

The five sanity checks prove independent replay accepts valid history and rejects wrong author/ID/option/timestamp/publisher, historical conflict bytes retain integrity, schemas reject extra authority, the fake transport preserves multiline bodies and lost-write effects while rejecting an unpinned host, and the fresh worker plus external verifier reject an uncorrected answer. Product scenarios launch real factory processes and use real worktrees, the P1 restriction, SQLite, and external command verification. Only GitHub responses and coding behavior are deterministic doubles.

Infrastructure failures remain separate from product failures. Missing real GitHub access or human response blocks the live requirement; it is never marked skipped or passed because the offline suite succeeds.
