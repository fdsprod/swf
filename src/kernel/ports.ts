import type { AgentOutcome, CommandVerificationSpec, VerificationResult, WorkUnit } from "../contracts/index.js";

export interface AgentExecutor {
  execute(unit: WorkUnit): Promise<AgentOutcome>;
}

export interface VerificationEngine {
  verify(unit: WorkUnit, specifications: CommandVerificationSpec[]): Promise<VerificationResult[]>;
}
