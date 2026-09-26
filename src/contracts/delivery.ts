import type { Artifact, LocalConfig, ProcessRecord } from "./local.js";
import type { GitHubIdentity } from "./decisions.js";
import type { RepairConfig } from "./repair.js";

export interface GitHubProgram { executable: string; prefixArgs: string[]; timeoutSeconds: number }
export type DeliveryTransport = { kind: "github_https"; url: string } | { kind: "local_bare"; path: string };
export interface RequiredCheck { name: string; appId: number }
export interface CommitIdentity { name: string; email: string }
export interface GitHubRunConfig {
  schemaVersion: 1;
  issue: { owner: string; repo: string; number: number };
  baseBranch: string;
  constraints: string[];
  acceptanceCriteria: string[];
  runtime: Omit<LocalConfig, "schemaVersion" | "request" | "decisions" | "repair">;
  github: GitHubProgram;
  git: { executable: string; timeoutSeconds: number };
  decisions?: { authorizedResolver: GitHubIdentity };
  repair?: RepairConfig;
  delivery: {
    transport: { kind: "github_https" } | { kind: "local_bare"; path: string };
    commitIdentity: CommitIdentity;
    requiredChecks: RequiredCheck[];
  };
}
export interface RepositoryIdentity { id: number; owner: string; name: string; url: string }
export interface GitHubIntake {
  input: GitHubRunConfig;
  repository: RepositoryIdentity;
  issue: { id: number; number: number; url: string };
  base: { branch: string; sha: string };
  transport: DeliveryTransport;
  records: { repository: Artifact; issue: Artifact; base: Artifact };
}
export interface CommitInput {
  tree: string;
  parent: string;
  author: CommitIdentity & { date: string };
  committer: CommitIdentity & { date: string };
  message: Artifact;
  expectedSha: string;
}
export interface DeliveryPlan {
  operationId: string;
  verificationId: string;
  evidence: Artifact;
  candidateDigest: string;
  baseCommit: string;
  repository: RepositoryIdentity;
  transport: DeliveryTransport;
  branch: string;
  commit: CommitInput;
  snapshot: Artifact;
}
export interface DeliverySnapshot {
  schemaVersion: 1;
  files: { path: string; digest: string; mode: "100644" | "100755"; content: Artifact }[];
}
export interface CommitReceipt { sha: string; process: ProcessRecord }
export interface PushReceipt { ref: string; sha: string; process: ProcessRecord }
export interface PullRequestPlan { operationId: string; publisher: GitHubIdentity; title: string; body: Artifact }
export type PullRequestState = { kind: "open" | "closed" } | { kind: "merged"; mergeCommitSha: string };
export interface PullRequestReceipt {
  id: number;
  number: number;
  url: string;
  authorId: number;
  repositoryId: number;
  head: { repositoryId: number; ref: string; sha: string };
  base: { repositoryId: number; ref: string; sha: string };
  state: PullRequestState;
  record: Artifact;
}
export type DeliveryProjection =
  | { kind: "unplanned" }
  | { kind: "planned"; plan: DeliveryPlan }
  | { kind: "committed" | "push_started"; plan: DeliveryPlan; commit: CommitReceipt }
  | { kind: "pushed"; plan: DeliveryPlan; commit: CommitReceipt; push: PushReceipt }
  | { kind: "pr_planned" | "pr_started"; plan: DeliveryPlan; commit: CommitReceipt; push: PushReceipt; publication: PullRequestPlan }
  | { kind: "created"; plan: DeliveryPlan; commit: CommitReceipt; push: PushReceipt; publication: PullRequestPlan; pullRequest: PullRequestReceipt };
export type CheckRunObservation = { id: number; name: string; appId: number; headSha: string } & (
  | { kind: "pending"; status: "queued" | "in_progress" | "waiting" | "requested" | "pending" }
  | { kind: "completed"; conclusion: "success" | "failure" | "neutral" | "cancelled" | "skipped" | "timed_out" | "action_required" | "stale" | "startup_failure" }
);
export interface CiObservation {
  headSha: string;
  before: PullRequestReceipt;
  after: PullRequestReceipt;
  checks: CheckRunObservation[];
  record: Artifact;
}
export type CiProjection = { kind: "unobserved" } | { kind: "pending" | "passed" | "failed" | "stale_head"; observation: CiObservation };
export type DeliveryFact =
  | { type: "DeliveryPlanned"; plan: DeliveryPlan }
  | { type: "CommitCreated"; operationId: string; receipt: CommitReceipt }
  | { type: "PushStarted"; operationId: string }
  | { type: "PushConfirmed"; operationId: string; receipt: PushReceipt }
  | { type: "PrPlanned"; publication: PullRequestPlan }
  | { type: "PrStarted"; operationId: string }
  | { type: "PrCreated"; operationId: string; receipt: PullRequestReceipt }
  | { type: "PullRequestObserved"; receipt: PullRequestReceipt }
  | { type: "CiObserved"; observation: CiObservation };
