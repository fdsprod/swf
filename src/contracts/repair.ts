import type { VerificationResult } from "./index.js";
import type { Artifact, ProcessRecord } from "./local.js";
import type { AttemptIdentity } from "./durable.js";

export interface RepairConfig { kind: "local_verification"; maxRepairs?: number }
export interface RepairReservation {
  repairId: string;
  failedVerificationId: string;
  evidence: Artifact;
  attempt: AttemptIdentity;
}
export type RepairFact = { type: "RepairReserved" } & RepairReservation;
// A trusted snapshot of the source verification, checked against its durable evidence.
export interface RepairContext {
  repairId: string;
  failedVerificationId: string;
  failedAttemptId: string;
  evidence: Artifact;
  results: VerificationResult[];
  commands: { specId: string; process: ProcessRecord; stdoutBase64: string; stderrBase64: string }[];
}
