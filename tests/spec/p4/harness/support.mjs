import assert from 'node:assert/strict';
import {copyFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture as p3Fixture,killFactory,trustedRoot,workspaces,validateContext,hash} from '../../p3/harness/support.mjs';
export * from '../../p3/harness/support.mjs';
export function fixture({worker='fail-first',decisions=false,maxRepairs,enabled=true}={}) {
  const f=p3Fixture();
  if(!decisions)delete f.config.decisions;
  if(enabled)f.config.repair={kind:'local_verification',...(maxRepairs===undefined?{}:{maxRepairs})};
  for(const name of ['codex-double.cjs','verifier.cjs'])copyFileSync(join(trustedRoot,'tests/spec/p4/fixtures',name),join(f.trusted,`p4-${name}`));
  f.config.worker.prefixArgs=[join(f.trusted,'p4-codex-double.cjs'),worker];
  if(!enabled)f.config.worker.prefixArgs=[join(f.trusted,'p2-worker.cjs'),'lie',f.root];
  f.config.commands[0].args=[join(f.trusted,'p4-verifier.cjs')];
  writeFileSync(f.configPath,JSON.stringify(f.config));return f;
}
export async function withFixture(options,action){if(typeof options==='function'){action=options;options={};}const f=fixture(options);try{return await action(f);}finally{for(const h of f.handles)if(!h.closed)await killFactory(h);f.cleanup();}}
export const contexts=f=>workspaces(f).flatMap(w=>{const p=join(w,'src/p4-contexts.jsonl');return existsSync(p)?readFileSync(p,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse):[];});
export function assertContext(row,p,events){
  const input=row.input;assert.ok(validateContext(input));assert.equal(input.runId,p.runId);assert.deepEqual(input.context.request,p.contract.config.request);assert.deepEqual(input.context.unit,p.graph.units[0]);
  assert.deepEqual(input.workspace,p.workspace.workspace);assert.equal(row.args.includes('resume'),false);assert.deepEqual(row.deliveryEnvironment,[]);
  const reservationIndex=events.findIndex(e=>['AttemptReserved','RepairReserved'].includes(e.fact.type)&&e.fact.attempt.id===input.attemptId);assert.ok(reservationIndex>=0);
  const completedBefore=events.slice(0,reservationIndex).filter(e=>e.fact.type==='DecisionResolved').map(e=>e.fact.resolution);assert.deepEqual(input.context.decisions,completedBefore);
  const previousIds=events.slice(0,reservationIndex).filter(e=>['AttemptReserved','RepairReserved'].includes(e.fact.type)).map(e=>e.fact.attempt.id);assert.deepEqual(input.context.priorAttempts.map(a=>a.id),previousIds);
  const r=input.context.repair;if(!r)return;
  const reserved=events.find(e=>e.fact.type==='RepairReserved'&&e.fact.repairId===r.repairId);assert.ok(reserved);assert.equal(r.failedVerificationId,reserved.fact.failedVerificationId);assert.deepEqual(r.evidence,reserved.fact.evidence);
  const source=events.find(e=>e.fact.type==='VerificationCompleted'&&e.fact.operationId===r.failedVerificationId);assert.ok(source);assert.deepEqual(r.results,source.fact.results);
  const bytes=readFileSync(r.evidence.path);assert.equal(hash(bytes),r.evidence.digest);const evidence=JSON.parse(bytes);assert.equal(r.failedAttemptId,evidence.attemptId);assert.deepEqual(evidence.contract,p.contract);
  assert.deepEqual(r.commands.map(c=>c.specId),evidence.commands.map(c=>c.specId));
  for(const [i,command]of r.commands.entries()){assert.deepEqual(command.process,evidence.commands[i].process);for(const stream of ['stdout','stderr']){const captured=readFileSync(command.process[stream].path);assert.equal(hash(captured),command.process[stream].digest);assert.deepEqual(Buffer.from(command[`${stream}Base64`],'base64'),captured);}}
}
