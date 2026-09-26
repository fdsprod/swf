import test from 'node:test';
import assert from 'node:assert/strict';
import {appendFileSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {withFixture,run,resume,runArgs,fault,killFactory,readStore,remoteRefs,posts,updateGateway,gateway,assertError,assertNoDelivery,git,writeConfig,holdBeforePush,waitFor,decode} from '../harness/support.mjs';
import {assertDurable,assertSnapshot,assertDeliveryArtifacts} from '../harness/replay.mjs';
import {assertDeliveredTree} from '../harness/git-oracle.mjs';
const heldRun=(f,point,type)=>fault(f,point,type,{args:runArgs(f)});

for(const point of ['transaction.after_event_insert','transaction.after_projection_write'])test(`P5-007: ${point} rolls delivery plan and projection back together`,async()=>withFixture(async f=>{
  const held=await heldRun(f,point,'DeliveryPlanned');await killFactory(held);const before=readStore(f);assertSnapshot(before);assert.equal(before.projection.delivery.kind,'unplanned');assertNoDelivery(f);
  const p=assertDurable(resume(f),f,'VERIFIED');assertDeliveredTree(p,f);assert.equal(readStore(f).events.filter(e=>e.fact.type==='DeliveryPlanned').length,1);assert.equal(posts(f).length,1);
}));

for(const type of ['CommitCreated','PushConfirmed','PrPlanned','PrCreated'])test(`P5-003/004/005: committed ${type} survives restart without a second delivery`,async()=>withFixture(async f=>{
  const held=await heldRun(f,'transaction.after_commit',type);await killFactory(held);const before=readStore(f);assertSnapshot(before);const expected=before.projection.delivery.plan.commit.expectedSha;
  const p=assertDurable(resume(f),f,'VERIFIED');assert.equal(p.delivery.commit.sha,expected);assertDeliveredTree(p,f);assert.equal(posts(f).length,1);assert.equal(readStore(f).events.filter(e=>e.fact.type==='CommitCreated').length,1);
}));

for(const point of ['delivery.after_commit_object','delivery.after_push','delivery.after_pr_create'])test(`P5-003/004/005: ${point} reconciles the effect before writing a receipt`,async()=>withFixture(async f=>{
  const held=await heldRun(f,point);await killFactory(held);const before=readStore(f);assertSnapshot(before);assert.equal(before.projection.delivery.kind,point==='delivery.after_commit_object'?'planned':point==='delivery.after_push'?'push_started':'pr_started');
  const expected=before.projection.delivery.plan.commit.expectedSha;const p=assertDurable(resume(f),f,'VERIFIED');assert.equal(p.delivery.commit.sha,expected);assertDeliveredTree(p,f);assert.equal(posts(f).length,1);assert.equal(readStore(f).events.filter(e=>e.fact.type==='CommitCreated').length,1);
}));

test('P5-004: create-only push cannot overwrite a concurrently created ancestor ref',async()=>withFixture(async f=>{
  const held=await holdBeforePush(f),p=readStore(f).projection,ref='refs/heads/'+p.delivery.plan.branch;assert.equal(p.delivery.kind,'push_started');assert.deepEqual(remoteRefs(f),[]);
  git(f.root,'--git-dir',f.remote,'update-ref',ref,f.base);writeFileSync(held.release,'release');await waitFor(()=>held.handle.closed,'Same factory did not finish create-only push after release',90000);assertError(decode(await held.handle.done),'push_conflict');
  assert.deepEqual(remoteRefs(f),[{sha:f.base,ref}]);assert.equal(posts(f).length,0);assert.equal(readStore(f).projection.state.status,'VERIFIED');
}));

test('P5-004: mutable named remote and URL rewrite cannot redirect pinned transport',async()=>withFixture(async f=>{
  const held=await heldRun(f,'transaction.after_commit','CommitCreated');await killFactory(held);const other=join(f.root,'other.git');git(f.root,'init','--bare',other);git(f.repo,'remote','set-url','origin',other);git(f.repo,'config','url.'+other.replaceAll('\\','/')+'.insteadOf',f.remote);
  const p=assertDurable(resume(f),f,'VERIFIED');assertDeliveredTree(p,f);assert.equal(git(f.root,'ls-remote',other),'');assert.equal(remoteRefs(f).length,1);
  f.githubConfig.delivery.transport.path=other;writeConfig(f);assertError(run(f),'config_mismatch');
}));

test('P5-005: unconfirmed PR dispatch without a result remains uncertain without repost',async()=>withFixture(async f=>{
  const held=await heldRun(f,'transaction.after_commit','PrStarted');await killFactory(held);const before=readStore(f);assert.equal(posts(f).length,0);
  assertError(resume(f),'pr_uncertain');assertError(resume(f),'pr_uncertain');assert.equal(posts(f).length,0);assert.deepEqual(readStore(f),before);
}));

test('P5-005: lost successful POST response reconciles an exact closed PR without replacement',()=>withFixture(f=>{
  updateGateway(f,d=>{d.mode='pr-response-lost';});assertError(run(f),'github_gateway_error');assert.equal(posts(f).length,1);
  updateGateway(f,d=>{d.mode='normal';d.pulls[0].state='closed';});const p=assertDurable(resume(f),f,'VERIFIED');assert.equal(p.delivery.kind,'created');assert.equal(p.delivery.pullRequest.state.kind,'closed');assert.equal(posts(f).length,1);
}));

for(const defect of ['multiple','wrong-head-repository','wrong-author'])test(`P5-005: ${defect} PR matches cannot be adopted or retried`,async()=>withFixture(async f=>{
  const held=await heldRun(f,'delivery.after_pr_create');await killFactory(held);
  updateGateway(f,d=>{if(defect==='multiple'){const copy=structuredClone(d.pulls[0]);copy.id++;copy.number++;copy.html_url=d.repository.html_url+'/pull/'+copy.number;d.pulls.push(copy);}if(defect==='wrong-head-repository')d.pulls[0].head.repo={...d.repository,id:999};if(defect==='wrong-author')d.pulls[0].user={id:999,login:'copied-marker'};});
  assertError(resume(f),'pr_uncertain');assert.equal(posts(f).length,1);assert.equal(readStore(f).projection.delivery.kind,'pr_started');
}));

for(const defect of ['candidate','verification-output'])test(`P5-002: changed ${defect} before planning blocks commit and remote effects`,async()=>withFixture(async f=>{
  const held=await heldRun(f,'transaction.after_commit','VerificationCompleted');await killFactory(held);const p=readStore(f).projection;
  if(defect==='candidate')writeFileSync(join(p.workspace.workspace.path,'src/answer.cjs'),'module.exports = 7;\n');else{const manifest=JSON.parse(readFileSync(p.verification.evidence.path,'utf8'));appendFileSync(manifest.commands[0].process.stdout.path,'tampered');}
  assertError(resume(f),'artifact_invalid');assertNoDelivery(f);assert.equal(readStore(f).events.some(e=>e.fact.type==='CommitCreated'),false);
}));

for(const [type,defect]of [['CommitCreated','candidate'],['PushConfirmed','verification-output']])test(`P5-002: changed ${defect} after ${type} blocks later remote effects`,async()=>withFixture(async f=>{
  const held=await heldRun(f,'transaction.after_commit',type);await killFactory(held);const before=readStore(f),p=before.projection,refs=remoteRefs(f),calls=gateway(f).calls.length;
  if(defect==='candidate')writeFileSync(join(p.workspace.workspace.path,'src/answer.cjs'),'module.exports = 7;\n');else{const manifest=JSON.parse(readFileSync(p.verification.evidence.path,'utf8'));appendFileSync(manifest.commands[0].process.stdout.path,'tampered');}
  assertError(resume(f),'artifact_invalid');assert.deepEqual(readStore(f),before);assert.deepEqual(remoteRefs(f),refs);assert.equal(refs.length,type==='PushConfirmed'?1:0);assert.equal(posts(f).length,0);assert.equal(gateway(f).calls.length,calls);
}));

for(const target of ['intake','snapshot','commit-message','pr-body'])test(`P5-007: ${target} artifact remains immutable after successful delivery`,()=>withFixture(f=>{
  const p=assertDurable(run(f),f,'VERIFIED'),before=readStore(f),calls=gateway(f).calls.length;
  const refs={intake:p.intake.records.issue,snapshot:p.delivery.plan.snapshot,'commit-message':p.delivery.plan.commit.message,'pr-body':p.delivery.publication.body};appendFileSync(refs[target].path,'tampered');
  assert.throws(()=>assertDeliveryArtifacts(before.events),assert.AssertionError);assertError(resume(f),'artifact_invalid');assert.deepEqual(readStore(f),before);assert.equal(gateway(f).calls.length,calls);assert.equal(posts(f).length,1);
}));
