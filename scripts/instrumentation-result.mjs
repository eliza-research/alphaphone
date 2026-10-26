import fs from 'node:fs';
import path from 'node:path';
import { requireInstrumentationSuccess } from '../vendor/eliza/packages/app/scripts/lib/instrumentation-result.mjs';

export { requireInstrumentationSuccess };

// AndroidJUnitRunner status codes (InstrumentationResultPrinter).
const STATUS = { 1: 'start', 0: 'ok', '-1': 'error', '-2': 'failure', '-3': 'ignored', '-4': 'assumption' };
const classPattern = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_$]*)+$/;

/**
 * Per-class outcome of raw `am instrument -w -r` output. Unlike
 * requireInstrumentationSuccess (all-or-nothing for exact requested classes),
 * this keeps going so one failing class does not hide the others. A class
 * passes only when every started test of it finished OK or was skipped by its
 * own assumption gate, at least one test passed, and the run ended cleanly.
 * Only-skipped is "skipped"; a requested class that never started is "missing".
 * Neither counts as passed.
 */
export function instrumentationClassResults(output, requestedClasses = []) {
  if (typeof output !== 'string' || output.length > 16 * 1024 * 1024) throw new Error('Instrumentation output missing or over bound');
  const text = output.replace(/\r\n?/g, '\n');
  const classes = new Map();
  const entry = name => {
    if (!classes.has(name)) classes.set(name, { class: name, started: 0, passed: 0, failed: [], ignored: [] });
    return classes.get(name);
  };
  for (const name of requestedClasses) {
    if (!classPattern.test(name)) throw new Error(`Invalid class name ${JSON.stringify(name)}`);
    entry(name);
  }
  let fields = new Map();
  let active = null;
  const seen = new Set();
  const finished = new Set();
  const ignoredWithoutStart = new Map();
  const malformedClasses = new Set();
  for (const line of text.split('\n')) {
    const field = /^INSTRUMENTATION_STATUS: ([A-Za-z][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (field) { if (!fields.has(field[1])) fields.set(field[1], field[2]); continue; }
    const code = /^INSTRUMENTATION_STATUS_CODE: (-?\d+)\s*$/.exec(line)?.[1];
    if (code === undefined) continue;
    const kind = STATUS[code] ?? 'unknown';
    const cls = fields.get('class');
    const method = fields.get('test');
    fields = new Map();
    if (!cls || !classPattern.test(cls) || !method) continue;
    const row = entry(cls);
    const selector = `${cls}#${method}`;
    if (kind === 'start') {
      if (seen.has(selector) || finished.has(selector)) malformedClasses.add(cls);
      if (active !== null) malformedClasses.add(active.split('#')[0]);
      seen.add(selector); row.started++; active = selector; continue;
    }
    if (finished.has(selector)) malformedClasses.add(cls);
    finished.add(selector);
    // JUnit @Ignore emits -3 without testStarted; assumptions (-4) require a start.
    if (kind === 'ignored' && !seen.has(selector))
      ignoredWithoutStart.set(cls, (ignoredWithoutStart.get(cls) ?? 0) + 1);
    else if (active !== selector) malformedClasses.add(cls);
    if (kind === 'ok' && active === selector) row.passed++;
    else if (kind === 'ignored' || kind === 'assumption') row.ignored.push(method);
    else row.failed.push(method);
    if (active === selector) active = null;
  }
  const terminal = [...text.matchAll(/^INSTRUMENTATION_CODE: (-?\d+)\s*$/gm)];
  const runFailure = /INSTRUMENTATION_FAILED|Process crashed/.test(text) || terminal.length !== 1 || terminal[0][1] !== '-1';
  const crashedIn = active?.split('#')[0] ?? null;
  const results = [...classes.values()].sort((a, b) => a.class.localeCompare(b.class)).map(row => {
    const incomplete = row.started + (ignoredWithoutStart.get(row.class) ?? 0) !== row.passed + row.failed.length + row.ignored.length;
    // Assumption-skipped methods (a test's own declared variant/campaign gate) are
    // listed, never counted as passes; a class with no passing test is not passed.
    let status = 'passed';
    if (row.started === 0 && row.ignored.length === 0) status = 'missing';
    else if (malformedClasses.has(row.class) || row.failed.length || incomplete || crashedIn === row.class || runFailure) status = 'failed';
    else if (row.passed === 0) status = 'skipped';
    return { ...row, status };
  });
  return { runFailure, crashedIn, results };
}

/** Test names listed by a `-e log true` dry run (nothing executes). */
export function listedInstrumentationTests(output) {
  const text = String(output).replace(/\r\n?/g, '\n');
  const tests = new Set();
  let fields = new Map();
  for (const line of text.split('\n')) {
    const field = /^INSTRUMENTATION_STATUS: ([A-Za-z][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (field) { fields.set(field[1], field[2]); continue; }
    if (/^INSTRUMENTATION_STATUS_CODE: 1\s*$/.test(line) && fields.get('class') && fields.get('test'))
      tests.add(`${fields.get('class')}#${fields.get('test')}`);
    if (/^INSTRUMENTATION_STATUS_CODE:/.test(line)) fields = new Map();
  }
  return [...tests].sort();
}

const hex64 = /^[0-9a-f]{64}$/;
const hex40 = /^[0-9a-f]{40}$/;

/**
 * Evidence class of a record, derived only from where it ran (docs/verification.md): an emulator
 * is class E, the Alpha Cuttlefish image class I, a physical Pixel class D. A caller cannot set
 * the class itself; the fields below are written after the record so they cannot be overridden.
 */
export const EVIDENCE_BY_TARGET = {
  emulator: { evidenceClass: 'E', evidence: 'emulator-instrumentation',
    notEvidenceFor: ['physical-device acceptance', 'user acceptance', 'AOSP image boot', 'real integrations'] },
  cuttlefish: { evidenceClass: 'I', evidence: 'cuttlefish-image-instrumentation',
    notEvidenceFor: ['emulator instrumentation', 'physical-device acceptance', 'user acceptance', 'real integrations', 'other images or fingerprints'] },
  pixel: { evidenceClass: 'D', evidence: 'physical-device-instrumentation',
    notEvidenceFor: ['emulator instrumentation', 'AOSP image boot', 'real integrations', 'user acceptance beyond the executed classes', 'other device models or builds'] },
};

/**
 * Write one instrumentation evidence record. Every record is bound to the source
 * commit and the SHA-256 of each installed APK. Without `deviceTarget` it is
 * emulator-class evidence (class E) and must carry `emulator`; with `deviceTarget`
 * cuttlefish or pixel it is class I or D and must carry the admitted `device` identity.
 * No class ever stands for another.
 */
export function writeInstrumentationRecord(file, record) {
  const target = record?.deviceTarget ?? 'emulator';
  if (!Object.hasOwn(EVIDENCE_BY_TARGET, target) || target === 'emulator' && record.deviceTarget !== undefined)
    throw new Error(`Unknown device target ${JSON.stringify(record?.deviceTarget)}`);
  if (target === 'emulator' && record.device !== undefined) throw new Error('An emulator record carries no device identity');
  if (target !== 'emulator' && (record.emulator !== undefined || record.device?.target !== target || !record.device?.fingerprint))
    throw new Error(`A ${target} record needs the admitted device identity (target and fingerprint) and no emulator identity`);
  if (!hex40.test(record?.commit ?? '')) throw new Error('Instrumentation record needs the full source commit');
  if (!Array.isArray(record.apks) || !record.apks.length || record.apks.some(apk => !hex64.test(apk.sha256 ?? '') || !apk.role || !apk.variant))
    throw new Error('Instrumentation record needs the variant, role and SHA-256 of every installed APK');
  if (!Array.isArray(record.classes)) throw new Error('Instrumentation record needs per-class results');
  for (const row of record.classes)
    if (!['passed', 'failed', 'missing', 'skipped'].includes(row.status) || !row.variant || !classPattern.test(row.class ?? ''))
      throw new Error(`Invalid class result ${JSON.stringify(row)}`);
  const body = {
    schema: 1,
    ...record,
    ...EVIDENCE_BY_TARGET[target],
    // A run that changed the HOME role passes only with the original holder proven restored.
    passed: record.classes.length > 0 && record.classes.every(row => row.status === 'passed')
      && (record.homeRole === undefined || (record.homeRole.restored === true && record.homeRole.coldHome?.resumed === true)),
  };
  // A run that created a disposable secondary user passes only with every such user proven removed.
  if (record.secondaryUsers !== undefined) body.passed = body.passed && Array.isArray(record.secondaryUsers) && record.secondaryUsers.every(row => row.removed === true && row.ownerRestored === true);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, { flag: 'wx' });
  return body;
}
