// Dependency learning only: installed Git/gh, dummy credentials and loopback HTTP.
// No product imports, real authentication, global config writes, or remote writes.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const git=process.env.LEARNING_GIT_EXE||'C:/Program Files/Git/cmd/git.exe';
const gh=process.env.LEARNING_GH_EXE||'C:/Program Files/GitHub CLI/gh.exe';
const root=mkdtempSync(join(tmpdir(),'swf-p5-credential-learning-'));
const output=resolve(process.argv[2]||join(root,'observations.json'));
const observations=[],commands=[];
const dummyGitHub='DUMMY_GITHUB_CREDENTIAL_NOT_A_SECRET',dummyEnterprise='DUMMY_ENTERPRISE_CREDENTIAL_NOT_A_SECRET',dummyHttp='DUMMY_LOOPBACK_CREDENTIAL_NOT_A_SECRET';
const configDir=join(root,'gh config'),emptyGlobal=join(root,'empty-global'),emptyAttrs=join(root,'empty-attributes'),hooks=join(root,'empty-hooks');
for(const dir of [configDir,hooks])mkdirSync(dir);for(const file of [emptyGlobal,emptyAttrs])writeFileSync(file,'');
const cleanEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>!(/^(GIT_|GH_|GITHUB_|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$|NO_PROXY$|SSH_ASKPASS$)/i.test(key))));
Object.assign(cleanEnv,{GH_CONFIG_DIR:configDir,GH_TOKEN:dummyGitHub,GH_ENTERPRISE_TOKEN:dummyEnterprise,GH_PROMPT_DISABLED:'1',GH_NO_UPDATE_NOTIFIER:'1',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:emptyGlobal,GIT_ATTR_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never',NO_PROXY:'*'});
const quote=value=>"'"+value.replaceAll('\\','/').replaceAll("'","'\\''")+"'";
const helper='!'+quote(gh)+' auth git-credential';
const protocol=(host='github.com',scheme='https',extra='')=>`protocol=${scheme}\nhost=${host}\n${extra}\n`;
const fields=bytes=>Object.fromEntries(bytes.toString().trim().split(/\r?\n/).filter(Boolean).map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)];}));
function safeResult(executable,args,result){
  assert.equal(args.some(arg=>[dummyGitHub,dummyEnterprise,dummyHttp].some(token=>arg.includes(token))),false,'Credential must not enter argv');
  const item={executable,args,exitCode:result.status??result.code,signal:result.signal??null};commands.push(item);return result;
}
function sync(executable,args,{input='',cwd=root,env=cleanEnv}={}){
  const child=spawnSync(executable,args,{cwd,env,input,encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1024*1024});assert.equal(!!child.error,false,'Bounded dependency command must finish');return safeResult(executable,args,child);
}
function gitSync(args,options){return sync(git,args,options);}
function success(result,label){assert.equal(result.status??result.code,0,label);return result.stdout;}
function observe(name,value){observations.push({name,...value});}
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]);}
const ghFilesBefore=files(configDir);
const versions={node:process.version,git:success(sync(git,['--version']),'Git version').trim(),gh:success(sync(gh,['--version']),'gh version').split(/\r?\n/)[0]};

// Direct native gh behavior with dummy environment credentials. Never use the real
// user's token or config; even unknown hosts have an explicit dummy enterprise token.
for(const [host,scheme]of [['github.com','https'],['github.com','http'],['github.com.evil.invalid','https'],['gist.github.com','https'],['github.com:443','https']]){
  const result=sync(gh,['auth','git-credential','get'],{input:protocol(host,scheme)}),data=fields(result.stdout);
  assert.ok(!data.password||[dummyGitHub,dummyEnterprise].includes(data.password),'Only a known dummy may be returned');
  observe('native-gh-get',{host,scheme,exitCode:result.status,returnedCredential:data.password===dummyGitHub?'dummy-github':data.password===dummyEnterprise?'dummy-enterprise':'none',username:data.username??null});
}
for(const operation of ['store','erase']){
  const result=sync(gh,['auth','git-credential',operation],{input:protocol('github.com','https',`username=fixture-user\npassword=${dummyGitHub}\n`)});success(result,'gh '+operation);assert.equal(result.stdout,'');assert.equal(result.stderr,'');
  const reread=fields(success(sync(gh,['auth','git-credential','get'],{input:protocol()}),'gh reread'));assert.equal(reread.password,dummyGitHub);observe('native-gh-'+operation,{exitCode:0,outputEmpty:true,subsequentDummyCredentialUnchanged:true});
}
assert.deepEqual(files(configDir),ghFilesBefore);observe('gh-config-unchanged',{filesWritten:0});

// Git invokes helpers through its shell. A ! prefix plus POSIX single quoting
// reaches the pinned native executable despite Program Files spaces.
const scoped=['-c','credential.helper=','-c','credential.https://github.com.helper='+helper];
const throughGit=gitSync([...scoped,'credential','fill'],{input:protocol()});assert.equal(fields(success(throughGit,'Git invokes native gh')).password,dummyGitHub);
observe('native-gh-through-git',{pinnedExecutable:gh,helper,credentialInArgv:false,dummyCredentialReturned:true});
for(const [host,scheme]of [['github.com.evil.invalid','https'],['gist.github.com','https'],['github.com','http']]){
  const result=gitSync([...scoped,'credential','fill'],{input:protocol(host,scheme)});assert.notEqual(result.status,0);assert.equal(fields(result.stdout).password,undefined);observe('url-scoped-gh-refusal',{host,scheme,exitCode:result.status,credentialReturned:false});
}
const explicitPort=gitSync([...scoped,'credential','fill'],{input:protocol('github.com:443')});const portPassword=fields(explicitPort.stdout).password;assert.ok(!portPassword||[dummyGitHub,dummyEnterprise].includes(portPassword));observe('url-scoped-explicit-default-port',{host:'github.com:443',exitCode:explicitPort.status,returnedCredential:portPassword===dummyGitHub?'dummy-github':portPassword===dummyEnterprise?'dummy-enterprise':'none'});

// Owned fixture executables/scripts have spaces, $, and an apostrophe in their
// absolute paths. Shell quoting must preserve these literal bytes.
const trusted=join(root,"trusted programs $fixture's");mkdirSync(trusted);
const fixtureNode=join(trusted,'native node.exe'),fixtureScript=join(trusted,'credential fixture.cjs');copyFileSync(process.execPath,fixtureNode);copyFileSync(join(dirname(fileURLToPath(import.meta.url)),'credential-helper-fixture.cjs'),fixtureScript);
const fixtureHelper=label=>'!'+[fixtureNode,fixtureScript,root,label].map(quote).join(' ');
const calls=()=>existsSync(join(root,'helper-calls.jsonl'))?readFileSync(join(root,'helper-calls.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
writeFileSync(join(root,'helper.json'),JSON.stringify({protocol:'https',host:'fixture.invalid',password:dummyHttp}));
const source=join(root,'untrusted source'),controlled=join(root,'controlled.git');success(gitSync(['init',source]),'Source fixture init');success(gitSync(['init','--bare',controlled]),'Controlled Git directory init');
success(gitSync(['-C',source,'config','credential.helper',fixtureHelper('source-local')]),'Fixture local helper');
success(gitSync(['-C',source,'config','url.http://rewritten.invalid/.insteadOf','https://github.com/']),'Fixture rewrite');
const sourceConfigBefore=readFileSync(join(source,'.git/config'));
const control=gitSync(['-C',source,'credential','fill'],{input:protocol('fixture.invalid')});assert.equal(fields(success(control,'Source helper positive control')).password,dummyHttp);assert.equal(calls().at(-1).label,'source-local');
const prior=calls().length;success(gitSync(['-C',source,'-c','credential.helper=','-c','credential.helper='+fixtureHelper('command-only'),'credential','fill'],{input:protocol('fixture.invalid')}),'Command helper reset');assert.deepEqual(calls().slice(prior).map(x=>x.label),['command-only']);
observe('helper-reset',{sourcePositiveControl:true,afterResetLabels:calls().slice(prior).map(x=>x.label),literalSpecialPath:true});

const hostileEnv={...cleanEnv,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'credential.helper',GIT_CONFIG_VALUE_0:fixtureHelper('inherited-runtime')};
const inheritedPrior=calls().length;success(gitSync(['--git-dir',controlled,'credential','fill'],{cwd:source,env:hostileEnv,input:protocol('fixture.invalid')}),'Inherited config positive control');assert.deepEqual(calls().slice(inheritedPrior).map(x=>x.label),['inherited-runtime']);
const controlledArgs=['--git-dir',controlled,'-c','core.hooksPath='+hooks,'-c','core.attributesFile='+emptyAttrs,'-c','credential.helper=','-c','credential.helper='+fixtureHelper('controlled')];
const cleanPrior=calls().length;success(gitSync([...controlledArgs,'credential','fill'],{cwd:source,input:protocol('fixture.invalid')}),'Isolated directory/helper');assert.deepEqual(calls().slice(cleanPrior).map(x=>x.label),['controlled']);
const origins=success(gitSync(['--git-dir',controlled,'config','--show-origin','--list'],{cwd:source}),'Controlled config origins');assert.equal(origins.includes(source.replaceAll('\\','/')),false);assert.equal(origins.includes('rewritten.invalid'),false);
assert.deepEqual(readFileSync(join(source,'.git/config')),sourceConfigBefore);observe('controlled-git-directory',{sourceCwd:true,sourceConfigExcluded:true,inheritedConfigPositiveControl:true,sanitizedRuntimeConfigExcluded:true,sourceConfigUnchanged:true});

// A local read-only HTTP origin proves Git's authentication challenge, helper
// get/store/erase callbacks, and exact-host rejection. It proves no push rights.
const requests=[],sha='1'.repeat(40);
const server=createServer((req,res)=>{
  const expected='Basic '+Buffer.from('fixture-user:'+dummyHttp).toString('base64');const auth=req.headers.authorization;
  requests.push({method:req.method,path:req.url,host:req.headers.host,authorization:auth===undefined?'none':auth===expected?'known-dummy':'unexpected'});
  if(req.url.startsWith('/redirect.git/')){res.writeHead(302,{Location:'http://localhost:'+server.address().port+req.url.replace('/redirect.git/','/repo.git/')});res.end();return;}
  if(auth!==expected||req.url.startsWith('/reject.git/')){res.writeHead(401,{'WWW-Authenticate':'Basic realm="learning"'});res.end();return;}
  res.writeHead(200,{'Content-Type':'text/plain'});res.end(req.url.includes('/info/refs')?sha+'\trefs/heads/main\n':req.url.endsWith('/HEAD')?'ref: refs/heads/main\n':'');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port,host='127.0.0.1:'+port;
writeFileSync(join(root,'helper.json'),JSON.stringify({protocol:'http',host,password:dummyHttp}));
const localArgs=['--git-dir',controlled,'-c','credential.helper=','-c','credential.http://'+host+'.helper='+fixtureHelper('http-scoped'),'-c','credential.useHttpPath=true','-c','http.proxy=','-c','http.followRedirects=false'];
async function asyncGit(args){
  const child=spawn(git,args,{cwd:source,env:cleanEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const timer=setTimeout(()=>child.kill('SIGKILL'),15000);
  child.stdout.on('data',b=>{stdout+=b.toString();if(stdout.length>1024*1024)child.kill('SIGKILL');});child.stderr.on('data',b=>{stderr+=b.toString();if(stderr.length>1024*1024)child.kill('SIGKILL');});
  try{const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal,stdout,stderr}));});assert.equal(result.signal,null,'HTTP command must finish within bound');return safeResult(git,args,result);}finally{clearTimeout(timer);}
}
try{
  const start=calls().length,requestStart=requests.length;const read=await asyncGit([...localArgs,'ls-remote','http://'+host+'/repo.git','refs/heads/main']);assert.equal(read.code,0);assert.equal(read.stdout.trim(),sha+'\trefs/heads/main');
  const steps=calls().slice(start);assert.ok(steps.some(x=>x.operation==='get'));assert.ok(steps.some(x=>x.operation==='store'));assert.ok(steps.every(x=>x.knownDummyPassword));assert.ok(requests.slice(requestStart).some(x=>x.authorization==='known-dummy'));observe('authenticated-loopback-read',{exitCode:read.code,helperOperations:steps.map(x=>x.operation),paths:steps.map(x=>x.path),readExactRef:true});
  const rejectStart=calls().length;const rejected=await asyncGit([...localArgs,'ls-remote','http://'+host+'/reject.git']);assert.notEqual(rejected.code,0);assert.ok(calls().slice(rejectStart).some(x=>x.operation==='erase'));observe('rejected-loopback-credential',{exitCode:rejected.code,helperOperations:calls().slice(rejectStart).map(x=>x.operation)});
  const mismatchStart=calls().length,requestMismatch=requests.length;const mismatch=await asyncGit([...localArgs,'ls-remote','http://localhost:'+port+'/repo.git']);assert.notEqual(mismatch.code,0);assert.equal(calls().length,mismatchStart);assert.ok(requests.slice(requestMismatch).every(x=>x.authorization==='none'));observe('loopback-host-mismatch',{exitCode:mismatch.code,helperCalls:0,authorizationSent:false});
  const redirectStart=requests.length;const redirected=await asyncGit([...localArgs,'ls-remote','http://'+host+'/redirect.git']);assert.notEqual(redirected.code,0);assert.ok(requests.slice(redirectStart).every(x=>x.host===host&&x.authorization==='none'));observe('redirect-disabled',{exitCode:redirected.code,followedDifferentHost:false,authorizationSent:false});
}finally{await new Promise(resolve=>server.close(resolve));}
assert.ok(requests.every(x=>x.method==='GET'&&x.authorization!=='unexpected'));assert.deepEqual(readFileSync(join(source,'.git/config')),sourceConfigBefore);assert.deepEqual(files(configDir),ghFilesBefore);
const report={schemaVersion:1,observedAt:new Date().toISOString(),versions,fixtureRoot:root,dummyCredentialsOnly:true,realCredentialsRead:false,remoteWrites:false,globalConfigWrites:false,observations,helperCalls:calls(),httpRequests:requests,commands,limitations:['Loopback HTTP is not HTTPS certificate/credential integration.','No actual GitHub token, authenticated push, private repository, permissions or branch protection was exercised.','The native gh helper is not an exact-host policy by itself; the tested command-scoped URL configuration is an additional boundary.']};
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');process.stdout.write(JSON.stringify({report:output,fixtureRoot:root,versions,observations},null,2)+'\n');
