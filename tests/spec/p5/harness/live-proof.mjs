// Retained evidence cannot replace the coordinator's review of real remote actions.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hash, validateResult, schema } from "./support.mjs";
import {
  assertSnapshot,
  assertArtifacts,
  assertIntake,
  assertDeliveryArtifacts,
  artifact,
} from "./replay.mjs";
import { assertGitModes, treeRecords } from "./git-oracle.mjs";

if (!process.env.P5_LIVE_PROOF) {
  process.stderr.write(
    "BLOCKED P5-LIVE: selected real repository/issue, HTTPS push, one real PR, exact-head required CI, credential-boundary review and fresh-process resume evidence are required. Set P5_LIVE_PROOF to the reviewed manifest.\n",
  );
  process.exit(1);
}
const proof = JSON.parse(readFileSync(process.env.P5_LIVE_PROOF, "utf8"));
const json = (ref) => JSON.parse(artifact(ref));
assert.equal(proof.schemaVersion, 1);
assert.equal(proof.requirement, "P5-LIVE");
assert.equal(
  proof.candidateSourceDigest,
  process.env.P5_CANDIDATE_SOURCE_DIGEST,
);
assert.ok(
  proof.coordinatorReview?.reviewer && proof.coordinatorReview?.reviewedAt,
);
assert.equal(proof.coordinatorReview.realRemoteActionsConfirmed, true);
assert.equal(proof.coordinatorReview.credentialBoundaryReviewed, true);
assert.ok(artifact(proof.authorizationRecord).length);
const before = json(proof.afterPushStatus);
const done = json(proof.resumedResult);
const again = json(proof.repeatResult);
for (const result of [before, done, again]) {
  schema(validateResult, result);
  assertSnapshot(result);
  assertArtifacts(result.projection);
  assertIntake(result.projection);
  assertDeliveryArtifacts(result.events);
}
const p = done.projection;
assert.equal(p.state.status, "VERIFIED");
assert.equal(p.delivery.kind, "created");
assert.equal(p.delivery.pullRequest.state.kind, "open");
assert.equal(p.ci.kind, "passed");
assert.equal(p.intake.transport.kind, "github_https");
assert.equal(
  p.intake.transport.url,
  `https://github.com/${p.intake.repository.owner}/${p.intake.repository.name}.git`,
);
assert.equal(before.projection.runId, p.runId);
assert.equal(before.projection.delivery.kind, "push_started");
assert.equal(before.projection.delivery.commit.sha, p.delivery.commit.sha);
assert.equal(
  again.projection.delivery.pullRequest.id,
  p.delivery.pullRequest.id,
);
assert.equal(again.projection.delivery.commit.sha, p.delivery.commit.sha);
assert.equal(again.events.filter((e) => e.fact.type === "PrCreated").length, 1);
assert.equal(
  again.events.filter((e) => e.fact.type === "CommitCreated").length,
  1,
);
assert.equal(p.delivery.pullRequest.head.sha, p.delivery.commit.sha);
assert.equal(p.delivery.pullRequest.repositoryId, p.intake.repository.id);
assert.ok(
  p.delivery.pullRequest.url.startsWith(p.intake.repository.url + "/pull/"),
);
const marker = json(proof.crashMarker);
assert.equal(marker.point, "delivery.after_push");
assert.equal(marker.runId, p.runId);
assert.ok(
  proof.firstFactoryPid > 0 &&
    proof.resumedFactoryPid > 0 &&
    proof.firstFactoryPid !== proof.resumedFactoryPid,
);
const remote = proof.remoteRead;
assert.deepEqual(remote.termination, { kind: "exited", exitCode: 0 });
artifact(remote.stderr);
assert.equal(
  artifact(remote.stdout).toString("utf8").trim(),
  p.delivery.commit.sha + "\trefs/heads/" + p.delivery.plan.branch,
);
const snapshot = json(p.delivery.plan.snapshot);
const checkout = json(proof.deliveredCheckout);
assert.equal(checkout.commitSha, p.delivery.commit.sha);
assert.equal(checkout.files.length, snapshot.files.length);
const baseTree = proof.baseTreeRead;
assert.deepEqual(baseTree.termination, { kind: "exited", exitCode: 0 });
assert.ok(
  baseTree.args.includes("ls-tree") &&
    baseTree.args.includes(p.baseCommit) &&
    baseTree.args.includes("-rz") &&
    baseTree.args.includes("--full-tree"),
);
artifact(baseTree.stderr);
assertGitModes(snapshot, treeRecords(artifact(baseTree.stdout)));
for (const expected of snapshot.files) {
  const observed = checkout.files.find((f) => f.path === expected.path);
  assert.ok(observed);
  assert.equal(observed.mode, expected.mode);
  assert.equal(observed.digest, expected.digest);
  assert.equal(hash(artifact(observed.content)), expected.digest);
}
const prs = json(proof.allStatePullRequests).flat();
const matching = prs.filter(
  (pr) =>
    pr.head?.repo?.id === p.intake.repository.id &&
    pr.head?.ref === p.delivery.plan.branch &&
    pr.head?.sha === p.delivery.commit.sha &&
    pr.base?.repo?.id === p.intake.repository.id &&
    pr.base?.ref === p.intake.base.branch &&
    pr.user?.id === p.delivery.publication.publisher.id &&
    pr.title === p.delivery.publication.title &&
    pr.body === artifact(p.delivery.publication.body).toString("utf8"),
);
assert.equal(matching.length, 1);
assert.equal(matching[0].id, p.delivery.pullRequest.id);
process.stdout.write(
  `P5-LIVE retained evidence passed for ${p.delivery.pullRequest.url}; real remote and credential review: ${proof.coordinatorReview.reviewer}.\n`,
);
