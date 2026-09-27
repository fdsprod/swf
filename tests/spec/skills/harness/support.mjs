import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fixture as p2Fixture,hash,trustedRoot,candidateRoot,killFactory,fault,workspaces} from '../../p2/harness/support.mjs';
import {fixture as p3Fixture,addAnswer} from '../../p3/harness/support.mjs';
import {fixture as p4Fixture} from '../../p4/harness/support.mjs';
import {fixture as p5Fixture} from '../../p5/harness/support.mjs';
export {hash,trustedRoot,candidateRoot,killFactory,fault,workspaces,addAnswer};
export function fixture({role='tester',kind='durable',skills=true}={}){
  const f=kind==='decision'?p3Fixture():kind==='repair'?p4Fixture():kind==='github'?p5Fixture():p2Fixture();
  f.kind=kind;f.skillRoot=join(f.root,'operator-skills');mkdirSync(f.skillRoot);
  const catalog=['ste','tdd','data-structure-design','tracer-bullets','custom'].map(id=>{
    mkdirSync(join(f.skillRoot,id));writeFileSync(join(f.skillRoot,id,'SKILL.md'),`# ${id}\r\nExact instructions — λ.\n`);
    writeFileSync(join(f.skillRoot,id,'asset.bin'),Buffer.from([0,255,128,10]));
    return{id,root:f.skillRoot,entrypoint:`${id}/SKILL.md`,assets:[`${id}/asset.bin`]};
  });
  writeFileSync(join(f.skillRoot,'undeclared.txt'),'Not selected.');
  f.designPath=join(f.root,'provided-design.md');writeFileSync(f.designPath,'# Pinned design\r\nUse the exact data shape — λ.\n');
  f.profile={assignment:role==='implementation'?{role,design:{kind:'none'}}:{role},catalog,common:['ste'],byRole:{tester:['tdd'],designer:['data-structure-design','tracer-bullets'],implementation:[]}};
  const config=runtime(f);if(skills)config.skills=f.profile;
  copyFileSync(join(trustedRoot,'tests/spec/skills/fixtures/worker.cjs'),join(f.trusted,'skills-worker.cjs'));
  config.worker.prefixArgs=[join(f.trusted,'skills-worker.cjs'),['decision','repair'].includes(kind)?kind:'good'];
  writeConfig(f);return f;
}
export const runtime=f=>f.kind==='github'?f.githubConfig.runtime:f.config;
export function writeConfig(f){writeFileSync(f.configPath,JSON.stringify(f.kind==='github'?f.githubConfig:f.config));}
export async function withFixture(options,action){if(typeof options==='function'){action=options;options={};}const f=fixture(options);try{return await action(f);}finally{for(const h of f.handles)if(!h.closed)await killFactory(h);f.cleanup();}}
export const runArgs=f=>['run',f.kind==='github'?'--github':'--local',f.configPath,...(f.kind==='local'?[]:['--store',f.store]),'--json'];
export function cli(args){const child=spawnSync(process.execPath,[join(candidateRoot,'dist/cli/main.js'),...args],{cwd:candidateRoot,env:{...process.env,SWF_TEST_FAULT:''},encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:16*1024*1024});assert.ifError(child.error);assert.equal(child.signal,null);assert.match(child.stdout,/^\{[^\r\n]*\}\r?\n$/,child.stderr);return{code:child.status,result:JSON.parse(child.stdout),stderr:child.stderr};}
export const run=f=>cli(runArgs(f));
export const resume=f=>cli(['resume','--store',f.store,'--json']);
export function readStore(f){const db=new DatabaseSync(join(f.store,'run.sqlite'),{readOnly:true});try{db.exec('BEGIN');const events=db.prepare('SELECT json FROM events ORDER BY sequence').all().map(r=>JSON.parse(r.json));const row=db.prepare('SELECT json FROM projection WHERE id=1').get();return{events,projection:row?JSON.parse(row.json):null};}finally{db.close();}}
export const rows=f=>workspaces(f).flatMap(w=>{const p=join(w,'src/skills-contexts.jsonl');return existsSync(p)?readFileSync(p,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse):[];});
export function artifact(path){return{path:realpathSync(path),digest:hash(readFileSync(path))};}
export function expected(profile){
  const role=profile.assignment.role,ids=[...profile.common,...profile.byRole[role],...(role==='implementation'&&profile.assignment.design.kind==='none'?profile.byRole.designer:[])];
  const skills=[...new Set(ids)].map(id=>{const s=profile.catalog.find(s=>s.id===id);assert.ok(s);const p=resolve(s.root,s.entrypoint);return{id,entrypoint:artifact(p),text:readFileSync(p,'utf8'),assets:s.assets.map(a=>artifact(resolve(s.root,a)))};});
  const assignment=structuredClone(profile.assignment);if(assignment.design?.kind==='provided'){const path=assignment.design.path;assignment.design={kind:'provided',artifact:artifact(path),text:readFileSync(path,'utf8')};}
  return{assignment,skills};
}
export function assertInstructions(row,profile,programs){
  assert.ok(row.input&&typeof row.input==='object','Worker must receive a JSON prompt');
  const actual=row.input.context?row.input.context.instructions:row.input.instructions,want=expected(profile);assert.deepEqual(actual,want,'Exact selected instructions must reach actual worker');
  const selected=[...want.skills.flatMap(s=>[s.entrypoint,...s.assets]),...(want.assignment.design?.kind==='provided'?[want.assignment.design.artifact]:[])];
  for(const a of selected){assert.ok(programs.some(p=>p.path===a.path&&p.digest===a.digest),`Selected input missing from immutable programs: ${a.path}`);const observations=row.observations.filter(o=>o.path===a.path);assert.ok(observations.length);for(const o of observations){assert.equal(o.base64,readFileSync(a.path).toString('base64'));assert.ok(['EPERM','EACCES'].includes(o.write),`Selected input must deny writes: ${a.path}: ${o.write}`);}}
  for(const s of profile.catalog.filter(s=>!want.skills.some(w=>w.id===s.id)))for(const path of [s.entrypoint,...s.assets])assert.equal(programs.some(p=>p.path===realpathSync(resolve(s.root,path))),false,'Unselected input must not be pinned');
  assert.equal(programs.some(p=>p.path===realpathSync(join(profile.catalog[0].root,'undeclared.txt'))),false);
  assert.equal(new Set(programs.map(p=>p.path.toLowerCase())).size,programs.length,'Program pins have one entry per canonical file');
}
export function verified(f,o=run(f)){assert.equal(o.code,0,JSON.stringify(o));assert.equal(o.result.kind,f.kind==='local'?'local_run_result':'durable_run_result');const p=f.kind==='local'?o.result:readStore(f).projection;assert.equal(p.state.status,'VERIFIED');const e=f.kind==='local'?p.evidence:p.verification.evidence;const bytes=readFileSync(e.path);assert.equal(hash(bytes),e.digest);const evidence=JSON.parse(bytes);assert.equal(evidence.verdict.status,'VERIFIED');return{projection:p,evidence};}
export function error(f,o,code){assert.equal(o.code,code==='input_error'?2:1,JSON.stringify(o));assert.equal(o.result.kind,f.kind==='local'&&code==='input_error'?'input_error':'durable_error');if(o.result.kind==='durable_error')assert.equal(o.result.code,code);assert.ok(o.result.issues.length);}
