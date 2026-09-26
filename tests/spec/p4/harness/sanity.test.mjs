import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {withFixture,hash,validateContext} from './support.mjs';
import {replay,assertSnapshot} from './replay.mjs';
import {validateConfig} from '../../p1/harness/support.mjs';

function trace(f){
  const unit={id:`${f.config.request.id}:unit:1`,objective:f.config.request.objective,constraints:f.config.request.constraints,verification:f.config.verification,metadata:f.config.request.metadata};
  const art=name=>({path:join(f.root,name),digest:'a'.repeat(64)}),attempt=n=>({id:`attempt-${n}`,ordinal:n,completionPath:art(`completion-${n}.json`).path});
  const result=status=>({specId:'answer',status,summary:status,evidence:[{id:'result',kind:'command_output',uri:'file:///capture',digest:'a'.repeat(64)}]});
  const facts=[
    {type:'RunCreated',contract:{config:f.config,digest:'b'.repeat(64),programs:[]},graph:{id:`${f.config.request.id}:graph`,requestId:f.config.request.id,units:[unit],dependencies:[]},baseCommit:f.base,maxStarts:5},
    {type:'WorkspacePlanned',operationId:'workspace-1',workspace:{repositoryPath:f.repo,path:join(f.config.workspaceRoot,'one'),baseCommit:f.base}},
    {type:'WorkspaceReady',operationId:'workspace-1'},
    {type:'AttemptReserved',attempt:attempt(1)},
    {type:'WorkerCompleted',attemptId:'attempt-1',outcome:{kind:'completed',summary:'claim',evidence:[]},record:art('completion-1.json')},
    {type:'VerificationPlanned',operationId:'verify-1',attemptId:'attempt-1',evidencePath:art('evidence-1.json').path},
    {type:'VerificationCompleted',operationId:'verify-1',results:[result('failed')],issues:[],evidence:art('evidence-1.json')},
    {type:'RepairReserved',repairId:'repair-1',failedVerificationId:'verify-1',evidence:art('evidence-1.json'),attempt:attempt(2)},
    {type:'WorkerCompleted',attemptId:'attempt-2',outcome:{kind:'completed',summary:'repair claim',evidence:[]},record:art('completion-2.json')},
    {type:'VerificationPlanned',operationId:'verify-2',attemptId:'attempt-2',evidencePath:art('evidence-2.json').path},
    {type:'VerificationCompleted',operationId:'verify-2',results:[result('passed')],issues:[],evidence:art('evidence-2.json')},
  ];return structuredClone(facts.map((fact,i)=>({sequence:i+1,runId:'sanity-run',fact})));
}
test('P4 sanity: independent replay requires both budgets and exact failed-verification source',()=>withFixture(f=>{
  const events=trace(f),p=replay(events);assert.equal(p.state.status,'VERIFIED');assert.equal(p.repairs.length,1);assert.equal(p.attempts.length,2);assertSnapshot({events,projection:p});
  for(const change of [e=>{e[0].fact.maxStarts=1;},e=>{e[0].fact.contract.config.repair.maxRepairs=0;},e=>{e[7].fact.failedVerificationId='unknown';},e=>{e[7].fact.evidence.digest='c'.repeat(64);},e=>{e[6].fact.issues=['forbidden path'];},e=>{e[6].fact.results[0].status='error';},e=>{delete e[0].fact.contract.config.repair;},e=>{e[7].fact.attempt.ordinal=3;}]){const bad=structuredClone(events);change(bad);assert.throws(()=>replay(bad),assert.AssertionError);}
  const forged=structuredClone(p);forged.repairs=[];assert.throws(()=>assertSnapshot({events,projection:forged}),assert.AssertionError);
}));

test('P4 sanity: optional repair config preserves legacy schema and rejects invalid bounds',()=>withFixture(f=>{
  assert.equal(validateConfig(f.config),true);const old=structuredClone(f.config);delete old.repair;assert.equal(validateConfig(old),true);
  for(const maxRepairs of [-1,1.5,101,'1']){const bad=structuredClone(f.config);bad.repair.maxRepairs=maxRepairs;assert.equal(validateConfig(bad),false);}
  const extra=structuredClone(f.config);extra.repair.used=0;assert.equal(validateConfig(extra),false);
}));

test('P4 sanity: fixture fixes only with exact captured failure; altered output is rejected',()=>withFixture(f=>{
  const input={schemaVersion:1,runId:'sanity-run',attemptId:'one',workspace:{path:f.repo,repositoryPath:f.repo,baseCommit:f.base},context:{request:f.config.request,unit:trace(f)[0].fact.graph.units[0],priorAttempts:[],decisions:[],evidence:[],repositoryContext:[{path:f.repo,baseCommit:f.base}]}};
  const invoke=()=>spawnSync(f.config.worker.executable,[...f.config.worker.prefixArgs,'exec','--json','-C',f.repo,JSON.stringify(input)],{encoding:'utf8',windowsHide:true,timeout:10000});
  const check=()=>spawnSync(f.config.commands[0].executable,f.config.commands[0].args,{cwd:f.repo,encoding:'utf8',windowsHide:true,timeout:10000});
  assert.ok(validateContext(input));assert.equal(invoke().status,0);const failed=check();assert.equal(failed.status,7);
  const artifact=(name,bytes)=>{const path=join(f.root,name);writeFileSync(path,bytes);return{path,digest:hash(bytes)};};
  const stdout=artifact('failure.stdout',failed.stdout),stderr=artifact('failure.stderr',failed.stderr),manifest=artifact('failure.json','{}');
  input.attemptId='two';input.context.repair={repairId:'repair-1',failedVerificationId:'verification-1',failedAttemptId:'one',evidence:manifest,results:[{specId:'answer',status:'failed',summary:'Actual exit 7',evidence:[{id:'output',kind:'command_output',uri:'file:///failure',digest:stderr.digest}]}],commands:[{specId:'answer',process:{executable:f.config.commands[0].executable,args:f.config.commands[0].args,cwd:f.repo,termination:{kind:'exited',exitCode:7},stdout,stderr},stdoutBase64:Buffer.from(failed.stdout).toString('base64'),stderrBase64:Buffer.from(failed.stderr).toString('base64')}]};
  assert.ok(validateContext(input));const correct=input.context.repair.commands[0].stderrBase64;input.context.repair.commands[0].stderrBase64=Buffer.from('invented failure').toString('base64');assert.notEqual(invoke().status,0);assert.equal(check().status,7);
  input.context.repair.commands[0].stderrBase64=correct;assert.equal(invoke().status,0);assert.equal(check().status,0);assert.equal(readFileSync(join(f.repo,'src/preserved.txt'),'utf8'),'keep-first-edit');
}));
