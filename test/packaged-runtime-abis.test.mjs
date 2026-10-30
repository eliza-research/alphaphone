import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('APK runtime ABI selection follows authenticated provenance and still rejects missing or extra ABIs', () => {
  const run = spawnSync('python3', ['-B', 'test/fixtures/packaged-runtime-abis.py'], {encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /12 authenticated runtime ABI archive cases passed/);
});
