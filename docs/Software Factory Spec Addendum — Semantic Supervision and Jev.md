# Semantic Supervision and Jev

## 1. Purpose

The factory may optionally use fast probabilistic decision models to provide continuous semantic supervision over slower generative workers.

The initial candidate implementation is **Jev**, but Jev is not a kernel dependency.

The architectural capability is called:

```text
Semantic Supervision
```

not:

```text
Jev Integration
```

Jev is one possible adapter.

The factory must continue to function without a semantic supervisor.

---

# 2. Position in the architecture

A semantic supervisor does not replace:

- AgentExecutor
- VerificationEngine
- DecisionGateway
- Evidence Gates
- deterministic policy
- human authority

It sits beside execution.

```text
                       WORK UNIT
                           │
                           ▼
                    AgentExecutor
                           │
                ┌──────────┴──────────┐
                │                     │
                ▼                     ▼
             actions               events
                │                     │
                │                     ▼
                │             ObservationBuilder
                │                     │
                │                     ▼
                │          SemanticAssessmentProvider
                │                 Jev / other
                │                     │
                │                     ▼
                │              DecisionSignals
                │                     │
                │                     ▼
                │             SupervisorPolicy
                │                     │
                │       ┌─────────────┼──────────────┐
                │       ▼             ▼              ▼
                │    continue       verify         steer
                │                     │
                │          retry / replan / escalate
                │
                ▼
        factory verification
```

The worker performs engineering.

The supervisor observes.

The policy controls what the factory is allowed to do.

---

# 3. Core invariant

A probabilistic assessment MUST NOT directly cause a protected factory state transition.

This is forbidden:

```text
Jev:
requirements_satisfied = 0.94

        ↓

WorkUnit = VERIFIED
```

This is allowed:

```text
Jev:
needs_verification = 0.94

        ↓

SupervisorPolicy

        ↓

START_VERIFIER

        ↓

VerificationEngine

        ↓

actual evidence
```

Likewise:

```text
Jev:
needs_human = high

        ↓

DecisionPolicy

        ↓

possibly create DecisionRequest
```

Jev may identify a probable need for human authority.

It does not provide that authority.

---

# 4. The supervisor loop

Semantic supervision should run independently of the worker.

```text
CODING WORKER                         SUPERVISOR

reason
  │
  ▼
tool
  │
  ▼
observe ─────── FactoryEvents ───────► collect
  │                                    │
  ▼                                    ▼
edit                                assess
  │                                    │
  ▼                                    ▼
test                              typed signals
  │                                    │
  │                                    ▼
  │                              deterministic
  │                                  policy
  │                                    │
  ◄────────────────────────────────────┘
         steer / verify / stop
         retry / replan / escalate
```

The coding worker does not need to stop every time supervision occurs.

Assessment should be:

- event-driven
- debounced
- bounded
- optionally periodic during long quiet periods

It should not run after every token, file read, or keystroke.

---

# 5. Observation

The supervisor does not receive the entire repository or conversation.

It receives a bounded current observation.

```ts
interface FactoryObservation {
  runId: Id;
  unitId: Id;

  objective: string;
  constraints: string[];

  unitState: WorkUnitState;

  attempt: {
    number: number;
    elapsedMs: number;
  };

  worker: {
    status: string;
    recentSummary?: string;
    recentOutput?: string;
  };

  change: {
    changedFiles: string[];
    diffSummary?: string;
    boundedDiff?: string;
  };

  verification: VerificationResult[];

  recentEvents: FactoryEvent[];

  previousAssessment?: SemanticAssessment;
}
```

Observation size must be explicitly bounded.

The purpose is not to give the supervisor enough information to solve the task.

It needs enough information to assess the worker.

---

# 6. SemanticAssessmentProvider

The kernel exposes an optional port.

```ts
interface SemanticAssessmentProvider {
  evaluate(
    observation: FactoryObservation,
    questions: AssessmentQuestion[]
  ): Promise<SemanticAssessment>;
}
```

Potential implementations:

```text
JevAssessmentProvider
LlmAssessmentProvider
LocalClassifierProvider
NoOpAssessmentProvider
```

The kernel does not contain Jev-specific types.

---

# 7. Assessment questions

Questions are versioned, narrow contracts.

```ts
interface AssessmentQuestion {
  id: string;
  version: number;

  kind:
    | "boolean"
    | "choice"
    | "score";

  instructions: string;

  options?: AssessmentOption[];
}
```

The bootstrap Jev supervisor should use only a small set of questions.

Recommended initial set:

```text
meaningful_progress
work_off_track
worker_stuck

implementation_appears_complete

requirements_appear_satisfied
tests_appear_sufficient

needs_independent_verification

needs_replan
needs_human
```

The wording "appears" is deliberate.

These are observations.

They are not facts.

---

# 8. DecisionSignal

Assessment results are stored as signals.

```ts
interface DecisionSignal {
  questionId: string;
  questionVersion: number;

  provider: string;
  modelVersion: string;

  result: JsonValue;

  providerProbability?: number;
  distribution?: Record<string, number>;

  observationRef: EvidenceRef;

  createdAt: string;
}
```

The field is:

```text
providerProbability
```

not:

```text
confidence
```

unless that is literally part of the provider's wire protocol.

The factory does not reinterpret a provider probability as an objective probability that the claim is true.

---

# 9. Calibration

Provider probabilities MUST NOT be assumed to be calibrated for factory workloads.

Calibration is local to:

```text
question
+
question version
+
model version
+
input shape
+
workload
```

A future calibration record may be:

```ts
interface CalibrationProfile {
  questionId: string;
  questionVersion: number;

  provider: string;
  modelVersion: string;

  datasetVersion: string;

  sampleCount: number;

  metrics: {
    precision?: number;
    recall?: number;
    brierScore?: number;
    expectedCalibrationError?: number;
  };

  thresholds: {
    observe?: number;
    intervene?: number;
    escalate?: number;
  };

  validatedAt: string;
}
```

Changing the question wording may invalidate previous calibration.

Changing the provider model may invalidate previous calibration.

Changing the observation schema may invalidate previous calibration.

Calibration therefore belongs to the policy configuration, not to the model.

---

# 10. Shadow mode

Every new semantic responsibility begins in:

```text
SHADOW
```

In shadow mode:

```text
factory event
    │
    ▼
semantic assessment
    │
    ▼
predicted action
    │
    ▼
LOG ONLY
```

The assessment cannot affect execution.

The factory records:

```text
what the supervisor predicted
what actually happened
what verifier found
what human ultimately decided
```

This becomes the labeled evaluation dataset.

Only after local evaluation should a responsibility move to:

```text
ADVISORY
```

and eventually, where appropriate:

```text
AUTOMATED
```

---

# 11. Authority levels

Semantic responsibilities have explicit maximum authority.

Example:

| Responsibility | Maximum automatic authority |
|---|---|
| meaningful_progress | observation |
| worker_stuck | steer/stop/retry |
| work_off_track | steer/replan |
| needs_verification | launch verifier |
| review_depth | select reviewer |
| model_route | select AgentExecutor |
| requirements_appear_satisfied | observation only |
| tests_appear_sufficient | observation only |
| needs_human | request escalation evaluation |
| product decision | none |
| security authorization | none |
| VERIFIED state | none |
| merge approval | none |

This prevents a highly probable model signal from accidentally becoming authority.

---

# 12. SupervisorPolicy

The model does not determine the action.

```ts
interface SupervisorPolicy {
  evaluate(input: {
    observation: FactoryObservation;
    assessment: SemanticAssessment;
    calibration: CalibrationProfile[];
    factoryState: FactoryRunState;
  }): SupervisorDirective;
}
```

Possible directives:

```ts
type SupervisorDirective =
  | { kind: "continue" }
  | { kind: "steer"; message: string }
  | { kind: "start_verification"; reason: string }
  | { kind: "stop_worker"; reason: string }
  | { kind: "retry"; reason: string }
  | { kind: "replan"; reason: string }
  | { kind: "evaluate_human_escalation"; reason: string };
```

Policy is deterministic.

Example:

```text
IF
  worker_stuck exceeds locally validated threshold

AND
  no steering has yet occurred

THEN
  STEER

ELSE IF
  worker_stuck remains above threshold
  after grace period

THEN
  STOP + RETRY
```

This prevents oscillation such as:

```text
stop
restart
stop
restart
stop
restart
```

---

# 13. Jev is useful where semantic judgment remains

The design principle is:

```text
Can code know this exactly?
        │
       yes
        │
        ▼
     USE CODE
```

Examples that MUST remain deterministic:

```text
Did npm test exit 0?

Did typecheck pass?

Did CI pass?

Did the worker modify a forbidden path?

Is dependency A complete?

Is there an unresolved human decision?

Has merge approval been given?

Did a required verification execute?
```

Jev adds little value to these.

Questions Jev may be useful for:

```text
Does the worker appear to be making meaningful progress?

Has the implementation drifted from the requested objective?

Does this failure look materially different from the previous failure?

Does the current implementation warrant independent verification?

Which review specialization appears relevant?

Does this change look qualitatively inconsistent with repository conventions?

Does this situation appear to require product judgment?

Which approved coding-agent profile best fits this WorkUnit?
```

These contain semantic ambiguity that is difficult to express as simple deterministic rules.

---

# 14. Jev does not replace System Two

Jev should primarily determine:

```text
Should expensive reasoning happen?
```

not perform the expensive reasoning.

Example:

```text
                        Diff
                          │
                          ▼
                     Jev screening
                          │
          ┌───────────────┼────────────────┐
          │               │                │
          ▼               ▼                ▼
   security concern   concurrency      no concern
      likely             concern
          │               │                │
          ▼               ▼                ▼
 security reviewer   concurrency         continue
    LLM/tool            reviewer
```

The expensive reviewer receives only the work that warrants deeper analysis.

This creates:

```text
System One
    ↓
triage / route
    ↓
System Two
    ↓
reason / generate
    ↓
deterministic verification
```

---

# 15. Agent routing

Semantic assessment may eventually select between approved AgentExecutor configurations.

Example:

```text
WorkUnit
   │
   ▼
routing assessment
   │
   ├── mechanical change ───► fast coding model
   │
   ├── normal feature ──────► standard model
   │
   ├── architecture ────────► high-reasoning model
   │
   └── investigation ───────► research configuration
```

Routing occurs primarily at durable boundaries such as:

```text
new WorkUnit
new Attempt
REPLAN_REQUIRED
review
verification
```

It should not switch models continuously inside a healthy active session.

Stable routing preserves worker context and avoids unnecessary context/cache reconstruction.

---

# 16. Verification routing

One particularly valuable use is deciding **what additional verification to invoke**.

Example:

```text
change
  │
  ▼
cheap semantic screening
  │
  ├── UI behavior likely affected
  │         ↓
  │    browser verifier
  │
  ├── concurrency likely affected
  │         ↓
  │    concurrency verifier
  │
  ├── persistence likely affected
  │         ↓
  │    restart verifier
  │
  └── ordinary change
            ↓
       normal suite
```

The supervisor selects candidate verification.

The verifier still produces the evidence.

---

# 17. PR review screening

The development backpressure system may use semantic screening before expensive review.

For every factory PR:

```text
diff
 + spec requirements
 + changed packages
 + architecture metadata
        │
        ▼
 Semantic Supervisor
        │
        ▼
narrow questions
```

Examples:

```text
Does this appear to introduce GitHub-specific concepts into kernel code?

Does this appear to move transition authority into an adapter?

Does this appear to bypass VerificationEngine?

Does this appear to make AgentExecutor responsible for delivery?

Does this appear to add persistent model-generated knowledge
without provenance?

Does this change appear inconsistent with the requirement it claims
to implement?
```

Positive findings do not fail the PR directly.

They cause:

```text
targeted architecture review
targeted test
stronger model review
human review
```

---

# 18. Requirement screening

The factory specification contains stable requirement IDs.

Example:

```text
ARC-001
Kernel MUST NOT import adapter packages.

VER-002
Factory MUST independently execute required verification.

DEC-003
WAITING_FOR_DECISION MUST NOT be treated as failure.
```

Deterministic requirements remain deterministic.

For semantic requirements, a cheap supervisor may screen:

```text
PR
 ↓
Which semantic requirements might this change affect?
 ↓
invoke only relevant reviewers
```

It MUST NOT declare the requirement implemented.

Executable scenarios remain authoritative.

---

# 19. Development backpressure with semantic supervision

The existing development loop becomes:

```text
SPEC
  │
  ▼
Acceptance Scenario
  │
  ▼
Minimal Implementation
  │
  ├───────────────┐
  │               │
  ▼               ▼
deterministic   semantic
checks          screening
  │               │
  │               ▼
  │        targeted System Two
  │             review
  │               │
  └───────┬───────┘
          ▼
 Black-box scenarios
          │
          ▼
      Dogfooding
          │
          ▼
       ACCEPTED
```

Jev makes the review system broader and cheaper.

It does not change what ACCEPTED means.

---

# 20. Runtime backpressure with semantic supervision

Likewise, runtime flow becomes:

```text
                     Worker
                       │
                       ▼
                  FactoryEvents
                       │
              ┌────────┴─────────┐
              │                  │
              ▼                  ▼
       deterministic         semantic
          facts             assessment
              │                  │
              └────────┬─────────┘
                       ▼
                 FactoryPolicy
                       │
       ┌───────────────┼────────────────┐
       ▼               ▼                ▼
    continue        investigate       intervene
                       │
                       ▼
              deterministic or
              System Two evidence
```

Semantic supervision therefore adds early-warning pressure without weakening existing evidence gates.

---

# 21. Memory and learning

Jev MAY later participate in the knowledge pipeline as a classifier.

Examples:

```text
Is this event potentially a reusable lesson?

Which existing knowledge claim is this observation related to?

Does this new observation appear to contradict an existing claim?
```

Jev MUST NOT:

```text
promote a candidate to accepted knowledge

declare a claim authoritative

revoke knowledge

change policy

create structural enforcement
```

Those actions remain governed by evidence, provenance, policy, and potentially human review.

Jev may help locate something worth investigating.

It cannot decide what the organization has "learned."

---

# 22. Failure tolerance

Semantic supervision is optional infrastructure.

Failure of the Jev service MUST NOT corrupt factory state.

Depending on responsibility, failure should cause one of:

```text
continue without supervision

fall back to deterministic policy

invoke another AssessmentProvider

escalate because supervision is required
```

The policy must define behavior explicitly.

No transition should become ambiguous because an assessment provider is unavailable.

---

# 23. Versioning

Every assessment record stores:

```text
provider
model version
question ID
question version
observation schema version
policy version
```

This is required because:

```text
question wording changed
```

or:

```text
jev-1.x → jev-2.x
```

may change the probability distribution.

Old calibration data must not silently apply to a materially different decision function.

---

# 24. Observability

Every automated supervisor intervention should be explainable from recorded state.

Example:

```text
18:42:01 AssessmentStarted

18:42:02 SemanticSignal
         work_off_track = 0.87
         question = off-track-v2
         provider = jev
         model = jev-X

18:42:02 PolicyEvaluated
         threshold = locally-calibrated profile CP-17
         action = STEER_WORKER

18:42:02 WorkerSteered
         reason = possible objective drift
```

This does not prove that Jev was correct.

It tells us exactly why the system acted.

Those outcomes become evaluation data.

---

# 25. Initial Jev rollout

Jev should NOT be a v0.1 dependency.

The factory must first produce:

```text
durable state
events
verification results
attempt history
real self-hosted runs
```

Otherwise there is nothing useful against which to evaluate supervision.

Recommended rollout:

## J0 — Instrumentation

Existing factory only.

Record sufficient events and outcomes to construct labeled examples.

No Jev dependency.

---

## J1 — Shadow Foreman

Add:

```text
SemanticAssessmentProvider
Jev adapter
ObservationBuilder
DecisionSignal persistence
```

Ask only:

```text
meaningful_progress
work_off_track
worker_stuck
needs_verification
needs_human
```

Jev has zero authority.

Compare its predictions with actual outcomes.

---

## J2 — Local calibration

Create evaluation fixtures from real runs.

Measure per responsibility:

```text
precision
recall
false-positive rate
false-negative rate
Brier score / calibration error where applicable
```

Thresholds are chosen from our workload.

Vendor thresholds are not copied blindly.

---

## J3 — Low-risk intervention

Permit only reversible actions such as:

```text
request verification
select reviewer
add advisory note
choose review depth
```

No stopping workers yet.

---

## J4 — Worker supervision

After sufficient evidence, permit:

```text
steer
stop
retry
request replan
```

with deterministic policies, grace periods, and attempt bounds.

---

## J5 — Model routing

Use semantic routing at WorkUnit/Attempt boundaries to select approved worker configurations.

Measure:

```text
task success
cost
latency
repair frequency
context rebuilding
```

before claiming routing is an improvement.

---

## J6 — Semantic development screening

Apply narrow assessments across factory PRs and spec requirements.

Use them to invoke targeted:

```text
tests
reviewers
verification
human attention
```

They remain advisory to the development acceptance model.

---

# 26. Backlog placement

The existing roadmap should change approximately as follows:

```text
M0–M5
Core factory and first self-hosting
NO Jev dependency

M6
Repair loop + sufficient event instrumentation

M6.5
Semantic Supervisor contracts
Jev shadow adapter

M7
Architecture hardening
+ collect Jev labels during real factory work

M8
Real WorkGraph
+ per-unit semantic observations

M9
Replanning/experiments
+ supervisor may recommend replan/experiment

M10
Parallelism
+ worker-level and factory-level supervision

M11
Review/evidence expansion
+ Jev review routing and qualitative screening

M12
Decision policy
+ calibrated low-risk supervisor interventions

M13+
Knowledge
+ Jev may classify/retrieve candidates
+ Jev never controls promotion
```

---

# 27. Jev-specific adapter

The adapter is intentionally small.

Conceptually:

```ts
class JevAssessmentProvider
  implements SemanticAssessmentProvider
{
  async evaluate(
    observation: FactoryObservation,
    questions: AssessmentQuestion[],
  ): Promise<SemanticAssessment> {
    // translate canonical questions to
    // Jev Noul / Choice / Score

    // invoke Jev

    // translate Jev result into
    // canonical DecisionSignals
  }
}
```

All Jev-specific SDK details remain in the adapter.

The kernel sees only:

```text
FactoryObservation
AssessmentQuestion
DecisionSignal
```

---

# 28. Architectural rule

The integration follows this hierarchy:

```text
DETERMINISTIC FACT?
        │
       yes
        ▼
      CODE

       no
        │
        ▼
BOUNDED SEMANTIC JUDGMENT?
        │
       yes
        ▼
   SYSTEM ONE

       no
        │
        ▼
OPEN-ENDED REASONING / GENERATION?
        │
       yes
        ▼
   SYSTEM TWO LLM

        │
        ▼
ACTUAL CORRECTNESS?
        │
        ▼
VERIFICATION / EVIDENCE
```

No model occupies all four roles.

---

# 29. Final principle

The purpose of Jev is not to make the factory trust AI more.

It is to make **small semantic judgments cheap enough that the factory can question its own operation continuously**.

The authoritative chain remains:

```text
Jev observes
     ↓
policy decides what to investigate
     ↓
LLMs reason or implement where necessary
     ↓
verification produces evidence
     ↓
kernel controls state
     ↓
humans retain protected authority
```

That separation is mandatory.