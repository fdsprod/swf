import type { Instructions } from "./skills.js";
import type {
  DecisionRequest,
  EvidenceRef,
  WorkRequest,
  WorkUnit,
} from "./index.js";
import type { Artifact, LocalWorkspace } from "./local.js";
import type { DurableAttempt } from "./durable.js";
import type { RepairContext } from "./repair.js";

export interface GitHubIdentity {
  id: number;
  login: string;
}
export interface DecisionConfig {
  kind: "github_issue_comments";
  executable: string;
  prefixArgs: string[];
  timeoutSeconds: number;
  authorizedResolver: GitHubIdentity;
}
export interface DecisionResolution {
  id: string;
  decisionId: string;
  answer: string;
  selectedOptionId?: string;
  basis: "human";
  evidence: EvidenceRef[];
  resolvedAt: string;
}
export interface DecisionAnswer {
  schemaVersion: 1;
  decisionId: string;
  answer: string;
  selectedOptionId: string | null;
}
export interface GitHubCommentIdentity {
  id: number;
  url: string;
  author: GitHubIdentity;
  createdAt: string;
  updatedAt: string;
}
export interface DecisionPublication {
  operationId: string;
  publisher: GitHubIdentity;
  body: Artifact;
}
export interface DecisionCommentReceipt {
  comment: GitHubCommentIdentity;
  record: Artifact;
}
export interface DecisionConflict {
  comments: GitHubCommentIdentity[];
  record: Artifact;
}
export type DecisionRecord = { attemptId: string; request: DecisionRequest } & (
  | { kind: "requested" }
  | {
      kind: "publication_planned" | "publication_started";
      publication: DecisionPublication;
    }
  | {
      kind: "published";
      publication: DecisionPublication;
      receipt: DecisionCommentReceipt;
    }
  | {
      kind: "conflicted";
      publication: DecisionPublication;
      receipt: DecisionCommentReceipt;
      conflict: DecisionConflict;
    }
  | {
      kind: "resolved";
      publication: DecisionPublication;
      receipt: DecisionCommentReceipt;
      resolution: DecisionResolution;
      source: DecisionCommentReceipt;
    }
);
export type DecisionFact =
  | {
      type: "DecisionPublicationPlanned";
      decisionId: string;
      publication: DecisionPublication;
    }
  | {
      type: "DecisionPublicationStarted";
      decisionId: string;
      operationId: string;
    }
  | {
      type: "DecisionPublished";
      decisionId: string;
      operationId: string;
      receipt: DecisionCommentReceipt;
    }
  | {
      type: "DecisionConflictObserved";
      decisionId: string;
      conflict: DecisionConflict;
    }
  | {
      type: "DecisionResolved";
      decisionId: string;
      resolution: DecisionResolution;
      source: DecisionCommentReceipt;
    };
export type DecisionWireResponse = {
  outcome:
    | { kind: "completed" | "blocked" | "failed"; message: string }
    | {
        kind: "decision_required";
        decision: {
          question: string;
          reason: string;
          options: {
            id: string;
            description: string;
            consequences: string[];
          }[];
          impact: string[];
          reversible: boolean;
        };
      };
};
export interface ContextPackage {
  instructions?: Instructions;
  repair?: RepairContext;
  request: WorkRequest;
  unit: WorkUnit;
  priorAttempts: DurableAttempt[];
  decisions: DecisionResolution[];
  evidence: EvidenceRef[];
  repositoryContext: { path: string; baseCommit: string }[];
}
export interface DecisionWorkerInput {
  schemaVersion: 1;
  runId: string;
  attemptId: string;
  workspace: LocalWorkspace;
  context: ContextPackage;
}
