import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture,git,run,check,assertInvalid} from '../harness/support.mjs';

test('P1-017 large required diff is fully captured or verification fails closed',()=>{
  const f=fixture();
  try {
    const marker='P1_REQUIRED_OLD_DIFF_CONTENT_END_6f709c';
    const oldComment=`/* P1_REQUIRED_OLD_DIFF_CONTENT_BEGIN ${'x'.repeat(17*1024*1024)} ${marker} */`;
    writeFileSync(join(f.repo,'src','answer.cjs'),`module.exports = 0;\n${oldComment}\n`);
    git(f.repo,'add','src/answer.cjs');
    git(f.repo,'commit','-m','large tracked diff evidence fixture');
    f.base=git(f.repo,'rev-parse','HEAD');

    const observed=run(f);
    assert.equal(observed.result.kind,'local_run_result','Capture failure must remain a structured run result');
    const manifest=JSON.parse(readFileSync(observed.result.evidence.path,'utf8'));
    if(observed.result.state.status==='VERIFIED') {
      assert.equal(observed.code,0);
      assert.equal(manifest.commands.length,1,'A verified run must execute the independent behavioral command');
      assert.deepEqual(manifest.commands[0].process.termination,{kind:'exited',exitCode:0});
      assert.match(readFileSync(manifest.commands[0].process.stdout.path,'utf8'),/verified:42/);
      const diff=readFileSync(manifest.diff.path,'utf8');
      assert.ok(diff.includes(marker),'Verified evidence must retain the unique marker at the end of the required old content');
      assert.ok(diff.includes(`-${oldComment}`),'Verified evidence must preserve the complete removed text, not a truncated capture');
      assert.ok(diff.includes('-module.exports = 0;'),'Verified evidence must contain the removed implementation');
      assert.ok(diff.includes('+module.exports = 42;'),'Verified evidence must contain the new implementation');
      assert.doesNotMatch(diff,/capture[_ -]?error|maxBuffer|ENOBUFS|stdout maxBuffer length exceeded/i,'Capture errors cannot substitute for required diff evidence');
      assert.equal(check(observed.result.evidence.path).result.status,'current');
    } else {
      assert.equal(observed.code,1,'A bounded capture failure cannot return successful exit status');
      assert.ok(['FAILED','REPAIR_READY'].includes(observed.result.state.status),'Capture failure must fail verification');
      assertInvalid(check(observed.result.evidence.path));
    }
    assert.equal(git(f.repo,'status','--porcelain'),'');
    assert.equal(readFileSync(join(f.repo,'src','answer.cjs'),'utf8'),`module.exports = 0;\n${oldComment}\n`);
  } finally {f.cleanup();}
});
