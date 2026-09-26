import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withFixture,validateGitHubConfig,validateProjection,git,hash,gateway,updateGateway,normalizedRequest} from './support.mjs';
import {commitSha,ciKind,replay,assertSnapshot,assertIntake,assertDeliveryArtifacts} from './replay.mjs';
import {gitResult,observedGit,assertGitModes,treeRecords} from './git-oracle.mjs';

function artifact(f,name,bytes){const path=join(f.root,name);writeFileSync(path,bytes);return{path,digest:hash(bytes)};}
function commitInput(f){
  writeFileSync(join(f.repo,'src/answer.cjs'),'module.exports = 42;\n');git(f.repo,'add','src/answer.cjs');const tree=git(f.repo,'write-tree'),identity={name:'Factory Fixture',email:'factory@example.invalid',date:'1700000000 +0000'},message=artifact(f,'commit-message.txt','Factory fixture commit\n');
  const input={tree,parent:f.base,author:identity,committer:identity,message,expectedSha:'0'.repeat(40)};
  const raw=Buffer.concat([Buffer.from(`tree ${tree}\nparent ${f.base}\nauthor ${identity.name} <${identity.email}> ${identity.date}\ncommitter ${identity.name} <${identity.email}> ${identity.date}\n\n`),readFileSync(message.path)]);
  input.expectedSha=observedGit(f,['-C',f.repo,'hash-object','-t','commit','-w','--stdin'],raw).toString().trim();return input;
}

test('P5 sanity: Git commit identity is deterministic and create-only push rejects an ancestor conflict',()=>withFixture(f=>{
  const input=commitInput(f);assert.equal(commitSha(input),input.expectedSha);assert.notEqual(commitSha({...input,committer:{...input.committer,date:'1700000001 +0000'}}),input.expectedSha);
  const ref='refs/heads/swf/sanity',args=['-C',f.repo,'push','--porcelain','--force-with-lease='+ref+':',f.remote,input.expectedSha+':'+ref];observedGit(f,args);observedGit(f,args);
  const conflict='refs/heads/swf/conflict';git(f.root,'--git-dir',f.remote,'update-ref',conflict,f.base);const rejected=gitResult(f,['-C',f.repo,'push','--porcelain','--force-with-lease='+conflict+':',f.remote,input.expectedSha+':'+conflict]);assert.notEqual(rejected.status,0);assert.equal(git(f.root,'--git-dir',f.remote,'rev-parse',conflict),f.base);
  observedGit(f,['-C',f.repo,'push','--porcelain',f.remote,input.expectedSha+':'+conflict]);assert.equal(git(f.root,'--git-dir',f.remote,'rev-parse',conflict),input.expectedSha,'Plain push would overwrite the concurrently created ancestor');
}));

test('P5 sanity: Git mode oracle preserves base executable mode and defaults new files',()=>withFixture(f=>{
  git(f.repo,'update-index','--chmod=+x','src/answer.cjs');const tree=git(f.repo,'write-tree'),base=treeRecords(observedGit(f,['-C',f.repo,'ls-tree','-rz','--full-tree',tree]));assert.equal(base.find(x=>x.path==='src/answer.cjs').mode,'100755');
  const snapshot={files:[{path:'src/answer.cjs',mode:'100755'},{path:'src/new file.txt',mode:'100644'}]};assertGitModes(snapshot,base);
  for(const [index,mode]of [[0,'100644'],[0,'438'],[1,'100755']]){const bad=structuredClone(snapshot);bad.files[index].mode=mode;assert.throws(()=>assertGitModes(bad,base),assert.AssertionError);}
}));

test('P5 sanity: strict input has no competing request, empty CI contract or worker transport choice',()=>withFixture(f=>{
  assert.equal(validateGitHubConfig(f.githubConfig),true);
  for(const change of [c=>{c.request={objective:'competing'};},c=>{c.delivery.requiredChecks=[];},c=>{c.runtime.delivery={remote:'worker-choice'};},c=>{c.delivery.transport={kind:'named_remote',name:'origin'};},c=>{c.delivery.requiredChecks[0].appId='301';}]){const bad=structuredClone(f.githubConfig);change(bad);assert.equal(validateGitHubConfig(bad),false);}
}));

test('P5 sanity: fake gateway binds hostname and models object-page CI with a pending repeat',()=>withFixture(f=>{
  const invoke=args=>spawnSync(f.githubConfig.github.executable,[...f.githubConfig.github.prefixArgs,'api',...args],{encoding:'utf8',windowsHide:true,timeout:10000,env:{...process.env,GH_HOST:'hostile.invalid'}});
  assert.equal(invoke(['--method','GET','user']).status,1);const prefix=['--hostname','github.com','--method','GET'];assert.equal(JSON.parse(invoke([...prefix,'repos/factory-fixture/delivery']).stdout).id,501);
  updateGateway(f,d=>{d.checkMode='repeated';});const data=JSON.parse(invoke([...prefix,'repos/factory-fixture/delivery/commits/'+f.base+'/check-runs?filter=all&per_page=1','--paginate','--slurp']).stdout);assert.equal(data.length,2);assert.equal(data[0].check_runs[0].conclusion,'success');assert.equal(data[1].check_runs[0].status,'queued');assert.equal(data[1].check_runs[0].id<data[0].check_runs[0].id,true);
}));

test('P5 sanity: independent CI oracle rejects stale, wrong-provider and ambiguous success',()=>{
  const head='a'.repeat(40),required=[{name:'build',appId:1}],check={id:99,name:'build',appId:1,headSha:head,kind:'completed',conclusion:'success'},observation={headSha:head,before:{head:{sha:head},state:{kind:'open'}},after:{head:{sha:head},state:{kind:'open'}},checks:[check]};
  assert.equal(ciKind(required,head,observation),'passed');assert.equal(ciKind(required,head,{...observation,checks:[]}), 'pending');assert.equal(ciKind(required,head,{...observation,checks:[{...check,appId:2}]}),'pending');assert.equal(ciKind(required,head,{...observation,after:{head:{sha:'b'.repeat(40)},state:{kind:'open'}}}),'stale_head');
  assert.equal(ciKind(required,head,{...observation,checks:[check,{...check,id:1,kind:'pending',status:'queued'}]}),'pending');assert.equal(ciKind(required,head,{...observation,checks:[{...check,conclusion:'skipped'}]}),'failed');
  assert.throws(()=>ciKind(required,head,{...observation,checks:[check,check]}),assert.AssertionError);
  assert.equal(ciKind(required,head,{...observation,after:{...observation.after,state:{kind:'closed'}}}),'unobserved');
  const both=[...required,{name:'lint',appId:2}],lint={...check,id:100,name:'lint',appId:2,kind:'pending',status:'queued'};assert.equal(ciKind(both,head,{...observation,checks:[check,lint]}),'pending');assert.equal(ciKind(both,head,{...observation,checks:[check,{...lint,kind:'completed',conclusion:'success'}]}),'passed');
});

function trace(f){
  const d=gateway(f),input=commitInput(f),request=normalizedRequest(f),config={schemaVersion:1,request,...f.githubConfig.runtime};
  const unit={id:request.id+':unit:1',objective:request.objective,constraints:request.constraints,verification:config.verification,metadata:request.metadata},graph={id:request.id+':graph',requestId:request.id,units:[unit],dependencies:[]};
  const contract={config,digest:'b'.repeat(64),programs:[f.githubConfig.github.executable,f.githubConfig.git.executable].map(path=>({path,digest:hash(readFileSync(path))}))};
  const records={repository:artifact(f,'repository.json',JSON.stringify(d.repository)),issue:artifact(f,'issue.json',JSON.stringify(d.issue)),base:artifact(f,'base.json',JSON.stringify(d.base))},intake={input:f.githubConfig,repository:{id:501,owner:'factory-fixture',name:'delivery',url:d.repository.html_url},issue:{id:701,number:7,url:d.issue.html_url},base:{branch:'main',sha:f.base},transport:{kind:'local_bare',path:f.remote},records};
  const output=artifact(f,'command-output','done\n'),process={executable:f.gitExe,args:['observed'],cwd:f.repo,termination:{kind:'exited',exitCode:0},stdout:output,stderr:output};
  const completed={kind:'completed',summary:'done',evidence:[]},completion=artifact(f,'completion.json','{}'),evidence=artifact(f,'evidence.json','{}'),snapshot=artifact(f,'snapshot.json','{}');
  const results=config.verification.required.map(s=>({specId:s.id,status:'passed',summary:'passed',evidence:[{id:s.id,kind:'command_output',uri:'file:///output',digest:output.digest}]}));
  const plan={operationId:'delivery-1',verificationId:'verification-1',evidence,candidateDigest:'c'.repeat(64),baseCommit:f.base,repository:intake.repository,transport:intake.transport,branch:'swf/'+hash('sanity-run'),commit:input,snapshot};
  const pr={id:900,number:1,url:d.repository.html_url+'/pull/1',authorId:201,repositoryId:501,head:{repositoryId:501,ref:plan.branch,sha:input.expectedSha},base:{repositoryId:501,ref:'main',sha:f.base},state:{kind:'open'},record:artifact(f,'pr.json','{}')};
  const observation={headSha:input.expectedSha,before:pr,after:pr,checks:[{id:1,name:'required-build',appId:301,headSha:input.expectedSha,kind:'completed',conclusion:'success'}],record:artifact(f,'ci.json','[]')};
  const facts=[{type:'RunCreated',contract,graph,baseCommit:f.base,maxStarts:5,intake},{type:'WorkspacePlanned',operationId:'workspace-1',workspace:{repositoryPath:f.repo,path:join(f.root,'workspaces/one'),baseCommit:f.base}},{type:'WorkspaceReady',operationId:'workspace-1'},{type:'AttemptReserved',attempt:{id:'attempt-1',ordinal:1,completionPath:completion.path}},{type:'WorkerCompleted',attemptId:'attempt-1',outcome:completed,record:completion},{type:'VerificationPlanned',operationId:'verification-1',attemptId:'attempt-1',evidencePath:evidence.path},{type:'VerificationCompleted',operationId:'verification-1',results,issues:[],evidence},{type:'DeliveryPlanned',plan},{type:'CommitCreated',operationId:plan.operationId,receipt:{sha:input.expectedSha,process}},{type:'PushStarted',operationId:plan.operationId},{type:'PushConfirmed',operationId:plan.operationId,receipt:{ref:'refs/heads/'+plan.branch,sha:input.expectedSha,process}},{type:'PrPlanned',publication:{operationId:'publication-1',publisher:d.publisher,title:'Factory change',body:artifact(f,'pr-body.txt','factory body')}},{type:'PrStarted',operationId:'publication-1'},{type:'PrCreated',operationId:'publication-1',receipt:pr},{type:'CiObserved',observation}];
  return JSON.parse(JSON.stringify(facts.map((fact,i)=>({sequence:i+1,runId:'sanity-run',fact}))));
}
test('P5 sanity: independent fact replay rejects changed target, ancestry, receipt and forged CI',()=>withFixture(f=>{
  const events=trace(f),p=replay(events);assert.equal(p.ci.kind,'passed');assertSnapshot({events,projection:p});assertIntake(p);
  for(const absent of ['intake','delivery','ci']){const partial=structuredClone(p);delete partial[absent];assert.equal(validateProjection(partial),false,'Partial GitHub feature group: '+absent);}
  const legacy=structuredClone(p);delete legacy.intake;delete legacy.delivery;delete legacy.ci;assert.equal(validateProjection(legacy),true);
  for(const change of [e=>{e[7].fact.plan.transport.path='another-target';},e=>{e[7].fact.plan.commit.parent='a'.repeat(40);},e=>{e[6].fact.results[0].status='failed';},e=>{e[10].fact.receipt.sha='b'.repeat(40);},e=>{e[13].fact.receipt.head.repositoryId=999;}]){const bad=structuredClone(events);change(bad);assert.throws(()=>replay(bad),assert.AssertionError);}
  const pending=structuredClone(events);pending.at(-1).fact.observation.checks=[];const wrong=replay(pending);wrong.ci.kind='passed';assert.throws(()=>assertSnapshot({events:pending,projection:wrong}),assert.AssertionError);
  assertDeliveryArtifacts([events[0]]);const old=events[0].fact.intake.records.issue;appendTamper(old.path);assert.throws(()=>assertDeliveryArtifacts([events[0]]),assert.AssertionError);
}));
function appendTamper(path){writeFileSync(path,Buffer.concat([readFileSync(path),Buffer.from('tampered')]));}

test('P5 sanity: absent real proof is blocked, never accepted or skipped',()=>{
  const child=spawnSync(process.execPath,[fileURLToPath(new URL('./live-proof.mjs',import.meta.url))],{encoding:'utf8',windowsHide:true,timeout:10000,env:{...process.env,P5_LIVE_PROOF:''}});assert.ifError(child.error);assert.equal(child.status,1);assert.match(child.stderr,/BLOCKED P5-LIVE/);
});
