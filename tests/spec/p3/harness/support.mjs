import assert from 'node:assert/strict';
import {copyFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import Ajv from 'ajv';
import {fixture as p2Fixture,killFactory,trustedRoot,workspaces} from '../../p2/harness/support.mjs';
export * from '../../p2/harness/support.mjs';
export const resolver = {id:101,login:'human-fixture'};
export const publisher = {id:201,login:'factory-fixture'};
const ajv = new Ajv({strict:true,allErrors:true});
for(const name of ['run-fixture','cli-result','local-config','local-result','local-evidence','durable-result']) ajv.addSchema(JSON.parse(readFileSync(join(trustedRoot,`src/contracts/schemas/${name}.schema.json`),'utf8')));
export const validateWire=ajv.compile(JSON.parse(readFileSync(join(trustedRoot,'src/contracts/schemas/decision-wire.schema.json'),'utf8')));
export const validateAnswer=ajv.compile(JSON.parse(readFileSync(join(trustedRoot,'src/contracts/schemas/decision-answer.schema.json'),'utf8')));
export const validateContext=ajv.compile(JSON.parse(readFileSync(join(trustedRoot,'src/contracts/schemas/decision-worker-input.schema.json'),'utf8')));
export function fixture({worker='decision'}={}) {
  const f=p2Fixture();
  for(const name of ['codex-double.cjs','github-double.cjs']) copyFileSync(join(trustedRoot,'tests/spec/p3/fixtures',name),join(f.trusted,`p3-${name}`));
  f.config.request.source={provider:'github',externalId:'7',url:'https://github.com/factory-fixture/decisions/issues/7'};
  f.config.request.repository.url='https://github.com/factory-fixture/decisions.git';
  f.config.worker.prefixArgs=[join(f.trusted,'p3-codex-double.cjs'),worker];
  f.config.decisions={kind:'github_issue_comments',executable:join(f.root,'node.exe'),prefixArgs:[join(f.trusted,'p3-github-double.cjs'),f.root],timeoutSeconds:10,authorizedResolver:resolver};
  f.gatewayPath=join(f.root,'github.json');
  writeFileSync(f.gatewayPath,JSON.stringify({publisher,comments:[],calls:[],nextId:1000,mode:'normal'}));
  writeFileSync(f.configPath,JSON.stringify(f.config));
  return f;
}
export async function withFixture(options,action) {
  if(typeof options==='function'){action=options;options={};}
  const f=fixture(options);
  try{return await action(f);}finally{for(const h of f.handles)if(!h.closed)await killFactory(h);f.cleanup();}
}
export const gateway=f=>JSON.parse(readFileSync(f.gatewayPath,'utf8'));
export function updateGateway(f,change){const g=gateway(f);change(g);writeFileSync(f.gatewayPath,JSON.stringify(g));return g;}
export const posts=f=>gateway(f).calls.filter(c=>c.method==='POST');
export const contexts=f=>workspaces(f).flatMap(w=>{const p=join(w,'src/p3-contexts.jsonl');const rows=existsSync(p)?readFileSync(p,'utf8').trim().split(/\r?\n/).map(JSON.parse):[];for(const row of rows)assert.ok(validateContext(row.input),ajv.errorsText(validateContext.errors));return rows;});
export function addAnswer(f,decisionId,{author=resolver,answer='Use 42.\nApproved.',selectedOptionId='forty-two',body,createdAt}={}) {
  let added;
  updateGateway(f,g=>{const id=g.nextId++;const date=createdAt||new Date().toISOString();added={id,html_url:`https://github.com/factory-fixture/decisions/issues/7#issuecomment-${id}`,user:author,body:body??JSON.stringify({schemaVersion:1,decisionId,answer,selectedOptionId}),created_at:date,updated_at:date};g.comments.push(added);});
  return added;
}
export function assertNoRemoteDelivery(f){assert.equal(gateway(f).calls.some(c=>/pulls|git\/refs|commits|check-runs/.test(c.endpoint||'')),false);}
export function assertError(observed,code){assert.equal(observed.result.kind,'durable_error');assert.equal(observed.result.code,code);assert.equal(observed.code,code==='input_error'?2:1);assert.ok(observed.result.issues.length);}
