import type { TransitionResult, UnitAction, UnitExecutionState, VerificationResult, WorkUnit } from "../contracts/index.js";
import { agentOutcomeIssues, verificationContractIssues, verificationResultsIssues } from "../contracts/validation.js";

const accepted = (state: UnitExecutionState): TransitionResult => ({ kind: "transitioned", state });
const rejected = (reason: string): TransitionResult => ({ kind: "rejected", reason });
const failed = (unit: WorkUnit, reason: string): TransitionResult => accepted({ status: "FAILED", unit, reason });

function verificationVerdict(unit: WorkUnit, results: VerificationResult[]): TransitionResult {
  const errors = verificationResultsIssues(results);
  if (errors.length) return failed(unit, `Invalid verification results: ${errors.join("; ")}`);

  const requiredIds = new Set(unit.verification.required.map(spec => spec.id));
  const resultIds = new Set(results.map(result => result.specId));
  if (results.length !== requiredIds.size || resultIds.size !== results.length ||
      results.some(result => !requiredIds.has(result.specId))) {
    return failed(unit, "Verification results must cover each required specification exactly once with no other IDs");
  }
  if (results.some(result => result.status === "passed" && result.evidence.length === 0)) {
    return failed(unit, "Every passed verification result must include evidence");
  }
  const commandErrors = results.filter(result => result.status === "error");
  if (commandErrors.length) {
    return failed(unit, commandErrors.map(result => `${result.specId}: ${result.summary}`).join("; "));
  }
  return accepted({
    status: results.some(result => result.status === "failed") ? "REPAIR_READY" : "VERIFIED",
    unit,
    results,
  });
}

export function transition(state: UnitExecutionState, action: UnitAction): TransitionResult {
  const errors = verificationContractIssues(state?.unit?.verification);
  if (errors.length) return rejected(`Invalid verification contract: ${errors.join("; ")}`);
  const unit = state.unit;

  switch (state.status) {
    case "PENDING":
      if (action?.type === "prepare") return accepted({ status: "READY", unit });
      break;
    case "READY":
      if (action?.type === "start") return accepted({ status: "RUNNING", unit });
      break;
    case "RUNNING":
      if (action?.type === "agent_finished") {
        const outcome = action.outcome;
        const outcomeErrors = agentOutcomeIssues(outcome);
        if (outcomeErrors.length) return rejected(`Invalid agent outcome: ${outcomeErrors.join("; ")}`);
        switch (outcome.kind) {
          case "completed":
            return accepted({ status: "VERIFYING", unit });
          case "decision_required":
            return outcome.decision.unitId === unit.id
              ? accepted({ status: "WAITING_FOR_DECISION", unit, decision: outcome.decision })
              : failed(unit, `Decision unit ${outcome.decision.unitId} does not match ${unit.id}`);
          case "blocked":
          case "failed":
            return failed(unit, outcome.reason);
        }
      }
      break;
    case "VERIFYING":
      if (action?.type === "verification_finished") return verificationVerdict(unit, action.results);
      break;
    case "WAITING_FOR_DECISION":
    case "VERIFIED":
    case "REPAIR_READY":
    case "FAILED":
      break;
    default:
      return rejected("Unknown execution state");
  }
  return rejected(`Action ${action?.type ?? "unknown"} is not permitted in ${state.status}`);
}
