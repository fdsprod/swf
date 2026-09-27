// Checks retained live observations. The coordinator still reviews actual human authorization.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hash, validateResult, validateContext, schema } from "./support.mjs";
import {
  assertSnapshot,
  assertArtifacts,
  assertHistoricalDecisionArtifacts,
} from "./replay.mjs";

if (!process.env.P3_LIVE_PROOF) {
  process.stderr.write(
    "BLOCKED P3-LIVE: selected real GitHub issue, actual authorized human answer, fresh-process continuation, and publication-crash proof are required. Set P3_LIVE_PROOF to their reviewed evidence manifest.\n",
  );
  process.exit(1);
}
const proof = JSON.parse(readFileSync(process.env.P3_LIVE_PROOF, "utf8"));
function bytes(ref) {
  assert.ok(ref?.path && ref.digest);
  const b = readFileSync(ref.path);
  assert.equal(hash(b), ref.digest);
  return b;
}
function json(ref) {
  return JSON.parse(bytes(ref));
}
assert.equal(proof.schemaVersion, 1);
assert.equal(proof.requirement, "P3-LIVE");
assert.equal(
  proof.candidateSourceDigest,
  process.env.P3_CANDIDATE_SOURCE_DIGEST,
);
assert.ok(
  /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/[1-9]\d*$/.test(
    proof.issueUrl,
  ),
);
assert.ok(
  proof.coordinatorReview?.reviewer && proof.coordinatorReview?.reviewedAt,
);
assert.equal(proof.coordinatorReview.actualHumanAuthorizationConfirmed, true);
assert.ok(bytes(proof.humanAuthorizationRecord).length > 0);
const waiting = json(proof.waitingResult);
const done = json(proof.resumedResult);
schema(validateResult, waiting);
schema(validateResult, done);
assert.equal(waiting.kind, "durable_result");
assert.equal(done.kind, "durable_result");
assert.equal(waiting.projection.state.status, "WAITING_FOR_DECISION");
assert.equal(done.projection.state.status, "VERIFIED");
assertSnapshot(waiting);
assertSnapshot(done);
assertArtifacts(waiting.projection);
assertArtifacts(done.projection);
assertHistoricalDecisionArtifacts(waiting.events);
assertHistoricalDecisionArtifacts(done.events);
assert.equal(waiting.projection.runId, done.projection.runId);
assert.equal(
  done.projection.attempts.length,
  waiting.projection.attempts.length + 1,
);
const d = done.projection.decisions.at(-1);
assert.equal(d.kind, "resolved");
const expectedId =
  done.projection.contract.config.decisions.authorizedResolver.id;
assert.equal(d.source.comment.author.id, expectedId);
assert.ok(d.receipt.comment.url.startsWith(proof.issueUrl + "#"));
assert.ok(d.source.comment.url.startsWith(proof.issueUrl + "#"));
const marker = json(proof.crashMarker);
assert.equal(marker.point, "decision.after_publish");
assert.equal(marker.runId, done.projection.runId);
const pageSnapshot = json(proof.commentsSnapshot);
assert.ok(Array.isArray(pageSnapshot));
const body = bytes(d.publication.body).toString("utf8");
assert.ok(body.includes("\n"));
const questions = pageSnapshot
  .flat()
  .filter((c) => c.user?.id === d.publication.publisher.id && c.body === body);
assert.equal(questions.length, 1);
assert.equal(questions[0].id, d.receipt.comment.id);
assert.ok(
  proof.firstFactoryPid > 0 &&
    proof.resumedFactoryPid > 0 &&
    proof.firstFactoryPid !== proof.resumedFactoryPid,
);
const context = json(proof.continuationContext);
schema(validateContext, context);
assert.equal(context.runId, done.projection.runId);
assert.deepEqual(
  context.context.decisions,
  done.projection.decisions
    .filter((d) => d.kind === "resolved")
    .map((d) => d.resolution),
);
process.stdout.write(
  `P3-LIVE retained evidence passed for ${proof.issueUrl}; actual human authorization review: ${proof.coordinatorReview.reviewer}.\n`,
);
