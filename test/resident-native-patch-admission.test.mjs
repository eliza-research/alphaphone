import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {preparePatchedNative} from '../scripts/prepare-patched-native.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('pinned recovery and lifecycle sources match the reviewed upstream repair',()=>{
 for(const [name,expected] of [
 ['AndroidBunTarget','1ce791f9fbeeeea2a40bdf94b1b11e600df75c8fbee8649a5f47b3d919d7f675'],
 // elizaOS/eliza#38158 adds only the shared problem-log exit-reason collection; #38205 only names the
 // state and workflow directory constants for Reset app data. Recovery and lifecycle are unchanged.
 ['ElizaAgentService','2a3e91d93f2d7ca2ca5ed64555cc01f7c51d81195227c2a99820fd70936f3803'],
 // PR37979/37981: verify directory timestamps after recovery publication.
 ['IpcStartupRecovery','c51152d8b6403622171e4baed30f55cb540cad2c3fd49a8be1171a4b2c015c27'],
 ['WorkflowSurvivorInventory','3270bebe7e125705eda25e91ba9996f99cb80fbcb7e534c0d1ea47672a0fc42b'],
 ])assert.equal(sha(fs.readFileSync(`vendor/eliza/packages/app/platforms/android/app/src/main/java/ai/elizaos/app/${name}.java`)),expected);
});
test('obsolete resident patch slot is refused rather than reapplied',()=>{
 assert.throws(()=>preparePatchedNative({manifestFile:'resident-native-manifest.json'}),/Unknown native patch slot/);
 assert.equal(fs.existsSync('patches/eliza/resident-ipc-recovery.patch'),false);
});
