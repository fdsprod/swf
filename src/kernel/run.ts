import type { CliResult, FactoryEvent, UnitAction, UnitExecutionState, VerificationContract, WorkGraph, WorkRequest, WorkUnit } from "../contracts/index.js";
import type { AgentExecutor, VerificationEngine } from "./ports.js";
import { transition } from "./transition.js";

export async function run(
  request: WorkRequest,
  verification: VerificationContract,
  worker: AgentExecutor,
  verifier: VerificationEngine,
): Promise<Extract<CliResult, { kind: "run_result" }>> {
  const unit: WorkUnit = {
    id: `${request.id}:unit:1`,
    objective: request.objective,
    constraints: structuredClone(request.constraints),
    verification: structuredClone(verification),
    metadata: structuredClone(request.metadata),
  };
  const graph: WorkGraph = { id: `${request.id}:graph`, requestId: request.id, units: [unit], dependencies: [] };
  let state: UnitExecutionState = { status: "PENDING", unit };
  const events: FactoryEvent[] = [{ type: "WorkGraphCreated", graphId: graph.id, unitIds: [unit.id] }];

  function advance(action: UnitAction): UnitExecutionState {
    const result = transition(state, action);
    if (result.kind === "rejected") throw new Error(result.reason);
    events.push({ type: "UnitStateChanged", unitId: unit.id, from: state.status, to: result.state.status });
    return result.state;
  }

  state = advance({ type: "prepare" });
  state = advance({ type: "start" });
  events.push({ type: "AgentInvocationStarted", unitId: unit.id });
  const outcome = await worker.execute(structuredClone(unit));
  events.push({ type: "AgentInvocationFinished", unitId: unit.id, outcome });
  state = advance({ type: "agent_finished", outcome });

  if (state.status === "VERIFYING") {
    events.push({ type: "VerificationStarted", unitId: unit.id, specIds: unit.verification.required.map(spec => spec.id) });
    const results = await verifier.verify(structuredClone(unit), structuredClone(unit.verification.required));
    events.push({ type: "VerificationFinished", unitId: unit.id, results });
    state = advance({ type: "verification_finished", results });
  }
  return { kind: "run_result", graph, state, events };
}
