import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { candidateRoot, trustedRoot, hash } from './support.mjs';

function files(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
}
const frozenFiles = root => [
  ...files(join(root, 'tests/spec')), ...files(join(root, 'src/contracts/schemas')),
  ...['src/contracts/index.ts', 'src/contracts/local.ts', 'src/contracts/durable.ts', 'src/contracts/decisions.ts', 'src/contracts/repair.ts', 'src/contracts/delivery.ts', 'package.json', 'package-lock.json', 'tsconfig.json',
    'tests/learning/p1/sandbox-probe.mjs'].map(path => join(root, path)),
].map(path => relative(root, path).replaceAll('\\', '/')).sort();
const preparation = process.argv.includes('--preparation');
const frozenPaths = frozenFiles(trustedRoot);
const manifest = root => Object.fromEntries(frozenPaths.map(path => [path, existsSync(join(root, path)) ? hash(readFileSync(join(root, path))) : null]));
const beforeTrusted = manifest(trustedRoot), beforeCandidate = manifest(candidateRoot);
const sourceManifest = () => Object.fromEntries(files(join(candidateRoot, 'src')).sort().map(path => [relative(candidateRoot, path).replaceAll('\\', '/'), hash(readFileSync(path))]));
const sourcesBefore = sourceManifest();
const differences = frozenPaths.filter(path => beforeTrusted[path] !== beforeCandidate[path]);
const bundleDigest = hash(JSON.stringify(beforeTrusted));
const proofDirectory = resolve(process.env.P5_PROOF_DIR || join(trustedRoot, '.p5-proof', 'latest'));
mkdirSync(proofDirectory, { recursive: true });
writeFileSync(join(proofDirectory, 'bundle-manifest.json'), JSON.stringify({ phase: 'P5', bundleDigest, files: beforeTrusted }, null, 2) + '\n');
const results = [{ name: 'frozen-bundle', exitCode: differences.length ? 1 : 0, differences }];
function execute(name, args, { timeout = 120000, env = {}, tests = false } = {}) {
  const started = Date.now();
  const child = spawnSync(process.execPath, args, { cwd: candidateRoot, env: { ...process.env, FACTORY_CANDIDATE_ROOT: candidateRoot, ...env }, encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  const log = `${child.stdout || ''}${child.stderr || ''}${child.error ? '\n' + child.error.stack + '\n' : ''}`;
  const logPath = join(proofDirectory, `${name}.log`); writeFileSync(logPath, log);
  const summary = Object.fromEntries([...log.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\r?$/gm)].map(match => [match[1], Number(match[2])]));
  const incomplete = tests && (!(summary.tests > 0) || ['pass', 'fail', 'cancelled', 'skipped', 'todo'].some(key => summary[key] === undefined)
    || summary.pass !== summary.tests || summary.fail !== 0 || summary.cancelled !== 0 || summary.skipped !== 0 || summary.todo !== 0);
  const exitCode = child.status === 0 && !incomplete ? 0 : child.status || 1;
  results.push({ name, command: [process.execPath, ...args], exitCode, processExitCode: child.status, signal: child.signal, elapsedMs: Date.now() - started, summary, incomplete: Boolean(incomplete), logPath });
  process.stdout.write(`${name}: exit ${exitCode}${summary.tests !== undefined ? `; tests ${summary.tests}, pass ${summary.pass}, fail ${summary.fail}` : ''}\n`);
}
if (!differences.length) {
  if (!preparation) execute('p4-cumulative', [join(trustedRoot, 'tests/spec/p4/harness/run-gates.mjs')], { timeout: 3600000, env: { P4_PROOF_DIR: join(proofDirectory, 'p4') } });
  else {
    execute('typecheck', [join(trustedRoot,'node_modules/typescript/bin/tsc'),'--project',join(candidateRoot,'tsconfig.json'),'--noEmit']);
    execute('build', [join(trustedRoot,'node_modules/typescript/bin/tsc'),'--project',join(candidateRoot,'tsconfig.json')]);
  }
  execute('p5-sanity', ['--test', '--test-reporter=tap', join(trustedRoot, 'tests/spec/p5/harness/sanity.test.mjs')], { tests: true });
  execute('p5-acceptance', ['--test', '--test-reporter=tap', '--test-concurrency=1',
    ...['intake-delivery', 'recovery', 'ci'].map(name => join(trustedRoot, `tests/spec/p5/scenarios/${name}.test.mjs`))], { timeout: 1800000, tests: true });
  if(!preparation) execute('p5-live',[join(trustedRoot,'tests/spec/p5/harness/live-proof.mjs')],{env:{P5_CANDIDATE_SOURCE_DIGEST:hash(JSON.stringify(sourcesBefore))}});
  else results.push({name:'p5-live',exitCode:1,classification:'blocked',reason:'Preparation is not acceptance. Requires reviewed real GitHub HTTPS/PR/CI proof and independently validated prior-candidate integration.'});
}
function changes(root) {
  const after = manifest(root);
  return [...new Set([...frozenPaths, ...frozenFiles(root)])].filter(path => !Object.hasOwn(beforeTrusted, path) || beforeTrusted[path] !== after[path]);
}
const trustedChanges = changes(trustedRoot), candidateChanges = changes(candidateRoot);
results.push({ name: 'frozen-bundle-after', exitCode: trustedChanges.length || candidateChanges.length ? 1 : 0, trustedChanges, candidateChanges });
const sourcesAfter = sourceManifest();
const sourceChanges = [...new Set([...Object.keys(sourcesBefore), ...Object.keys(sourcesAfter)])].filter(path => sourcesBefore[path] !== sourcesAfter[path]);
results.push({ name: 'candidate-source-stability', exitCode: sourceChanges.length ? 1 : 0, differences: sourceChanges });
function git(args, root) { const child = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }); return child.status === 0 ? child.stdout.trim() : null; }
const report = { phase: 'P5', mode: preparation ? 'preparation' : 'acceptance', accepted: !preparation && results.every(r=>r.exitCode===0), trustedRoot, candidateRoot, trustedRevision: git(['rev-parse', 'HEAD'], trustedRoot), candidateRevision: git(['rev-parse', 'HEAD'], candidateRoot),
  candidateChanges: git(['status', '--porcelain', '--untracked-files=all'], candidateRoot), nodeVersion: process.version, nodeExecutable: process.execPath, bundleDigest,
  candidateSourceDigestBefore: hash(JSON.stringify(sourcesBefore)), candidateSourceDigestAfter: hash(JSON.stringify(sourcesAfter)), candidateSourcesBefore: sourcesBefore, candidateSourcesAfter: sourcesAfter, results };
writeFileSync(join(proofDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(`Bundle SHA-256: ${bundleDigest}\nProof: ${proofDirectory}\n`);
process.exitCode = results.some(result => result.exitCode !== 0) ? 1 : 0;
