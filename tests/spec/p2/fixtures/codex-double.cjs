const fs = require('node:fs');
const path = require('node:path');
const [mode, root, ...args] = process.argv.slice(2);
const flag = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const cwd = flag('-C') || flag('--cd') || process.cwd();
const log = path.join(cwd, 'src', 'p2-invocations.jsonl');
const prior = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split(/\r?\n/).filter(Boolean).length : 0;
fs.appendFileSync(log, JSON.stringify({ ordinal: prior + 1, pid: process.pid, factoryFaultInherited: Object.hasOwn(process.env, 'SWF_TEST_FAULT') }) + '\n');
if (mode === 'store-restriction') {
  let observation;
  try { fs.writeFileSync(path.join(root, 'store', 'worker-sentinel.txt'), 'BREACH'); observation = 'wrote'; }
  catch (error) { observation = error.code; }
  fs.writeFileSync(path.join(cwd, 'src', 'store-restriction.json'), JSON.stringify({ observation }));
}
const delegateMode = mode === 'recover' ? (prior === 0 ? 'hang-child' : 'good') : mode === 'always-hang' ? 'hang-child' : mode === 'store-restriction' ? 'good' : mode;
const target = path.join(root, 'trusted', 'codex-double.cjs');
process.argv = [process.execPath, target, delegateMode, root, ...args];
require(target);
