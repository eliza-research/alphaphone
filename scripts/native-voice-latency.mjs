// Native audio-clock evidence for issue #395. Renderer recording-stop timestamps
// cannot establish the last captured speech sample or first audible output sample.
export const nativeTimingFormat = 'alpha-native-voice-timing-v1';
const marks = ['last-user-audio', 'endpoint', 'transcript-ready', 'request', 'first-token', 'first-pcm', 'audible-playback'];
const identityKeys = ['sourceSha256', 'engineSha256', 'modelSha256', 'device', 'abi', 'network', 'thermal'];
const sha256 = /^[a-f0-9]{64}$/;
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
function valid(row) {
  if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id || typeof row.cold !== 'boolean' || !['passed', 'failed', 'cancelled'].includes(row.outcome)) return false;
  if (!row.identity || identityKeys.some(key => typeof row.identity[key] !== 'string' || !row.identity[key].trim())) return false;
  if (['sourceSha256', 'engineSha256', 'modelSha256'].some(key => !sha256.test(row.identity[key]))) return false;
  if (!['arm64-v8a', 'x86_64'].includes(row.identity.abi) || row.clock !== 'native-monotonic-ms' || row.mode !== 'voice-assistant' || row.queryClass !== 'simple') return false;
  if (!row.marks || Array.isArray(row.marks) || typeof row.marks !== 'object' || !finite(row.marks['last-user-audio'])) return false;
  if (Object.entries(row.marks).some(([key, value]) => !marks.includes(key) || !finite(value))) return false;
  let previous = -1;
  for (const key of marks) {
    const at = row.marks[key];
    if (at === undefined) { if (row.outcome === 'passed') return false; continue; }
    if (at < previous) return false;
    previous = at;
  }
  return true;
}
function statistics(values) {
  const sorted = values.sort((a, b) => a - b);
  const percentile = p => sorted.length ? sorted[Math.ceil(p * sorted.length) - 1] : null;
  return { samples: sorted.length, p50: percentile(.5), p95: percentile(.95), max: sorted.at(-1) ?? null };
}
export function aggregateNativeVoice(documents, required = { warm: 20, cold: 5 }) {
  const records = new Map(), conflicts = new Set(); let invalid = 0;
  for (const document of documents) {
    if (document?.format !== nativeTimingFormat || !Array.isArray(document.records)) throw new Error('Not a native voice timing export');
    for (const row of document.records) {
      if (!valid(row)) { invalid++; continue; }
      // IDs identify trials globally. Conflicting exports cannot quietly preserve
      // an earlier success after a later record reports failure or different timing.
      const canonical = JSON.stringify([row.cold, row.outcome, identityKeys.map(key => row.identity[key]), marks.map(key => row.marks[key] ?? null)]);
      const prior = records.get(row.id);
      if (prior && prior.canonical !== canonical) conflicts.add(row.id);
      else records.set(row.id, { row, canonical });
    }
  }
  const groups = new Map();
  for (const { row } of records.values()) {
    if (conflicts.has(row.id)) continue;
    const key = JSON.stringify(identityKeys.map(name => row.identity[name]));
    if (!groups.has(key)) groups.set(key, { identity: Object.fromEntries(identityKeys.map(name => [name, row.identity[name]])), rows: [] });
    groups.get(key).rows.push(row);
  }
  const cohorts = [...groups.values()].map(({ identity, rows }) => {
    const passed = rows.filter(row => row.outcome === 'passed');
    const result = { identity, trials: rows.length, failures: rows.filter(row => row.outcome === 'failed').length, cancelled: rows.filter(row => row.outcome === 'cancelled').length };
    for (const cold of [false, true]) result[cold ? 'cold' : 'warm'] = statistics(passed.filter(row => row.cold === cold).map(row => row.marks['audible-playback'] - row.marks['last-user-audio']));
    result.sufficient = passed.length >= 50 && result.warm.samples >= Math.max(20, required.warm) && result.cold.samples >= Math.max(5, required.cold);
    result.withinBudget = result.sufficient && !result.failures && !result.cancelled && result.warm.max <= 6000 && result.cold.max <= 6000;
    return result;
  });
  return { boundary: 'last-user-audio to audible-playback, including endpoint detection and buffering', units: 'ms', requiredSuccessfulTrials: 50, budgetMs: 6000, invalid, conflictingTrials: conflicts.size, cohorts,
    sufficient: cohorts.length > 0 && !invalid && !conflicts.size && cohorts.every(row => row.sufficient),
    withinBudget: cohorts.length > 0 && !invalid && !conflicts.size && cohorts.every(row => row.withinBudget),
    acceptance: 'Timing evidence only; native clock provenance, microphone/speaker quality and target-device acceptance still require review.' };
}
