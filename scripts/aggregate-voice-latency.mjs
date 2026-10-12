#!/usr/bin/env node
// Aggregate exported per-turn voice timing records (apps/app/src/runtime/voice-timing.ts).
//
//   node scripts/aggregate-voice-latency.mjs export-1.json [export-2.json ...] [--warm N>=20] [--cold N>=5] [--out summary.json]
//
// Phases are measured from marks on one device clock, in milliseconds:
//   recognition         transcript-ready - recording-end
//   review              send - transcript-ready   (commit delay; legacy manual samples may include user review)
//   firstToken          first-token - send
//   finalReply          final-reply - send
//   firstAudio          first-audio - send        (only when Speak replies is on)
//   speechToTokenExcludingReview  recognition + firstToken
//   speechToAudioExcludingReview  recognition + firstAudio
// The last two are candidate A-10 measures (end of speech to first response, excluding the
// commit delay). Ongoing voice acceptance must also include that delay end to end. This script reports them; it does not sign off a target.
// Exit 0: enough complete audible samples in both cohorts for every observed route.
// Pooled route statistics are descriptive only. Exit 2: not enough. Exit 1: bad input.
import fs from 'node:fs';

const order = ['recording-end', 'transcript-ready', 'send', 'first-token', 'final-reply', 'first-audio'];
const routes = new Set(['on-device', 'browser', 'local-agent', 'eliza-cloud', 'paired-agent', 'development-agent', 'manual']);

/** The sample counts the measurement plan requires. Options can raise them, never lower them. */
export const minimumSamples = Object.freeze({ warm: 20, cold: 5 });
export function parseArguments(argv) {
  const options = { files: [], warm: minimumSamples.warm, cold: minimumSamples.cold, out: null };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === '--warm' || value === '--cold') { const n = Number(argv[++i]); const key = value.slice(2); if (!Number.isInteger(n) || n < minimumSamples[key]) throw new Error(`${value} needs an integer of at least ${minimumSamples[key]}`); options[key] = n; }
    else if (value === '--out') { options.out = argv[++i]; if (!options.out) throw new Error('--out needs a path'); }
    else if (value.startsWith('--')) throw new Error(`Unknown option ${value}`);
    else options.files.push(value);
  }
  if (!options.files.length) throw new Error('Pass at least one voice timing export');
  return options;
}

function validRecord(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || row.version !== 1 || typeof row.id !== 'string' || !/^[0-9a-f-]{36}$/.test(row.id)) return false;
  if (typeof row.cold !== 'boolean' || !routes.has(row.route) || !Number.isFinite(row.recordedAt) || !row.marks || typeof row.marks !== 'object') return false;
  const entries = Object.entries(row.marks);
  if (entries.some(([key, at]) => !order.includes(key) || typeof at !== 'number' || !Number.isFinite(at) || at < 0)) return false;
  // Marks must be monotonic in their defined order.
  let last = -1;
  for (const key of order) { const at = row.marks[key]; if (at === undefined) continue; if (at < last) return false; last = at; }
  return true;
}

/** Reads exports, drops invalid and duplicate records, and keeps the first copy of each id. */
export function collectRecords(exports) {
  const seen = new Map(); let invalid = 0;
  for (const document of exports) {
    if (!document || document.format !== 'alpha-voice-timing-v1' || !Array.isArray(document.records)) throw new Error('Not an alpha-voice-timing-v1 export');
    for (const row of document.records) { if (!validRecord(row)) { invalid++; continue; } if (!seen.has(row.id)) seen.set(row.id, row); }
  }
  return { records: [...seen.values()], invalid };
}

/** Nearest-rank percentile of sorted values. */
export function percentile(sorted, p) { if (!sorted.length) return null; return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p / 100 * sorted.length) - 1))]; }
function stats(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return { n: sorted.length, p50: percentile(sorted, 50), p90: percentile(sorted, 90), p95: percentile(sorted, 95), max: sorted.length ? sorted[sorted.length - 1] : null };
}
export function phases(row) {
  const m = row.marks, gap = (a, b) => m[a] !== undefined && m[b] !== undefined ? m[b] - m[a] : undefined;
  const recognition = gap('recording-end', 'transcript-ready'), firstToken = gap('send', 'first-token'), firstAudio = gap('send', 'first-audio');
  return {
    recognition, review: gap('transcript-ready', 'send'), firstToken, finalReply: gap('send', 'final-reply'), firstAudio,
    speechToTokenExcludingReview: recognition !== undefined && firstToken !== undefined ? recognition + firstToken : undefined,
    speechToAudioExcludingReview: recognition !== undefined && firstAudio !== undefined ? recognition + firstAudio : undefined,
  };
}
/** A complete sample reached the final reply through every earlier mark. */
export const complete = row => !row.outcome && order.slice(0, 5).every(key => row.marks[key] !== undefined);

function cohortSummary(records, required) {
  const usable = records.filter(complete), cohorts = {};
  for (const name of ['warm', 'cold']) {
    const rows = usable.filter(row => row.cold === (name === 'cold')), byPhase = {};
    for (const key of Object.keys(phases({ marks: {} }))) byPhase[key] = stats(rows.map(row => phases(row)[key]));
    const withAudio = rows.filter(row => row.marks['first-audio'] !== undefined).length;
    cohorts[name] = { samples: rows.length, required: required[name], sufficient: rows.length >= required[name], routes: [...new Set(rows.map(row => row.route))].sort(), withAudio, audioSufficient: withAudio >= required[name], phases: byPhase };
  }
  return cohorts;
}

export function aggregate(exports, requested = minimumSamples) {
  const required = { warm: Math.max(minimumSamples.warm, requested.warm ?? 0), cold: Math.max(minimumSamples.cold, requested.cold ?? 0) };
  const { records, invalid } = collectRecords(exports);
  const usable = records.filter(complete), cohorts = cohortSummary(records, required);
  // Include abandoned/incomplete-only routes: omitting them would conceal a failing route.
  const byRoute = Object.fromEntries([...new Set(records.map(row => row.route))].sort().map(route => {
    const selected = records.filter(row => row.route === route), detail = cohortSummary(selected, required);
    return [route, { records: selected.length, complete: selected.filter(complete).length,
      abandoned: selected.filter(row => row.outcome === 'abandoned').length,
      incomplete: selected.filter(row => !row.outcome && !complete(row)).length,
      cohorts: detail, sufficient: detail.warm.audioSufficient && detail.cold.audioSufficient }];
  }));
  return {
    format: 'alpha-voice-latency-summary-v1', units: 'ms',
    records: records.length, complete: usable.length, abandoned: records.filter(row => row.outcome === 'abandoned').length, incomplete: records.filter(row => !row.outcome && !complete(row)).length, invalid,
    cohorts, pooledCohortsAreDescriptiveOnly: true, byRoute,
    sufficient: Object.keys(byRoute).length > 0 && Object.values(byRoute).every(route => route.sufficient),
    sufficiencyRule: 'At least the required warm and cold complete audible samples for each observed route; sample count is not latency target sign-off.',
    targetSignOff: 'pending A-10: the measurement boundary and target are not decided; this summary is evidence only',
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let options;
  try { options = parseArguments(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exit(1); }
  let summary;
  try { summary = aggregate(options.files.map(file => JSON.parse(fs.readFileSync(file, 'utf8'))), { warm: options.warm, cold: options.cold }); }
  catch (error) { console.error(`Cannot aggregate: ${error.message}`); process.exit(1); }
  const text = JSON.stringify(summary, null, 2);
  if (options.out) fs.writeFileSync(options.out, text + '\n'); else console.log(text);
  if (!summary.sufficient) {
    const missing = Object.entries(summary.byRoute).filter(([, value]) => !value.sufficient)
      .map(([route, value]) => `${route}: audible warm ${value.cohorts.warm.withAudio}/${options.warm}, cold ${value.cohorts.cold.withAudio}/${options.cold}`);
    console.error(`Insufficient audible samples by route: ${missing.join('; ') || 'no valid records'}.`);
    process.exit(2);
  }
}
