import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {withFixture,resume,fault,killFactory,readStore,contexts,assertError,ownedProcesses,hash} from '../harness/support.mjs';
import {assertSnapshot,assertArtifacts,artifact} from '../harness/replay.mjs';

test('P4-002/006: changed candidate after repair reservation cannot reach initial repair dispatch',async()=>withFixture(async f=>{
  const held=await fault(f,'transaction.after_commit','RepairReserved');await killFactory(held);
  const before=readStore(f),p=assertSnapshot(before);assert.equal(p.repairs.length,1);assert.equal(p.attempts.length,2);assert.equal(p.attempts.at(-1).kind,'reserved');assert.equal(contexts(f).length,1);assert.deepEqual(ownedProcesses(f),[]);assertArtifacts(p);
  const repairId=p.attempts.at(-1).id;assert.equal(before.events.some(e=>e.fact.type==='WorkerStarted'&&e.fact.attemptId===repairId),false,'The reserved repair has never dispatched');
  const evidence=JSON.parse(artifact(p.repairs[0].evidence)),path=join(p.workspace.workspace.path,'src/answer.cjs'),original=readFileSync(path);
  assert.equal(hash(original),evidence.candidate.files.find(file=>file.path==='src/answer.cjs').digest,'Fixture starts at the measured failed candidate');
  writeFileSync(path,'module.exports = 777;\n');assert.notEqual(hash(readFileSync(path)),hash(original));
  assertError(resume(f),'artifact_invalid');assert.equal(contexts(f).length,1,'No repair process may consume an unmeasured initial candidate');assert.deepEqual(ownedProcesses(f),[]);
  const after=readStore(f);assert.equal(after.events.filter(e=>e.fact.type==='WorkerStarted').length,before.events.filter(e=>e.fact.type==='WorkerStarted').length);assert.equal(after.projection.repairs.length,1);
}));
