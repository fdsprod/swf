import type { AgentOutcome, UnitExecutionState, VerificationResult, WorkGraph } from "./index.js";
import type { Artifact, LocalEvidence, LocalWorkspace, ProcessRecord } from "./local.js";
import type { DecisionFact, DecisionRecord } from "./decisions.js";
import type { RepairFact, RepairReservation } from "./repair.js";
import type { DeliveryFact, GitHubIntake, DeliveryProjection, CiProjection } from "./delivery.js";

export interface ProcessIdentity { pid: number; createdAt: string; executable: string }
export interface AttemptIdentity { id: string; ordinal: number; completionPath: string }
export type DurableAttempt = AttemptIdentity & (
  | { kind: "reserved" }
  | { kind: "running"; process: ProcessIdentity }
  | { kind: "interrupted"; reason: string; artifacts: Artifact[] }
  | { kind: "completed"; outcome: AgentOutcome; record: Artifact }
);
export type WorkspaceOperation =
  | { kind: "unplanned" }
  | { kind: "intent" | "ready"; operationId: string; workspace: LocalWorkspace };
export type VerificationOperation =
  | { kind: "idle" }
  | { kind: "intent"; operationId: string; attemptId: string; evidencePath: string }
  | { kind: "completed"; operationId: string; attemptId: string; evidencePath: string; evidence: Artifact };
export interface WorkerCompletion {
  schemaVersion: 1;
  kind: "worker_completion";
  attemptId: string;
  process: ProcessRecord;
  outcome: AgentOutcome;
}
export type DurableFact =
  | DeliveryFact
  | RepairFact
  | DecisionFact
  | { type: "RunCreated"; contract: LocalEvidence["contract"]; graph: WorkGraph; baseCommit: string; maxStarts: number; intake?: GitHubIntake }
  | { type: "WorkspacePlanned"; operationId: string; workspace: LocalWorkspace }
  | { type: "WorkspaceReady"; operationId: string }
  | { type: "AttemptReserved"; attempt: AttemptIdentity }
  | { type: "WorkerStarted"; attemptId: string; process: ProcessIdentity }
  | { type: "AttemptInterrupted"; attemptId: string; reason: string; artifacts: Artifact[] }
  | { type: "WorkerCompleted"; attemptId: string; outcome: AgentOutcome; record: Artifact }
  | { type: "VerificationPlanned"; operationId: string; attemptId: string; evidencePath: string }
  | { type: "VerificationCompleted"; operationId: string; results: VerificationResult[]; issues: string[]; evidence: Artifact }
  | { type: "RunStopped"; reason: "worker_start_budget_exhausted" | "repair_budget_exhausted" | "recovery_failed"; message: string };
export interface DurableEvent { sequence: number; runId: string; fact: DurableFact }
// This projection is a cache of DurableEvent history, checked against replay on load.
export interface DurableProjectionBase {
  schemaVersion: 1;
  runId: string;
  sequence: number;
  contract: LocalEvidence["contract"];
  graph: WorkGraph;
  baseCommit: string;
  state: UnitExecutionState;
  maxStarts: number;
  workspace: WorkspaceOperation;
  attempts: DurableAttempt[];
  verification: VerificationOperation;
  decisions?: DecisionRecord[];
  repairs?: RepairReservation[];
}
export type DurableProjection = DurableProjectionBase & (
  | { intake?: never; delivery?: never; ci?: never }
  | { intake: GitHubIntake; delivery: DeliveryProjection; ci: CiProjection }
);
export type DurableCliResult =
  | { kind: "durable_result" | "durable_status"; projection: DurableProjection; events: DurableEvent[] }
  | { kind: "durable_error"; code: "input_error" | "store_busy" | "not_found" | "config_mismatch" | "corrupt_store" | "artifact_invalid" | "ownership_uncertain" | "decision_gateway_error" | "publication_uncertain" | "decision_conflict" | "github_gateway_error" | "delivery_error" | "push_conflict" | "pr_uncertain" | "ci_gateway_error"; issues: string[] }
  | { kind: "not_implemented" };
