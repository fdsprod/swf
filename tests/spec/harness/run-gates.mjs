import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { candidateRoot, trustedRoot } from './support.mjs';

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
}
const frozenPaths = [
  ...files(join(trustedRoot, 'tests/spec')),
  ...files(join(trustedRoot, 'src/contracts/schemas')),
  ...['src/contracts/index.ts', 'package.json', 'package-lock.json', 'tsconfig.json'].map(path => join(trustedRoot, path)),
].map(path => relative(trustedRoot, path).replaceAll('\\', '/')).sort();
const digest = root => Object.fromEntries(frozenPaths.map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]));
const manifest = digest(trustedRoot);
const bundleDigest = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
const proofDirectory = resolve(process.env.P0_PROOF_DIR ?? join(trustedRoot, '.p0-proof', 'latest'));
mkdirSync(proofDirectory, { recursive: true });
writeFileSync(join(proofDirectory, 'bundle-manifest.json'), `${JSON.stringify({ bundleDigest, files: manifest }, null, 2)}\n`);
const candidateManifest = digest(candidateRoot);
const differences = frozenPaths.filter(path => manifest[path] !== candidateManifest[path]);
const results = [];
if (differences.length) results.push({ name: 'frozen-bundle', exitCode: 1, differences });
else results.push({ name: 'frozen-bundle', exitCode: 0 });
const commands = [
  ['typecheck', [join(trustedRoot, 'node_modules/typescript/bin/tsc'), '-p', join(candidateRoot, 'tsconfig.json'), '--noEmit']],
  ['build', [join(trustedRoot, 'node_modules/typescript/bin/tsc'), '-p', join(candidateRoot, 'tsconfig.json')]],
  ['sanity', ['--test', '--test-reporter=tap', join(trustedRoot, 'tests/spec/harness/sanity.test.mjs')]],
  ['architecture', [join(trustedRoot, 'tests/spec/harness/architecture.mjs')]],
  ['acceptance', ['--test', '--test-reporter=tap', ...['cli', 'transitions', 'architecture'].map(name => join(trustedRoot, `tests/spec/scenarios/${name}.test.mjs`))]],
];
for (const [name, args] of commands) {
  const started = Date.now();
  const child = spawnSync(process.execPath, args, { cwd: candidateRoot, env: { ...process.env, FACTORY_CANDIDATE_ROOT: candidateRoot }, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  const log = `${child.stdout ?? ''}${child.stderr ?? ''}${child.error ? `\n${child.error.stack}\n` : ''}`;
  const logPath = join(proofDirectory, `${name}.log`);
  writeFileSync(logPath, log);
  const summary = Object.fromEntries([...log.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  const exitCode = child.status ?? 1;
  results.push({ name, command: [process.execPath, ...args], exitCode, signal: child.signal, elapsedMs: Date.now() - started, summary, logPath });
  process.stdout.write(`${name}: exit ${exitCode}${summary.tests !== undefined ? `; tests ${summary.tests}, pass ${summary.pass}, fail ${summary.fail}, skipped ${summary.skipped}` : ''}\n`);
}
function revision(root) {
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
}
const report = { trustedRoot, candidateRoot, trustedRevision: revision(trustedRoot), candidateRevision: revision(candidateRoot), nodeVersion: process.version, bundleDigest, results };
writeFileSync(join(proofDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`Bundle SHA-256: ${bundleDigest}\nProof: ${proofDirectory}\n`);
process.exitCode = results.some(result => result.exitCode !== 0 || result.summary?.skipped || result.summary?.cancelled || result.summary?.todo) ? 1 : 0;
