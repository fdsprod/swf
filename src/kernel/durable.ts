import { deliveryFact } from "./delivery.js";
import type {
  DurableEvent,
  DurableProjection,
  DurableFact,
  DurableAttempt,
} from "../contracts/durable.js";
import type {
  UnitExecutionState,
  VerificationResult,
  WorkUnit,
} from "../contracts/index.js";

export function stable(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
function requireFact(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
export function durableVerdict(
  unit: WorkUnit,
  results: VerificationResult[],
  issues: string[],
): UnitExecutionState {
  const fail = (reason: string): UnitExecutionState => ({
    status: "FAILED",
    unit,
    reason,
  });
  if (issues.length) {
    return fail(issues.join("; "));
  }
  const ids = results.map((r) => r.specId);
  const required = unit.verification.required.map((s) => s.id);
  if (
    ids.length !== required.length ||
    new Set(ids).size !== ids.length ||
    required.some((id) => !ids.includes(id))
  ) {
    return fail("Invalid verification result coverage");
  }
  if (results.some((r) => r.status === "error")) {
    return fail(
      results
        .filter((r) => r.status === "error")
        .map((r) => r.summary)
        .join("; "),
    );
  }
  if (results.some((r) => r.status === "passed" && !r.evidence.length)) {
    return fail("Missing verification evidence");
  }
  return {
    status: results.some((r) => r.status === "failed")
      ? "REPAIR_READY"
      : "VERIFIED",
    unit,
    results,
  };
}
export function replay(events: DurableEvent[]): DurableProjection {
  let p: DurableProjection | undefined;
  const operations = new Set<string>();
  const operation = (id: string): void => {
    requireFact(!operations.has(id), "Duplicate operation identity");
    operations.add(id);
  };
  for (const [index, event] of events.entries()) {
    requireFact(event.sequence === index + 1, "Noncontiguous event sequence");
    const fact: DurableFact = structuredClone(event.fact);
    if (!p) {
      requireFact(
        fact.type === "RunCreated",
        "History must start with RunCreated",
      );
      const request = fact.contract.config.request;
      const unit: WorkUnit = {
        id: `${request.id}:unit:1`,
        objective: request.objective,
        constraints: request.constraints,
        verification: fact.contract.config.verification,
        metadata: request.metadata,
      };
      const graph = {
        id: `${request.id}:graph`,
        requestId: request.id,
        units: [unit],
        dependencies: [],
      };
      requireFact(
        event.runId !== request.id && stable(fact.graph) === stable(graph),
        "Invalid run graph",
      );
      p = {
        schemaVersion: 1,
        runId: event.runId,
        sequence: event.sequence,
        contract: fact.contract,
        graph,
        baseCommit: fact.baseCommit,
        maxStarts: fact.maxStarts,
        state: { status: "PENDING", unit },
        workspace: { kind: "unplanned" },
        attempts: [],
        verification: { kind: "idle" },
      };
      if (fact.intake) {
        requireFact(
          fact.intake.base.sha === p.baseCommit &&
            fact.intake.base.branch === fact.intake.input.baseBranch,
          "Intake base differs from run",
        );
        p = {
          ...p,
          intake: fact.intake,
          delivery: { kind: "unplanned" },
          ci: { kind: "unobserved" },
        };
      }
      if (fact.contract.config.decisions) {
        p.decisions = [];
      }
      if (fact.contract.config.repair) {
        p.repairs = [];
      }
      continue;
    }
    requireFact(event.runId === p.runId, "Run identity changed");
    p.sequence = event.sequence;
    const unit = p.graph.units[0]!;
    const selected = (id: string): DurableAttempt => {
      const a = p!.attempts.at(-1);
      requireFact(a?.id === id, "Attempt identity mismatch");
      return a;
    };
    const identity = (a: DurableAttempt) => ({
      id: a.id,
      ordinal: a.ordinal,
      completionPath: a.completionPath,
    });
    const replace = (a: DurableAttempt): void => {
      p!.attempts[p!.attempts.length - 1] = a;
    };
    switch (fact.type) {
      case "DeliveryPlanned":
      case "CommitCreated":
      case "PushStarted":
      case "PushConfirmed":
      case "PrPlanned":
      case "PrStarted":
      case "PrCreated":
      case "PullRequestObserved":
      case "CiObserved":
        requireFact(p.intake, "Delivery fact on local run");
        deliveryFact(
          p as Extract<DurableProjection, { intake: object }>,
          fact,
          operation,
        );
        break;
      case "RepairReserved": {
        requireFact(
          p.contract.config.repair &&
            p.repairs &&
            p.state.status === "REPAIR_READY" &&
            p.verification.kind === "completed",
          "Repair requires completed failed verification",
        );
        requireFact(
          p.repairs.length < (p.contract.config.repair.maxRepairs ?? 1) &&
            p.attempts.length < p.maxStarts,
          "Repair budget exhausted",
        );
        requireFact(
          !p.decisions?.some((d) => d.kind !== "resolved"),
          "Repair cannot bypass a decision",
        );
        requireFact(
          fact.failedVerificationId === p.verification.operationId &&
            stable(fact.evidence) === stable(p.verification.evidence) &&
            !p.repairs.some(
              (r) => r.failedVerificationId === fact.failedVerificationId,
            ),
          "Repair source differs from current failed verification",
        );
        requireFact(
          fact.attempt.ordinal === p.attempts.length + 1 &&
            !p.attempts.some(
              (a) =>
                a.id === fact.attempt.id ||
                a.completionPath === fact.attempt.completionPath,
            ),
          "Invalid repair attempt identity",
        );
        operation(fact.repairId);
        const { type: _type, ...reservation } = fact;
        p.repairs.push(reservation);
        p.attempts.push({ ...fact.attempt, kind: "reserved" });
        p.state = { status: "RUNNING", unit };
        p.verification = { kind: "idle" };
        break;
      }
      case "WorkspacePlanned":
        requireFact(
          p.workspace.kind === "unplanned" && p.state.status === "PENDING",
          "Workspace already planned",
        );
        operation(fact.operationId);
        requireFact(
          fact.workspace.baseCommit === p.baseCommit,
          "Workspace base mismatch",
        );
        p.workspace = {
          kind: "intent",
          operationId: fact.operationId,
          workspace: fact.workspace,
        };
        break;
      case "WorkspaceReady":
        requireFact(
          p.workspace.kind === "intent" &&
            p.workspace.operationId === fact.operationId,
          "Unknown workspace intent",
        );
        p.workspace = { ...p.workspace, kind: "ready" };
        p.state = { status: "READY", unit };
        break;
      case "AttemptReserved":
        requireFact(
          p.workspace.kind === "ready" &&
            p.state.status === "READY" &&
            p.attempts.length < p.maxStarts,
          "Worker reservation not allowed",
        );
        requireFact(
          fact.attempt.ordinal === p.attempts.length + 1 &&
            !p.attempts.some(
              (a) =>
                a.id === fact.attempt.id ||
                a.completionPath === fact.attempt.completionPath,
            ),
          "Invalid attempt identity",
        );
        p.attempts.push({ ...fact.attempt, kind: "reserved" });
        p.state = { status: "RUNNING", unit };
        break;
      case "WorkerStarted": {
        const a = selected(fact.attemptId);
        requireFact(
          a.kind === "reserved" && p.state.status === "RUNNING",
          "Worker start without reservation",
        );
        replace({ ...identity(a), kind: "running", process: fact.process });
        break;
      }
      case "AttemptInterrupted": {
        const a = selected(fact.attemptId);
        requireFact(
          (a.kind === "reserved" || a.kind === "running") &&
            p.state.status === "RUNNING",
          "Attempt cannot be interrupted",
        );
        replace({
          ...identity(a),
          kind: "interrupted",
          reason: fact.reason,
          artifacts: fact.artifacts,
        });
        p.state = { status: "READY", unit };
        break;
      }
      case "WorkerCompleted": {
        const a = selected(fact.attemptId);
        requireFact(
          (a.kind === "reserved" || a.kind === "running") &&
            p.state.status === "RUNNING" &&
            a.completionPath === fact.record.path,
          "Completion without current attempt",
        );
        replace({
          ...identity(a),
          kind: "completed",
          outcome: fact.outcome,
          record: fact.record,
        });
        if (fact.outcome.kind === "decision_required") {
          const request = fact.outcome.decision;
          requireFact(
            p.decisions &&
              !p.decisions.some(
                (d) => d.kind !== "resolved" || d.request.id === request.id,
              ),
            "Decision is not available or unique",
          );
          requireFact(
            request.runId === p.runId &&
              request.unitId === unit.id &&
              request.id === `${p.runId}:decision:${a.id}`,
            "Decision authority changed",
          );
          requireFact(
            request.question.trim() &&
              request.reason.trim() &&
              !request.evidence.length &&
              new Set(request.options?.map((o) => o.id)).size ===
                (request.options?.length ?? 0),
            "Invalid decision request",
          );
          p.decisions.push({ attemptId: a.id, request, kind: "requested" });
          p.state = { status: "WAITING_FOR_DECISION", unit, decision: request };
        } else {
          p.state =
            fact.outcome.kind === "completed"
              ? { status: "VERIFYING", unit }
              : { status: "FAILED", unit, reason: fact.outcome.reason };
        }
        break;
      }
      case "DecisionPublicationPlanned":
      case "DecisionPublicationStarted":
      case "DecisionPublished":
      case "DecisionConflictObserved":
      case "DecisionResolved": {
        const d = p.decisions?.find((d) => d.request.id === fact.decisionId);
        requireFact(
          d &&
            p.state.status === "WAITING_FOR_DECISION" &&
            p.state.decision.id === d.request.id,
          "No matching waiting decision",
        );
        const at = p.decisions!.indexOf(d);
        const base = { attemptId: d.attemptId, request: d.request };
        if (fact.type === "DecisionPublicationPlanned") {
          requireFact(d.kind === "requested", "Question already planned");
          operation(fact.publication.operationId);
          p.decisions![at] = {
            ...base,
            kind: "publication_planned",
            publication: fact.publication,
          };
        } else if (fact.type === "DecisionPublicationStarted") {
          requireFact(
            d.kind === "publication_planned" &&
              d.publication.operationId === fact.operationId,
            "Unknown publication plan",
          );
          p.decisions![at] = { ...d, kind: "publication_started" };
        } else if (fact.type === "DecisionPublished") {
          requireFact(
            d.kind === "publication_started" &&
              d.publication.operationId === fact.operationId &&
              d.publication.publisher.id === fact.receipt.comment.author.id,
            "Invalid publication receipt",
          );
          p.decisions![at] = { ...d, kind: "published", receipt: fact.receipt };
        } else {
          requireFact(
            d.kind === "published" || d.kind === "conflicted",
            "Question not published",
          );
          const resolver = p.contract.config.decisions!.authorizedResolver.id;
          if (fact.type === "DecisionConflictObserved") {
            requireFact(
              fact.conflict.comments.length >= 2 &&
                fact.conflict.comments.every(
                  (c) =>
                    c.author.id === resolver &&
                    Date.parse(c.createdAt) >=
                      Date.parse(d.receipt.comment.createdAt),
                ),
              "Invalid conflict authority",
            );
            requireFact(
              d.kind !== "conflicted" ||
                d.conflict.record.digest !== fact.conflict.record.digest,
              "Duplicate unchanged conflict",
            );
            p.decisions![at] = {
              ...d,
              kind: "conflicted",
              conflict: fact.conflict,
            };
          } else {
            const r = fact.resolution;
            requireFact(
              r.decisionId === d.request.id &&
                r.basis === "human" &&
                r.answer.trim() &&
                r.evidence.length &&
                fact.source.comment.author.id === resolver &&
                Date.parse(fact.source.comment.createdAt) >=
                  Date.parse(d.receipt.comment.createdAt),
              "Invalid resolution authority",
            );
            requireFact(
              d.request.options?.length
                ? d.request.options.some((o) => o.id === r.selectedOptionId)
                : r.selectedOptionId === undefined,
              "Invalid answer option",
            );
            p.decisions![at] = {
              ...base,
              kind: "resolved",
              publication: d.publication,
              receipt: d.receipt,
              resolution: r,
              source: fact.source,
            };
            p.state = { status: "READY", unit };
          }
        }
        break;
      }
      case "VerificationPlanned": {
        const a = selected(fact.attemptId);
        requireFact(
          a.kind === "completed" &&
            a.outcome.kind === "completed" &&
            p.state.status === "VERIFYING" &&
            p.verification.kind === "idle",
          "Verification without completed worker",
        );
        operation(fact.operationId);
        p.verification = {
          kind: "intent",
          operationId: fact.operationId,
          attemptId: fact.attemptId,
          evidencePath: fact.evidencePath,
        };
        break;
      }
      case "VerificationCompleted":
        requireFact(
          p.verification.kind === "intent" &&
            p.verification.operationId === fact.operationId &&
            p.verification.evidencePath === fact.evidence.path &&
            p.state.status === "VERIFYING",
          "Verification completion without intent",
        );
        p.verification = {
          ...p.verification,
          kind: "completed",
          evidence: fact.evidence,
        };
        p.state = durableVerdict(unit, fact.results, fact.issues);
        break;
      case "RunStopped":
        if (fact.reason === "worker_start_budget_exhausted") {
          requireFact(
            (p.state.status === "READY" ||
              (p.state.status === "REPAIR_READY" &&
                p.contract.config.repair)) &&
              p.attempts.length === p.maxStarts,
            "Budget exhaustion disagrees with attempts",
          );
        }
        if (fact.reason === "repair_budget_exhausted") {
          requireFact(
            p.contract.config.repair &&
              p.state.status === "REPAIR_READY" &&
              p.repairs?.length === (p.contract.config.repair.maxRepairs ?? 1),
            "Repair exhaustion disagrees with reservations",
          );
        }
        p.state = { status: "FAILED", unit, reason: fact.message };
        break;
      default:
        throw new Error("Unexpected durable event");
    }
  }
  requireFact(p, "Empty run history");
  return p;
}
