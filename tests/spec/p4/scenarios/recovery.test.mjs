import test from 'node:test';
import assert from 'node:assert/strict';
import {appendFileSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {withFixture,resume,fault,killFactory,readStore,contexts,assertContext,resumeArgs,assertError,ownedProcesses} from '../harness/support.mjs';
import {assertDurable,assertSnapshot,assertArtifacts} from '../harness/replay.mjs';

for(const point of ['transaction.after_event_insert','transaction.after_projection_write'])test(`P4-004: ${point} rolls both repair and worker reservations back together`,async()=>withFixture(async f=>{
  const held=await fault(f,point,'RepairReserved');await killFactory(held);
  const before=readStore(f);assertSnapshot(before);assert.equal(before.projection.state.status,'REPAIR_READY');assert.deepEqual(before.projection.repairs,[]);assert.equal(before.projection.attempts.length,1);assert.equal(contexts(f).length,1);
  const done=assertDurable(resume(f),f,'VERIFIED');assert.equal(done.repairs.length,1);assert.equal(done.attempts.length,2);assertArtifacts(done);for(const row of contexts(f))assertContext(row,done,readStore(f).events);
}));

test('P4-004: committed repair reservation survives interruption without a second repair charge',async()=>withFixture(async f=>{
  const held=await fault(f,'transaction.after_commit','RepairReserved');await killFactory(held);
  const before=readStore(f);assertSnapshot(before);assert.equal(before.projection.repairs.length,1);assert.equal(before.projection.attempts.length,2);assert.equal(contexts(f).length,1);
  const p=assertDurable(resume(f),f,'VERIFIED');assert.equal(p.repairs.length,1);assert.equal(p.attempts.length,3);assert.equal(p.attempts[1].kind,'interrupted');assert.equal(contexts(f).length,2);
  assert.deepEqual(p.repairs,before.projection.repairs);assertArtifacts(p);for(const row of contexts(f))assertContext(row,p,readStore(f).events);
}));

test('P4-004: restart at durable failed verification retains its exact failure evidence',async()=>withFixture(async f=>{
  const held=await fault(f,'transaction.after_commit','VerificationCompleted');await killFactory(held);
  const before=readStore(f);assertSnapshot(before);assert.equal(before.projection.state.status,'REPAIR_READY');assertArtifacts(before.projection);
  const p=assertDurable(resume(f),f,'VERIFIED');assert.equal(p.attempts.length,2);assert.deepEqual(p.repairs[0].evidence,before.projection.verification.evidence);assertContext(contexts(f)[1],p,readStore(f).events);
}));

for(const defect of ['manifest','stdout','contract','forbidden-tree'])test(`P4-006: ${defect} corruption cannot trigger repair`,async()=>withFixture(async f=>{
  const held=await fault(f,'transaction.after_commit','VerificationCompleted');await killFactory(held);const before=readStore(f),p=before.projection;
  assert.equal(p.state.status,'REPAIR_READY');const manifest=JSON.parse(readFileSync(p.verification.evidence.path,'utf8'));
  if(defect==='manifest')appendFileSync(p.verification.evidence.path,'tampered');
  if(defect==='stdout')appendFileSync(manifest.commands[0].process.stdout.path,'tampered');
  if(defect==='contract'){manifest.contract.config.verification.required=[];writeFileSync(p.verification.evidence.path,JSON.stringify(manifest));}
  if(defect==='forbidden-tree')writeFileSync(join(p.workspace.workspace.path,'tests/protected.cjs'),'process.exit(0);\n');
  assertError(resume(f),'artifact_invalid');assert.deepEqual(readStore(f),before);assert.equal(contexts(f).length,1);assert.deepEqual(ownedProcesses(f),[]);
}));
