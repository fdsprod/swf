export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface WorkRequest {
  id: string;
  source: { provider: string; externalId: string; url?: string };
  repository: { url: string; baseRef: string };
  objective: string;
  constraints: string[];
  acceptanceCriteria: string[];
  metadata: Record<string, JsonValue>;
}

export interface EvidenceRef {
  id: string;
  kind: "file" | "command_output" | "test_result" | "git_diff" | "commit" | "pull_request" | "ci_run" | "human_decision" | "runtime_observation" | "other";
  uri: string;
  digest?: string;
  metadata?: Record<string, JsonValue>;
}

export interface DecisionRequest {
  id: string;
  runId: string;
  unitId: string;
  question: string;
  reason: string;
  options?: { id: string; description: string; consequences: string[] }[];
  impact: string[];
  reversible: boolean;
  evidence: EvidenceRef[];
}

export type AgentOutcome =
  | { kind: "completed"; summary: string; evidence: EvidenceRef[] }
  | { kind: "decision_required"; decision: DecisionRequest }
  | { kind: "blocked" | "failed"; reason: string; evidence: EvidenceRef[] };

export interface CommandVerificationSpec {
  kind: "command";
  id: string;
  command: string;
  cwd?: string;
  timeoutSeconds?: number;
}

export interface VerificationContract {
  required: CommandVerificationSpec[];
  completionPolicy: { requireAll: true };
}

export interface VerificationResult {
  specId: string;
  status: "passed" | "failed" | "error";
  evidence: EvidenceRef[];
  summary: string;
}

export interface WorkUnit {
  id: string;
  objective: string;
  constraints: string[];
  verification: VerificationContract;
  metadata: Record<string, JsonValue>;
}

export interface WorkGraph {
  id: string;
  requestId: string;
  units: WorkUnit[];
  dependencies: { from: string; to: string }[];
}

export type UnitExecutionState =
  | { status: "PENDING" | "READY" | "RUNNING"; unit: WorkUnit }
  | { status: "WAITING_FOR_DECISION"; unit: WorkUnit; decision: DecisionRequest }
  | { status: "VERIFYING"; unit: WorkUnit }
  | { status: "VERIFIED" | "REPAIR_READY"; unit: WorkUnit; results: VerificationResult[] }
  | { status: "FAILED"; unit: WorkUnit; reason: string };

export type UnitStatus = UnitExecutionState["status"];

export type UnitAction =
  | { type: "prepare" }
  | { type: "start" }
  | { type: "agent_finished"; outcome: AgentOutcome }
  | { type: "verification_finished"; results: VerificationResult[] };

export type TransitionResult =
  | { kind: "transitioned"; state: UnitExecutionState }
  | { kind: "rejected"; reason: string };

export type FactoryEvent =
  | { type: "WorkGraphCreated"; graphId: string; unitIds: string[] }
  | { type: "UnitStateChanged"; unitId: string; from: UnitStatus; to: UnitStatus }
  | { type: "AgentInvocationStarted"; unitId: string }
  | { type: "AgentInvocationFinished"; unitId: string; outcome: AgentOutcome }
  | { type: "VerificationStarted"; unitId: string; specIds: string[] }
  | { type: "VerificationFinished"; unitId: string; results: VerificationResult[] };

export interface RunFixture {
  schemaVersion: 1;
  request: WorkRequest;
  verification: VerificationContract;
  script: { agentOutcome: AgentOutcome; verificationResults: VerificationResult[] };
}

export type CliResult =
  | { kind: "run_result"; graph: WorkGraph; state: UnitExecutionState; events: FactoryEvent[] }
  | { kind: "input_error"; issues: string[]; events: [] }
  | { kind: "not_implemented" };
