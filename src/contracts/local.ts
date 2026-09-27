import type { Skills } from "./skills.js";
import type {
  AgentOutcome,
  FactoryEvent,
  VerificationContract,
  WorkGraph,
  WorkRequest,
  UnitExecutionState,
} from "./index.js";
import type { DecisionConfig } from "./decisions.js";
import type { RepairConfig } from "./repair.js";

export interface LocalConfig {
  schemaVersion: 1;
  request: WorkRequest;
  verification: VerificationContract;
  repositoryPath: string;
  workspaceRoot: string;
  artifactRoot: string;
  worker: { executable: string; prefixArgs: string[]; timeoutSeconds: number };
  sandboxExecutable: string;
  commands: { specId: string; executable: string; args: string[] }[];
  allowedPaths: string[];
  protectedPaths: string[];
  blockedReadPaths: string[];
  verificationInputs: string[];
  skills?: Skills;
  decisions?: DecisionConfig;
  repair?: RepairConfig;
}

export interface LocalWorkspace {
  path: string;
  repositoryPath: string;
  baseCommit: string;
}
export interface Artifact {
  path: string;
  digest: string;
}
export type ProcessTermination =
  | { kind: "exited"; exitCode: number }
  | { kind: "timeout" | "cancelled" | "launch_error"; reason: string };
export interface ProcessRecord {
  executable: string;
  args: string[];
  cwd: string;
  termination: ProcessTermination;
  stdout: Artifact;
  stderr: Artifact;
}
export interface LocalEvidence {
  schemaVersion: 1;
  kind: "local_evidence";
  attemptId: string;
  workspace: LocalWorkspace;
  candidate: {
    digest: string;
    files: { path: string; digest: string; mode: string }[];
  };
  contract: { digest: string; config: LocalConfig; programs: Artifact[] };
  worker: { process: ProcessRecord; outcome: AgentOutcome };
  commands: { specId: string; process: ProcessRecord }[];
  changedPaths: string[];
  diff: Artifact;
  verdict: UnitExecutionState;
}
export type LocalCliResult =
  | {
      kind: "local_run_result";
      graph: WorkGraph;
      state: UnitExecutionState;
      events: FactoryEvent[];
      workspace: LocalWorkspace;
      evidence: Artifact;
    }
  | { kind: "evidence_check"; status: "current" | "invalid"; issues: string[] }
  | { kind: "input_error"; issues: string[]; events: [] }
  | { kind: "not_implemented" };
