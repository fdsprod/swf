import test from 'node:test';
import assert from 'node:assert/strict';
import { checkArchitecture } from '../harness/architecture.mjs';
import { candidateRoot } from '../harness/support.mjs';

test('ARC-001: kernel imports no adapters directly or through a local dependency', () => {
  assert.deepEqual(checkArchitecture(candidateRoot), []);
});
