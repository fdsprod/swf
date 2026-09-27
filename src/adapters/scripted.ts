import type { AgentOutcome, VerificationResult } from "../contracts/index.js";
import type { AgentExecutor, VerificationEngine } from "../kernel/ports.js";

export function scriptedWorker(outcome: AgentOutcome): AgentExecutor {
  return { execute: async () => structuredClone(outcome) };
}

export function scriptedVerifier(
  results: VerificationResult[],
): VerificationEngine {
  return { verify: async () => structuredClone(results) };
}
