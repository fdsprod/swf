import { createHash } from "node:crypto";
import type { DurableProjection } from "../contracts/durable.js";
import type {
  CiObservation,
  CiProjection,
  DeliveryFact,
  GitHubIntake,
  PullRequestReceipt,
  RequiredCheck,
} from "../contracts/delivery.js";
import { stable } from "./durable.js";

type GitHubProjection = Extract<DurableProjection, { intake: GitHubIntake }>;
function requireFact(value: unknown, reason: string): asserts value {
  if (!value) {
    throw new Error(reason);
  }
}
export const deliveryBranch = (runId: string): string =>
  `swf/${createHash("sha256").update(runId).digest("hex")}`;
export function ciVerdict(
  required: RequiredCheck[],
  head: string,
  observation: CiObservation,
): CiProjection {
  requireFact(
    new Set(observation.checks.map((c) => c.id)).size ===
      observation.checks.length,
    "Duplicate check identities",
  );
  if (
    observation.before.state.kind === "closed" ||
    observation.after.state.kind === "closed"
  ) {
    return { kind: "unobserved" };
  }
  if (
    observation.before.head.sha !== head ||
    observation.after.head.sha !== head
  ) {
    return { kind: "stale_head", observation };
  }
  const results = required.map((spec) => {
    const matches = observation.checks.filter(
      (c) =>
        c.name === spec.name && c.appId === spec.appId && c.headSha === head,
    );
    return matches.length !== 1 || matches[0]!.kind === "pending"
      ? "pending"
      : matches[0]!.conclusion === "success"
        ? "passed"
        : "failed";
  });
  return {
    kind: results.includes("failed")
      ? "failed"
      : results.every((r) => r === "passed")
        ? "passed"
        : "pending",
    observation,
  };
}
export function assertPrIdentity(
  p: GitHubProjection,
  receipt: PullRequestReceipt,
  exactHead: boolean,
): void {
  const d = p.delivery;
  requireFact(
    "publication" in d && "commit" in d,
    "PR has no publication intent",
  );
  requireFact(
    receipt.repositoryId === p.intake.repository.id &&
      receipt.head.repositoryId === p.intake.repository.id &&
      receipt.base.repositoryId === p.intake.repository.id &&
      receipt.head.ref === d.plan.branch &&
      receipt.base.ref === p.intake.base.branch &&
      receipt.authorId === d.publication.publisher.id,
    "PR differs from delivery identity",
  );
  requireFact(
    !exactHead || receipt.head.sha === d.commit.sha,
    "PR head differs from delivered commit",
  );
  if (d.kind === "created") {
    requireFact(
      receipt.id === d.pullRequest.id &&
        receipt.number === d.pullRequest.number,
      "PR identity changed",
    );
  }
}
export function deliveryFact(
  p: GitHubProjection,
  fact: DeliveryFact,
  operation: (id: string) => void,
): void {
  const d = p.delivery;
  switch (fact.type) {
    case "DeliveryPlanned": {
      const plan = fact.plan;
      requireFact(
        d.kind === "unplanned" &&
          p.state.status === "VERIFIED" &&
          p.verification.kind === "completed" &&
          !p.decisions?.some((r) => r.kind !== "resolved"),
        "Delivery requires verified resolved work",
      );
      requireFact(
        plan.verificationId === p.verification.operationId &&
          stable(plan.evidence) === stable(p.verification.evidence) &&
          plan.baseCommit === p.baseCommit &&
          plan.commit.parent === p.baseCommit &&
          stable(plan.repository) === stable(p.intake.repository) &&
          stable(plan.transport) === stable(p.intake.transport) &&
          plan.branch === deliveryBranch(p.runId),
        "Delivery plan differs from run authority",
      );
      for (const identity of [plan.commit.author, plan.commit.committer]) {
        requireFact(
          identity.name === p.intake.input.delivery.commitIdentity.name &&
            identity.email === p.intake.input.delivery.commitIdentity.email &&
            /^\d+ \+0000$/.test(identity.date),
          "Commit identity differs from policy",
        );
      }
      operation(plan.operationId);
      p.delivery = { kind: "planned", plan };
      break;
    }
    case "CommitCreated":
      requireFact(
        d.kind === "planned" &&
          fact.operationId === d.plan.operationId &&
          fact.receipt.sha === d.plan.commit.expectedSha &&
          fact.receipt.process.termination.kind === "exited" &&
          fact.receipt.process.termination.exitCode === 0,
        "Invalid commit receipt",
      );
      p.delivery = { ...d, kind: "committed", commit: fact.receipt };
      break;
    case "PushStarted":
      requireFact(
        d.kind === "committed" && fact.operationId === d.plan.operationId,
        "Push without committed object",
      );
      p.delivery = { ...d, kind: "push_started" };
      break;
    case "PushConfirmed":
      requireFact(
        d.kind === "push_started" &&
          fact.operationId === d.plan.operationId &&
          fact.receipt.sha === d.commit.sha &&
          fact.receipt.ref === `refs/heads/${d.plan.branch}` &&
          fact.receipt.process.termination.kind === "exited" &&
          fact.receipt.process.termination.exitCode === 0,
        "Push receipt differs from intended ref",
      );
      p.delivery = { ...d, kind: "pushed", push: fact.receipt };
      break;
    case "PrPlanned":
      requireFact(d.kind === "pushed", "PR plan before confirmed push");
      operation(fact.publication.operationId);
      p.delivery = { ...d, kind: "pr_planned", publication: fact.publication };
      break;
    case "PrStarted":
      requireFact(
        d.kind === "pr_planned" &&
          fact.operationId === d.publication.operationId,
        "Unknown PR intent",
      );
      p.delivery = { ...d, kind: "pr_started" };
      break;
    case "PrCreated":
      requireFact(
        d.kind === "pr_started" &&
          fact.operationId === d.publication.operationId,
        "PR creation without intent",
      );
      assertPrIdentity(p, fact.receipt, true);
      p.delivery = { ...d, kind: "created", pullRequest: fact.receipt };
      break;
    case "PullRequestObserved":
      requireFact(d.kind === "created", "Observation without delivered PR");
      assertPrIdentity(p, fact.receipt, false);
      p.delivery = { ...d, pullRequest: fact.receipt };
      p.ci = { kind: "unobserved" };
      break;
    case "CiObserved":
      requireFact(
        d.kind === "created" && fact.observation.headSha === d.commit.sha,
        "CI observation without delivered head",
      );
      assertPrIdentity(p, fact.observation.before, false);
      assertPrIdentity(p, fact.observation.after, false);
      p.ci = ciVerdict(
        p.intake.input.delivery.requiredChecks,
        d.commit.sha,
        fact.observation,
      );
      p.delivery = { ...d, pullRequest: fact.observation.after };
      break;
  }
}
