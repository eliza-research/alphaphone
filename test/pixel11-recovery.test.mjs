import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('offline Pixel recovery verifier rejects corrupt and incompatible fixtures',()=>{
  const result=spawnSync('python3',['-B',fileURLToPath(new URL('./pixel11-recovery-fixtures.py',import.meta.url))],{encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,`${result.error || ''}\n${result.stdout}\n${result.stderr}`);
});
