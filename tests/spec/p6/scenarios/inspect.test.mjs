import test from 'node:test';
import assert from 'node:assert/strict';
import {appendFileSync,existsSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import * as p2 from '../../p2/harness/support.mjs';
import * as p4 from '../../p4/harness/support.mjs';
import * as p5 from '../../p5/harness/support.mjs';
import {inspect,launch,readStore,assertInspection,assertError,assertReadOnly,assertHuman} from '../harness/support.mjs';

test('P6-I001/004: verified local inspection and concise human form are read-only persisted views',()=>p2.withFixture(f=>{
  assert.equal(p2.run(f).result.projection.state.status,'VERIFIED');const snapshot=readStore(f);
  const view=assertReadOnly(f,()=>assertInspection(inspect(f),snapshot));assert.equal(view.starts.consumed,1);assert.equal(view.starts.remaining,4);assert.deepEqual(view.github,{kind:'disabled'});assert.deepEqual(view.repair,{kind:'disabled'});
  assertReadOnly(f,()=>assertHuman(inspect(f,{json:false}),view));assertReadOnly(f,()=>assertInspection(inspect(f),snapshot));
}));

test('P6-I002/004: active reserved attempt consumes budget, permits candidate edits and cannot be resumed by inspect',async()=>p2.withFixture(async f=>{
  const held=await p2.fault(f,'transaction.after_commit','AttemptReserved');const snapshot=readStore(f);assert.equal(snapshot.projection.attempts[0].kind,'reserved');
  writeFileSync(join(snapshot.projection.workspace.workspace.path,'src/answer.cjs'),'module.exports = 19;\n');
  const view=assertReadOnly(f,()=>assertInspection(inspect(f),snapshot));assert.equal(view.starts.consumed,1);assert.equal(view.starts.remaining,4);assert.equal(held.original.closed,false);
  assert.equal(readFileSync(join(snapshot.projection.workspace.workspace.path,'src/answer.cjs'),'utf8'),'module.exports = 19;\n');await p2.killFactory(held);
}));

test('P6-I002: interrupted attempt still consumes a total start on continuation',async()=>p2.withFixture(async f=>{
  const held=await p2.fault(f,'transaction.after_commit','AttemptReserved');await p2.killFactory(held);assert.equal(p2.resume(f).result.projection.state.status,'VERIFIED');
  const view=assertReadOnly(f,()=>assertInspection(inspect(f),readStore(f)));assert.equal(view.starts.consumed,2);assert.equal(view.starts.remaining,3);assert.equal(view.starts.attempts[0].kind,'interrupted');
}));

test('P6-I002/003: human continuation during repair consumes total starts but only one repair',()=>p4.withFixture({worker:'decision-during',decisions:true},f=>{
  const waiting=p4.run(f).result.projection;assert.equal(waiting.state.status,'WAITING_FOR_DECISION');
  const waitingView=assertReadOnly(f,()=>assertInspection(inspect(f),readStore(f)));assert.equal(waitingView.starts.consumed,2);assert.equal(waitingView.repair.limit,1);assert.equal(waitingView.repair.consumed,1);assert.equal(waitingView.repair.remaining,0);assertReadOnly(f,()=>assertHuman(inspect(f,{json:false}),waitingView));
  p4.addAnswer(f,waiting.state.decision.id);assert.equal(p4.resume(f).result.projection.state.status,'VERIFIED');
  const view=assertReadOnly(f,()=>assertInspection(inspect(f),readStore(f)));assert.equal(view.starts.consumed,3);assert.equal(view.repair.consumed,1);assert.equal(view.decisions[0].kind,'resolved');
}));

test('P6-I002: explicit exhausted repair allowance is visible without replenishment',()=>p4.withFixture({worker:'always-fail',maxRepairs:2},f=>{
  assert.equal(p4.run(f).result.projection.state.status,'FAILED');const view=assertReadOnly(f,()=>assertInspection(inspect(f),readStore(f)));
  assert.equal(view.starts.consumed,3);assert.equal(view.starts.remaining,2);assert.equal(view.repair.limit,2);assert.equal(view.repair.consumed,2);assert.equal(view.repair.remaining,0);
}));

test('P6-I002: legacy failed verification does not invent an enabled repair budget',()=>p2.withFixture({worker:'lie'},f=>{
  assert.equal(p2.run(f).result.projection.state.status,'REPAIR_READY');const view=assertReadOnly(f,()=>assertInspection(inspect(f),readStore(f)));assert.deepEqual(view.repair,{kind:'disabled'});assert.equal(view.starts.consumed,1);
}));

for(const mode of ['pending','failed'])test(`P6-I003/004: local VERIFIED and ${mode} CI remain distinct; inspect never polls remote`,()=>p5.withFixture(f=>{
  p5.updateGateway(f,d=>{d.checkMode=mode;});const original=p5.run(f).result.projection;assert.equal(original.state.status,'VERIFIED');assert.equal(original.ci.kind,mode);
  p5.updateGateway(f,d=>{d.checkMode='success';});const snapshot=readStore(f),view=assertReadOnly(f,()=>assertInspection(inspect(f),snapshot));assert.equal(view.github.ci.kind,mode);assert.equal(view.github.delivery.kind,'created');assertReadOnly(f,()=>assertHuman(inspect(f,{json:false}),view));
}));

test('P6-I003/004: recorded push intent is visible while the owner holds the delivery boundary',async()=>p5.withFixture(async f=>{
  const held=await p5.fault(f,'transaction.after_commit','PushStarted',{args:p5.runArgs(f)});const view=assertReadOnly(f,()=>assertInspection(inspect(f),readStore(f)));
  assert.equal(view.state.status,'VERIFIED');assert.equal(view.github.delivery.kind,'push_started');assert.equal(view.github.ci.kind,'unobserved');assert.equal(held.original.closed,false);await p5.killFactory(held);
}));

for(const defect of ['missing-manifest','changed-output'])test(`P6-I005: ${defect} cannot be displayed as healthy evidence`,()=>p2.withFixture(f=>{
  const p=p2.run(f).result.projection;assert.equal(p.state.status,'VERIFIED');const manifest=JSON.parse(readFileSync(p.verification.evidence.path,'utf8'));
  if(defect==='missing-manifest')rmSync(p.verification.evidence.path);else appendFileSync(manifest.commands[0].process.stdout.path,'tampered output');
  assertReadOnly(f,()=>assertError(inspect(f),'artifact_invalid'));
}));

test('P6-I005: successful repair cannot hide corrupted older failed evidence',()=>p4.withFixture(f=>{
  const p=p4.run(f).result.projection;assert.equal(p.state.status,'VERIFIED');assert.notEqual(p.repairs[0].evidence.path,p.verification.evidence.path);
  appendFileSync(p.repairs[0].evidence.path,'tampered failure');assertReadOnly(f,()=>assertError(inspect(f),'artifact_invalid'));
}));

test('P6-I005: latest passing CI cannot hide a corrupted earlier CI observation',()=>p5.withFixture(f=>{
  p5.updateGateway(f,d=>{d.checkMode='pending';});const old=p5.run(f).result.projection.ci.observation.record;
  p5.updateGateway(f,d=>{d.checkMode='success';});const current=p5.resume(f).result.projection;assert.equal(current.ci.kind,'passed');assert.notEqual(old.digest,current.ci.observation.record.digest);
  appendFileSync(old.path,'tampered historical CI');assertReadOnly(f,()=>assertError(inspect(f),'artifact_invalid'));
}));

test('P6-I005: corrupt projection is an error, never repaired by inspection',()=>p2.withFixture(f=>{
  const p=p2.run(f).result.projection,db=new DatabaseSync(join(f.store,'run.sqlite'));const altered={...p,maxStarts:p.maxStarts+1};
  try{db.prepare('UPDATE projection SET json=? WHERE id=1').run(JSON.stringify(altered));}finally{db.close();}
  assertReadOnly(f,()=>assertError(inspect(f),'corrupt_store'));
}));

test('P6-I006: missing store is not found and inspection does not create it',()=>p2.withFixture(f=>{
  assert.equal(existsSync(f.store),false);assertError(inspect(f),'not_found');assert.equal(existsSync(f.store),false);
}));

test('P6-I006: missing, repeated and unknown CLI arguments are structured input errors',()=>p2.withFixture(f=>{
  for(const args of [['inspect','--json'],['inspect','--store','--json'],['inspect','--store',f.store,'--store',f.store,'--json'],['inspect','--store',f.store,'--unexpected','--json'],['inspect','--store',f.store,'--json','extra']])assertError(launch(args),'input_error');assert.equal(existsSync(f.store),false);
}));
