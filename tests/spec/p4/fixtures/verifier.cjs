const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const observed=require(path.join(process.cwd(),'src/answer.cjs'));
process.stdout.write('p2-verifier-invocation:'+randomUUID()+'\n');
process.stdout.write('failure-token:'+randomUUID()+'\nraw-output:\u0000\u03bb\r\n');
process.stderr.write(`Expected 42; observed ${observed}\n`);
process.exitCode=observed===42?0:7;
