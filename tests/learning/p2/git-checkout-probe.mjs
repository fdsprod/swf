// Isolated Git behavior probe. This file imports no product code.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const evidenceDirectory = resolve(process.argv[2] || '.p2-proof/git-checkout-learning');
const root = mkdtempSync(join(tmpdir(), 'swf-p2-git-learning-'));
const repository = join(root, 'repository'), workspace = join(root, 'workspace'), hooks = join(root, 'empty-hooks');
mkdirSync(repository); mkdirSync(hooks); mkdirSync(evidenceDirectory, { recursive: true });
const commands = [];
function git(cwd, args) {
  const argv = ['-C', cwd, '-c', 'core.autocrlf=false', '-c', `core.hooksPath=${hooks}`, ...args];
  const output = execFileSync('git', argv, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  commands.push({ argv, stdout: output.toString('utf8'), digest: createHash('sha256').update(output).digest('hex') });
  return output;
}
const version = execFileSync('git', ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
git(repository, ['init', '-b', 'main']);
writeFileSync(join(repository, '.gitattributes'), '*.txt text eol=crlf\n');
writeFileSync(join(repository, 'document.txt'), 'first\nsecond\n');
git(repository, ['add', '.']);
git(repository, ['-c', 'user.name=SWF isolated probe', '-c', 'user.email=probe@invalid', 'commit', '-m', 'Pin checkout attributes']);
const base = git(repository, ['rev-parse', 'HEAD']).toString('utf8').trim();
git(repository, ['worktree', 'add', '--detach', workspace, base]);
const raw = git(repository, ['cat-file', 'blob', `${base}:document.txt`]);
const checkedOut = readFileSync(join(workspace, 'document.txt'));
const fromPinned = () => git(workspace, [`--attr-source=${base}`, 'cat-file', '--filters', `${base}:document.txt`]);
assert.equal(raw.toString(), 'first\nsecond\n');
assert.equal(checkedOut.toString(), 'first\r\nsecond\r\n');
assert.deepEqual(fromPinned(), checkedOut);
writeFileSync(join(workspace, '.gitattributes'), '*.txt text eol=lf\n');
const fromChangedWorktree = git(workspace, ['cat-file', '--filters', `${base}:document.txt`]);
const pinnedAfterEdit = fromPinned();
assert.deepEqual(fromChangedWorktree, raw);
assert.deepEqual(pinnedAfterEdit, checkedOut);
const result = { version, root, base, observations: { rawBlob: 'LF', checkout: 'CRLF', filteredFromChangedWorktree: 'LF', filteredFromPinnedTreeAfterAttributeEdit: 'CRLF' }, commands };
writeFileSync(join(evidenceDirectory, 'git-checkout-observations.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ version, root, observations: result.observations, commands: commands.length }));
