# Software Factory Kernel

**Status:** Draft v0.2  
**Purpose:** Define the smallest extensible software-factory kernel capable of building subsequent versions of itself.

---

# 1. Goal

The product is a software-production control system.

It accepts work, turns that work into executable units, delegates execution to replaceable workers, verifies resulting behavior, pauses when human authority is required, records evidence and decisions, and produces auditable software changes.

The system must not conceptually depend on any particular:

- issue tracker
- LLM provider
- agent framework
- workflow engine
- CI provider
- source-control host
- programming language used by the target repository
- memory implementation

The first implementation may directly use specific technologies where doing so substantially reduces bootstrap complexity.

---

# 2. Self-hosting milestone

The first useful version is complete when this repository can use the factory to implement its own next feature.

The minimum self-hosting loop is:

```text
GitHub Issue
     │
     ▼
WorkRequest
     │
     ▼
Single WorkUnit
     │
     ▼
isolated worktree
     │
     ▼
coding agent
     │
     ▼
factory verification
     │
     ├── FAIL ─────► repair
     │
     ├── DECISION ─► durable human pause
     │
     ▼
   PASS
     │
     ▼
commit
     │
     ▼
GitHub PR
     │
     ▼
CI status
```

The system does not require the following to reach this milestone:

- multi-agent execution
- automatic work decomposition
- persistent learned memory
- distributed workers
- dynamic plugin loading
- a dashboard
- automatic merge
- automatic deployment
- sophisticated model routing

These remain future capabilities.

---

# 3. Design principles

| Principle | Meaning |
|---|---|
| Factory owns state | Agent conversations are not workflow state. |
| Agents are disposable | Any worker may disappear and another worker can continue from durable state. |
| Factory determines completion | An agent may claim completion; evidence gates determine advancement. |
| Evidence before transition | No important state transition occurs merely because an agent requested it. |
| Decisions are explicit | Human decisions, policy decisions, experiments, deterministic evidence, and agent judgment are distinct. |
| No fake confidence | Model-generated confidence numbers are not part of the protocol. |
| Evidence over assertion | Important claims reference tests, code, runtime observations, decisions, or artifacts. |
| Plugins replace mechanisms | Product semantics remain in the kernel. |
| Durable history is append-only | Corrections supersede previous records rather than silently rewriting history. |
| Memory is not truth | Future knowledge is stored as claims with provenance and lifecycle. |
| Start concrete | One implementation per port is enough until another is actually required. |
| Fail cheaply and early | High-risk assumptions should be validated before broad downstream work begins. |
| Self-host early | The factory should begin building itself before advanced architecture is added. |

---

# 4. Architectural boundary

The kernel owns the semantics of software work.

```text
                    ┌───────────────────────┐
                    │        Intake         │
                    └──────────┬────────────┘
                               │
                         WorkRequest
                               │
                               ▼
                    ┌───────────────────────┐
                    │   WorkGraphBuilder    │
                    └──────────┬────────────┘
                               │
                           WorkGraph
                               │
                               ▼
              ┌────────────────────────────────┐
              │             KERNEL             │
              │                                │
              │ state machine                  │
              │ dependency resolution          │
              │ attempt lifecycle              │
              │ decision lifecycle             │
              │ verification lifecycle         │
              │ evidence gates                 │
              │ completion rules               │
              │ evidence aggregation           │
              └──┬────┬────┬────┬────┬───────┘
                 │    │    │    │    │
                 ▼    ▼    ▼    ▼    ▼
               Run  Work  Agent Verify Decision
              Store space Exec Engine Gateway
                                  │
                                  ▼
                              Human/System
                                  │
                                  ▼
                         Delivery Provider
                                  │
                             PR / CI / etc.
```

The kernel is not replaceable as a whole.

A workflow framework such as Temporal, Durable Task, or another scheduler may later provide execution and durability mechanics, but it must not redefine factory domain states, authority rules, transition semantics, or evidence requirements.

---

# 5. Language and protocol

The initial kernel implementation uses **TypeScript**.

The reasons are:

- strong type system without heavy ceremony
- discriminated unions for state and outcome modeling
- broad deployment support
- easy integration with CLIs and APIs
- good ecosystem for Git, GitHub, JSON Schema, SQLite, and process execution
- straightforward developer onboarding

The canonical cross-component protocol is **JSON-schema-first**.

TypeScript is an implementation choice.

The protocol is not.

All cross-component contracts must be JSON serializable.

```ts
type Id = string;

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
```

Adapters and workers may later be written in Python, Go, Rust, or another language without recreating factory semantics.

---

# 6. Core domain model

The core domain is intentionally small:

```text
WorkRequest
WorkGraph
WorkUnit
Attempt
DecisionRequest
DecisionResolution
VerificationContract
Evidence
Delivery
FactoryEvent
```

The kernel manages transitions between these objects.

External systems provide mechanisms around them.

---

# 7. WorkRequest

`WorkRequest` is the normalized representation of incoming work.

```ts
interface WorkRequest {
  id: Id;

  source: {
    provider: string;
    externalId: string;
    url?: string;
  };

  repository: {
    url: string;
    baseRef: string;
  };

  objective: string;

  constraints: string[];

  acceptanceCriteria: string[];

  metadata: Record<string, JsonValue>;
}
```

The intake system converts GitHub issues, Linear tickets, CLI requests, API requests, production events, or future sources into this form.

Downstream components must not need to understand GitHub, Linear, Jira, or another intake system directly.

---

# 8. WorkGraph

A `WorkGraph` represents executable work and dependencies.

```ts
interface WorkGraph {
  id: Id;
  requestId: Id;

  units: WorkUnit[];
  dependencies: WorkDependency[];
}

interface WorkDependency {
  from: Id;
  to: Id;
}
```

A WorkUnit is:

```ts
interface WorkUnit {
  id: Id;

  objective: string;

  constraints: string[];

  scope?: {
    paths?: string[];
  };

  verification: VerificationContract;

  assumptions?: Assumption[];

  metadata: Record<string, JsonValue>;
}
```

The first implementation uses a deterministic graph builder:

```text
WorkRequest
     │
     ▼
one WorkUnit
```

Autonomous decomposition is deliberately deferred.

---

# 9. WorkGraphBuilder

```ts
interface WorkGraphBuilder {
  build(
    request: WorkRequest,
    context: PlanningContext
  ): Promise<WorkGraph>;
}
```

The builder does not execute work.

Future builders may use:

- deterministic templates
- heuristics
- repository analysis
- an LLM planner
- historical evidence
- architecture metadata
- combinations of the above

---

# 10. Assumptions

Important assumptions may be represented explicitly.

```ts
interface Assumption {
  id: Id;

  statement: string;

  validation:
    | "existing_evidence"
    | "experiment"
    | "human_decision"
    | "downstream_verification";
}
```

Example:

```text
Assumption:
SQLite locking is sufficient for local parallel workers.

Validation:
Experiment E-3.
```

High-impact assumptions should be validated before large portions of the graph are allowed to depend on them.

---

# 11. Factory state

State belongs to the factory, not to an LLM session.

A minimal WorkUnit lifecycle is:

```text
PENDING
   │
   ▼
 READY
   │
   ▼
RUNNING
   │
   ├──────────────► WAITING_FOR_DECISION
   │                        │
   │                        ▼
   │                     READY
   │
   ▼
VERIFYING
   │
   ├── repairable ─► REPAIR_READY
   │                      │
   │                      ▼
   │                    READY
   │
   ├── plan wrong ─► REPLAN_REQUIRED
   │
   ▼
VERIFIED
```

Terminal states include:

```text
FAILED
CANCELLED
```

Delivery state is tracked separately from execution state.

---

# 12. State-machine invariants

Invalid transitions must be impossible.

For example:

```text
RUNNING → VERIFIED
```

must not exist.

An agent cannot bypass factory verification.

Likewise:

```text
WAITING_FOR_DECISION → VERIFIED
```

must not exist unless the decision is first resolved and execution/verification resumes.

The kernel owns these invariants.

Adapters do not.

---

# 13. Durable control semantics

The kernel owns state transitions.

Durability is supplied through replaceable mechanisms.

```ts
interface RunStore {
  append(event: FactoryEvent): Promise<void>;

  load(runId: Id): Promise<FactoryRunState>;

  findRunnableUnits(runId: Id): Promise<Id[]>;
}
```

The preferred logical model is:

```text
append-only event history
          +
materialized current state
```

Full event sourcing is not required.

The requirement is that consequential transitions have durable history.

Example events include:

```ts
type FactoryEvent =
  | RunCreated
  | GraphCreated
  | UnitReady
  | AttemptStarted
  | AttemptFinished
  | VerificationStarted
  | VerificationFinished
  | DecisionRequested
  | DecisionResolved
  | ReplanRequested
  | UnitVerified
  | UnitFailed
  | DeliveryCreated
  | CiObserved;
```

The first implementation may use SQLite.

The process must survive termination after any persisted transition.

---

# 14. WorkspaceProvider

Workers operate in isolated working copies.

```ts
interface WorkspaceProvider {
  create(input: {
    runId: Id;
    unitId: Id;
    repository: string;
    baseRef: string;
  }): Promise<Workspace>;

  destroy(workspaceId: Id): Promise<void>;
}

interface Workspace {
  id: Id;
  path: string;
  baseRevision: string;
}
```

Initial implementation:

```text
git worktree
```

Containers are not required for the bootstrap slice.

---

# 15. ContextPackage

Workers receive explicit context.

They do not inherit a conversation.

```ts
interface ContextPackage {
  request: WorkRequest;
  unit: WorkUnit;

  priorAttempts: AttemptSummary[];

  decisions: DecisionResolution[];

  evidence: EvidenceRef[];

  repositoryContext: RepositoryContext[];
}
```

The first implementation does not have persistent learned memory.

Current repository state, factory state, recorded decisions, verification failures, and prior attempts are enough.

---

# 16. AgentExecutor

The agent is an execution mechanism.

```ts
interface AgentExecutor {
  execute(input: AgentExecutionInput): Promise<AgentOutcome>;
}
```

```ts
interface AgentExecutionInput {
  runId: Id;
  unit: WorkUnit;
  workspace: Workspace;
  context: ContextPackage;
}
```

Results are explicit:

```ts
type AgentOutcome =
  | {
      kind: "completed";
      summary: string;
      evidence: EvidenceRef[];
    }
  | {
      kind: "decision_required";
      decision: DecisionRequest;
    }
  | {
      kind: "blocked";
      reason: string;
      evidence: EvidenceRef[];
    }
  | {
      kind: "failed";
      reason: string;
      evidence: EvidenceRef[];
    };
```

There is deliberately no:

```ts
confidence: number;
```

Model-produced confidence scores are not treated as calibrated truth.

---

# 17. Agent authority

Agents may make ordinary reversible engineering decisions necessary to complete work.

Examples:

- local naming
- implementation detail
- private helper placement
- equivalent algorithm selection
- minor refactoring

Agents must not silently decide matters involving:

- ambiguous product semantics
- destructive data behavior
- protected architecture boundaries
- security policy
- irreversible actions
- breaking public API behavior
- deployment authority
- other explicitly protected decisions

Such work produces:

```text
decision_required
```

---

# 18. DecisionRequest

```ts
interface DecisionRequest {
  id: Id;

  runId: Id;
  unitId: Id;

  question: string;

  reason: string;

  options?: DecisionOption[];

  impact: string[];

  reversible: boolean;

  evidence: EvidenceRef[];
}

interface DecisionOption {
  id: string;
  description: string;
  consequences: string[];
}
```

A resolution is separate:

```ts
interface DecisionResolution {
  id: Id;
  decisionId: Id;

  answer: string;

  selectedOptionId?: string;

  basis:
    | "human"
    | "policy"
    | "existing_precedent"
    | "experiment"
    | "deterministic_evidence";

  evidence: EvidenceRef[];

  resolvedAt: string;
}
```

No confidence field is used.

---

# 19. DecisionGateway

```ts
interface DecisionGateway {
  publish(request: DecisionRequest): Promise<void>;

  getResolution(
    decisionId: Id
  ): Promise<DecisionResolution | undefined>;
}
```

The initial GitHub adapter may publish the question to the originating issue.

The WorkUnit becomes:

```text
WAITING_FOR_DECISION
```

This is not a failure.

The factory process may terminate while waiting.

A later process may load the run and continue after the resolution exists.

---

# 20. Decision authority

A decision should be resolved by the cheapest appropriate authority.

Conceptually:

```text
Question
   │
   ├── existing rule? ─────────────► deterministic
   │
   ├── answer observable? ─────────► experiment
   │
   ├── reversible engineering? ────► agent
   │
   └── product/risk authority? ────► human
```

The LLM does not determine its own authority.

Factory policy does.

---

# 21. VerificationContract

Verification belongs to the work.

Not to the agent.

```ts
interface VerificationContract {
  required: VerificationSpec[];

  completionPolicy: {
    requireAll: boolean;
  };
}
```

Initial variants:

```ts
type VerificationSpec =
  | CommandVerificationSpec
  | DiffConstraintSpec;
```

Example:

```ts
interface CommandVerificationSpec {
  kind: "command";

  id: string;

  command: string;

  cwd?: string;

  timeoutSeconds?: number;
}
```

Future variants may include:

- HTTP behavior
- browser behavior
- runtime traces
- performance thresholds
- schema comparisons
- invariants
- security scanners
- human approvals
- external service behavior

---

# 22. Verification categories

Verification has two broad sources.

## 22.1 Repository invariants

These apply broadly:

```text
typecheck succeeds
build succeeds
lint succeeds
forbidden dependency is absent
forbidden paths are untouched
architecture rules hold
```

## 22.2 Work-specific proof

These demonstrate requested behavior.

Example:

```text
Given:
  run is WAITING_FOR_DECISION

When:
  process exits
  decision is resolved
  new factory process starts

Then:
  same run resumes
  completed work is not repeated
```

Both may be required before a WorkUnit is considered verified.

---

# 23. VerificationEngine

```ts
interface VerificationEngine {
  verify(input: {
    workspace: Workspace;
    specs: VerificationSpec[];
  }): Promise<VerificationResult[]>;
}
```

```ts
interface VerificationResult {
  specId: string;

  status:
    | "passed"
    | "failed"
    | "error";

  evidence: EvidenceRef[];

  summary: string;
}
```

The factory decides whether the results satisfy the VerificationContract.

An AgentExecutor does not mark its own work verified.

---

# 24. Independent verification

Agents may run tests during execution.

That is encouraged.

However:

```text
Agent says tests pass
```

is not authoritative evidence.

When the worker reports completion:

```text
RUNNING
   │
   ▼
VERIFYING
```

the factory executes required verification itself.

Where practical, later implementations should verify from a clean or freshly reconstructed environment.

For the initial implementation, the factory may verify inside the worktree while controlling:

- working directory
- environment
- command execution
- process lifetime

---

# 25. Evidence

Important outputs reference evidence.

```ts
interface EvidenceRef {
  id: Id;

  kind:
    | "file"
    | "command_output"
    | "test_result"
    | "git_diff"
    | "commit"
    | "pull_request"
    | "ci_run"
    | "human_decision"
    | "runtime_observation"
    | "other";

  uri: string;

  digest?: string;

  metadata?: Record<string, JsonValue>;
}
```

Evidence should generally be referenced rather than repeatedly embedded in state.

---

# 26. ArtifactStore

```ts
interface ArtifactStore {
  put(input: ArtifactInput): Promise<EvidenceRef>;

  get(ref: EvidenceRef): Promise<Artifact>;
}
```

The bootstrap implementation may use local disk.

---

# 27. Failure evidence

Verification failure must produce structured evidence suitable for another attempt.

```ts
interface VerificationFailure {
  specId: string;

  command?: string;

  exitCode?: number;

  summary: string;

  evidence: EvidenceRef[];

  fingerprint?: string;
}
```

Example:

```json
{
  "specId": "resume-test",
  "command": "npm test -- resume-after-decision",
  "exitCode": 1,
  "summary": "expected RUNNING, observed WAITING_FOR_DECISION",
  "fingerprint": "resume-test:state-mismatch"
}
```

The next worker receives the failure and its evidence.

---

# 28. Repair

A verification failure may produce another attempt.

```text
attempt
   │
   ▼
verification
   │
   ▼
failure evidence
   │
   ▼
repair attempt
```

The new ContextPackage contains:

- objective
- existing changes
- prior attempts
- exact verification failure
- relevant evidence
- existing decisions

---

# 29. Retry versus replan

These are separate.

## Retry

The implementation is wrong.

Keep:

- objective
- work decomposition
- verification contract

Try another implementation.

## Replan

The approach or WorkGraph is wrong.

Potential actions include:

- split WorkUnit
- add WorkUnit
- add experiment
- modify dependencies
- choose another implementation strategy
- request authority

Conceptually:

```text
verification failure
        │
        ▼
 failure analysis
        │
  ┌─────┼─────────────┐
  │     │             │
 retry replan      decision
```

---

# 30. Plateau detection

Retries must not become blind loops.

A simple initial signal is repeated failure fingerprints.

```text
Attempt 1 → failure A
Attempt 2 → failure A
Attempt 3 → failure A
```

suggests a plateau.

The system should prefer:

```text
REPLAN_REQUIRED
```

over endlessly repeating equivalent work.

The bootstrap implementation may use simple bounded retries.

More sophisticated progress analysis can be added later.

---

# 31. DeliveryProvider

Agents do not push branches or create PRs directly.

Delivery is a factory responsibility.

```ts
interface DeliveryProvider {
  deliver(input: DeliveryRequest): Promise<DeliveryResult>;

  getStatus(
    deliveryId: Id
  ): Promise<DeliveryStatus>;
}
```

```ts
interface DeliveryRequest {
  runId: Id;

  workspace: Workspace;

  title: string;

  description: string;

  evidence: EvidenceRef[];
}
```

The initial implementation:

1. creates a commit
2. pushes a branch
3. creates a GitHub PR

Automatic merge is outside the first milestone.

---

# 32. CI

CI is conceptually separate from delivery creation.

```ts
interface CiProvider {
  getChecks(
    delivery: DeliveryResult
  ): Promise<CiCheckResult[]>;
}
```

Initial behavior:

```text
PR created
   │
   ▼
CI observed
   │
   ├── PASS
   └── FAIL
```

Automatic repair from remote CI is deferred.

---

# 33. IntakePort

```ts
interface IntakePort {
  getWork(reference: string): Promise<WorkRequest>;
}
```

Initial implementation:

```text
GitHubIssueIntake
```

Potential future implementations:

```text
Linear
Jira
CLI
REST API
Sentry
Slack
scheduled jobs
production alerts
```

These systems never become kernel concepts.

---

# 34. Runtime backpressure

Backpressure is a core factory mechanism.

The fundamental rule is:

> **A proposed state transition must present sufficient evidence for the policy governing that transition.**

The factory does not operate as:

```text
agent thinks
   ↓
agent proceeds
```

It operates as:

```text
work
  │
  ▼
observation
  │
  ▼
evidence
  │
  ▼
policy
  │
  ▼
transition
```

---

# 35. Evidence Gates

Runtime backpressure is implemented through **Evidence Gates**.

A gate evaluates whether a particular transition may occur.

```ts
type GateOutcome =
  | {
      kind: "pass";
      evidence: EvidenceRef[];
    }
  | {
      kind: "reject";
      reason: string;
      evidence: EvidenceRef[];
      next: "retry" | "replan";
    }
  | {
      kind: "decision_required";
      decision: DecisionRequest;
      evidence: EvidenceRef[];
    }
  | {
      kind: "fail";
      reason: string;
      evidence: EvidenceRef[];
    };
```

```ts
interface TransitionGate<TContext> {
  readonly id: string;

  evaluate(context: TContext): Promise<GateOutcome>;
}
```

The kernel defines **where gates apply**.

Plugins implement particular checks.

---

# 36. TransitionPolicy

```ts
interface TransitionPolicy {
  from: WorkUnitState;
  to: WorkUnitState;

  requiredGates: string[];
}
```

Example:

```json
{
  "from": "verifying",
  "to": "verified",
  "requiredGates": [
    "repository-invariants",
    "work-verification"
  ]
}
```

An adapter cannot bypass these requirements.

---

# 37. Runtime gate outcomes

A gate can lead to:

```text
PASS
RETRY
REPLAN
WAIT_FOR_HUMAN
FAIL
```

These outcomes represent different control signals.

They must not be collapsed into a generic success/failure boolean.

---

# 38. Runtime backpressure locations

The first implementation should have five main pressure points.

```text
GitHub Issue
     │
     ▼
[1] INTAKE GATE
     │
     ▼
Single WorkUnit
     │
     ▼
[2] EXECUTION-READY GATE
     │
     ▼
Agent
     │
     ▼
[3] LOCAL VERIFICATION GATE
     │
     ├── fail ─► repair/replan
     │
     ▼
commit
     │
     ▼
[4] DELIVERY GATE
     │
     ▼
PR
     │
     ▼
[5] CI GATE
```

---

# 39. Intake Gate

Initial requirements:

```text
source exists
repository known
objective non-empty
repository accessible
```

The intake gate prevents malformed work from entering execution.

Later it may validate:

- acceptance criteria
- protected repositories
- policy
- authorization
- work classification

---

# 40. Execution-Ready Gate

Before any worker is started:

```text
workspace successfully created
base revision recorded
verification commands known
agent configuration valid
dependencies complete
required decisions resolved
```

If the environment is not ready, an agent should not be launched.

---

# 41. Local Verification Gate

Before a WorkUnit becomes verified:

```text
required commands pass
repository invariants pass
work-specific verification passes
required evidence exists
```

Example bootstrap checks:

```text
npm test
npm run typecheck
```

Failure produces structured feedback and another attempt or replan.

---

# 42. Delivery Gate

Before pushing a branch or creating a PR:

```text
verification remains valid
diff exists
base revision is known
forbidden paths were not modified
commit can be created
delivery policy allows action
```

This prevents the delivery provider from becoming an unchecked side channel.

---

# 43. CI Gate

Remote CI is another source of evidence.

Possible outcomes:

```text
pending
passed
failed
```

For v0.1, CI failure may be recorded without automatic repair.

A later milestone may introduce:

```text
CI failure
   │
   ▼
new repair attempt
```

---

# 44. Continuous backpressure

Verification should not exist only at the end.

Work should encounter increasingly expensive checks as it progresses.

```text
cheap / frequent
      │
      ▼
syntax
typecheck
targeted tests
package tests
integration tests
full CI
      │
      ▼
expensive / broad
```

The goal is to detect incorrect direction as early and cheaply as possible.

---

# 45. Evidence debt

Failure to run a required verification is not equivalent to passing it.

```text
"could not run test"
```

means:

```text
UNVERIFIED
```

not:

```text
PASS
```

Verification requirements may eventually have levels:

```ts
type VerificationRequirement =
  | "required"
  | "required_before_pr"
  | "required_before_merge"
  | "advisory";
```

Unresolved required evidence prevents advancement.

---

# 46. Authority as backpressure

Human decisions are part of backpressure.

```text
work discovers ambiguity
        │
        ▼
DecisionRequest
        │
        ▼
WAITING_FOR_DECISION
        │
        ▼
DecisionResolution
        │
        ▼
resume
```

The factory does not optimize throughput by silently making decisions outside its authority.

---

# 47. Graph-level backpressure

Future WorkGraphs should avoid launching large amounts of downstream work before key assumptions are proven.

Example:

```text
        A
        │
        ▼
 architecture experiment
        │
    ┌───┴───┐
    ▼       ▼
    B       C
   / \     / \
  D   E   F   G
```

B and C remain blocked until the architectural assumption represented by A is validated.

This keeps expensive downstream execution behind high-risk proof points.

---

# 48. Experiments

Experiments should eventually become first-class work.

```ts
type WorkUnitKind =
  | "implementation"
  | "investigation"
  | "experiment"
  | "verification";
```

An experiment converts uncertainty into observable evidence.

Example:

```text
Question:
Will SQLite leases behave correctly under concurrent workers?

Experiment:
Start 20 competing lease attempts.

Evidence:
Recorded acquisition results.

Decision:
Continue, replan, or escalate.
```

---

# 49. Initial adapter set

| Factory role | Contract | Bootstrap implementation |
|---|---|---|
| Intake | `IntakePort` | GitHub issue |
| Graph construction | `WorkGraphBuilder` | one WorkUnit |
| Durable state | `RunStore` | SQLite |
| Scheduling | kernel | one local process |
| Workspace | `WorkspaceProvider` | git worktree |
| Agent | `AgentExecutor` | one configured CLI coding agent |
| Context | `ContextPackage` | repository + run state |
| Verification | `VerificationEngine` | command execution |
| Human decisions | `DecisionGateway` | GitHub issue comments |
| Artifacts | `ArtifactStore` | filesystem |
| Delivery | `DeliveryProvider` | GitHub PR |
| CI | `CiProvider` | GitHub checks |
| Long-term learning | none | intentionally deferred |

There is no plugin discovery system in v0.1.

"Pluggable" means the kernel depends on contracts rather than implementations.

It does not imply dynamic runtime loading.

---

# 50. Package layout

```text
software-factory/

  packages/

    contracts/
      schemas/
      src/

    kernel/
      src/
        runs/
        work/
        decisions/
        attempts/
        verification/
        gates/
        delivery/

    adapter-github/
      src/

    adapter-git/
      src/

    adapter-sqlite/
      src/

    adapter-agent-cli/
      src/

    adapter-command-verification/
      src/

    adapter-local-artifacts/
      src/

    cli/
      src/

  spec/
    scenarios/

  factory.config.json

  package.json
```

Dependency direction:

```text
contracts
    ▲
    │
 kernel
    ▲
    │
adapters

cli → kernel + adapters
```

The kernel must never import an adapter package.

---

# 51. Bootstrap configuration

The initial configuration should remain small.

Conceptually:

```json
{
  "repository": {
    "provider": "github"
  },

  "agent": {
    "provider": "cli"
  },

  "verification": [
    {
      "kind": "command",
      "id": "test",
      "command": "npm test"
    },
    {
      "kind": "command",
      "id": "typecheck",
      "command": "npm run typecheck"
    }
  ]
}
```

---

# 52. Bootstrap CLI

The first version does not require a daemon.

```text
factory run github:owner/repo#123
```

performs:

```text
fetch issue
   ↓
normalize WorkRequest
   ↓
create durable run
   ↓
build one-node graph
   ↓
create worktree
   ↓
execute agent
   ↓
verify
   ↓
deliver PR
```

If human input is required:

```text
persist DecisionRequest
   ↓
publish GitHub comment
   ↓
mark WAITING_FOR_DECISION
   ↓
process exits normally
```

Later:

```text
factory resume <run-id>
```

reloads durable state and continues.

---

# 53. Self-hosting acceptance test

The repository contains a real issue requesting a factory feature.

Example:

```text
Add support for a second verification command.
```

The factory must:

```text
read issue
   ↓
create run
   ↓
create worktree
   ↓
invoke coding agent
   ↓
modify its own source
   ↓
run its own tests/typecheck
   ↓
repair one failure if necessary
   ↓
commit verified changes
   ↓
push branch
   ↓
create PR
   ↓
record PR as evidence
```

A second scenario must intentionally require a human decision.

The factory must:

1. persist the decision request
2. exit
3. later start as a new process
4. retrieve the resolution
5. continue without the prior LLM session

---

# 54. Long-term memory is deliberately deferred

The first implementation must not contain a generic "memory store" that writes model-generated lessons into future prompts.

Future knowledge must instead be represented as claims.

Potential interface:

```ts
interface KnowledgeProvider {
  query(input: KnowledgeQuery): Promise<KnowledgeClaim[]>;
}
```

A future `KnowledgeClaim` must include at minimum:

```text
claim
scope
source provenance
derived-from lineage
status
supersedes
created-at
last-verified
supporting evidence
contradicting evidence
```

---

# 55. Knowledge lifecycle

Expected future states include:

```text
OBSERVATION
    │
    ▼
CANDIDATE
    │
    ▼
ACCEPTED
    │
    ▼
PROMOTED
```

And independently:

```text
CONTESTED
SUPERSEDED
REVOKED
QUARANTINED
```

One agent observation must not automatically become durable organizational knowledge.

---

# 56. Knowledge promotion

Model consensus alone is insufficient for promotion.

This is invalid:

```text
Agent A agrees
Agent B agrees
Agent C agrees
     ↓
accepted fact
```

Multiple models inspecting the same source are not independent evidence.

Promotion should depend on independent sources such as:

- tests
- runtime observations
- current implementation
- architecture decisions
- human policy
- historical behavior
- multiple independent artifacts

---

# 57. Knowledge lineage and unlearning

Derived claims must preserve lineage.

Example:

```text
K-12
  │
  ├────► K-31
  │        │
  │        └────► K-44
  │
  └────► K-39
```

If `K-12` is revoked:

```text
K-12 REVOKED
    │
    ▼
K-31 QUARANTINED
    │
    ▼
K-44 QUARANTINED
```

Descendant claims are reevaluated rather than silently remaining authoritative.

---

# 58. Structural learning

Repeated validated lessons may eventually become stronger mechanisms:

```text
observation
   ↓
candidate lesson
   ↓
skill guidance
   ↓
verification warning
   ↓
lint warning
   ↓
lint error
   ↓
architecture/type constraint
```

The stronger the enforcement, the stronger the required evidence.

A mistaken type constraint has a larger blast radius than a mistaken prompt hint.

---

# 59. Policy changes should be deployed like software

A proposed structural rule should not immediately become mandatory.

Preferred progression:

```text
Candidate Lesson
      │
      ▼
Policy change
      │
      ▼
tests
      │
      ▼
shadow mode
      │
      ▼
warning mode
      │
      ▼
enforced
```

This permits validation before institutionalizing a mistaken lesson.

---

# 60. Development backpressure

The factory kernel itself must be developed under a separate backpressure system.

This is different from runtime Evidence Gates.

Runtime backpressure governs work flowing **through** the factory.

Development backpressure governs whether the **factory implementation matches its specification and remains useful**.

The development loop is:

```text
Spec capability
     │
     ▼
Executable acceptance scenario
     │
     ▼
Minimal implementation
     │
     ▼
component verification
     │
     ▼
architecture verification
     │
     ▼
black-box capability test
     │
     ▼
dogfood against real work
     │
     ├── insufficient ─► revise implementation/spec
     │
     ▼
capability accepted
```

---

# 61. Specification before implementation

Every significant capability should define observable proof before implementation begins.

A backlog item should not merely say:

```text
Implement DecisionGateway.
```

It should define behavior.

Example:

```text
Given:
  a run executing WorkUnit A

When:
  the worker requests a human decision

Then:
  DecisionRequest is persisted
  WorkUnit enters WAITING_FOR_DECISION
  process may terminate
  no worker must remain alive

When:
  DecisionResolution is later recorded
  and a new factory process starts

Then:
  the same run loads
  the decision is available
  WorkUnit A resumes
  completed work is not rerun
```

Implementation is accepted only when this behavior is demonstrated.

---

# 62. Executable specification

The repository should contain executable black-box scenarios.

```text
spec/
  scenarios/

    001-single-work-unit/
    002-verification-failure/
    003-repair/
    004-human-decision/
    005-process-restart/
    006-create-pr/
```

These tests exercise product capability rather than implementation details.

Examples:

```text
single work unit executes successfully

verification failure prevents advancement

failed verification can produce repair

human decision survives process restart

run state survives process restart

verified work creates PR
```

---

# 63. Requirement identifiers

Important specification requirements should have stable identifiers.

Example:

```text
RUN-001
A factory run MUST survive termination after any persisted transition.

DEC-003
A WorkUnit waiting for human authority MUST NOT be considered failed.

AGT-004
Agent completion MUST NOT transition a WorkUnit directly to VERIFIED.

VER-002
Verification MUST be executed by the factory independently of the worker's claim.

ARC-001
The kernel MUST NOT import an adapter package.
```

Executable tests should reference these IDs.

Example:

```ts
it("RUN-001: resumes after a persisted transition", ...)
```

This creates traceability:

```text
spec requirement
      ↓
test
      ↓
implementation
```

---

# 64. Development verification layers

Kernel development uses three verification layers.

## 64.1 Component correctness

Fast checks:

```text
unit tests
typecheck
lint
schema validation
```

These run frequently.

## 64.2 Architectural fitness

These verify that implementation boundaries continue to match the specification.

Examples:

```text
kernel cannot import adapter packages

contracts cannot import kernel

GitHub-specific types cannot appear in kernel contracts

AgentExecutor cannot mutate RunStore directly

DeliveryProvider cannot transition WorkUnit state

adapter packages may depend on contracts/kernel interfaces,
but kernel may not depend on adapters
```

These should be automated.

## 64.3 System capability

Black-box specification scenarios verify complete behavior across boundaries.

Examples:

```text
issue → work → worker → verification → PR

decision → exit → restart → resume
```

---

# 65. Contract tests

Every replaceable adapter should eventually have a canonical contract test suite.

Example:

```ts
runStoreContract(() => new InMemoryRunStore());
runStoreContract(() => new SqliteRunStore());
```

Both implementations must satisfy the same semantics.

Likewise:

```text
WorkspaceProvider contract
ArtifactStore contract
DecisionGateway contract
DeliveryProvider contract
```

This gives "pluggable" a concrete meaning.

---

# 66. Fakes before integrations

The kernel should first be testable with deterministic fakes.

Examples:

```text
FakeAgentExecutor
InMemoryRunStore
FakeDecisionGateway
FakeDeliveryProvider
ScriptedVerificationEngine
```

This allows deterministic testing of factory semantics without requiring GitHub, a real LLM, or external CI.

Example:

```text
Fake agent → completed
Fake verifier → failed
```

must cause:

```text
RUNNING
   ↓
VERIFYING
   ↓
REPAIR_READY
```

without depending on external systems.

---

# 67. Vertical slices

Development should proceed through vertical capability slices rather than implementing whole infrastructure layers.

Avoid:

```text
build all contracts
build all storage
build all GitHub
build all agents
build all verification
finally integrate
```

Prefer:

```text
Slice 1:
CLI
 ↓
fake intake
 ↓
one WorkUnit
 ↓
fake agent
 ↓
verification
 ↓
result
```

Then:

```text
Slice 2:
GitHub issue
 ↓
one WorkUnit
 ↓
real agent
 ↓
verification
 ↓
result
```

Then:

```text
Slice 3:
GitHub issue
 ↓
agent
 ↓
verification
 ↓
GitHub PR
```

Then:

```text
Slice 4:
decision required
 ↓
persist
 ↓
exit
 ↓
resume
```

Each slice crosses the architecture and challenges the abstractions early.

---

# 68. Spikes

Risky assumptions should be tested with disposable spikes before large abstractions are built.

Examples:

```text
spike/resume-run
spike/git-worktree-isolation
spike/agent-cli-json-output
spike/github-decision-comments
```

A spike answers a focused question.

Example:

```text
Can a run persist, process terminate,
new process load state, and continue?
```

If the answer is no, architecture changes before significant implementation depends on the assumption.

---

# 69. Assumption backlog

The development process should explicitly track architectural assumptions.

Example:

```text
A-001
A coding-agent CLI can execute non-interactively
and return a reliable completion status.

Validation:
spike

Status:
validated
```

```text
A-002
SQLite is sufficient for the initial
single-process durable runner.

Validation:
restart scenarios

Status:
unvalidated
```

High-impact unvalidated assumptions should be attacked early.

---

# 70. Spec feedback loop

The specification is not immutable.

Implementation may reveal that the specification is wrong.

When implementation conflicts with the spec:

```text
spec says X
     │
implementation reveals problem
     │
     ▼
Spec Issue
     │
 ┌───┴────────────────┐
 ▼                    ▼
implementation wrong  specification wrong
```

If the spec is wrong:

1. change the specification
2. change executable scenarios
3. change contracts if necessary
4. then change implementation

Implementation must not silently diverge from the documented model.

---

# 71. Dogfooding

The strongest development gate is real self-use.

A capability is not considered mature merely because unit tests pass.

The factory must progressively build itself.

Example progression:

```text
Bootstrap 0
human writes everything

Bootstrap 1
factory runs deterministic scenarios

Bootstrap 2
factory runs agent + verification

Bootstrap 3
factory creates its own PR

Bootstrap 4
factory repairs its own failed work

Bootstrap 5
factory pauses and resumes its own decisions

Bootstrap 6
factory decomposes its own work
```

Each stage should reduce manual orchestration required for the next stage.

---

# 72. Self-hosting development gates

Advanced features remain blocked until earlier self-hosting behavior is demonstrated.

Example Stage 1 exit criteria:

```text
✓ 10 successful real runs
✓ process restart demonstrated
✓ human decision pause/resume demonstrated
✓ verification failure/repair demonstrated
✓ PR delivery demonstrated
✓ factory merged at least 2 changes to itself
✓ kernel has no GitHub dependency
✓ kernel has no dependency on selected agent implementation
```

Until this is true, work should generally not expand into:

- multi-agent scheduling
- long-term memory
- distributed workers
- automated decomposition
- dynamic plugins
- sophisticated UI
- automated deployment

---

# 73. Architectural decision records

Consequential architectural choices should be documented.

Examples:

```text
ADR-001 TypeScript kernel
ADR-002 JSON-serializable protocol contracts
ADR-003 kernel owns state-machine semantics
ADR-004 SQLite bootstrap persistence
ADR-005 GitHub bootstrap control surface
```

Not every library selection needs an ADR.

The record is intended for decisions that materially affect architecture or future compatibility.

---

# 74. Development observability

The factory must produce enough observable history to debug its own development.

A run should expose events such as:

```text
08:13:02 RunCreated
08:13:03 WorkGraphCreated
08:13:04 WorkUnitReady
08:13:04 AttemptStarted
08:16:22 AgentCompleted
08:16:23 VerificationStarted
08:16:41 VerificationFailed
08:16:41 RepairScheduled
```

A local JSON event log is sufficient initially.

Full telemetry infrastructure is not required.

---

# 75. Development acceptance model

A capability progresses through:

```text
SPECIFIED
    │
    ▼
SCENARIO_DEFINED
    │
    ▼
IMPLEMENTED
    │
    ▼
COMPONENT_VERIFIED
    │
    ▼
ARCHITECTURE_VERIFIED
    │
    ▼
CAPABILITY_VERIFIED
    │
    ▼
DOGFOODED
    │
    ▼
ACCEPTED
```

Implementation alone is not completion.

---

# 76. Runtime backpressure versus development backpressure

These must remain conceptually distinct.

## Runtime backpressure

Controls work being processed by the factory.

```text
work
 ↓
evidence
 ↓
gate
 ↓
transition
```

Questions include:

```text
Can this WorkUnit execute?

Did verification pass?

Is this decision authorized?

Can this PR be delivered?

Did CI succeed?
```

## Development backpressure

Controls development of the factory itself.

```text
spec
 ↓
acceptance scenario
 ↓
minimal implementation
 ↓
architecture tests
 ↓
black-box proof
 ↓
dogfood
```

Questions include:

```text
Did we implement the specified behavior?

Did we violate an abstraction boundary?

Does the design work with real agents?

Does the factory survive restart?

Can the factory use this capability to modify itself?
```

Both systems follow the same general principle:

> **Progress requires evidence, not assertion.**

But they operate at different levels.

---

# 77. Bootstrap roadmap

## M0 — Executable skeleton

Build:

```text
contracts package
kernel state machine
in-memory adapters
scripted agent
scripted verifier
```

Proof:

```text
one deterministic black-box scenario
```

---

## M1 — Real execution

Build:

```text
git worktree adapter
CLI agent adapter
command verification
```

Proof:

```text
agent changes fixture repository
factory verification passes
```

---

## M2 — Durability

Build:

```text
SQLite RunStore
restart/resume
event history
```

Proof:

```text
terminate process mid-run
new process resumes correctly
```

---

## M3 — Decisions

Build:

```text
DecisionRequest
DecisionResolution
DecisionGateway
GitHub decision adapter
```

Proof:

```text
factory exits while waiting
decision supplied later
new process resumes
```

---

## M4 — Delivery

Build:

```text
GitHub issue intake
git commit/push
GitHub PR delivery
CI observation
```

Proof:

```text
issue → verified PR
```

---

## M5 — Self-hosting

Run the factory against its own repository.

Proof:

```text
factory-created PR implementing a real factory feature
```

Repeat this more than once.

---

## M6 — Repair loop

Build:

```text
structured verification feedback
new attempt
failure fingerprints
basic plateau detection
```

Proof:

```text
intentional first-attempt failure
corrected automatically
```

---

## M7 — Harden abstractions

Build:

```text
adapter contract suites
architecture tests
JSON schemas
boundary enforcement
```

Proof:

```text
replace at least one adapter
without changing kernel semantics
```

---

## M8 — Real WorkGraph

Build:

```text
multiple WorkUnits
dependencies
graph execution
partial progress
```

Proof:

```text
blocked unit does not stop independent work
```

---

## M9 — Replanning and experiments

Build:

```text
REPLAN_REQUIRED
graph mutation
experiment WorkUnits
assumption validation
```

Proof:

```text
failed assumption changes plan
without restarting entire run
```

---

## M10 — Parallelism

Build:

```text
leases
worker pool
concurrency limits
backpressure
```

Proof:

```text
multiple isolated workers execute safely
```

---

## M11 — Review and evidence expansion

Build:

```text
independent review
finding model
runtime evidence
broader verification
```

Proof:

```text
review findings lead to evidence or repair,
not model voting
```

---

## M12 — Decision policy

Build:

```text
protected operations
authority rules
escalation filtering
```

Proof:

```text
agents cannot make prohibited decisions
without explicit resolution
```

---

## M13 — Knowledge system

Build:

```text
claims
provenance
scope
lineage
supersession
revocation
quarantine
```

Proof:

```text
bad knowledge can be invalidated
and dependent claims are reevaluated
```

---

## M14 — Learning pipeline

Build:

```text
candidate lessons
promotion policy
shadow mode
structural enforcement
rollback
```

Proof:

```text
learning cannot silently become policy
```

---

## M15 — External execution control plane

Only if justified, integrate systems such as:

```text
Temporal
Durable Task
other distributed workflow engines
```

The external control plane must implement factory mechanics without replacing kernel semantics.

---

## M16 — Automation and operator UI

Potential additions:

```text
webhooks
production triggers
scheduled work
dashboard
graph visualization
decision inbox
evidence browser
```

These are operational surfaces around the kernel.

---

# 78. Explicit v0.1 non-goals

v0.1 will not include:

- autonomous graph decomposition
- multiple concurrent agents
- distributed scheduling
- persistent learned memory
- vector database memory
- automatic policy synthesis
- automated merging
- production deployment
- runtime dashboard
- dynamic plugin loading
- sophisticated model routing
- broad cost optimization
- automatic architecture generation
- multi-agent voting

These capabilities must prove their need.

---

# 79. Core product invariant

The central invariant is:

> **Agents propose changes and interpretations. The factory owns state, authority, verification, evidence, and delivery.**

---

# 80. Core development invariant

The corresponding development invariant is:

> **The specification proposes architecture. Executable scenarios, architectural tests, and dogfooding determine whether that architecture is actually valid.**

---

# 81. Definition of the kernel

The actual product core is intentionally small:

```text
Canonical Contracts
        +
Run State Machine
        +
WorkGraph State
        +
Attempt Lifecycle
        +
Decision Lifecycle
        +
Evidence Gates
        +
Verification Lifecycle
        +
Evidence References
        +
Ports
```

Everything else is mechanism:

```text
GitHub
SQLite
git worktrees
Claude
Codex
CI platforms
workflow frameworks
artifact storage
knowledge stores
operator interfaces
```

The first version should resist adding anything to the kernel that can remain an adapter, configuration, or policy.

---

# 82. Overall control model

Both runtime operation and kernel development follow the same larger philosophy:

```text
           proposal
              │
              ▼
          observation
              │
              ▼
           evidence
              │
              ▼
            policy
              │
              ▼
           decision
              │
              ▼
           progress
```

The model is deliberately not:

```text
LLM produces answer
        │
        ▼
trust answer
        │
        ▼
continue
```

The system is designed around the assumption that models are useful but fallible workers.

Correctness, authority, durability, learning, and progress therefore live outside the model.