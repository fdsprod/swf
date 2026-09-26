# P0 public contract

Status: proposed handoff contract. The coordinator must freeze this file before product work starts.

P0 runs one deterministic request in memory. The fixture selects a scripted worker outcome and scripted verifier results. Neither script executes a shell command or uses a network service.

## Command and process boundary

```text
node dist/cli/main.js run --fixture <JSON file> --json
```

The command writes exactly one JSON object and a newline to stdout. Diagnostics must not corrupt stdout. Exit codes are 0 for `VERIFIED`, 1 for a valid run that stops without verification, 2 for invalid input or command usage, and 3 for the initial `not_implemented` scaffold.

The fixture has this shape:

```ts
interface RunFixture {
  schemaVersion: 1;
  request: WorkRequest;
  verification: VerificationContract;
  script: {
    agentOutcome: AgentOutcome;
    verificationResults: VerificationResult[];
  };
}
```

`WorkRequest`, `EvidenceRef`, `DecisionRequest`, `AgentOutcome`, and `VerificationResult` retain the field names and shapes in kernel specification sections 7, 16, 18, 23, and 25. P0 supports the four agent outcomes from section 16. P0 verification specifications support only the `command` variant from section 21. Commands are opaque labels for the scripted verifier; P1 supplies execution.

`VerificationContract.required` is nonempty, its IDs are unique and nonempty, and `completionPolicy.requireAll` is the literal `true`. Strings that identify entities, describe objectives, name commands, or explain outcomes must contain a non-whitespace character. `constraints`, `acceptanceCriteria`, and `metadata` remain required fields on a request. Empty arrays and metadata objects are allowed. Unknown object fields are rejected except inside the explicit metadata maps. JSON schemas in `src/contracts/schemas/` define the boundary and are validated with Ajv. Validation and semantic input checks finish before constructing a graph or invoking a worker. Invalid JSON, a missing fixture file, unsupported schema versions, invalid nested fields, and invalid verification contracts produce `input_error`.

Output is a discriminated union:

```ts
type CliResult =
  | { kind: "run_result"; graph: WorkGraph; state: UnitExecutionState; events: FactoryEvent[] }
  | { kind: "input_error"; issues: string[]; events: [] }
  | { kind: "not_implemented" };
```

The graph has the section 8 shape and exactly one unit, no dependencies, and `requestId` equal to the input request ID. The unit retains the objective, constraints, metadata, and verification contract. The graph ID is `${request.id}:graph` and the unit ID is `${request.id}:unit:1`. P0 has no authoritative run identity; decision `runId` binding is deferred until durable run state exists. The output is deterministic across fresh processes for identical input. P0 does not represent delivery as an execution state and performs no delivery.

## Kernel API

The public entrypoint is `src/kernel/index.ts`, emitted at `dist/kernel/index.js`. It exports `transition` and these types (types may be defined in contracts and re-exported).

```ts
type UnitExecutionState =
  | { status: "PENDING" | "READY" | "RUNNING"; unit: WorkUnit }
  | { status: "WAITING_FOR_DECISION"; unit: WorkUnit; decision: DecisionRequest }
  | { status: "VERIFYING"; unit: WorkUnit }
  | { status: "VERIFIED" | "REPAIR_READY"; unit: WorkUnit; results: VerificationResult[] }
  | { status: "FAILED"; unit: WorkUnit; reason: string };

type UnitAction =
  | { type: "prepare" }
  | { type: "start" }
  | { type: "agent_finished"; outcome: AgentOutcome }
  | { type: "verification_finished"; results: VerificationResult[] };

type TransitionResult =
  | { kind: "transitioned"; state: UnitExecutionState }
  | { kind: "rejected"; reason: string };

function transition(state: UnitExecutionState, action: UnitAction): TransitionResult;
```

The reducer does not mutate its inputs. A rejected transition returns a nonempty explanation. Unsupported runtime action tags and state tags are rejected. The sole accepted state/action pairs are:

| State | Action | Result |
|---|---|---|
| `PENDING` | `prepare` | `READY` |
| `READY` | `start` | `RUNNING` |
| `RUNNING` | `agent_finished` with completed outcome | `VERIFYING` |
| `RUNNING` | `agent_finished` with decision request for this unit | `WAITING_FOR_DECISION`, retaining request |
| `RUNNING` | `agent_finished` with decision request for another unit | `FAILED`, explaining identity mismatch |
| `RUNNING` | `agent_finished` with blocked or failed outcome | `FAILED`, retaining reason |
| `VERIFYING` | `verification_finished` with all required results passed and evidenced | `VERIFIED` |
| `VERIFYING` | `verification_finished` with a failed result and no errors | `REPAIR_READY` |
| `VERIFYING` | `verification_finished` with an error result | `FAILED` |
| `VERIFYING` | `verification_finished` with invalid result coverage or missing pass evidence | `FAILED` |

All other pairs reject. P0 includes no resume, repair execution, replan, cancellation, or direct mark-verified action. In particular, passing verification results supplied while `RUNNING` or `WAITING_FOR_DECISION` cannot advance state. Repeated terminal actions reject.

Coverage is exact: every required spec ID has exactly one result and there are no other IDs. Order does not matter. Coverage is checked before result status. Every passed result must contain at least one schema-valid `EvidenceRef`. Empty agent evidence is valid and cannot approve verification. Verifier `error` includes a scripted command timeout; it never counts as a pass. Errors take precedence over failed checks. The reducer validates these gate constraints itself, so the CLI cannot be the sole enforcement point. A malformed, empty, duplicate-ID, or non-requireAll contract causes transition rejection even when a caller bypasses CLI validation. Malformed result statuses or evidence never produce `VERIFIED`; the gate returns `FAILED`. P0 checks decision `unitId`; run-level decision authority and resume arrive in P3.

This shape keeps execution state authoritative, puts unresolved decisions only on the waiting state, and retains the work's verification contract on every state. Verification evidence accompanies the verdict that needs it. Delivery and future CI lifecycle fields remain separate concerns.

## Observable events

Events appear in execution order. All IDs refer to the graph or its sole unit.

```ts
type FactoryEvent =
  | { type: "WorkGraphCreated"; graphId: string; unitIds: string[] }
  | { type: "UnitStateChanged"; unitId: string; from: UnitStatus; to: UnitStatus }
  | { type: "AgentInvocationStarted"; unitId: string }
  | { type: "AgentInvocationFinished"; unitId: string; outcome: AgentOutcome }
  | { type: "VerificationStarted"; unitId: string; specIds: string[] }
  | { type: "VerificationFinished"; unitId: string; results: VerificationResult[] };
```

The initial graph represents `PENDING`. State-change events reflect each accepted transition. Exactly one worker invocation starts after `RUNNING` and finishes before `VERIFYING`. Exactly one independent verifier invocation starts after `VERIFYING` and finishes before its resulting transition. The verifier receives every required specification even if the worker claims to have tested the work. Decision-required, blocked, and failed outcomes do not invoke verification. No event claims delivery.

## Backpressure ownership

BP-0 owns `tests/spec/`, the root package and TypeScript build configuration, and the acceptance runner. The frozen bundle includes canonical contract types and JSON schemas under `src/contracts/`. BP-0 supplies contract-only stubs and a runnable CLI returning `not_implemented`; PRODUCT-0 later owns product implementation and may add contract validation helpers but cannot change frozen types or schema semantics without BP review. The coordinator records the scaffold revision, red evidence, and bundle digest before assigning implementation. The pinned acceptance runner uses its own commands and reads a candidate directory supplied through `FACTORY_CANDIDATE_ROOT`.

The harness validates every CLI response against the frozen output schema. Event assertions establish the observable invocation sequence; coordinator source review must separately confirm that kernel orchestration calls distinct worker and verifier ports, rather than merely fabricating these events. P0 does not claim a hostile-code sandbox.

The test bundle covers the public CLI, all state/action pairs, schema rejection, independent verifier ordering, exact result coverage, required evidence, and kernel import boundaries. Sanity checks include a valid process fixture and deliberate defects that the assertions and architecture gate reject. No acceptance test reads product implementation to derive expected behavior.
