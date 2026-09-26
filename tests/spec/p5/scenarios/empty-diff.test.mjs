import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {withFixture,run,readStore,assertNoDelivery,assertError,writeConfig,git,trustedRoot} from '../harness/support.mjs';
import {artifact} from '../harness/replay.mjs';
import {commitFixture} from '../harness/git-oracle.mjs';

test('P5-002: a verified empty diff cannot be delivered',()=>withFixture(f=>{
  writeFileSync(join(f.repo,'src/answer.cjs'),'module.exports = 42;\n');commitFixture(f,'Already correct baseline');
  const worker=join(f.trusted,'completed-no-change.cjs');copyFileSync(join(trustedRoot,'tests/spec/p5/fixtures/completed-no-change.cjs'),worker);
  f.githubConfig.runtime.worker.prefixArgs=[worker];writeConfig(f);
  const result=run(f),store=readStore(f),p=store.projection;
  assert.equal(p.state.status,'VERIFIED');
  const evidence=JSON.parse(artifact(p.verification.evidence));
  assert.deepEqual(evidence.changedPaths,[],'Fixture must produce no candidate changes');
  const diff=JSON.parse(artifact(evidence.diff));
  assert.equal(diff.patch,'','The measured patch must be empty');assert.deepEqual(diff.addedFiles,[]);assert.deepEqual(diff.changedPaths,[]);assert.deepEqual(diff.issues,[]);
  assert.equal(git(p.workspace.workspace.path,'status','--porcelain','--untracked-files=all'),'');
  assertError(result,'delivery_error');assertNoDelivery(f);
  assert.equal(store.events.some(e=>e.fact.type==='CommitCreated'),false);
}));
