import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {withFixture,run,sourceSnapshot,posts,remoteRefs} from '../p5/harness/support.mjs';
import {assertDurable} from '../p5/harness/replay.mjs';
import {assertDeliveredTree,commitFixture,observedGit} from '../p5/harness/git-oracle.mjs';

test('UNICODE-003: P5 verifies and delivers a base containing a regular Unicode filename',()=>withFixture(f=>{
  const path='docs/Software Factory — Conceptual Specification.md',bytes=Buffer.from('Pinned Unicode path fixture.\n');
  mkdirSync(join(f.repo,'docs'));writeFileSync(join(f.repo,path),bytes);commitFixture(f,'Base with Unicode documentation path');
  const before=sourceSnapshot(f),p=assertDurable(run(f),f,'VERIFIED');
  assert.equal(p.ci.kind,'passed');assert.equal(posts(f).length,1);assert.equal(remoteRefs(f).length,1);
  assert.deepEqual(readFileSync(join(p.workspace.workspace.path,path)),bytes);
  assertDeliveredTree(p,f);
  const delivered=observedGit(f,['-C',f.repo,'cat-file','blob',p.delivery.commit.sha+':'+path]);
  assert.deepEqual(delivered,bytes,'The produced commit must retain the exact Unicode path and content');
  assert.deepEqual(sourceSnapshot(f),before);
}));
