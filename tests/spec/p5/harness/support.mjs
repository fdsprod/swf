import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {copyFileSync,existsSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import Ajv from 'ajv';
import {fixture as p4Fixture,trustedRoot,killFactory,git,cli,hash,start,waitFor} from '../../p4/harness/support.mjs';
export * from '../../p4/harness/support.mjs';
const ajv=new Ajv({strict:true,allErrors:true});
for(const name of ['run-fixture','cli-result','local-config','local-result','local-evidence','durable-result'])ajv.addSchema(JSON.parse(readFileSync(join(trustedRoot,`src/contracts/schemas/${name}.schema.json`),'utf8')));
export const validateGitHubConfig=ajv.compile(JSON.parse(readFileSync(join(trustedRoot,'src/contracts/schemas/github-run.schema.json'),'utf8')));
export const validateSnapshot=ajv.compile({$ref:'https://swf.local/schemas/p2/durable-result.schema.json#/definitions/deliverySnapshot'});
export function fixture({worker='good',repair=false,decisions=false}={}){
  const f=p4Fixture({worker:repair?worker==='good'?'fail-first':worker:worker,enabled:repair,decisions});
  if(!repair)f.config.worker.prefixArgs=[join(f.trusted,'p2-worker.cjs'),worker,f.root];
  copyFileSync(join(trustedRoot,'tests/spec/p5/fixtures/github-double.cjs'),join(f.trusted,'p5-github-double.cjs'));
  const gitExe=spawnSync('powershell.exe',['-NoProfile','-Command','(Get-Command git.exe).Source'],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(gitExe.status,0);f.gitExe=gitExe.stdout.trim();
  f.remote=join(f.root,'remote.git');git(f.root,'init','--bare',f.remote);git(f.repo,'remote','add','origin',f.remote);git(f.repo,'push','origin','HEAD:refs/heads/main');
  const {schemaVersion,request,repair:repairConfig,decisions:decisionConfig,...runtime}=f.config;
  f.githubConfig={schemaVersion:1,issue:{owner:'factory-fixture',repo:'delivery',number:7},baseBranch:'main',constraints:['Only edit src/'],acceptanceCriteria:['Trusted answer check passes'],runtime,github:{executable:join(f.root,'gateway-node.exe'),prefixArgs:[join(f.trusted,'p5-github-double.cjs'),f.root],timeoutSeconds:10},git:{executable:f.gitExe,timeoutSeconds:30},...(repair?{repair:repairConfig}:{}),...(decisions?{decisions:{authorizedResolver:decisionConfig.authorizedResolver}}:{}),delivery:{transport:{kind:'local_bare',path:f.remote},commitIdentity:{name:'Factory Fixture',email:'factory@example.invalid'},requiredChecks:[{name:'required-build',appId:301}]}};
  f.configPath=join(f.root,'github-config.json');f.gatewayPath=join(f.root,'github.json');
  const repository={id:501,name:'delivery',full_name:'factory-fixture/delivery',owner:{login:'factory-fixture'},html_url:'https://github.com/factory-fixture/delivery',clone_url:'https://github.com/factory-fixture/delivery.git',default_branch:'main'};
  const issue={id:701,number:7,title:'Export the requested answer',body:'Change src/answer.cjs to export 42.\nKeep all trusted checks.',state:'open',html_url:repository.html_url+'/issues/7',repository_url:'https://api.github.com/repos/factory-fixture/delivery'};
  writeFileSync(f.gatewayPath,JSON.stringify({repository,issue,base:{name:'main',commit:{sha:f.base}},publisher:{id:201,login:'factory-fixture'},comments:[],pulls:[],calls:[],nextId:1000,mode:'normal',checkMode:'success',remote:f.remote,git:f.gitExe}));
  writeConfig(f);return f;
}
export function writeConfig(f){writeFileSync(f.configPath,JSON.stringify(f.githubConfig));}
export async function withFixture(options,action){if(typeof options==='function'){action=options;options={};}const f=fixture(options);try{return await action(f);}finally{for(const h of f.handles)if(!h.closed)await killFactory(h);f.cleanup();}}
export const runArgs=(f,maxStarts)=>['run','--github',f.configPath,'--store',f.store,...(maxStarts===undefined?[]:['--max-starts',String(maxStarts)]),'--json'];
export const run=(f,maxStarts,options)=>cli(runArgs(f,maxStarts),options);
export async function holdBeforePush(f){
  const point='delivery.before_push',marker=join(f.root,'before-push.json'),release=join(f.root,'release-push');
  const handle=start(f,runArgs(f),{SWF_TEST_FAULT:JSON.stringify({point,marker,release})});
  await waitFor(()=>{if(existsSync(marker))return true;assert.equal(handle.closed,false,`Factory must reach ${point}: ${handle.stdout}\n${handle.stderr}`);return false;},'Factory did not reach final absent-ref push boundary');
  const observed=JSON.parse(readFileSync(marker,'utf8'));assert.equal(observed.point,point);assert.ok(observed.runId);return{handle,release};
}
export const gateway=f=>JSON.parse(readFileSync(f.gatewayPath,'utf8'));
export function updateGateway(f,change){const data=gateway(f);change(data);writeFileSync(f.gatewayPath,JSON.stringify(data));return data;}
export const posts=f=>gateway(f).calls.filter(c=>c.method==='POST'&&c.endpoint?.split('?')[0].endsWith('/pulls'));
export const remoteRefs=f=>git(f.root,'ls-remote',f.remote,'refs/heads/swf/*').split(/\r?\n/).filter(Boolean).map(s=>{const [sha,ref]=s.split(/\s+/);return{sha,ref};});
export const normalizedRequest=f=>{const d=gateway(f);return{id:`github:${d.repository.id}:issue:${d.issue.id}`,source:{provider:'github',externalId:String(d.issue.number),url:d.issue.html_url},repository:{url:d.repository.html_url+'.git',baseRef:f.githubConfig.baseBranch},objective:d.issue.title+'\n\n'+(d.issue.body??''),constraints:f.githubConfig.constraints,acceptanceCriteria:f.githubConfig.acceptanceCriteria,metadata:{githubRepositoryId:d.repository.id,githubIssueId:d.issue.id}};};
export function addAnswer(f,decisionId,{answer='Use 42.\nApproved.',selectedOptionId='forty-two'}={}){updateGateway(f,d=>{const id=d.nextId++,date=new Date().toISOString();d.comments.push({id,html_url:d.issue.html_url+'#issuecomment-'+id,user:f.githubConfig.decisions.authorizedResolver,body:JSON.stringify({schemaVersion:1,decisionId,answer,selectedOptionId}),created_at:date,updated_at:date});});}
export function sourceSnapshot(f){return{head:git(f.repo,'rev-parse','HEAD'),index:hash(readFileSync(join(f.repo,'.git/index'))),answer:hash(readFileSync(join(f.repo,'src/answer.cjs')))};}
export function assertNoDelivery(f){assert.deepEqual(remoteRefs(f),[]);assert.equal(posts(f).length,0);}
export function assertPinnedTransport(p,f){assert.deepEqual(p.intake.transport,{kind:'local_bare',path:realpathSync(f.remote)});assert.deepEqual(p.delivery.plan.transport,p.intake.transport);}
