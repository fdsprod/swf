# P3 durable human decisions

Status: preparation against the inherited P2 scaffold. The coordinator freezes this contract only after P2 acceptance, integration, and committed behavioral-red evidence. P3 acceptance also requires the real GitHub proof below.

## Compatibility and configuration

Existing P0, P1, and P2 commands, configuration fields, wire outcomes, histories, and projection shapes remain valid. Add one optional `LocalConfig.decisions` object, defined in `src/contracts/decisions.ts`. It selects `github_issue_comments`, a trusted executable and prefix argument array, a positive timeout no greater than 300 seconds, and one authorized resolver `{id,login}`. The positive numeric GitHub user ID supplies authority; the login is a display label. Pin this configuration with the run contract. Changing it on repeat run is `config_mismatch`.

Decision configuration requires a durable store. The normalized request carries `request.repository.url` as `https://github.com/<owner>/<repo>` with optional `.git`, and `request.source.provider = "github"`, `externalId` as a positive decimal issue number, and optional matching issue URL. Reject inconsistent identities before dispatch. This phase does not implement issue intake. The local repository path remains the checkout/worktree source.

Keep `run --local ... --store ... --json`, `resume --store ... --json`, and `status --store ... --json`. A valid `WAITING_FOR_DECISION` result exits 0: this is P3's explicit extension to P2's non-VERIFIED exit policy. State, not exit code alone, indicates verification. A gateway failure, unresolved publication uncertainty, or conflicting answer exits 1 with `durable_error` and code `decision_gateway_error`, `publication_uncertain`, or `decision_conflict`. These observations do not turn waiting into FAILED. Normal unresolved polling returns the waiting projection unchanged. `status` remains a read-only snapshot and never contacts GitHub.

## Worker process boundary

The exact `decision-wire.schema.json` was proved against Codex CLI 0.157.1 by the isolated P3 learning probe. Its schema bytes have SHA-256 `f1af7887ede9407a4696c3fc728c4b6854de48d487206ab52c163806ca6ea87b`. The strict root has one required `outcome` field. Nested `anyOf` selects either `{kind:completed|blocked|failed,message}` or `{kind:decision_required,decision:{question,reason,options,impact,reversible}}`. Options contain required `id`, `description`, and `consequences:string[]`; impact is `string[]`. Every object rejects extra fields. All fields are required, and an empty options array means a free answer.

The learned structural schema permits empty strings. The adapter must additionally reject blank message/question/reason/option IDs/descriptions and duplicate option IDs. Do not add worker-supplied run IDs, decision IDs, author identity, authority, resolution, or evidence. The factory creates the canonical `DecisionRequest` with a stable unique ID for that run/attempt, its true run and unit IDs, and `evidence:[]`. Option IDs must be nonempty and unique. Keep the old flat P1 completion/blocked/failed response accepted; launches without decision configuration retain the old schema. A decision response without configured durable handling must not create remote effects.

Configured workers receive a JSON `DecisionWorkerInput` as the whole prompt, through stdin with the `-` prompt argument or one literal argv prompt. `schemaVersion`, `runId`, `attemptId`, `workspace`, and `context` are required. The ContextPackage contains the unchanged request and unit, every prior durable attempt excluding the current reservation, all accepted resolutions in order, prior evidence references, and repository context `{path,baseCommit}`. On continuation, include at least the previous completion evidence. Use a new execution, never a resumed Codex conversation. Existing changes and the original base/workspace remain intact. Existing P1 restrictions continue to exclude delivery credentials, network actions, protected paths, factory state, and evidence from worker authority.

## Durable facts and lifecycle

The existing `WorkerCompleted.outcome.decision` is the authoritative request. Replay records the completed attempt, enters `WAITING_FOR_DECISION`, and appends `{kind:"requested",attemptId,request}` to a decision collection. Only configured runs have a `decisions` projection property; initialize it to `[]` when their `RunCreated` fact is replayed. Unconfigured runs retain the exact P2 shape. All prior resolved decisions remain, but there is at most one unresolved decision.

Worker completion evidence is written only after the owned worker tree has stopped. No verifier or further worker runs while a decision is unresolved.

New facts are defined by the public TypeScript and durable JSON schema:

| Fact | Required result |
|---|---|
| `DecisionPublicationPlanned` | Stores decision ID and publication `{operationId,publisher:{id,login},body:Artifact}`; lifecycle becomes `publication_planned`. |
| `DecisionPublicationStarted` | Stores decision and operation IDs before POST dispatch; lifecycle becomes `publication_started`. |
| `DecisionPublished` | Stores decision and operation IDs plus receipt `{comment,record:Artifact}`; lifecycle becomes `published`. |
| `DecisionConflictObserved` | Stores decision ID and conflicting comment identities plus a captured API-array artifact; lifecycle becomes `conflicted`, still waiting. |
| `DecisionResolved` | Stores decision ID, canonical human resolution, and authenticated source receipt; lifecycle becomes `resolved`, execution becomes `READY`. |

A comment identity is `{id,url,author:{id,login},createdAt,updatedAt}`. A receipt's `record` contains the full captured GitHub comment JSON, including `user`, `body`, `created_at`, and `updated_at`. The body artifact contains the exact UTF-8 publication body. The human resolution has a factory-generated ID, matching decision ID, nonempty answer, optional selected option ID, `basis:"human"`, nonempty evidence references, and resolution timestamp. It cannot directly mark work verified.

Lifecycle variants require applicable fields together. `requested` has no publication fields. Planned/started states require publication. Published requires publication and receipt. Conflicted additionally requires conflict evidence. Resolved additionally requires resolution and source, with no current conflict field. Earlier conflicts remain in history. The projection remains a cache replayed from facts. All new writes use P2's atomic event/projection transaction and append-only protection.

Repeat unresolved polls append no facts. Repeat unchanged conflicts append no duplicate conflict event: compare the captured authoritative comment set/content, not retrieval time. One accepted resolution creates one fact and one continuation. Required artifact checks include old publication, conflict, and human-answer captures. Tampering cannot be repaired by trusting current remote text or silently discarding old evidence.

## GitHub adapter and uncertain effects

Call the trusted executable with argv arrays, without a shell. Use `gh api`, explicit GET/POST methods, bounded process execution, and JSON POST bodies through `--input -`. GET comments with `--paginate --slurp`, then flatten all page arrays. Validate successful process termination and API shapes before using payloads. Failed calls and malformed JSON are errors, not empty successful reads. Do not use names embedded in comment text as identity.

Authenticate the publisher with `GET /user`, and pin the returned numeric ID before publication. The question body has a deterministic marker containing both run and decision IDs. It includes the exact question/reason, option IDs/descriptions/consequences, impact, reversibility, resolver label, and exact response instructions. Persist the body and publication plan before any POST. Persist `DecisionPublicationStarted` immediately before dispatch.

Recovery distinguishes three cases:

- A planned, unstarted publication can proceed to dispatch.
- A started publication searches all comments. Adopt one exact marker/body match from the pinned publisher. Ignore copied markers from other authors. Multiple same-publisher matches or same-publisher marker/content disagreement are `publication_uncertain`.
- If a started publication has no confirmed match, return `publication_uncertain` without another POST. Intent does not prove the request failed to reach GitHub. P3 has no automatic uncertain-write override.

If POST creates the question but returns failure, the first command returns `decision_gateway_error`; a later resume reconciles the existing result. Do not infer successful publication from an error response. A completed publication never reposts the question on ordinary polling.

## Human response and immutable authority

Accept only a comment whose entire body is this strict JSON structure, with no Markdown fence, wrapper prose, or extra fields:

```json
{"schemaVersion":1,"decisionId":"<factory ID>","answer":"Use 42.\nApproved.","selectedOptionId":"forty-two"}
```

For a free-answer question use `selectedOptionId:null`. When options exist, the selected ID must match one of them. The numeric API author ID must equal the configured resolver. The API `created_at` must be no earlier than the question's `created_at`; editing an old comment later does not make it a response to the question. Wrong IDs, unauthorized authors, malformed bodies, unknown options, and old comments do not unlock work.

Scan all current comments before committing an answer. Current edited content may count before acceptance. Treat equal answer text and selected option as duplicates; choose the smallest numeric comment ID as the stable source. Different valid answers conflict. Record those authenticated comment snapshots, remain waiting, and return `decision_conflict`. A later corrected current comment set can resolve; it cannot erase the observed conflict history.

After `DecisionResolved` commits, its answer and source snapshot are immutable. Later remote editing, deletion, or contradictory replies cannot replace it. Do not poll an accepted decision again. Each later question receives a fresh decision ID and retains prior answers.

The next worker start reserves a new P2 attempt. It consumes the same immutable total worker-start budget. Waiting polls, publication recovery, status, and resolution recording consume no starts. At exhausted budget, retain the accepted answer and append the existing budget-exhaustion stop without dispatch. This continuation will not consume a P4 repair allowance.

## Fault boundaries and acceptance

Retain every P2 fault point and add `decision.after_publish`, after successful remote creation and before `DecisionPublished` commits. The marker follows P2's trusted fault contract and remains outside worker writes. Existing transaction hooks apply to new fact types. The suite cuts both precommit boundaries for publication planning and resolution, representative postcommit boundaries, and the external publication/result gap.

Run `node tests/spec/p3/harness/run-gates.mjs` from the pinned external verifier checkout with `FACTORY_CANDIDATE_ROOT` set to the candidate. The runner checks cumulative P2/P1/P0 gates, P3 sanity, P3 scenarios, required live evidence, frozen bundle hashes, and candidate source stability. It rejects missing, cancelled, skipped, timed-out, or todo tests. `P3_PROOF_DIR` selects the report directory.

`--preparation` runs typecheck/build and P3 scenarios against the inherited scaffold. It always reports `accepted:false` and a blocked live gate. This is not final red-on-P2 or phase acceptance. The coordinator must record final committed red after P2 integration, freeze the bundle, and only then assign PRODUCT-3.

See `tests/spec/p3/requirements.md` for the check map and `tests/spec/p3/LIVE.md` for the mandatory real issue exercise.
