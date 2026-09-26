// Isolated dependency observation. No product imports, credentials or network.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,readdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';

const root=mkdtempSync(join(tmpdir(),'swf-p5-shared-objects-')),reportPath=resolve(process.argv[2]||join(root,'observations.json'));
const git=process.env.LEARNING_GIT_EXE||'C:/Program Files/Git/cmd/git.exe';
const source=join(root,'source'),stage=join(root,'private staging'),controlled=join(root,'controlled.git'),remote=join(root,'intended.git'),decoy=join(root,'decoy.git');
const empty=join(root,'empty-config'),emptyHooks=join(root,'empty-hooks'),sourceHooks=join(root,'source-hooks'),sentinel=join(root,'source-effects.jsonl');
for(const path of [source,stage,emptyHooks,sourceHooks])mkdirSync(path);writeFileSync(empty,'');
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!(/^(GIT_|GH_|GITHUB_|SSH_ASKPASS$)/i.test(key))));
Object.assign(env,{GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:empty,GIT_ATTR_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',GIT_AUTHOR_NAME:'Shared Objects Learning',GIT_AUTHOR_EMAIL:'learning@example.invalid',GIT_COMMITTER_NAME:'Shared Objects Learning',GIT_COMMITTER_EMAIL:'learning@example.invalid',GIT_AUTHOR_DATE:'1700000000 +0000',GIT_COMMITTER_DATE:'1700000000 +0000'});
const commands=[],observations={};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const quote=value=>"'"+value.replaceAll('\\','/').replaceAll("'","'\\''")+"'";
const settings=['-c','core.autocrlf=false','-c','core.filemode=false','-c','core.attributesFile='+empty,'-c','commit.gpgSign=false','-c','tag.gpgSign=false'];
function run(args,{input,extraEnv={},allowFailure=false}={}){
  const result=spawnSync(git,args,{cwd:source,env:{...env,...extraEnv},input,windowsHide:true,encoding:null,timeout:20000,maxBuffer:4*1024*1024});
  const record={args,environmentOverrides:extraEnv,inputBase64:input===undefined?undefined:Buffer.from(input).toString('base64'),status:result.status,signal:result.signal,stdout:result.stdout?.toString('utf8'),stderr:result.stderr?.toString('utf8')};commands.push(record);assert.equal(!!result.error,false,'Dependency command must finish');if(!allowFailure)assert.equal(result.status,0,JSON.stringify(record));return result;
}
const ordinary=(args,options)=>run([...settings,...args],options);
const text=result=>result.stdout.toString('utf8').trim();
const lines=()=>existsSync(sentinel)?readFileSync(sentinel,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const entries=bytes=>bytes.toString('utf8').split('\0').filter(Boolean).map(line=>{const tab=line.indexOf('\t'),[mode,type,oid]=line.slice(0,tab).split(' ');return{path:line.slice(tab+1),mode,type,oid};});
const files=directory=>readdirSync(directory,{withFileTypes:true}).filter(e=>e.name!=='.git').flatMap(e=>e.isDirectory()?files(join(directory,e.name)).map(f=>({...f,path:e.name+'/'+f.path})):[{path:e.name,digest:hash(readFileSync(join(directory,e.name)))}]);

observations.version=text(run(['--version']));ordinary(['init','-b','main',source]);
writeFileSync(join(source,'.gitattributes'),'*.txt text eol=crlf\n');writeFileSync(join(source,'document.txt'),'base\n');writeFileSync(join(source,'deleted.txt'),'remove\n');writeFileSync(join(source,'executable.sh'),'#!/bin/sh\necho base\n');
ordinary(['add','-A']);ordinary(['update-index','--chmod=+x','executable.sh']);ordinary(['commit','-m','Pinned base']);
const base=text(ordinary(['rev-parse','HEAD']));
for(const directory of [controlled,remote,decoy])ordinary(['init','--bare',directory]);
ordinary(['push',remote,base+':refs/heads/main']);ordinary(['push',decoy,base+':refs/heads/decoy-only']);

// Every dangerous source mechanism is an owned fixture with a positive control.
const effectScript=join(root,'source-effect.cjs');writeFileSync(effectScript,`const fs=require('node:fs');const [kind,operation]=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(sentinel)},JSON.stringify({kind,operation})+'\\n');if(kind==='filter')process.stdout.write(fs.readFileSync(0).toString().toUpperCase());if(kind==='helper'&&operation==='get')process.stdout.write('username=dummy\\npassword=DUMMY_NOT_SECRET\\n\\n');`);
writeFileSync(join(sourceHooks,'pre-push'),'#!/bin/sh\nexec '+quote(process.execPath)+' '+quote(effectScript)+' hook\n');
ordinary(['config','core.hooksPath',sourceHooks]);ordinary(['config','credential.helper','!'+quote(process.execPath)+' '+quote(effectScript)+' helper']);
ordinary(['config','url.'+decoy.replaceAll('\\','/')+'.insteadOf',remote]);
ordinary(['config','filter.owned.smudge',quote(process.execPath)+' '+quote(effectScript)+' filter']);ordinary(['config','filter.owned.clean',quote(process.execPath)+' '+quote(effectScript)+' filter']);ordinary(['config','filter.owned.required','true']);
writeFileSync(join(source,'.git/info/attributes'),'*.txt filter=owned\n');
ordinary(['--attr-source='+base,'cat-file','--filters',base+':document.txt']);assert.ok(lines().some(x=>x.kind==='filter'));
ordinary(['credential','fill'],{input:'protocol=https\nhost=fixture.invalid\n\n'});assert.ok(lines().some(x=>x.kind==='helper'));
ordinary(['push',decoy,base+':refs/heads/hook-control']);assert.ok(lines().some(x=>x.kind==='hook'));
const rewritten=text(ordinary(['ls-remote',remote]));assert.match(rewritten,/refs\/heads\/decoy-only/);assert.doesNotMatch(rewritten,/refs\/heads\/main/);
observations.sourcePositiveControls={filter:true,helper:true,hook:true,rewrite:true,sourceInfoAttributes:'*.txt filter=owned'};

const sourceGit=realpathSync(text(ordinary(['rev-parse','--path-format=absolute','--git-common-dir']))),objects=realpathSync(join(sourceGit,'objects'));
const snapshot=()=>({head:text(ordinary(['rev-parse','HEAD'])),headBytes:hash(readFileSync(join(sourceGit,'HEAD'))),index:hash(readFileSync(join(sourceGit,'index'))),config:hash(readFileSync(join(sourceGit,'config'))),infoAttributes:hash(readFileSync(join(sourceGit,'info/attributes'))),files:files(source)});
const before=snapshot(),effectsBefore=lines();
// Staging contains approved candidate bytes, including deletion by absence.
writeFileSync(join(stage,'.gitattributes'),'*.txt text eol=crlf\n');writeFileSync(join(stage,'document.txt'),'candidate\r\n');writeFileSync(join(stage,'executable.sh'),'#!/bin/sh\necho candidate\n');writeFileSync(join(stage,'new file.txt'),'new file\r\n');
const candidate=files(stage),pathspec=join(root,'paths.z'),index=join(root,'private.index');writeFileSync(pathspec,['.gitattributes','document.txt','deleted.txt','executable.sh','new file.txt'].join('\0')+'\0');
const controlledArgs=['--git-dir',controlled,'--work-tree',stage,...settings,'-c','core.hooksPath='+emptyHooks,'-c','credential.helper='];
const sharedEnv={GIT_INDEX_FILE:index,GIT_OBJECT_DIRECTORY:objects};
const controlledRun=(args,options={})=>run([...controlledArgs,...args],{...options,extraEnv:{...sharedEnv,...options.extraEnv}});
const missing=run([...controlledArgs,'cat-file','-e',base],{allowFailure:true});assert.notEqual(missing.status,0,'Controlled object database starts without the source base');
controlledRun(['cat-file','-e',base]);controlledRun(['read-tree',base]);
controlledRun(['--attr-source='+base,'add','-A','-f','--pathspec-from-file='+pathspec,'--pathspec-file-nul']);
const tree=text(controlledRun(['write-tree'])),treeFiles=entries(controlledRun(['ls-tree','-rz','--full-tree',tree]).stdout);
assert.deepEqual(treeFiles.map(x=>x.path).sort(),candidate.map(x=>x.path).sort());assert.equal(treeFiles.find(x=>x.path==='executable.sh').mode,'100755');assert.equal(treeFiles.find(x=>x.path==='new file.txt').mode,'100644');assert.equal(treeFiles.some(x=>x.path==='deleted.txt'),false);
const message=Buffer.from('One deterministic delivery commit\n'),commit=text(controlledRun(['commit-tree',tree,'-p',base,'-F','-'],{input:message}));assert.equal(text(controlledRun(['commit-tree',tree,'-p',base,'-F','-'],{input:message})),commit);
for(const file of candidate){const actual=controlledRun(['--attr-source='+commit,'cat-file','--filters',commit+':'+file.path]).stdout;assert.equal(hash(actual),file.digest,'Controlled checkout bytes: '+file.path);}
assert.equal(controlledRun(['cat-file','blob',commit+':document.txt']).stdout.toString(),'candidate\n');
const ref='refs/heads/swf/shared-objects';controlledRun(['push','--porcelain','--force-with-lease='+ref+':',remote,commit+':'+ref]);controlledRun(['push','--porcelain','--force-with-lease='+ref+':',remote,commit+':'+ref]);
const receipt=text(controlledRun(['ls-remote','--exit-code',remote,ref]));assert.equal(receipt,commit+'\t'+ref);
// Read remote under a fresh environment without the shared-object override.
const remoteFiles=entries(run(['--git-dir',remote,...settings,'ls-tree','-rz','--full-tree',commit]).stdout);assert.deepEqual(remoteFiles,treeFiles);
for(const file of candidate)assert.equal(hash(run(['--git-dir',remote,...settings,'--attr-source='+commit,'cat-file','--filters',commit+':'+file.path]).stdout),file.digest);
assert.equal(text(run(['--git-dir',decoy,'show-ref','--verify',ref],{allowFailure:true})), '');
assert.deepEqual(snapshot(),before);assert.deepEqual(lines(),effectsBefore);assert.equal(text(controlledRun(['rev-list','--count',base+'..'+commit])),'1');
const config=text(controlledRun(['config','--show-origin','--list']));assert.equal(config.includes('filter.owned'),false);assert.equal(config.includes('insteadOf'),false);assert.equal(config.includes('source-hooks'),false);
observations.controlled={gitDirectory:controlled,privateWorkTree:stage,privateIndex:index,sharedObjectDirectory:objects,base,tree,commit,deterministicCommit:true,exactCandidateBytes:true,executableMode:'100755',newFileMode:'100644',deletedPathAbsent:true,storedTextIsLf:true,checkoutTextIsCrLf:true,remoteReceipt:receipt,remoteObjectsIndependent:true,sourcePreserved:true,noAdditionalSourceEffects:true,sourceConfigurationExcluded:true};
mkdirSync(dirname(reportPath),{recursive:true});writeFileSync(reportPath,JSON.stringify({schemaVersion:1,observedAt:new Date().toISOString(),fixtureRoot:root,nodeVersion:process.version,observations,sourceBefore:before,sourceAfter:snapshot(),sourceEffectCalls:lines(),candidate,treeFiles,commands},null,2)+'\n');
process.stdout.write(JSON.stringify({report:reportPath,observations,commands:commands.length},null,2)+'\n');
