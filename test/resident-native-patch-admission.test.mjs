import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {preparePatchedNative} from '../scripts/prepare-patched-native.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('merged recovery sources retain exactly the previously reviewed implementation',()=>{
 for(const [name,expected] of [
 ['ElizaAgentService','477648baa2d84d7e9b344ff8310ef356527f9127c0ac0810e2676f7ce07e7c7b'],
 ['IpcStartupRecovery','caf7633ee51dc4e7ea652f15cb1f62d9115ca3956192df643753c8bd7c73e951'],
 ])assert.equal(sha(fs.readFileSync(`vendor/eliza/packages/app/platforms/android/app/src/main/java/ai/elizaos/app/${name}.java`)),expected);
});
test('obsolete resident patch slot is refused rather than reapplied',()=>{
 assert.throws(()=>preparePatchedNative({manifestFile:'resident-native-manifest.json'}),/Unknown native patch slot/);
 assert.equal(fs.existsSync('patches/eliza/resident-ipc-recovery.patch'),false);
});
