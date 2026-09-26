// Installed-Git learning only. All hooks, filters and credentials are owned dummy fixtures.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';

const root=mkdtempSync(join(tmpdir(),'swf-p5-worktree-checkout-')),reportPath=resolve(process.argv[2]||join(root,'observations.json'));
const git=process.env.LEARNING_GIT_EXE||'C:/Program Files/Git/cmd/git.exe',source=join(root,'source'),hooks=join(root,'source-hooks'),emptyHooks=join(root,'empty-hooks'),log=join(root,'effects.jsonl');
for(const path of [source,hooks,emptyHooks])mkdirSync(path);
const emptyConfig=join(root,'empty-config'),globalConfig=join(root,'global-config'),globalAttributes=join(root,'global-attributes');writeFileSync(emptyConfig,'');writeFileSync(globalAttributes,'*.txt filter=owned\n');
const dummy='DUMMY_WORKTREE_CREDENTIAL_NOT_A_SECRET';
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!(/^(GIT_|GH_|GITHUB_|SSH_ASKPASS$)/i.test(key))));
Object.assign(env,{GH_TOKEN:dummy,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:emptyConfig,GIT_ATTR_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',GIT_AUTHOR_NAME:'Checkout learning',GIT_AUTHOR_EMAIL:'learning@example.invalid',GIT_COMMITTER_NAME:'Checkout learning',GIT_COMMITTER_EMAIL:'learning@example.invalid'});
const quote=value=>"'"+value.replaceAll('\\','/').replaceAll("'","'\\''")+"'";
const effect=join(root,'effect.cjs');writeFileSync(effect,`const fs=require('node:fs');const [kind,...args]=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({kind,args,pid:process.pid,parentPid:process.ppid,cwd:process.cwd(),inheritedDummyCredential:process.env.GH_TOKEN===${JSON.stringify(dummy)}})+'\\n');if(kind==='filter')process.stdout.write(fs.readFileSync(0).toString().toUpperCase());`);
const script=kind=>'#!/bin/sh\nexec '+quote(process.execPath)+' '+quote(effect)+' '+kind+' "$@"\n';
writeFileSync(join(hooks,'post-checkout'),script('configured-post-checkout'));
const commands=[];
function run(args,{configuredGlobal=false}={}){
  const child=spawnSync(git,['-C',source,'-c','core.autocrlf=false','-c','commit.gpgSign=false',...args],{env:{...env,GIT_CONFIG_GLOBAL:configuredGlobal?globalConfig:emptyConfig},encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:1024*1024});
  const record={args,pid:child.pid,status:child.status,signal:child.signal,configuredGlobal,stdout:child.stdout,stderr:child.stderr};commands.push(record);assert.equal(!!child.error,false);assert.equal(child.status,0,JSON.stringify(record));return child;
}
const lines=()=>existsSync(log)?readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const version=run(['--version']).stdout.trim();run(['init','-b','main',source]);
writeFileSync(join(source,'.gitattributes'),'*.txt text eol=crlf\n');writeFileSync(join(source,'ordinary.txt'),'base content\n');
// A tracked hook-shaped file probes whether literal empty hooksPath means an
// empty directory or makes Git search the checkout root instead.
writeFileSync(join(source,'post-checkout'),script('tracked-root-post-checkout'));
run(['add','-A']);run(['commit','-m','Ordinary attributes and owned hook-shaped file']);const base=run(['rev-parse','HEAD']).stdout.trim();
run(['config','core.hooksPath',hooks]);run(['config','filter.owned.smudge',quote(process.execPath)+' '+quote(effect)+' filter']);run(['config','filter.owned.required','true']);
run(['config','--file',globalConfig,'core.attributesFile',globalAttributes]);
const observations=[];
for(const [name,overrides]of [
  ['ambient-source-settings',[]],
  ['empty-hook-directory',['-c','core.hooksPath='+emptyHooks]],
  ['empty-global-attributes',['-c','core.attributesFile=']],
  ['both-boundaries',['-c','core.hooksPath='+emptyHooks,'-c','core.attributesFile=']],
  ['literal-empty-hooks-path',['-c','core.hooksPath=','-c','core.attributesFile=']],
]){
  const path=join(root,name),start=lines().length,child=run([...overrides,'--attr-source='+base,'worktree','add','--detach',path,base],{configuredGlobal:true});
  const effects=lines().slice(start),bytes=readFileSync(join(path,'ordinary.txt'));
  observations.push({name,gitPid:child.pid,effects,ordinaryText:bytes.toString('utf8'),baseAttributes:readFileSync(join(path,'.gitattributes'),'utf8'),systemAttributesDisabled:true});
}
const observed=name=>observations.find(x=>x.name===name),has=(name,kind)=>observed(name).effects.some(e=>e.kind===kind);
assert.equal(has('ambient-source-settings','configured-post-checkout'),true);assert.equal(has('ambient-source-settings','filter'),true);assert.ok(observed('ambient-source-settings').effects.every(e=>e.inheritedDummyCredential));
assert.equal(has('empty-hook-directory','configured-post-checkout'),false);assert.equal(has('empty-hook-directory','tracked-root-post-checkout'),false);assert.equal(has('empty-hook-directory','filter'),true);
assert.equal(has('empty-global-attributes','filter'),false);assert.equal(has('empty-global-attributes','configured-post-checkout'),true);assert.equal(observed('empty-global-attributes').ordinaryText,'base content\r\n');
assert.deepEqual(observed('both-boundaries').effects,[]);assert.equal(observed('both-boundaries').ordinaryText,'base content\r\n');assert.equal(observed('both-boundaries').baseAttributes,'*.txt text eol=crlf\n');
for(const item of observations)assert.equal(item.baseAttributes,'*.txt text eol=crlf\n');
mkdirSync(dirname(reportPath),{recursive:true});writeFileSync(reportPath,JSON.stringify({schemaVersion:1,observedAt:new Date().toISOString(),version,nodeVersion:process.version,fixtureRoot:root,dummyCredentialsOnly:true,realCredentialsRead:false,base,observations,commands},null,2)+'\n');
process.stdout.write(JSON.stringify({report:reportPath,version,observations},null,2)+'\n');
