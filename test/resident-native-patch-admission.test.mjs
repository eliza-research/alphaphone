import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {preparePatchedNative} from '../scripts/prepare-patched-native.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('pinned recovery and lifecycle sources match the reviewed upstream repair',()=>{
 for(const [name,expected] of [
 ['ElizaAgentService','4024061bd3e98daea7740aa21a3190b25e38b16d60ce60ee0e49c35d385a5861'],
 ['AndroidBunTarget','1ce791f9fbeeeea2a40bdf94b1b11e600df75c8fbee8649a5f47b3d919d7f675'],
 ['IpcStartupRecovery','d77ea0883554991622a5a0b044a7cf373686eec15c5a705abbd69aaf5b94e80f'],
 ['WorkflowSurvivorInventory','4db99bd2120d33e0ff6211e3c4f05313f16ffbacef3a2fbf21df291ca8b62098'],
 ])assert.equal(sha(fs.readFileSync(`vendor/eliza/packages/app/platforms/android/app/src/main/java/ai/elizaos/app/${name}.java`)),expected);
});
test('obsolete resident patch slot is refused rather than reapplied',()=>{
 assert.throws(()=>preparePatchedNative({manifestFile:'resident-native-manifest.json'}),/Unknown native patch slot/);
 assert.equal(fs.existsSync('patches/eliza/resident-ipc-recovery.patch'),false);
});
