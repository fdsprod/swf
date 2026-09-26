import test from 'node:test';
import assert from 'node:assert/strict';
import {withFixture,run,updateGateway,assertError,assertNoDelivery,git} from '../harness/support.mjs';

for(const [defect,origin]of [['wrong-scheme','http://github.com'],['explicit-port','https://github.com:443'],['foreign-host','https://github.com.evil.invalid']])test(`P5-001: coherent ${defect} repository URLs cannot become intake authority`,()=>withFixture(f=>{
  updateGateway(f,d=>{
    // Numeric identity, canonical owner/name and API locator remain valid. Change
    // every related web/clone URL together so mutual URL consistency cannot pass.
    const repositoryUrl=origin+'/'+d.repository.full_name;
    d.repository.html_url=repositoryUrl;d.repository.clone_url=repositoryUrl+'.git';d.issue.html_url=repositoryUrl+'/issues/'+d.issue.number;
  });
  assertError(run(f),'input_error');assertNoDelivery(f);
  assert.equal(git(f.repo,'worktree','list','--porcelain').split('\n').filter(line=>line.startsWith('worktree ')).length,1,'Noncanonical intake must fail before workspace/worker dispatch');
}));
