import assert from 'node:assert/strict';
import {copyFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture as p3Fixture,killFactory,trustedRoot,workspaces,validateContext,hash} from '../../p3/harness/support.mjs';
export * from '../../p3/harness/support.mjs';
export function fixture({worker='fail-first',verifier='good',decisions=false,maxRepairs,enabled=true}={}) {
  const f=p3Fixture();
  if(!decisions)delete f.config.decisions;
  if(enabled)f.config.repair={kind:'local_verification',...(maxRepairs===undefined?{}:{maxRepairs})};
  for(const name of ['codex-double.cjs','verifier.cjs'])copyFileSync(join(trustedRoot,'tests/spec/p4/fixtures',name),join(f.trusted,`p4-${name}`));
  f.config.worker.prefixArgs=[join(f.trusted,'p4-codex-double.cjs'),worker];
  if(!enabled)f.config.worker.prefixArgs=[join(f.trusted,'p2-worker.cjs'),'lie',f.root];
  f.config.commands[0].args=[join(f.trusted,'p4-verifier.cjs'),verifier];
  f.config.verification.required.push({kind:'command',id:'baseline',command:'external baseline assertion',timeoutSeconds:2});
  f.config.commands.push({specId:'baseline',executable:join(f.root,'node.exe'),args:[join(f.trusted,'p4-verifier.cjs'),'baseline']});
  writeFileSync(f.configPath,JSON.stringify(f.config));return f;
}
export async function withFixture(options,action){if(typeof options==='function'){action=options;options={};}const f=fixture(options);try{return await action(f);}finally{for(const h of f.handles)if(!h.closed)await killFactory(h);f.cleanup();}}
export const contexts=f=>workspaces(f).flatMap(w=>{const p=join(w,'src/p4-contexts.jsonl');return existsSync(p)?readFileSync(p,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse):[];});
export function assertRepairOrigin(input,events){
  const reservationIndex=events.findIndex(e=>['AttemptReserved','RepairReserved'].includes(e.fact.type)&&e.fact.attempt.id===input.attemptId);assert.ok(reservationIndex>=0);
  const origin=events.slice(0,reservationIndex+1).filter(e=>e.fact.type==='RepairReserved').at(-1)?.fact;
  if(!origin){assert.equal(input.context.repair,undefined,'Initial workers cannot claim a repair origin');return{reservationIndex};}
  assert.ok(input.context.repair,'Repair origin must survive interruption and decision continuation');
  assert.equal(input.context.repair.repairId,origin.repairId,'Worker must receive the latest applicable repair origin');
  assert.equal(input.context.repair.failedVerificationId,origin.failedVerificationId);assert.deepEqual(input.context.repair.evidence,origin.evidence);
  return{reservationIndex,origin};
}
export function assertContext(row,p,events){
  const input=row.input;assert.ok(validateContext(input));assert.equal(input.runId,p.runId);assert.deepEqual(input.context.request,p.contract.config.request);assert.deepEqual(input.context.unit,p.graph.units[0]);
  assert.deepEqual(input.workspace,p.workspace.workspace);assert.equal(row.args.includes('resume'),false);assert.deepEqual(row.deliveryEnvironment,[]);
  const {reservationIndex,origin}=assertRepairOrigin(input,events);
  const completedBefore=events.slice(0,reservationIndex).filter(e=>e.fact.type==='DecisionResolved').map(e=>e.fact.resolution);assert.deepEqual(input.context.decisions,completedBefore);
  const previousIds=events.slice(0,reservationIndex).filter(e=>['AttemptReserved','RepairReserved'].includes(e.fact.type)).map(e=>e.fact.attempt.id);assert.deepEqual(input.context.priorAttempts.map(a=>a.id),previousIds);
  assert.deepEqual(input.context.priorAttempts,p.attempts.filter(a=>previousIds.includes(a.id)));
  const r=input.context.repair;if(!r)return;
  assert.ok(origin);
  const source=events.find(e=>e.fact.type==='VerificationCompleted'&&e.fact.operationId===r.failedVerificationId);assert.ok(source);assert.deepEqual(r.results,source.fact.results);
  const bytes=readFileSync(r.evidence.path);assert.equal(hash(bytes),r.evidence.digest);const evidence=JSON.parse(bytes);assert.equal(r.failedAttemptId,evidence.attemptId);assert.deepEqual(evidence.contract,p.contract);
  assert.deepEqual(r.commands.map(c=>c.specId),evidence.commands.map(c=>c.specId));
  for(const [i,command]of r.commands.entries()){assert.deepEqual(command.process,evidence.commands[i].process);for(const stream of ['stdout','stderr']){const captured=readFileSync(command.process[stream].path);assert.equal(hash(captured),command.process[stream].digest);assert.deepEqual(Buffer.from(command[`${stream}Base64`],'base64'),captured);}}
}
