import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {PIXEL10A_PRODUCT} from './aosp-pixel10a.mjs';
import {channelDistributionProblems} from './sign-aosp-release.mjs';

/** The distinct Pixel 10a distribution gates (issue #399). */
export const PIXEL10A_GATES = 'android/aosp/pixel10a-qualification-gates.json';
export const GATE_NAMES = ['sourceAdmission', 'apkVariants', 'cuttlefishBoot', 'physicalDevice', 'signedUpdateRecovery', 'userAcceptance'];
const STATUSES = ['not run', 'development', 'failed', 'passed'];
const LEVELS = ['development', 'release'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = (root, file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

/**
 * Problems with the recorded gates, read from `root`. Each gate stands alone: 'passed' needs
 * release-level evidence of its own, development evidence never passes a gate, and the record
 * must agree with the source lock, product descriptor and update channel it summarizes.
 * An empty list means the record is consistent, not that any gate passed.
 */
export function pixel10aGateProblems(root = process.cwd()) {
  let record;
  try { record = readJson(root, PIXEL10A_GATES); } catch (error) { return [`${PIXEL10A_GATES} is unreadable: ${error.message}`]; }
  const problems = [];
  if (record.schema !== 1 || record.target !== 'pixel10a' || record.product !== 'alpha_stallion_phone') problems.push(`${PIXEL10A_GATES}: must be schema 1 for alpha_stallion_phone on pixel10a`);
  const gates = record.gates ?? {};
  if (JSON.stringify(Object.keys(gates)) !== JSON.stringify(GATE_NAMES)) problems.push(`${PIXEL10A_GATES}: gates must be exactly ${GATE_NAMES.join(', ')}`);
  for (const name of GATE_NAMES) {
    const gate = gates[name], at = `${PIXEL10A_GATES}: ${name}`;
    if (!gate) continue;
    if (!STATUSES.includes(gate.status)) { problems.push(`${at} status must be one of ${STATUSES.join(', ')}`); continue; }
    if (!Array.isArray(gate.evidence)) { problems.push(`${at} evidence must be a list`); continue; }
    for (const entry of gate.evidence) {
      if (!LEVELS.includes(entry?.level)) problems.push(`${at} evidence level must be development or release`);
      if (typeof entry?.ref !== 'string' || !entry.ref) problems.push(`${at} evidence needs a ref`);
      else if (!/^https:\/\//.test(entry.ref) && !fs.existsSync(path.join(root, entry.ref))) problems.push(`${at} evidence ${entry.ref} is missing`);
    }
    if (gate.status !== 'not run' && !gate.evidence.length) problems.push(`${at} is "${gate.status}" without evidence`);
    if (gate.status === 'passed' && !gate.evidence.some(entry => entry?.level === 'release')) problems.push(`${at} cannot pass on development evidence`);
  }
  // Source admission must name the exact admitted lock.
  if (gates.sourceAdmission?.status === 'passed') {
    const product = readJson(root, PIXEL10A_PRODUCT), lockBytes = fs.readFileSync(path.join(root, product.sourceLock.file));
    if (JSON.parse(lockBytes).developmentOnly !== false) problems.push(`${PIXEL10A_GATES}: sourceAdmission passed while the lock is developmentOnly`);
    if (sha256(lockBytes) !== product.sourceLock.sha256) problems.push(`${PIXEL10A_GATES}: sourceAdmission passed while ${PIXEL10A_PRODUCT} does not pin the lock`);
    const verified = gates.sourceAdmission.evidence.filter(entry => entry.level === 'release' && !/^https:\/\//.test(entry.ref) && fs.existsSync(path.join(root, entry.ref)))
      .map(entry => { try { return readJson(root, entry.ref); } catch { return {}; } });
    if (!verified.some(report => report.sourceLockSha256 === product.sourceLock.sha256 && report.developmentOnly === false))
      problems.push(`${PIXEL10A_GATES}: sourceAdmission evidence does not verify the pinned admitted lock`);
  }
  // The update/recovery gate mirrors the channel drill record.
  if (gates.signedUpdateRecovery?.status === 'passed') {
    const product = readJson(root, PIXEL10A_PRODUCT);
    for (const problem of channelDistributionProblems(readJson(root, product.ota.channel), product.ota.channel)) problems.push(`${PIXEL10A_GATES}: signedUpdateRecovery passed while ${problem}`);
  }
  // User acceptance follows every other gate.
  if (gates.userAcceptance?.status === 'passed' && GATE_NAMES.some(name => name !== 'userAcceptance' && gates[name]?.status !== 'passed'))
    problems.push(`${PIXEL10A_GATES}: userAcceptance cannot pass before every other gate`);
  return problems;
}
