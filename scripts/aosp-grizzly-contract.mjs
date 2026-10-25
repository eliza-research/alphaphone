import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const boardPath = 'vendor/google_devices/grizzly/BoardConfig.mk';
const policyPath = new URL('../android/aosp/grizzly/stock-boot-policy.mk', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

/** Derive one explicit Alpha development overlay; preserve the reference lock.
 * The caller must still run the upstream complete vendor-tree assertion using
 * effectiveLock, and bind the resulting source tree. This is not release admission.
 */
export function deriveAlphaGrizzlyVendorContract(referenceLock, baseBoard, actualBoard) {
  const matches = referenceLock.generatedVendor?.requiredArtifacts?.filter(entry => entry.path === boardPath);
  if (matches?.length !== 1) throw Error('Exactly one reference BoardConfig artifact is required');
  const original = matches[0];
  if (baseBoard.length !== original.sizeBytes || hash(baseBoard) !== original.sha256)
    throw Error('Original generated BoardConfig does not match the reference lock');
  const policy = readFileSync(policyPath);
  let end = baseBoard.length;
  while (end && baseBoard[end - 1] === 10) end--;
  const expected = Buffer.concat([baseBoard.subarray(0, end), Buffer.from('\n\n'), policy]);
  if (!actualBoard.equals(expected)) throw Error('Current BoardConfig is not the exact Alpha overlay of the locked base');
  const overlay = {path: boardPath, baseSha256: original.sha256, baseSizeBytes: original.sizeBytes,
    policyPath: 'android/aosp/grizzly/stock-boot-policy.mk', policySha256: hash(policy),
    sha256: hash(expected), sizeBytes: expected.length};
  const effectiveLock = structuredClone(referenceLock);
  const entry = effectiveLock.generatedVendor.requiredArtifacts.find(item => item.path === boardPath);
  entry.sha256 = overlay.sha256;
  entry.sizeBytes = overlay.sizeBytes;
  return {effectiveLock, overlay, developmentOnly: true, deployReady: false};
}
