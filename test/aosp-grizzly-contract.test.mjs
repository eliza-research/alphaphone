import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {deriveAlphaGrizzlyVendorContract} from '../scripts/aosp-grizzly-contract.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const base = Buffer.from('# original fixture\n');
const policy = readFileSync(new URL('../android/aosp/grizzly/stock-boot-policy.mk', import.meta.url));
const actual = Buffer.concat([base, Buffer.from('\n'), policy]);
const reference = () => ({generatedVendor: {requiredFiles: ['other/file'], requiredTextFiles: [{path: 'other/file', includes: ['required']}], requiredArtifacts: [
  {path: 'vendor/google_devices/grizzly/BoardConfig.mk', sha256: sha(base), sizeBytes: base.length},
  {path: 'other/file', sha256: 'a'.repeat(64), sizeBytes: 12},
]}});

test('Alpha board derivation preserves the reference and every unrelated requirement', () => {
  const lock = reference();
  const before = structuredClone(lock);
  const result = deriveAlphaGrizzlyVendorContract(lock, base, actual);
  assert.deepEqual(lock, before);
  assert.deepEqual(result.effectiveLock.generatedVendor.requiredArtifacts[1], before.generatedVendor.requiredArtifacts[1]);
  assert.deepEqual(result.effectiveLock.generatedVendor.requiredFiles, before.generatedVendor.requiredFiles);
  assert.deepEqual(result.effectiveLock.generatedVendor.requiredTextFiles, before.generatedVendor.requiredTextFiles);
  assert.equal(result.overlay.baseSha256, sha(base));
  assert.equal(result.overlay.sha256, sha(actual));
  assert.equal(result.deployReady, false);
});

test('Alpha board derivation rejects altered base, extra edits, and ambiguous reference entries', () => {
  assert.throws(() => deriveAlphaGrizzlyVendorContract(reference(), Buffer.from('wrong'), actual), /reference lock/);
  assert.throws(() => deriveAlphaGrizzlyVendorContract(reference(), base, Buffer.concat([actual, Buffer.from('extra')])), /exact Alpha overlay/);
  assert.throws(() => deriveAlphaGrizzlyVendorContract(reference(), base, base), /exact Alpha overlay/);
  const duplicate = reference();
  duplicate.generatedVendor.requiredArtifacts.push(duplicate.generatedVendor.requiredArtifacts[0]);
  assert.throws(() => deriveAlphaGrizzlyVendorContract(duplicate, base, actual), /Exactly one/);
  assert.throws(() => deriveAlphaGrizzlyVendorContract({}, base, actual), /Exactly one/);
});
