import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {withFixture,run,resume,status,contexts,assertContext,readStore,writeConfig,assertError,ownedProcesses,invocations,addAnswer,posts,verifierInvocations} from '../harness/support.mjs';
import {assertDurable,assertArtifacts} from '../harness/replay.mjs';

test('P4-001/002: opt-in default repairs one measured failure in a fresh process',()=>withFixture(f=>{
  const p=assertDurable(run(f),f,'VERIFIED'),events=readStore(f).events;assertArtifacts(p);
  assert.equal(p.repairs.length,1);assert.equal(p.attempts.length,2);assert.equal(p.maxStarts,5);
  const workers=contexts(f);assert.equal(workers.length,2);assert.notEqual(workers[0].threadId,workers[1].threadId);assert.equal(workers[0].input.context.repair,undefined);
  for(const row of workers)assertContext(row,p,events);assert.equal(workers[1].input.context.repair.repairId,p.repairs[0].repairId);
  assert.equal(verifierInvocations(f).length,2);assert.deepEqual(ownedProcesses(f),[]);
  assert.equal(readFileSync(join(p.workspace.workspace.path,'src/preserved.txt'),'utf8'),'keep-first-edit');assert.equal(readFileSync(join(f.repo,'src/answer.cjs'),'utf8'),'module.exports = 0;\n');
  const failures=events.filter(e=>e.fact.type==='VerificationCompleted');assert.equal(failures[0].fact.results[0].status,'failed');assert.equal(failures[1].fact.results[0].status,'passed');
  assert.deepEqual(assertDurable(resume(f),f,'VERIFIED'),p);assert.deepEqual(assertDurable(status(f),f,'VERIFIED','durable_status'),p);assert.equal(contexts(f).length,2);
}));

test('P4-001: absent repair retains legacy REPAIR_READY and exact projection shape',()=>withFixture({enabled:false},f=>{
  const p=assertDurable(run(f),f,'REPAIR_READY');assert.equal(Object.hasOwn(p,'repairs'),false);assert.equal(Object.hasOwn(p,'decisions'),false);
  assert.deepEqual(assertDurable(resume(f),f,'REPAIR_READY'),p);assert.equal(invocations(f).length,1);assert.equal(contexts(f).length,0);
}));

for(const maxRepairs of [0,1,2])test(`P4-003: always failing stops at immutable repair limit ${maxRepairs}`,()=>withFixture({worker:'always-fail',maxRepairs},f=>{
  const p=assertDurable(run(f),f,'FAILED');assert.equal(p.attempts.length,maxRepairs+1);assert.equal(p.repairs.length,maxRepairs);assertArtifacts(p);
  assert.equal(readStore(f).events.at(-1).fact.reason,'repair_budget_exhausted');assert.equal(contexts(f).length,maxRepairs+1);
  for(const row of contexts(f))assertContext(row,p,readStore(f).events);
  assert.deepEqual(assertDurable(resume(f),f,'FAILED'),p);f.config.repair.maxRepairs=maxRepairs+1;writeConfig(f);assertError(run(f),'config_mismatch');assert.equal(contexts(f).length,maxRepairs+1);
}));

test('P4-003: total start budget stops repair before a second reservation',()=>withFixture(f=>{
  const p=assertDurable(run(f,1),f,'FAILED');assert.equal(p.attempts.length,1);assert.deepEqual(p.repairs,[]);assert.equal(contexts(f).length,1);assert.equal(readStore(f).events.at(-1).fact.reason,'worker_start_budget_exhausted');
}));

for(const worker of ['decision-before','decision-during'])test(`P4-005: ${worker} preserves authority and consumes no extra repair allowance`,()=>withFixture({worker,decisions:true},f=>{
  const waiting=assertDurable(run(f),f,'WAITING_FOR_DECISION');assert.equal(waiting.repairs.length,worker==='decision-before'?0:1);
  const before=contexts(f).length;assert.deepEqual(assertDurable(resume(f),f,'WAITING_FOR_DECISION'),waiting);assert.equal(contexts(f).length,before);
  addAnswer(f,waiting.state.decision.id);const p=assertDurable(resume(f),f,'VERIFIED');assertArtifacts(p);
  assert.equal(p.attempts.length,3);assert.equal(p.repairs.length,1);assert.equal(p.decisions[0].kind,'resolved');assert.equal(posts(f).length,1);
  const rows=contexts(f);assert.equal(new Set(rows.map(r=>r.threadId)).size,3);for(const row of rows)assertContext(row,p,readStore(f).events);
  if(worker==='decision-during')assert.deepEqual(rows[1].input.context.repair,rows[2].input.context.repair);
}));

test('P4-005: accepted decision during repair cannot bypass exhausted total starts',()=>withFixture({worker:'decision-during',decisions:true},f=>{
  const waiting=assertDurable(run(f,2),f,'WAITING_FOR_DECISION');addAnswer(f,waiting.state.decision.id);
  const p=assertDurable(resume(f),f,'FAILED');assert.equal(p.repairs.length,1);assert.equal(p.attempts.length,2);assert.equal(p.decisions[0].kind,'resolved');assert.equal(contexts(f).length,2);assert.equal(readStore(f).events.at(-1).fact.reason,'worker_start_budget_exhausted');
}));

test('P4-006: explicit worker blocked outcome is not a failed-verification repair',()=>withFixture({worker:'blocked'},f=>{
  const p=assertDurable(run(f),f,'FAILED');assert.equal(p.attempts.length,1);assert.deepEqual(p.repairs,[]);assert.equal(verifierInvocations(f).length,0);
}));

for(const invalid of [-1,1.5,101,'1'])test(`P4-001: invalid repair limit ${JSON.stringify(invalid)} is rejected before effects`,()=>withFixture(f=>{
  f.config.repair.maxRepairs=invalid;writeConfig(f);assertError(run(f),'input_error');assert.equal(contexts(f).length,0);
}));
