const path = require('node:path');
const crypto = require('node:crypto');
const [mode, root] = process.argv.slice(2);
console.log('p2-verifier-invocation:' + crypto.randomUUID());
console.log('p2-factory-fault-inherited:' + Object.hasOwn(process.env, 'SWF_TEST_FAULT'));
const target = path.join(root, 'trusted', 'verifier.cjs');
process.argv = [process.execPath, target, mode, root];
require(target);
