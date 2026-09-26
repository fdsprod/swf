import test from 'node:test';
import assert from 'node:assert/strict';
import {appendFileSync} from 'node:fs';
import {withFixture,run,resume,status,fault,killFactory,runArgs,resumeArgs,readStore,gateway,updateGateway,posts,addAnswer,contexts,assertError} from '../harness/support.mjs';
import {assertDurable,assertSnapshot,assertArtifacts} from '../harness/replay.mjs';

for(const point of ['transaction.after_event_insert','transaction.after_projection_write']) {
  test(`P3-006: ${point} rolls decision publication intent back atomically`,async()=>withFixture(async f=>{
    const held=await fault(f,point,'DecisionPublicationPlanned'); await killFactory(held);
    const before=readStore(f); assertSnapshot(before); assert.equal(before.events.some(e=>e.fact.type==='DecisionPublicationPlanned'),false);
    assert.equal(before.projection.state.status,'WAITING_FOR_DECISION'); assert.equal(posts(f).length,0);
    const resumed=assertDurable(resume(f),f,'WAITING_FOR_DECISION'); assert.equal(resumed.decisions[0].kind,'published'); assert.equal(posts(f).length,1); assert.equal(contexts(f).length,1);
  }));
  test(`P3-006: ${point} rolls resolution and READY state back together`,async()=>withFixture(async f=>{
    const p=assertDurable(run(f),f,'WAITING_FOR_DECISION'); addAnswer(f,p.state.decision.id);
    const held=await fault(f,point,'DecisionResolved',{args:resumeArgs(f)}); await killFactory(held);
    const before=readStore(f); assertSnapshot(before); assert.equal(before.events.some(e=>e.fact.type==='DecisionResolved'),false);
    assert.equal(before.projection.state.status,'WAITING_FOR_DECISION'); assert.equal(before.projection.attempts.length,1);
    const done=assertDurable(resume(f),f,'VERIFIED'); assert.equal(done.attempts.length,2); assert.equal(readStore(f).events.filter(e=>e.fact.type==='DecisionResolved').length,1);
  }));
}
for(const eventType of ['WorkerCompleted','DecisionPublicationPlanned','DecisionPublished']) test(`P3-006: committed ${eventType} survives a fresh process`,async()=>withFixture(async f=>{
  const held=await fault(f,'transaction.after_commit',eventType); await killFactory(held);
  const before=readStore(f); assertSnapshot(before); assert.equal(before.events.at(-1).fact.type,eventType);
  const resumed=assertDurable(resume(f),f,'WAITING_FOR_DECISION'); assert.equal(resumed.decisions[0].kind,'published'); assert.equal(posts(f).length,1); assert.equal(contexts(f).length,1); assertArtifacts(resumed);
}));

test('P3-006: committed resolution survives without polling edited remote text again',async()=>withFixture(async f=>{
  const p=assertDurable(run(f),f,'WAITING_FOR_DECISION'); addAnswer(f,p.state.decision.id);
  const held=await fault(f,'transaction.after_commit','DecisionResolved',{args:resumeArgs(f)}); await killFactory(held);
  const before=readStore(f); assertSnapshot(before); assert.equal(before.projection.state.status,'READY'); assert.equal(before.projection.attempts.length,1);
  updateGateway(f,g=>{g.comments=[];}); const calls=gateway(f).calls.length;
  const done=assertDurable(resume(f),f,'VERIFIED'); assert.equal(done.attempts.length,2); assert.equal(gateway(f).calls.length,calls); assertArtifacts(done);
}));

test('P3-006/007: crash after remote publication reconciles all pages without another POST',async()=>withFixture(async f=>{
  const held=await fault(f,'decision.after_publish'); await killFactory(held);
  const before=readStore(f); assertSnapshot(before); assert.equal(before.projection.decisions[0].kind,'publication_started'); assert.equal(posts(f).length,1);
  const question=gateway(f).comments[0];
  updateGateway(f,g=>{g.comments.unshift({...question,id:1,user:{id:999,login:'copycat'}});});
  const p=assertDurable(resume(f),f,'WAITING_FOR_DECISION'); assert.equal(p.decisions[0].receipt.comment.id,question.id); assert.equal(posts(f).length,1); assertArtifacts(p);
}));

test('P3-007: started publication with absent result remains uncertain without retries',async()=>withFixture(async f=>{
  const held=await fault(f,'transaction.after_commit','DecisionPublicationStarted'); await killFactory(held);
  const before=readStore(f); assertSnapshot(before); assert.equal(posts(f).length,0);
  assertError(resume(f),'publication_uncertain'); assertError(resume(f),'publication_uncertain');
  assert.deepEqual(readStore(f),before); assert.equal(posts(f).length,0); assert.equal(contexts(f).length,1);
}));

for(const defect of ['duplicate','changed-body']) test(`P3-007: ${defect} publication match cannot be adopted`,async()=>withFixture(async f=>{
  const held=await fault(f,'decision.after_publish'); await killFactory(held);
  updateGateway(f,g=>{if(defect==='duplicate')g.comments.push({...g.comments[0],id:g.nextId++});else g.comments[0].body+='\nALTERED';});
  assertError(resume(f),'publication_uncertain'); assert.equal(posts(f).length,1); assert.equal(contexts(f).length,1);
}));

for(const mode of ['api-failure','malformed']) test(`P3-007: ${mode} comment reads are errors, not absent authorization`,()=>withFixture(f=>{
  const p=assertDurable(run(f),f,'WAITING_FOR_DECISION'); updateGateway(f,g=>{g.mode=mode;});
  assertError(resume(f),'decision_gateway_error'); assert.deepEqual(assertDurable(status(f),f,'WAITING_FOR_DECISION','durable_status'),p); assert.equal(contexts(f).length,1);
}));

test('P3-007: failed POST response does not hide the successfully created question',()=>withFixture(f=>{
  updateGateway(f,g=>{g.mode='post-response-lost';}); assertError(run(f),'decision_gateway_error'); assert.equal(posts(f).length,1);
  updateGateway(f,g=>{g.mode='normal';}); const p=assertDurable(resume(f),f,'WAITING_FOR_DECISION'); assert.equal(p.decisions[0].kind,'published'); assert.equal(posts(f).length,1);
}));

test('P3-006: changed question artifact cannot be used for publication or resumed authority',()=>withFixture(f=>{
  const p=assertDurable(run(f),f,'WAITING_FOR_DECISION'); appendFileSync(p.decisions[0].publication.body.path,'tampered');
  assertError(resume(f),'artifact_invalid'); assert.equal(contexts(f).length,1); assert.equal(posts(f).length,1);
}));

test('P3-006: changed authenticated answer snapshot blocks continuation after resolution commit',async()=>withFixture(async f=>{
  const p=assertDurable(run(f),f,'WAITING_FOR_DECISION'); addAnswer(f,p.state.decision.id);
  const held=await fault(f,'transaction.after_commit','DecisionResolved',{args:resumeArgs(f)}); await killFactory(held);
  appendFileSync(readStore(f).projection.decisions[0].source.record.path,'tampered');
  assertError(resume(f),'artifact_invalid'); assert.equal(contexts(f).length,1);
}));
