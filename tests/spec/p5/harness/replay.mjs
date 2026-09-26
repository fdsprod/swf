import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateEvent, validateProjection, validateCompletion, validateEvidence, validateSnapshot, schema, hash, readStore } from './support.mjs';
import { assertHistoricalDecisionArtifacts } from '../../p3/harness/replay.mjs';

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
      if (fact.contract.config.repair) p.repairs = [];
      if(fact.intake){p.intake=fact.intake;p.delivery={kind:'unplanned'};p.ci={kind:'unobserved'};assert.equal(p.baseCommit,fact.intake.base.sha);assert.equal(fact.intake.base.branch,fact.intake.input.baseBranch);}
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
      case 'DeliveryPlanned': {
        assert.ok(p.intake);assert.equal(p.delivery.kind,'unplanned');assert.equal(p.state.status,'VERIFIED');assert.equal(p.verification.kind,'completed');assert.equal(p.decisions?.some(d=>d.kind!=='resolved')??false,false);
        const plan=fact.plan;operation(plan.operationId);assert.equal(plan.verificationId,p.verification.operationId);assert.deepEqual(plan.evidence,p.verification.evidence);assert.equal(plan.baseCommit,p.baseCommit);assert.equal(plan.commit.parent,p.baseCommit);
        assert.deepEqual(plan.repository,p.intake.repository);assert.deepEqual(plan.transport,p.intake.transport);assert.equal(plan.branch,'swf/'+hash(p.runId));
        for(const identity of [plan.commit.author,plan.commit.committer]){assert.equal(identity.name,p.intake.input.delivery.commitIdentity.name);assert.equal(identity.email,p.intake.input.delivery.commitIdentity.email);assert.match(identity.date,/^\d+ \+0000$/);}
        assert.equal(plan.commit.expectedSha,commitSha(plan.commit));p.delivery={kind:'planned',plan};break;
      }
      case 'CommitCreated':
        assert.equal(p.delivery.kind,'planned');assert.equal(fact.operationId,p.delivery.plan.operationId);assert.equal(fact.receipt.sha,p.delivery.plan.commit.expectedSha);assert.deepEqual(fact.receipt.process.termination,{kind:'exited',exitCode:0});p.delivery={...p.delivery,kind:'committed',commit:fact.receipt};break;
      case 'PushStarted':
        assert.equal(p.delivery.kind,'committed');assert.equal(fact.operationId,p.delivery.plan.operationId);p.delivery.kind='push_started';break;
      case 'PushConfirmed':
        assert.equal(p.delivery.kind,'push_started');assert.equal(fact.operationId,p.delivery.plan.operationId);assert.equal(fact.receipt.sha,p.delivery.commit.sha);assert.equal(fact.receipt.ref,'refs/heads/'+p.delivery.plan.branch);assert.deepEqual(fact.receipt.process.termination,{kind:'exited',exitCode:0});p.delivery={...p.delivery,kind:'pushed',push:fact.receipt};break;
      case 'PrPlanned':
        assert.equal(p.delivery.kind,'pushed');operation(fact.publication.operationId);p.delivery={...p.delivery,kind:'pr_planned',publication:fact.publication};break;
      case 'PrStarted':
        assert.equal(p.delivery.kind,'pr_planned');assert.equal(fact.operationId,p.delivery.publication.operationId);p.delivery.kind='pr_started';break;
      case 'PrCreated':
        assert.equal(p.delivery.kind,'pr_started');assert.equal(fact.operationId,p.delivery.publication.operationId);assertPrIdentity(fact.receipt,p,true);p.delivery={...p.delivery,kind:'created',pullRequest:fact.receipt};break;
      case 'PullRequestObserved':
        assert.equal(p.delivery.kind,'created');assertPrIdentity(fact.receipt,p,false);assert.equal(fact.receipt.id,p.delivery.pullRequest.id);assert.equal(fact.receipt.number,p.delivery.pullRequest.number);p.delivery.pullRequest=fact.receipt;p.ci={kind:'unobserved'};break;
      case 'CiObserved':
        assert.equal(p.delivery.kind,'created');assertPrIdentity(fact.observation.before,p,false);assertPrIdentity(fact.observation.after,p,false);assert.equal(fact.observation.before.id,p.delivery.pullRequest.id);assert.equal(fact.observation.after.id,p.delivery.pullRequest.id);assert.equal(fact.observation.headSha,p.delivery.commit.sha);
        {const kind=ciKind(p.intake.input.delivery.requiredChecks,p.delivery.commit.sha,fact.observation);p.ci=kind==='unobserved'?{kind}:{kind,observation:fact.observation};}p.delivery.pullRequest=fact.observation.after;break;
      case 'RepairReserved': {
        assert.ok(p.contract.config.repair); assert.equal(p.state.status,'REPAIR_READY'); assert.equal(p.verification.kind,'completed');
        assert.equal(fact.failedVerificationId,p.verification.operationId); assert.deepEqual(fact.evidence,p.verification.evidence);
        assert.ok(p.repairs.length<(p.contract.config.repair.maxRepairs??1)); assert.ok(p.attempts.length<p.maxStarts);
        assert.equal(p.decisions?.some(d=>d.kind!=='resolved')??false,false); operation(fact.repairId);
        assert.equal(p.repairs.some(r=>r.failedVerificationId===fact.failedVerificationId),false);
        assert.equal(fact.attempt.ordinal,p.attempts.length+1); assert.equal(p.attempts.some(a=>a.id===fact.attempt.id||a.completionPath===fact.attempt.completionPath),false);
        const {type,...reservation}=fact; p.repairs.push(reservation);p.attempts.push({...fact.attempt,kind:'reserved'});
        p.state={status:'RUNNING',unit};p.verification={kind:'idle'};break;
      }
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
        if (fact.reason === 'worker_start_budget_exhausted') { assert.equal(p.attempts.length, p.maxStarts); assert.ok(['READY','REPAIR_READY'].includes(p.state.status)); }
        if (fact.reason === 'repair_budget_exhausted') {assert.equal(p.state.status,'REPAIR_READY');assert.equal(p.repairs.length,p.contract.config.repair.maxRepairs??1);}
        p.state = { status: 'FAILED', unit, reason: fact.message }; break;
      default: assert.fail(`Unexpected durable fact ${fact.type}`);
    }
  }
  schema(validateProjection, p);
  return p;
}

export function commitSha(input){const header=`tree ${input.tree}\nparent ${input.parent}\nauthor ${input.author.name} <${input.author.email}> ${input.author.date}\ncommitter ${input.committer.name} <${input.committer.email}> ${input.committer.date}\n\n`;const bytes=Buffer.concat([Buffer.from(header),artifact(input.message)]);return createHash(input.expectedSha.length===64?'sha256':'sha1').update(Buffer.from(`commit ${bytes.length}\0`)).update(bytes).digest('hex');}
export function assertPrIdentity(pr,p,exactHead){assert.equal(pr.repositoryId,p.intake.repository.id);assert.equal(pr.head.repositoryId,p.intake.repository.id);assert.equal(pr.base.repositoryId,p.intake.repository.id);assert.equal(pr.head.ref,p.delivery.plan.branch);assert.equal(pr.base.ref,p.intake.base.branch);assert.equal(pr.authorId,p.delivery.publication.publisher.id);if(exactHead)assert.equal(pr.head.sha,p.delivery.commit.sha);}
export function ciKind(required,head,observation){
  if(observation.before.state.kind==='closed'||observation.after.state.kind==='closed')return'unobserved';
  if(observation.before.head.sha!==head||observation.after.head.sha!==head)return'stale_head';
  const outcomes=required.map(spec=>{const matches=observation.checks.filter(c=>c.name===spec.name&&c.appId===spec.appId&&c.headSha===head);const ids=new Set(matches.map(c=>c.id));assert.equal(ids.size,matches.length,'Duplicate check IDs are malformed observations');if(matches.length!==1)return'pending';return matches[0].kind==='pending'?'pending':matches[0].conclusion==='success'?'passed':'failed';});
  return outcomes.includes('failed')?'failed':outcomes.every(s=>s==='passed')?'passed':'pending';
}

export function assertIntake(p){
  const i=p.intake;if(!i)return;const repository=JSON.parse(artifact(i.records.repository)),issue=JSON.parse(artifact(i.records.issue)),base=JSON.parse(artifact(i.records.base));
  const canonicalUrl=`https://github.com/${repository.owner.login}/${repository.name}`,canonicalIssueUrl=canonicalUrl+'/issues/'+issue.number;
  assert.equal(repository.html_url,canonicalUrl,'Repository URL must be independently canonical');assert.equal(repository.clone_url,canonicalUrl+'.git');assert.equal(issue.html_url,canonicalIssueUrl);if(i.transport.kind==='github_https')assert.equal(i.transport.url,canonicalUrl+'.git');
  assert.equal(repository.id,i.repository.id);assert.equal(repository.name,i.repository.name);assert.equal(repository.owner.login,i.repository.owner);assert.equal(repository.html_url,i.repository.url);
  assert.equal(Object.hasOwn(issue,'pull_request'),false);assert.equal(issue.id,i.issue.id);assert.equal(issue.number,i.input.issue.number);assert.equal(issue.html_url,i.issue.url);assert.equal(base.name,i.base.branch);assert.equal(base.commit.sha,i.base.sha);
  const request={id:`github:${repository.id}:issue:${issue.id}`,source:{provider:'github',externalId:String(issue.number),url:canonicalIssueUrl},repository:{url:canonicalUrl+'.git',baseRef:i.input.baseBranch},objective:issue.title+'\n\n'+(issue.body??''),constraints:i.input.constraints,acceptanceCriteria:i.input.acceptanceCriteria,metadata:{githubRepositoryId:repository.id,githubIssueId:issue.id}};
  const expected={schemaVersion:1,request,...i.input.runtime,...(i.input.repair?{repair:i.input.repair}:{}),...(i.input.decisions?{decisions:{kind:'github_issue_comments',...i.input.github,authorizedResolver:i.input.decisions.authorizedResolver}}:{})};assert.deepEqual(p.contract.config,expected);
  for(const executable of [i.input.github.executable,i.input.git.executable])assert.ok(p.contract.programs.some(a=>a.path.replaceAll('\\','/').toLowerCase()===executable.replaceAll('\\','/').toLowerCase()&&a.digest===hash(readFileSync(executable))),'Both delivery executable bytes must be pinned');
}
export function assertDeliveryArtifacts(events){
  let publication;
  const process=record=>{artifact(record.stdout);artifact(record.stderr);};
  const receipt=pr=>{const raw=JSON.parse(artifact(pr.record));assert.equal(raw.id,pr.id);assert.equal(raw.number,pr.number);assert.equal(raw.user.id,pr.authorId);assert.equal(raw.head.sha,pr.head.sha);assert.equal(raw.head.ref,pr.head.ref);assert.equal(raw.base.ref,pr.base.ref);assert.equal(raw.head.repo.id,pr.head.repositoryId);assert.equal(raw.base.repo.id,pr.base.repositoryId);assert.equal(raw.html_url,pr.url);};
  for(const{fact}of events){
    if(fact.type==='RunCreated'&&fact.intake)Object.values(fact.intake.records).forEach(artifact);
    if(fact.type==='DeliveryPlanned'){const plan=fact.plan,evidence=JSON.parse(artifact(plan.evidence)),snapshot=JSON.parse(artifact(plan.snapshot));schema(validateSnapshot,snapshot);artifact(plan.commit.message);assert.equal(plan.candidateDigest,evidence.candidate.digest);const sorted=files=>files.map(({path,digest})=>({path,digest})).sort((a,b)=>a.path.localeCompare(b.path));assert.deepEqual(sorted(snapshot.files),sorted(evidence.candidate.files));for(const file of snapshot.files){assert.equal(file.content.digest,file.digest);artifact(file.content);}}
    if(fact.type==='CommitCreated'||fact.type==='PushConfirmed')process(fact.receipt.process);
    if(fact.type==='PrPlanned'){publication=fact.publication;artifact(publication.body);}
    if(fact.type==='PrCreated'||fact.type==='PullRequestObserved'){receipt(fact.receipt);if(fact.type==='PrCreated'){assert.ok(publication);const raw=JSON.parse(artifact(fact.receipt.record));assert.equal(raw.title,publication.title);assert.equal(raw.body,artifact(publication.body).toString('utf8'));assert.equal(raw.user.id,publication.publisher.id);}}
    if(fact.type==='CiObserved'){const raw=JSON.parse(artifact(fact.observation.record));assert.ok(Array.isArray(raw));const checks=raw.flatMap(page=>{assert.ok(Array.isArray(page.check_runs));return page.check_runs;});assert.equal(checks.length,fact.observation.checks.length);for(const c of fact.observation.checks){const r=checks.find(r=>r.id===c.id);assert.ok(r);assert.equal(c.headSha,r.head_sha);assert.equal(c.appId,r.app.id);assert.equal(c.name,r.name);if(c.kind==='completed'){assert.equal(r.status,'completed');assert.equal(c.conclusion,r.conclusion);}else{assert.equal(c.status,r.status);assert.equal(r.conclusion,null);}}receipt(fact.observation.before);receipt(fact.observation.after);}
  }
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
  for(const repair of projection.repairs||[]) {
    const evidence=JSON.parse(artifact(repair.evidence));schema(validateEvidence,evidence);assert.equal(evidence.verdict.status,'REPAIR_READY');assert.deepEqual(evidence.contract,projection.contract);
    artifact(evidence.diff);for(const command of evidence.commands){artifact(command.process.stdout);artifact(command.process.stderr);}
  }
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
    if(['VERIFIED','REPAIR_READY'].includes(projection.state.status))assert.deepEqual(evidence.verdict, projection.state); assert.deepEqual(evidence.contract, projection.contract);
    artifact(evidence.diff); artifact(evidence.worker.process.stdout); artifact(evidence.worker.process.stderr);
    for (const command of evidence.commands) { artifact(command.process.stdout); artifact(command.process.stderr); }
    return evidence;
  }
}
export function assertDurable(observed, f, expectedStatus, kind = 'durable_result') {
  assert.equal(observed.result.kind, kind);
  const snapshot = { events: observed.result.events, projection: observed.result.projection };
  const p = assertSnapshot(snapshot);
  assertHistoricalDecisionArtifacts(snapshot.events);
  assert.equal(p.state.status, expectedStatus);
  const successful=p.delivery?.kind==='created'&&p.delivery.pullRequest.state.kind!=='closed'&&p.ci.kind==='passed';
  assert.equal(observed.code,kind==='durable_status'||expectedStatus==='WAITING_FOR_DECISION'||successful?0:1);
  assert.deepEqual(readStore(f), snapshot, 'CLI result must reflect durable SQLite state');
  assert.deepEqual(p.intake.input, f.githubConfig);assertIntake(p);assertDeliveryArtifacts(snapshot.events);
  assert.equal(p.baseCommit, f.base);
  if (p.workspace.kind !== 'unplanned') {
    assert.equal(p.workspace.workspace.repositoryPath, f.repo); assert.equal(p.workspace.workspace.baseCommit, f.base);
  }
  return p;
}
