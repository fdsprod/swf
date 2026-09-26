import test from 'node:test';
import assert from 'node:assert/strict';
import {commands,loadParser,validateWorkflow} from './verify.mjs';

const parser=loadParser(process.env.BOOTSTRAP_YAML_ROOT);
// Synthetic verifier controls only. The actual workflow is owned by the factory worker.
function valid(){return {name:'Control',on:{pull_request:null,push:{branches:['main']}},permissions:{contents:'read'},jobs:{'bootstrap-checks':{name:'bootstrap-checks','runs-on':'windows-latest',steps:[{uses:'actions/checkout@v4',with:{ref:'${{ github.event.pull_request.head.sha || github.sha }}','persist-credentials':false}},{uses:'actions/setup-node@v4',with:{'node-version':'22.22.3'}},...commands.map(run=>({run}))]}}};}
test('accepts semantic YAML and the declared positive control',()=>{
  assert.equal(validateWorkflow(JSON.stringify(valid()),parser).job,'bootstrap-checks');
  const text=JSON.stringify(valid()).replace('"permissions":{"contents":"read"}','"permissions": {contents: read}');
  assert.equal(validateWorkflow(text,parser).node,'22.22.3');
});
const mutations=[
  ['missing command',w=>w.jobs['bootstrap-checks'].steps.pop()],
  ['wrong command',w=>w.jobs['bootstrap-checks'].steps[2].run='echo npm ci'],
  ['combined commands hide failure',w=>w.jobs['bootstrap-checks'].steps[2].run='npm ci\nnpm test'],
  ['changed ordering',w=>w.jobs['bootstrap-checks'].steps.reverse()],
  ['conditional job',w=>w.jobs['bootstrap-checks'].if='false'],
  ['conditional step',w=>w.jobs['bootstrap-checks'].steps[2].if='false'],
  ['ignored failure',w=>w.jobs['bootstrap-checks'].steps[2]['continue-on-error']=true],
  ['privileged trigger',w=>w.on.pull_request_target={}],
  ['filtered pull request',w=>w.on.pull_request={paths:['unrelated/**']}],
  ['unrestricted push',w=>w.on.push={}],
  ['write permission',w=>w.permissions.contents='write'],
  ['different check name',w=>w.jobs['bootstrap-checks'].name='other'],
  ['different runner',w=>w.jobs['bootstrap-checks']['runs-on']='ubuntu-latest'],
  ['floating Node',w=>w.jobs['bootstrap-checks'].steps[1].with['node-version']='22'],
  ['wrong checkout ref',w=>w.jobs['bootstrap-checks'].steps[0].with.ref='main'],
  ['retained credentials',w=>w.jobs['bootstrap-checks'].steps[0].with['persist-credentials']=true],
  ['extra action',w=>w.jobs['bootstrap-checks'].steps.push({uses:'owner/action@main'})],
  ['untrusted environment',w=>w.env={NODE_OPTIONS:'--require bypass.js'}],
];
for(const [label,mutate]of mutations)test('rejects '+label,()=>{const value=valid();mutate(value);assert.throws(()=>validateWorkflow(JSON.stringify(value),parser),assert.AssertionError);});
test('rejects duplicate YAML keys and additional documents',()=>{
  assert.throws(()=>validateWorkflow('jobs: {}\njobs: {}\n',parser),assert.AssertionError);
  assert.throws(()=>validateWorkflow(JSON.stringify(valid())+'\n---\n{}\n',parser),assert.AssertionError);
});
