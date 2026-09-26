# Next features after P5

Status: recommendation for discussion. This does not authorize P6 or change
the accepted bootstrap scope. Product implementation is complete through P5.

Do P6 next, then build a small local operator UI using the resulting inspection
and explanation contracts. First close the outstanding live proof. The current
engine passed 407 runnable checks, but it has not yet demonstrated the required
real GitHub and self-hosting workflows.

The immediate usability gap is configuration and understanding a run. A GUI
can address that gap, but a usable CLI and a working repository profile can
support the first real runs. The existing JSON `status` command is a starting
point; the proposed features must add useful behavior rather than duplicate it.

## Basis

| Source | Consequence for this recommendation |
| --- | --- |
| [Kernel sections 2, 52 and 53](<Software Factory Kernel — Conceptual Specification v0.2.md#2-self-hosting-milestone>) | Self-hosting is the first useful milestone. A daemon and dashboard are not prerequisites. |
| [Bootstrap P6](bootstrap-plan.md#p6--use-the-factory-to-build-its-own-next-feature) | Two real factory feature runs, with independent tests, real delivery, human continuation, and human review. `inspect` and `explain` are suggested features. |
| [P5 report](phase-reports/p5.md) | Runnable tests passed. Real decision and GitHub delivery proof remain blocked. |
| [Kernel sections 71 and 72](<Software Factory Kernel — Conceptual Specification v0.2.md#72-self-hosting-development-gates>) | Collect real operating evidence before advanced expansion. |
| [Addendum sections 10 and 25](<Software Factory Spec Addendum — Semantic Supervision and Jev.md#25-initial-jev-rollout>) | Semantic supervision follows real self-hosting and starts with no execution authority. |

The original roadmap places operator UI in M16. Moving a small local UI just
after P6 is a proposed usability refinement. It does not bring forward the
dashboard, scheduling, decomposition, or distributed execution backlog.
P6 is our bootstrap phase number; it is not the original roadmap's M6.

## Ordered feature list

Each implementation row has a separate backpressure author. The product worker
cannot weaken the tests judging its own change.

| Order | Capability | Operator benefit | Independent backpressure |
| --- | --- | --- | --- |
| 0 | One configured real repository and completed P3/P5 live proof | A real issue can become a verified PR and survive restart | Real authorized decision, HTTPS push recovery, one PR, exact-head CI, credential-boundary review |
| 1 | P6: run inspection | See attempts, decisions, checks, evidence, delivery, and CI without parsing the whole store | Red on P5; exact structured output; read-only behavior; missing/corrupt evidence cannot look healthy |
| 2 | P6: blocking-gate explanation | Know why work stopped and what action or evidence is needed next | Deterministic explanations for waiting, failed checks, exhausted budgets, delivery uncertainty, and pending/failed/stale CI |
| 3 | Local run viewer | Open a run and follow its state and event history | Browser E2E against real durable stores; restart/refresh accuracy; no mutation from viewing |
| 4 | Saved repository setup and task submission | Choose a profile, enter an issue or task, review the scope, and start without hand-writing JSON | Configuration/preflight rejection before effects; immutable run snapshot; duplicate submissions cannot start duplicate work |
| 5 | Decision inbox and resume | Read the question and options, answer through the authorized channel, then continue | Wrong responder/decision, stale or conflicting answers cannot unlock work; valid answer survives process restart |
| 6 | Controlled stop and continuation | Stop an owned run deliberately and see whether/how it can continue | Durable stop semantics; all owned children stop; no verification or delivery from incomplete work; budgets stay consumed |
| 7 | Change and evidence review | Inspect the diff, command results, exact delivered revision, PR, and CI before human merge | UI binds evidence to the exact candidate/commit; invalid evidence and stale CI stay visible; rendered logs cannot execute content |

## Prerequisite: make one real run concrete

Prepare an operator-owned configuration and a stable installation outside the
target worktree. Pin the independent verifier bundle outside the worker's
writable paths. A new configuration wizard is not needed to do this once.
Freeze the version N binary while it builds version N+1.

- [ ] Select the repository, small issue, base branch, required checks, and delivery policy.
- [ ] Prepare and validate the concrete runtime paths and protected credential locations.
- [ ] Select the human resolver and collect their actual answer to a real question.
- [ ] Complete the exact-candidate [P3 live proof](../tests/spec/p3/LIVE.md) and [P5 live proof](../tests/spec/p5/LIVE.md).
- [ ] Retain a usable, non-secret example configuration and run instructions.

BP-6 may prepare contracts and red tests while external inputs are pending.
That preparation is not self-hosting acceptance.

## P6: two useful self-hosted features

### P6-A: inspect a run

**Question answered:** Can the factory build an accurate operator-facing view
of its own recorded work under independent checks?

**Layers touched:** CLI, read-only durable history, artifact references, output contract.

**Scope:** One selected run, stable structured output, concise human output,
attempts and remaining budgets, decisions, verification, delivery, and CI.
Resolve the exact command and lookup contract before writing tests; current
commands use `--store`, so do not assume a run-ID registry already exists.

**Validation:**

- [ ] New behavior fails meaningfully on the P5 baseline.
- [ ] Output agrees with durable events and distinguishes local verification from delivery and CI.
- [ ] Inspection starts no worker, performs no remote mutation, and changes no run state.
- [ ] A real factory run produces the feature's PR and passes its pinned checks.

**Dependencies:** Accepted live-proof baseline and stable runner installation.

### P6-B: explain the next blocking gate

**Question answered:** Can the factory build an explanation that points a human
to the actual prerequisite preventing progress?

**Layers touched:** CLI, recorded state and evidence, deterministic explanation logic.

**Scope:** One run's blocking condition, supporting references, and the next
permitted action. This is not an LLM diagnosis or permission to bypass a gate.

**Validation:**

- [ ] New behavior fails meaningfully on the promoted P6-A baseline.
- [ ] Waiting, failed verification, exhausted budgets, uncertain publication, and CI states have correct explanations.
- [ ] Missing evidence is reported without inventing an answer or changing state.
- [ ] A second real factory run produces a verified PR.

**Dependencies:** P6-A accepted, human-reviewed, merged, and promoted.

P6 is complete only with the additional self-hosting evidence below.

- [ ] Two real issues yield useful source changes, factory-created PRs, and passing required CI.
- [ ] At least one real self-hosted run pauses for a human decision and continues in a fresh process.
- [ ] A deterministic scenario proves bounded repair and protection of the external acceptance bundle.
- [ ] No manual source, state, or result patch is counted as autonomous success.
- [ ] A human reviews and merges each accepted change before the next binary is promoted.

## First UI release

Keep one local operator, one configured repository profile, and one active run.
Keep product code in `src/` and checks in `tests/spec/`, within the existing
package. Select the UI technology only when this slice is ready to build.

Start with the read-only run viewer. Then add one complete path from saved
setup through task submission to run progress. Add decision continuation,
controlled stop, and detailed review as separate tested slices. Every slice
must operate through the existing engine and preserve its evidence rules.

The first decision page should show the existing GitHub question, offer its
required answer format, and resume after an authorized answer. Accepting
answers directly inside a new local UI requires an explicit identity and
authority design; a button cannot impersonate the configured GitHub resolver.

Controlled stop also needs product behavior: killing a CLI process currently
exercises crash recovery, which is not a defined operator cancellation policy.
Keep stopping work, resuming interrupted work, and starting a new request
distinct. Closing a browser page must not imply a durable state transition.

## Later backlog, after real use

The bootstrap plan adopts ten successful real runs and two human-merged
self-changes as the maturity gate before advanced expansion. Collect the
restart, decision, repair, delivery, and boundary evidence during normal use.

| Later capability | Smallest useful addition | Separate backpressure |
| --- | --- | --- |
| Adapter hardening | Replace one concrete adapter where real use requires it | Same contract suite passes without changing kernel semantics |
| Serial WorkGraph | Multiple units, dependencies, partial progress | Blocked work does not stop independent units; restart preserves completed units |
| Replanning and experiments | Change a plan after a failed assumption | Preserve completed evidence and explicitly version changed work |
| Parallel execution | Bounded worker count and isolated ownership | Contention, crash, and duplicate-dispatch tests |
| Broader verification and review | Additional evidence types and actionable findings | Known defects lead to measured failure or repair, not model voting |
| Decision policy | Explicit protected operations and narrow approved policies | Authority tests prove that workers cannot resolve protected decisions |
| Semantic supervision | Observations and shadow predictions after real self-hosting | Zero-authority tests and labeled local evaluation before interventions |
| Knowledge and learning | Claims, provenance, revocation, then controlled promotion | Invalid claims can be withdrawn; learning cannot silently become policy |
| Automation and larger operator surfaces | Triggers, scheduling, graph views, or external orchestration when justified | End-to-end recovery and ownership checks against unchanged kernel rules |

Semantic supervision is optional, not a prerequisite for WorkGraph or the
first UI. Start with log-only observations, then measure local accuracy before
granting any bounded intervention. Automatic merge and deployment remain
outside this next-feature proposal.
