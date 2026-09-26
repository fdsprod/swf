import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture,run,assertLocal,check,codexPath} from '../harness/support.mjs';

test('P1-LIVE actual Codex makes the fixture edit and independent verification passes',{timeout:360000},()=>{
  const f=fixture();try {
    f.config.worker={executable:codexPath,prefixArgs:[],timeoutSeconds:240};
    f.config.request.objective='Edit src/answer.cjs so it exports exactly the number 42 with CommonJS module.exports. Make only that required source edit. The factory will run its separate verifier. Return the required structured completed outcome after editing.';
    const o=run(f,{timeoutMs:330000}),m=assertLocal(o,f,'VERIFIED');
    assert.match(readFileSync(m.commands[0].process.stdout.path,'utf8'),/verified:42/);
    assert.equal(m.worker.outcome.kind,'completed');assert.equal(m.commands[0].process.termination.exitCode,0);
    assert.equal(check(o.result.evidence.path).result.status,'current');
  }finally{f.cleanup();}
});
