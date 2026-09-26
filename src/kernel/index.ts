import type { TransitionResult, UnitAction, UnitExecutionState } from "../contracts/index.js";

export type { TransitionResult, UnitAction, UnitExecutionState } from "../contracts/index.js";

export function transition(_state: UnitExecutionState, _action: UnitAction): TransitionResult {
  return { kind: "rejected", reason: "not_implemented" };
}
