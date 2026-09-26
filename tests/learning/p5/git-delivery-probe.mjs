// Learning probe against installed Git only. No product or acceptance imports.
// Keep this file as dependency documentation, outside the product test suite.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'swf-p5-git-learning-'));
const repository = join(root, 'repository');
const workspace = join(root, 'workspace');
const remote = join(root, 'remote.git');
const emptyHooks = join(root, 'empty-hooks');
const configuredHooks = join(root, 'configured-hooks');
const reportPath = resolve(process.argv[2] || join(root, 'observations.json'));
for (const path of [repository, emptyHooks, configuredHooks]) mkdirSync(path);
const emptyConfig = join(root, 'empty.gitconfig');
writeFileSync(emptyConfig, '');
const environment = { ...process.env };
for (const name of Object.keys(environment)) if (/^GIT_/i.test(name)) delete environment[name];
Object.assign(environment, {
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig, GIT_ATTR_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'SWF Git learning', GIT_AUTHOR_EMAIL: 'learning@example.invalid',
  GIT_COMMITTER_NAME: 'SWF Git learning', GIT_COMMITTER_EMAIL: 'learning@example.invalid',
  GIT_AUTHOR_DATE: '1700000000 +0000', GIT_COMMITTER_DATE: '1700000000 +0000',
});
const commands = [];
const observations = {};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function git(cwd, args, options = {}) {
  const argv = ['-C', cwd, '-c', 'core.autocrlf=false', '-c', 'commit.gpgSign=false', '-c', `core.attributesFile=${emptyConfig}`,
    ...(options.configuredHooks ? [] : ['-c', `core.hooksPath=${emptyHooks}`]), ...args];
  const result = spawnSync('git', argv, {
    env: { ...environment, ...options.env }, input: options.input,
    encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024,
  });
  commands.push({ argv, environmentOverrides: options.env || {}, input: options.input,
    status: result.status, signal: result.signal, stdout: result.stdout,
    stderr: result.stderr, error: result.error?.message });
  if (!options.failureAllowed) assert.equal(result.status, 0, JSON.stringify(commands.at(-1)));
  return result;
}
const output = (cwd, args, options) => git(cwd, args, options).stdout.trim();
function fileSnapshot(directory) {
  const records = [];
  function walk(current, relative = '') {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git') continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(current, entry.name), name);
      else records.push({ path: name, digest: sha256(readFileSync(join(current, entry.name))) });
    }
  }
  walk(directory);
  return records;
}
function indexDigest(cwd) {
  return sha256(readFileSync(output(cwd, ['rev-parse', '--path-format=absolute', '--git-path', 'index'])));
}
function treeEntries(tree) {
  return output(repository, ['ls-tree', '-r', tree]).split('\n').map(line => {
    const [, mode, type, oid, path] = /^(\d+) (\S+) (\S+)\t(.+)$/.exec(line);
    return { mode, type, oid, path };
  });
}

try {
  observations.version = output(root, ['--version']);
  git(repository, ['init', '-b', 'main']);
  git(repository, ['config', 'core.filemode', 'false']);
  git(repository, ['config', 'core.hooksPath', configuredHooks]);
  writeFileSync(join(repository, '.gitattributes'), '*.txt text eol=crlf\n');
  writeFileSync(join(repository, '.gitignore'), 'ignored-*.txt\n');
  writeFileSync(join(repository, 'document.txt'), 'base\n');
  writeFileSync(join(repository, 'delete.txt'), 'remove me\n');
  writeFileSync(join(repository, 'executable.sh'), '#!/bin/sh\necho base\n');
  writeFileSync(join(repository, 'mode-change.sh'), 'echo plain\n');
  git(repository, ['add', '.']);
  git(repository, ['update-index', '--chmod=+x', '--', 'executable.sh']);
  git(repository, ['commit', '-m', 'Learning base']);
  const base = output(repository, ['rev-parse', 'HEAD']);
  git(repository, ['worktree', 'add', '--detach', workspace, base]);
  assert.equal(readFileSync(join(workspace, 'document.txt'), 'utf8'), 'base\r\n');

  // Leave a deliberately different ordinary index. The alternate index must
  // neither inherit this staged content nor change its bytes.
  writeFileSync(join(workspace, 'document.txt'), 'staged only\r\n');
  git(workspace, ['add', '--', 'document.txt']);
  writeFileSync(join(workspace, 'document.txt'), 'candidate\r\n');
  writeFileSync(join(workspace, '.gitattributes'), '*.txt -text\n');
  writeFileSync(join(workspace, 'new file.txt'), 'new candidate\r\n');
  writeFileSync(join(workspace, 'ignored-allowed.txt'), 'explicit allowed candidate\r\n');
  writeFileSync(join(workspace, 'ignored-cache.txt'), 'not candidate\r\n');
  writeFileSync(join(workspace, 'excluded.txt'), 'not candidate\r\n');
  rmSync(join(workspace, 'delete.txt'));
  const before = {
    repositoryFiles: fileSnapshot(repository), workspaceFiles: fileSnapshot(workspace),
    repositoryIndex: indexDigest(repository), workspaceIndex: indexDigest(workspace),
    repositoryHead: output(repository, ['rev-parse', 'HEAD']), workspaceHead: output(workspace, ['rev-parse', 'HEAD']),
  };
  const candidatePaths = ['.gitattributes', '.gitignore', 'document.txt', 'delete.txt',
    'executable.sh', 'mode-change.sh', 'new file.txt', 'ignored-allowed.txt'];
  const pathspec = join(root, 'candidate-paths.z');
  writeFileSync(pathspec, candidatePaths.join('\0') + '\0');
  function stageCandidate(indexName, pinned) {
    const env = { GIT_INDEX_FILE: join(root, indexName) };
    git(workspace, ['read-tree', base], { env });
    git(workspace, [...(pinned ? [`--attr-source=${base}`] : []), 'add', '-A', '-f',
      `--pathspec-from-file=${pathspec}`, '--pathspec-file-nul'], { env });
    const beforeModeChange = output(workspace, ['ls-files', '--stage', '--', 'mode-change.sh'], { env });
    git(workspace, ['update-index', '--chmod=+x', '--', 'mode-change.sh'], { env });
    return { tree: output(workspace, ['write-tree'], { env }), beforeModeChange };
  }
  const pinned = stageCandidate('pinned.index', true);
  const unpinned = stageCandidate('unpinned.index', false);
  const entries = treeEntries(pinned.tree);
  const blob = (tree, path) => git(repository, ['cat-file', 'blob', `${tree}:${path}`]).stdout;
  assert.deepEqual(entries.map(e => e.path).sort(), candidatePaths.filter(p => p !== 'delete.txt').sort());
  assert.equal(blob(pinned.tree, 'document.txt'), 'candidate\n');
  assert.equal(blob(pinned.tree, 'new file.txt'), 'new candidate\n');
  assert.equal(blob(pinned.tree, 'ignored-allowed.txt'), 'explicit allowed candidate\n');
  assert.equal(blob(unpinned.tree, 'document.txt'), 'candidate\r\n');
  assert.equal(blob(pinned.tree, '.gitattributes'), '*.txt -text\n');
  assert.equal(entries.find(e => e.path === 'executable.sh').mode, '100755');
  assert.equal(entries.find(e => e.path === 'mode-change.sh').mode, '100755');
  assert.equal(entries.find(e => e.path === 'new file.txt').mode, '100644');
  assert.match(pinned.beforeModeChange, /^100644 /);
  const baseFiltered = git(repository, [`--attr-source=${base}`, 'cat-file', '--filters', `${pinned.tree}:document.txt`]).stdout;
  const candidateFiltered = git(repository, [`--attr-source=${pinned.tree}`, 'cat-file', '--filters', `${pinned.tree}:document.txt`]).stdout;
  assert.equal(baseFiltered, 'candidate\r\n');
  assert.equal(candidateFiltered, 'candidate\n');
  observations.candidate = { base, tree: pinned.tree, unpinnedTree: unpinned.tree, entries,
    explicitAllowedIgnoredFileIncluded: true, deletedAndExcludedFilesAbsent: true,
    pinnedBlob: 'LF', unpinnedBlob: 'CRLF', baseAttributeCheckout: 'CRLF', changedCandidateAttributeCheckout: 'LF',
    windowsModes: 'Existing executable bit preserved; new file is 100644; explicit alternate-index chmod changes a mode.' };
  const infoAttributes = join(output(workspace, ['rev-parse', '--path-format=absolute', '--git-common-dir']), 'info', 'attributes');
  writeFileSync(infoAttributes, 'document.txt -text\n');
  const infoOverride = stageCandidate('info-override.index', true);
  assert.equal(blob(infoOverride.tree, 'document.txt'), 'candidate\r\n');
  rmSync(infoAttributes);
  observations.candidate.repositoryInfoAttributesOverridePinnedTree = true;

  // commit-tree receives all content and metadata from explicit inputs. It does
  // not update HEAD or invoke ordinary commit hooks. Discard the first receipt.
  const hookSentinel = join(root, 'hooks.log').replaceAll('\\', '/');
  for (const hook of ['pre-commit', 'commit-msg', 'pre-push']) {
    writeFileSync(join(configuredHooks, hook), `#!/bin/sh\nprintf '${hook}\\n' >> '${hookSentinel}'\n`, { mode: 0o755 });
  }
  const message = 'Pinned learning delivery\n\nrun: local-probe\n';
  const lostCommitReceipt = output(repository, ['commit-tree', pinned.tree, '-p', base, '-F', '-'], { input: message, configuredHooks: true });
  const commit = output(repository, ['commit-tree', pinned.tree, '-p', base, '-F', '-'], { input: message, configuredHooks: true });
  assert.equal(commit, lostCommitReceipt);
  assert.equal(existsSync(hookSentinel), false);
  const changedDateCommit = output(repository, ['commit-tree', pinned.tree, '-p', base, '-F', '-'], {
    input: message, env: { GIT_COMMITTER_DATE: '1700000001 +0000' },
  });
  assert.notEqual(changedDateCommit, commit);
  observations.commit = { commit, repeatedCommit: lostCommitReceipt, changedDateCommit,
    exactInputsRepeatObject: true, commitHooksInvoked: false, raw: git(repository, ['cat-file', 'commit', commit]).stdout };

  git(root, ['init', '--bare', remote]);
  const ref = 'refs/heads/swf/p5-learning';
  // The first push response is deliberately not used as a receipt. Query the
  // remote ref, then repeat the same non-force update after this simulated gap.
  git(repository, ['push', '--porcelain', remote, `${commit}:${ref}`], { configuredHooks: true });
  assert.match(readFileSync(hookSentinel, 'utf8'), /pre-push/);
  const remoteAfterGap = output(repository, ['ls-remote', '--exit-code', remote, ref]);
  assert.equal(remoteAfterGap, `${commit}\t${ref}`);
  const hookBeforeDisabledPush = readFileSync(hookSentinel, 'utf8');
  const repeatedPush = git(repository, ['push', '--porcelain', remote, `${commit}:${ref}`]);
  assert.match(repeatedPush.stdout, /up to date/);
  assert.equal(readFileSync(hookSentinel, 'utf8'), hookBeforeDisabledPush);
  assert.equal(output(repository, ['ls-remote', '--exit-code', remote, ref]), `${commit}\t${ref}`);
  const conflictingRef = 'refs/heads/swf/p5-conflict';
  git(repository, ['push', '--porcelain', remote, `${changedDateCommit}:${conflictingRef}`]);
  const conflictObserved = output(repository, ['ls-remote', '--exit-code', remote, conflictingRef]);
  assert.equal(conflictObserved, `${changedDateCommit}\t${conflictingRef}`);
  const conflictPush = git(repository, ['push', '--porcelain', remote, `${commit}:${conflictingRef}`], { failureAllowed: true });
  assert.notEqual(conflictPush.status, 0);
  assert.equal(output(repository, ['ls-remote', '--exit-code', remote, conflictingRef]), conflictObserved);
  const missing = git(repository, ['ls-remote', '--exit-code', remote, 'refs/heads/swf/missing'], { failureAllowed: true });
  assert.equal(missing.status, 2);
  observations.push = { remote, ref, remoteAfterGap, repeatedPushStatus: repeatedPush.status,
    conflictObserved, conflictPushStatus: conflictPush.status, missingRefStatus: missing.status,
    ordinaryPushCasesUsedNoForce: true, configuredLocalPrePushHookRan: true, emptyHookPathSuppressedLocalHook: true };
  const ancestorRef = 'refs/heads/swf/ancestor-conflict';
  git(repository, ['push', '--porcelain', remote, `${base}:${ancestorRef}`]);
  assert.equal(output(repository, ['ls-remote', '--exit-code', remote, ancestorRef]), `${base}\t${ancestorRef}`);
  git(repository, ['push', '--porcelain', remote, `${commit}:${ancestorRef}`]);
  assert.equal(output(repository, ['ls-remote', '--exit-code', remote, ancestorRef]), `${commit}\t${ancestorRef}`);
  observations.push.differentAncestorShaStillAllowsOrdinaryFastForwardPush = true;

  // An empty expected ref is a create-only lease. Learn its behavior separately
  // from ordinary push, including a branch created after the absence query.
  const leaseRef = 'refs/heads/swf/create-only';
  const absentLeaseRef = git(repository, ['ls-remote', '--exit-code', remote, leaseRef], { failureAllowed: true });
  assert.equal(absentLeaseRef.status, 2);
  const leaseArgs = ['push', '--porcelain', `--force-with-lease=${leaseRef}:`, remote, `${commit}:${leaseRef}`];
  const leaseCreate = git(repository, leaseArgs);
  assert.equal(output(repository, ['ls-remote', '--exit-code', remote, leaseRef]), `${commit}\t${leaseRef}`);
  const leaseRepeat = git(repository, leaseArgs);
  assert.match(leaseRepeat.stdout, /up to date/);
  assert.equal(output(repository, ['ls-remote', '--exit-code', remote, leaseRef]), `${commit}\t${leaseRef}`);
  const raceRef = 'refs/heads/swf/create-only-race';
  assert.equal(git(repository, ['ls-remote', '--exit-code', remote, raceRef], { failureAllowed: true }).status, 2);
  // Model the interleaving: another writer creates a branch at the ancestor
  // after the query. An ordinary push would accept this fast-forward.
  git(repository, ['push', '--porcelain', remote, `${base}:${raceRef}`]);
  const raceAttempt = git(repository, ['push', '--porcelain', `--force-with-lease=${raceRef}:`, remote, `${commit}:${raceRef}`], { failureAllowed: true });
  assert.notEqual(raceAttempt.status, 0);
  assert.match(raceAttempt.stdout + raceAttempt.stderr, /stale info/);
  assert.equal(output(repository, ['ls-remote', '--exit-code', remote, raceRef]), `${base}\t${raceRef}`);
  observations.createOnlyLease = { leaseRef, createStatus: leaseCreate.status,
    sameShaRepeatStatus: leaseRepeat.status, sameShaRepeatReportedUpToDate: true,
    raceRef, differingAncestorRejectionStatus: raceAttempt.status,
    rejectionReportedStaleInfo: true, differingAncestorPreserved: true };

  const after = {
    repositoryFiles: fileSnapshot(repository), workspaceFiles: fileSnapshot(workspace),
    repositoryIndex: indexDigest(repository), workspaceIndex: indexDigest(workspace),
    repositoryHead: output(repository, ['rev-parse', 'HEAD']), workspaceHead: output(workspace, ['rev-parse', 'HEAD']),
  };
  assert.deepEqual(after, before);
  observations.preservation = { ...after, sourceAndCandidateFilesIndexesHeadsUnchanged: true };

  // Compare the delivered commit's own filtered representation with the input
  // bytes. This is a separate fixture with both unchanged and changed attrs.
  const roundtripRepo = join(root, 'roundtrip-repository');
  mkdirSync(roundtripRepo);
  git(roundtripRepo, ['init', '-b', 'main']);
  writeFileSync(join(roundtripRepo, '.gitattributes'), '*.txt text eol=crlf\n');
  writeFileSync(join(roundtripRepo, 'document.txt'), 'base\r\n');
  git(roundtripRepo, ['add', '.']);
  git(roundtripRepo, ['commit', '-m', 'Roundtrip base']);
  const roundtripBase = output(roundtripRepo, ['rev-parse', 'HEAD']);
  writeFileSync(join(roundtripRepo, 'document.txt'), 'candidate\r\n');
  writeFileSync(join(roundtripRepo, 'new file.txt'), 'new candidate\r\n');
  const roundtrip = (label) => {
    const env = { GIT_INDEX_FILE: join(root, `${label}.index`) };
    const candidateBefore = fileSnapshot(roundtripRepo), ordinaryIndexBefore = indexDigest(roundtripRepo);
    git(roundtripRepo, ['read-tree', roundtripBase], { env });
    git(roundtripRepo, [`--attr-source=${roundtripBase}`, 'add', '-A', '--', '.gitattributes', 'document.txt', 'new file.txt'], { env });
    const tree = output(roundtripRepo, ['write-tree'], { env });
    const commit = output(roundtripRepo, ['commit-tree', tree, '-p', roundtripBase, '-F', '-'], { input: 'Roundtrip\n' });
    const files = candidateBefore.map(candidate => {
      const checkout = git(roundtripRepo, [`--attr-source=${commit}`, 'cat-file', '--filters', `${commit}:${candidate.path}`]).stdout;
      return { ...candidate, checkoutDigest: sha256(checkout), sameBytes: sha256(checkout) === candidate.digest };
    });
    assert.deepEqual(fileSnapshot(roundtripRepo), candidateBefore);
    assert.equal(indexDigest(roundtripRepo), ordinaryIndexBefore);
    return { tree, commit, files };
  };
  const unchangedAttributes = roundtrip('roundtrip-unchanged');
  assert.ok(unchangedAttributes.files.every(file => file.sameBytes));
  writeFileSync(join(roundtripRepo, '.gitattributes'), '*.txt -text\n');
  const changedAttributes = roundtrip('roundtrip-changed');
  assert.deepEqual(changedAttributes.files.filter(file => !file.sameBytes).map(file => file.path), ['document.txt', 'new file.txt']);
  observations.checkoutRoundtrip = { unchangedAttributes, changedAttributes };

  // A pinned attribute tree still selects local filter drivers. Hook suppression
  // and core.autocrlf=false do not disable arbitrary clean-filter execution.
  const filterRepo = join(root, 'filter-repository');
  mkdirSync(filterRepo);
  git(filterRepo, ['init', '-b', 'main']);
  writeFileSync(join(filterRepo, '.gitattributes'), '*.txt text eol=crlf filter=learning\n');
  writeFileSync(join(filterRepo, 'filtered.txt'), 'base\r\n');
  git(filterRepo, ['add', '.']);
  git(filterRepo, ['commit', '-m', 'Filter learning base']);
  const filterBase = output(filterRepo, ['rev-parse', 'HEAD']);
  const filterSentinel = join(root, 'filter.log');
  const filterScript = join(root, 'filter.cjs');
  writeFileSync(filterScript, `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(filterSentinel)},'ran\\n');process.stdout.write(fs.readFileSync(0,'utf8').toUpperCase());\n`);
  const filterCommand = [process.execPath, filterScript].map(p => `"${p.replaceAll('\\', '/')}"`).join(' ');
  git(filterRepo, ['config', 'filter.learning.clean', filterCommand]);
  git(filterRepo, ['config', 'filter.learning.required', 'true']);
  writeFileSync(join(filterRepo, 'filtered.txt'), 'candidate\r\n');
  const filterEnv = { GIT_INDEX_FILE: join(root, 'filter.index') };
  git(filterRepo, ['read-tree', filterBase], { env: filterEnv });
  git(filterRepo, [`--attr-source=${filterBase}`, 'add', '--', 'filtered.txt'], { env: filterEnv });
  const filteredTree = output(filterRepo, ['write-tree'], { env: filterEnv });
  const filteredBlob = git(filterRepo, ['cat-file', 'blob', `${filteredTree}:filtered.txt`]).stdout;
  assert.equal(filteredBlob, 'CANDIDATE\n');
  const cleanFilterInvocations = readFileSync(filterSentinel, 'utf8').trim().split('\n').length;
  assert.ok(cleanFilterInvocations >= 1);
  const filteredCommit = output(filterRepo, ['commit-tree', filteredTree, '-p', filterBase, '-F', '-'], { input: 'Filter roundtrip\n' });
  const missingSmudge = git(filterRepo, [`--attr-source=${filteredCommit}`, 'cat-file', '--filters', `${filteredCommit}:filtered.txt`], { failureAllowed: true });
  assert.notEqual(missingSmudge.status, 0);
  const smudgeScript = join(root, 'smudge.cjs');
  writeFileSync(smudgeScript, "process.stdout.write(require('node:fs').readFileSync(0));\n");
  const smudgeCommand = [process.execPath, smudgeScript].map(p => `"${p.replaceAll('\\', '/')}"`).join(' ');
  git(filterRepo, ['config', 'filter.learning.smudge', smudgeCommand]);
  const filterCheckout = git(filterRepo, [`--attr-source=${filteredCommit}`, 'cat-file', '--filters', `${filteredCommit}:filtered.txt`]).stdout;
  assert.equal(filterCheckout, 'CANDIDATE\r\n');
  assert.notEqual(filterCheckout, readFileSync(join(filterRepo, 'filtered.txt'), 'utf8'));
  observations.filters = { filterBase, filteredTree, cleanFilterInvokedUnderPinnedAttributes: true,
    hooksSuppressedDuringFilter: true, cleanFilterInvocations, filteredBlob, filterCommand,
    filteredCommit, missingRequiredSmudgeStatus: missingSmudge.status, smudgeCommand,
    filterCheckout, sameCheckoutBytesAsCandidate: false };
  observations.result = 'observed';
} catch (error) {
  observations.result = 'probe_failed';
  observations.failure = error.stack;
  process.exitCode = 1;
} finally {
  mkdirSync(resolve(reportPath, '..'), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({ root, reportPath, observations, commands }, null, 2) + '\n');
  console.log(JSON.stringify({ root, reportPath, result: observations.result,
    version: observations.version, commandCount: commands.length, failure: observations.failure }, null, 2));
}
