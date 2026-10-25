/** Cuttlefish admission and instrumentation accounting; no device mutations. */
export function admitCuttlefish(serial, properties) {
  if (!/^(?:127\.0\.0\.1|localhost):\d{2,5}$/.test(serial || '')) throw Error('Select an explicit loopback Cuttlefish ADB endpoint');
  if (!['cutf_cvm', 'cutf_ivshmem', 'cutf_vm'].includes(properties.hardware) ||
      !/^vsoc_/.test(properties.device) || properties.bootCompleted !== '1') throw Error('A booted Cuttlefish image is required');
  return properties;
}

export function instrumentationResult(log) {
  const cases = [], started = [];
  let block = '';
  for (const line of log.split(/\r?\n/)) {
    const match = /^INSTRUMENTATION_STATUS_CODE: (-?\d+)\s*$/.exec(line);
    if (!match) { block += line + '\n'; continue; }
    const cls = /^INSTRUMENTATION_STATUS: class=(.+)$/m.exec(block)?.[1];
    const method = /^INSTRUMENTATION_STATUS: test=(.+)$/m.exec(block)?.[1];
    const code = Number(match[1]);
    if (cls && method) {
      const selector = `${cls}#${method}`;
      if (code === 1) started.push(selector);
      else if (code <= 0) cases.push({selector, code});
    }
    block = '';
  }
  const count = Number(/OK \((\d+) tests?\)/.exec(log)?.[1]);
  const counts = {passed: 0, failed: 0, skipped: 0, unknown: 0};
  for (const {code} of cases) counts[code === 0 ? 'passed' : [-1,-2].includes(code) ? 'failed' : [-3,-4].includes(code) ? 'skipped' : 'unknown']++;
  const complete = Number.isSafeInteger(count) && count > 0 && count === cases.length &&
    new Set(cases.map(c => c.selector)).size === cases.length &&
    cases.every(c => c.code === -3 || started.filter(s => s === c.selector).length === 1) &&
    started.every(s => cases.some(c => c.selector === s));
  return {complete, counts, cases, passed: complete && counts.passed > 0 && !counts.failed && !counts.unknown && !/FAILURES|INSTRUMENTATION_FAILED|Process crashed/.test(log), allExecuted: complete && counts.skipped === 0};
}
