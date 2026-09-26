import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateEvent, validateProjection, validateCompletion, validateEvidence, schema, hash, readStore } from './support.mjs';

function verificationState(unit, results, issues) {
  if (issues.length) return { status: 'FAILED', unit, reason: issues.join('; ') };
  const required = unit.verification.required.map(spec => spec.id);
  const ids = results.map(result => result.specId);
  if (ids.length !== required.length || new Set(ids).size !== ids.length || required.some(id => !ids.includes(id))) {
    return { status: 'FAILED', unit, reason: 'Invalid verification result coverage' };
  }
  if (results.some(result => result.status === 'error')) return { status: 'FAILED', unit, reason: results.filter(result => result.status === 'error').map(result => result.summary).join('; ') };
  if (results.some(result => result.status === 'passed' && result.evidence.length === 0)) return { status: 'FAILED', unit, reason: 'Missing verification evidence' };
  return { status: results.some(result => result.status === 'failed') ? 'REPAIR_READY' : 'VERIFIED', unit, results };
}

// This reducer is independent acceptance code. It imports no candidate module.
export function replay(events) {
  assert.ok(events.length > 0, 'A run requires a creation fact');
  let p;
  const operationIds = new Set();
  for (const [index, event] of events.entries()) {
    schema(validateEvent, event); assert.equal(event.sequence, index + 1);
    const fact = structuredClone(event.fact);
    if (index === 0) {
      assert.equal(fact.type, 'RunCreated');
      const request = fact.contract.config.request;
      const unit = { id: `${request.id}:unit:1`, objective: request.objective, constraints: request.constraints, verification: fact.contract.config.verification, metadata: request.metadata };
      assert.deepEqual(fact.graph, { id: `${request.id}:graph`, requestId: request.id, units: [unit], dependencies: [] });
      assert.notEqual(event.runId, request.id, 'Run identity is independent of request identity');
      p = { schemaVersion: 1, runId: event.runId, sequence: 1, contract: fact.contract, graph: fact.graph, baseCommit: fact.baseCommit,
        state: { status: 'PENDING', unit }, maxStarts: fact.maxStarts, workspace: { kind: 'unplanned' }, attempts: [], verification: { kind: 'idle' } };
      if (fact.contract.config.decisions) p.decisions = [];
      continue;
    }
    assert.equal(event.runId, p.runId); p.sequence = event.sequence;
    const unit = p.graph.units[0];
    const current = () => { assert.ok(p.attempts.length); return p.attempts.at(-1); };
    const selected = () => { const a = current(); assert.equal(a.id, fact.attemptId); return a; };
    const replace = attempt => { p.attempts[p.attempts.length - 1] = attempt; };
    const identity = attempt => ({ id: attempt.id, ordinal: attempt.ordinal, completionPath: attempt.completionPath });
    const operation = id => { assert.equal(operationIds.has(id), false, 'Effect IDs cannot be reused'); operationIds.add(id); };
    switch (fact.type) {
      case 'WorkspacePlanned':
        assert.equal(p.workspace.kind, 'unplanned'); assert.equal(p.state.status, 'PENDING'); operation(fact.operationId);
        assert.equal(fact.workspace.baseCommit, p.baseCommit, 'Workspace must use the original resolved base');
        p.workspace = { kind: 'intent', operationId: fact.operationId, workspace: fact.workspace }; break;
      case 'WorkspaceReady':
        assert.equal(p.workspace.kind, 'intent'); assert.equal(fact.operationId, p.workspace.operationId);
        p.workspace.kind = 'ready'; p.state = { status: 'READY', unit }; break;
      case 'AttemptReserved':
        assert.equal(p.workspace.kind, 'ready'); assert.equal(p.state.status, 'READY');
        assert.ok(p.attempts.length < p.maxStarts); assert.equal(fact.attempt.ordinal, p.attempts.length + 1);
        assert.equal(p.attempts.some(attempt => attempt.id === fact.attempt.id || attempt.completionPath === fact.attempt.completionPath), false);
        p.attempts.push({ ...fact.attempt, kind: 'reserved' }); p.state = { status: 'RUNNING', unit }; break;
      case 'WorkerStarted': {
        const attempt = selected(); assert.equal(attempt.kind, 'reserved'); assert.equal(p.state.status, 'RUNNING');
        replace({ ...identity(attempt), kind: 'running', process: fact.process }); break;
      }
      case 'AttemptInterrupted': {
        const attempt = selected(); assert.ok(['reserved', 'running'].includes(attempt.kind));
        replace({ ...identity(attempt), kind: 'interrupted', reason: fact.reason, artifacts: fact.artifacts });
        p.state = { status: 'READY', unit }; break;
      }
      case 'WorkerCompleted': {
        const attempt = selected(); assert.ok(['reserved', 'running'].includes(attempt.kind)); assert.equal(fact.record.path, attempt.completionPath);
        replace({ ...identity(attempt), kind: 'completed', outcome: fact.outcome, record: fact.record });
        if (fact.outcome.kind === 'decision_required') {
          assert.ok(p.decisions); assert.equal(p.decisions.some(d => d.kind !== 'resolved'), false);
          const request = fact.outcome.decision;
          assert.equal(request.runId, p.runId); assert.equal(request.unitId, unit.id);
          assert.equal(p.decisions.some(d => d.request.id === request.id), false);
          p.decisions.push({attemptId:attempt.id,request,kind:'requested'});
          p.state = {status:'WAITING_FOR_DECISION',unit,decision:request};
        } else p.state = fact.outcome.kind === 'completed' ? { status: 'VERIFYING', unit } : { status: 'FAILED', unit, reason: fact.outcome.reason };
        break;
      }
      case 'VerificationPlanned': {
        const attempt = selected(); assert.equal(attempt.kind, 'completed'); assert.equal(attempt.outcome.kind, 'completed');
        assert.equal(p.state.status, 'VERIFYING'); assert.equal(p.verification.kind, 'idle'); operation(fact.operationId);
        p.verification = { kind: 'intent', operationId: fact.operationId, attemptId: fact.attemptId, evidencePath: fact.evidencePath }; break;
      }
      case 'VerificationCompleted':
        assert.equal(p.verification.kind, 'intent'); assert.equal(fact.operationId, p.verification.operationId); assert.equal(fact.evidence.path, p.verification.evidencePath);
        p.verification = { ...p.verification, kind: 'completed', evidence: fact.evidence };
        p.state = verificationState(unit, fact.results, fact.issues); break;
      case 'DecisionPublicationPlanned': {
        const d=decision(p,fact); assert.equal(d.kind,'requested'); operation(fact.publication.operationId);
        Object.assign(d,{kind:'publication_planned',publication:fact.publication}); break;
      }
      case 'DecisionPublicationStarted': {
        const d=decision(p,fact); assert.equal(d.kind,'publication_planned'); assert.equal(d.publication.operationId,fact.operationId);
        d.kind='publication_started'; break;
      }
      case 'DecisionPublished': {
        const d=decision(p,fact); assert.equal(d.kind,'publication_started'); assert.equal(d.publication.operationId,fact.operationId);
        assert.equal(fact.receipt.comment.author.id,d.publication.publisher.id);
        Object.assign(d,{kind:'published',receipt:fact.receipt}); break;
      }
      case 'DecisionConflictObserved': {
        const d=decision(p,fact); assert.ok(['published','conflicted'].includes(d.kind));
        assert.ok(fact.conflict.comments.length>=2); fact.conflict.comments.forEach(c=>assert.equal(c.author.id,p.contract.config.decisions.authorizedResolver.id));
        if(d.kind==='conflicted') assert.notEqual(d.conflict.record.digest,fact.conflict.record.digest,'Unchanged conflicts must not append duplicate facts');
        Object.assign(d,{kind:'conflicted',conflict:fact.conflict}); break;
      }
      case 'DecisionResolved': {
        const d=decision(p,fact); assert.ok(['published','conflicted'].includes(d.kind));
        assert.equal(fact.resolution.decisionId,d.request.id); assert.equal(fact.resolution.basis,'human');
        assert.equal(fact.source.comment.author.id,p.contract.config.decisions.authorizedResolver.id);
        assert.ok(Date.parse(fact.source.comment.createdAt)>=Date.parse(d.receipt.comment.createdAt));
        if(d.request.options?.length) assert.ok(d.request.options.some(o=>o.id===fact.resolution.selectedOptionId));
        else assert.equal(fact.resolution.selectedOptionId,undefined);
        delete d.conflict; Object.assign(d,{kind:'resolved',resolution:fact.resolution,source:fact.source});
        p.state={status:'READY',unit}; break;
      }
      case 'RunStopped':
        if (fact.reason === 'worker_start_budget_exhausted') { assert.equal(p.attempts.length, p.maxStarts); assert.equal(p.state.status, 'READY'); }
        p.state = { status: 'FAILED', unit, reason: fact.message }; break;
      default: assert.fail(`Unexpected durable fact ${fact.type}`);
    }
  }
  schema(validateProjection, p);
  return p;
}

function decision(p,fact) {
  assert.equal(p.state.status,'WAITING_FOR_DECISION');
  const d=p.decisions?.find(d=>d.request.id===fact.decisionId); assert.ok(d);
  assert.equal(p.state.decision.id,d.request.id); return d;
}
export function assertSnapshot(snapshot) {
  assert.deepEqual(snapshot.projection, replay(snapshot.events), 'Projection must equal independent fact replay');
  return snapshot.projection;
}
export function artifact(ref) {
  const bytes = readFileSync(ref.path); assert.equal(hash(bytes), ref.digest, `Artifact digest: ${ref.path}`); return bytes;
}
export function assertArtifacts(projection) {
  for (const attempt of projection.attempts) {
    if (attempt.kind === 'interrupted') attempt.artifacts.forEach(artifact);
    if (attempt.kind === 'completed') {
      const record = JSON.parse(artifact(attempt.record)); schema(validateCompletion, record);
      assert.equal(record.attemptId, attempt.id); assert.deepEqual(record.outcome, attempt.outcome);
      artifact(record.process.stdout); artifact(record.process.stderr);
    }
  }
  for(const d of projection.decisions||[]) {
    if(d.publication) artifact(d.publication.body);
    if(d.receipt) {
      const comment=JSON.parse(artifact(d.receipt.record)); assert.equal(comment.id,d.receipt.comment.id);
      assert.equal(comment.user.id,d.publication.publisher.id); assert.equal(comment.body,artifact(d.publication.body).toString('utf8'));
    }
    if(d.conflict) artifact(d.conflict.record);
    if(d.kind==='resolved') {
      const comment=JSON.parse(artifact(d.source.record)); assert.equal(comment.id,d.source.comment.id);
      assert.equal(comment.user.id,projection.contract.config.decisions.authorizedResolver.id);
      const answer=JSON.parse(comment.body); assert.equal(answer.decisionId,d.request.id);
      assert.equal(answer.answer,d.resolution.answer); assert.equal(answer.selectedOptionId,d.resolution.selectedOptionId??null);
    }
  }
  if (projection.verification.kind === 'completed') {
    const evidence = JSON.parse(artifact(projection.verification.evidence)); schema(validateEvidence, evidence);
    assert.equal(evidence.attemptId, projection.verification.attemptId);
    assert.deepEqual(evidence.verdict, projection.state); assert.deepEqual(evidence.contract, projection.contract);
    artifact(evidence.diff); artifact(evidence.worker.process.stdout); artifact(evidence.worker.process.stderr);
    for (const command of evidence.commands) { artifact(command.process.stdout); artifact(command.process.stderr); }
    return evidence;
  }
}
export function assertDurable(observed, f, expectedStatus, kind = 'durable_result') {
  assert.equal(observed.result.kind, kind);
  const snapshot = { events: observed.result.events, projection: observed.result.projection };
  const p = assertSnapshot(snapshot);
  assert.equal(p.state.status, expectedStatus);
  assert.equal(observed.code, kind === 'durable_status' || ['VERIFIED','WAITING_FOR_DECISION'].includes(expectedStatus) ? 0 : 1);
  assert.deepEqual(readStore(f), snapshot, 'CLI result must reflect durable SQLite state');
  assert.deepEqual(p.contract.config, f.config);
  assert.equal(p.baseCommit, f.base);
  if (p.workspace.kind !== 'unplanned') {
    assert.equal(p.workspace.workspace.repositoryPath, f.repo); assert.equal(p.workspace.workspace.baseCommit, f.base);
  }
  return p;
}
