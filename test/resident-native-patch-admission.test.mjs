import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {preparePatchedNative} from '../scripts/prepare-patched-native.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('pinned recovery and lifecycle sources match the reviewed upstream repair',()=>{
 for(const [name,expected] of [
 ['ElizaAgentService','7abd49d66db96ba5c07de451349d1e81473d1c55ff34168c7d90a4d36509ecb8'],
 ['IpcStartupRecovery','d77ea0883554991622a5a0b044a7cf373686eec15c5a705abbd69aaf5b94e80f'],
 ['WorkflowSurvivorInventory','bb9b1ac3c0e13f356edeef26d5fdb7d9d8288071b659440a930e4570d0790b12'],
 ])assert.equal(sha(fs.readFileSync(`vendor/eliza/packages/app/platforms/android/app/src/main/java/ai/elizaos/app/${name}.java`)),expected);
});
test('obsolete resident patch slot is refused rather than reapplied',()=>{
 assert.throws(()=>preparePatchedNative({manifestFile:'resident-native-manifest.json'}),/Unknown native patch slot/);
 assert.equal(fs.existsSync('patches/eliza/resident-ipc-recovery.patch'),false);
});
