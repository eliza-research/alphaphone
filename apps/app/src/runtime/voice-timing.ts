import type { VoiceSendPolicy } from './voice-selection';
import type { HeardOutcome } from './voice-turn-routes';
/**
 * Per-turn voice latency records, kept only on this device. A record holds a random turn
 * id, the speech route, whether the turn was cold, and millisecond offsets from the end of
 * recording. It never holds transcript or reply text, account, agent or conversation
 * identifiers. Export produces the JSON that `scripts/aggregate-voice-latency.mjs` reads.
 *
 * Marks: recording-end (offset 0), transcript-ready, send, first-token, final-reply,
 * first-audio. Each mark is recorded once (first wins) and must not precede the mark before
 * it, so a late or out-of-order observation cannot shorten a measured phase.
 *
 * A record started by an app entrypoint also names that entry ('conversation' for the Cloud
 * voice conversation on Home or another view, 'notes' for the Notes recorder) and the send
 * policy in force. The marks are raw: whether review time counts toward a target (A-10) is
 * decided by the aggregator's boundary, never by moving a mark.
 *
 * A live turn (the agent's streaming ASR, live-voice.ts) also carries `live`: the ASR mode and
 * numbers only — partial count, speech-start to first partial, speech-end to final on this
 * client, and the agent's own last-frame to final. Never text.
 *
 * A voice-assistant turn (#423) also carries `endpoint`: which path submitted it (`semantic`, the
 * resident's end-of-turn scorer, or `gap`, the long silence gap), the scorer's outcome enum, its
 * unavailable reason enum and latency; and `heard`: the outcome enum of recording heard-only content
 * after an interruption (voice-turn-routes.ts). Never text.
 *
 * On the phone, a conversation turn's transcript-ready, send and first-token marks are also
 * reported to the native latency collector (issue #395) through a sink the platform installs
 * (native-voice-turn.ts). Native stamps them on its monotonic clock and links them to the live
 * capture turn by a random native turn id, which this record keeps as `nativeTurn` and the reply's
 * synthesis echoes. Only the stage name and that id cross the bridge: never text.
 *
 * Plain constants and function exports only: Node contract tests evaluate this source.
 */
type VoiceTimingMark = 'recording-end' | 'transcript-ready' | 'send' | 'first-token' | 'final-reply' | 'first-audio';
type VoiceTimingEntry = 'conversation' | 'notes';
export type VoiceTimingLive = { mode: 'stream' | 'batch' | 'unknown'; partials: number; firstPartialMs?: number; finalFromSpeechEndMs?: number; asrFinalFromSpeechEndMs?: number };
export type VoiceTimingEndpoint = { by: 'semantic' | 'gap'; semantic: 'complete' | 'incomplete' | 'unavailable' | 'timeout' | 'error' | 'not-asked'; reason?: string; latencyMs?: number };
type VoiceTimingRecord = { version: 1; id: string; recordedAt: number; route: string; cold: boolean; entry?: VoiceTimingEntry; policy?: VoiceSendPolicy; marks: Partial<Record<VoiceTimingMark, number>>; live?: VoiceTimingLive; endpoint?: VoiceTimingEndpoint; heard?: HeardOutcome; nativeTurn?: string; outcome?: 'abandoned' };
/** Native collector stages (VoiceLatencyTrials) fed by renderer marks. */
type NativeVoiceStage = 'asr-final' | 'request' | 'first-token';
const nativeVoiceStages: Partial<Record<VoiceTimingMark, NativeVoiceStage>> = { 'transcript-ready': 'asr-final', send: 'request', 'first-token': 'first-token' };
const nativeTurnPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Reports one stage; resolves with the native turn id it was bound to, if any. */
type NativeVoiceStageSink = (stage: NativeVoiceStage, voiceTurnId?: string) => Promise<string | undefined>;
let nativeVoiceStageSink: NativeVoiceStageSink | undefined;
const voiceTimingLiveNumbers = ['firstPartialMs', 'finalFromSpeechEndMs', 'asrFinalFromSpeechEndMs'] as const;
/** The `live` numbers of a record, or undefined when the value is not exactly that shape. */
export function voiceTimingLive(value: unknown): VoiceTimingLive | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (!['stream', 'batch', 'unknown'].includes(row.mode as string) || !Number.isSafeInteger(row.partials) || (row.partials as number) < 0 || (row.partials as number) > 100000) return undefined;
  const out: VoiceTimingLive = { mode: row.mode as VoiceTimingLive['mode'], partials: row.partials as number };
  for (const key of voiceTimingLiveNumbers) {
    const at = row[key];
    if (at === undefined) continue;
    if (typeof at !== 'number' || !Number.isFinite(at) || at < 0 || at >= 3_600_000) return undefined;
    out[key] = Math.round(at);
  }
  return out;
}
const voiceTimingEndpointBy = ['semantic', 'gap'];
const voiceTimingEndpointOutcomes = ['complete', 'incomplete', 'unavailable', 'timeout', 'error', 'not-asked'];
const voiceTimingEndpointReasons = ['voice-not-started', 'ffi-context-unloaded', 'scorer-unsupported', 'ram-pressure', 'unscored', 'timeout', 'too-long', 'invalid-response', 'unknown'];
const voiceTimingHeard = ['recorded', 'unchanged', 'not-needed', 'nothing-heard', 'conflict', 'not-found', 'unavailable', 'rejected', 'stale', 'invalid'];
/** The `endpoint` enums of a record, or undefined when the value is not exactly that shape. */
export function voiceTimingEndpoint(value: unknown): VoiceTimingEndpoint | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (!voiceTimingEndpointBy.includes(row.by as string) || !voiceTimingEndpointOutcomes.includes(row.semantic as string)) return undefined;
  if (row.by === 'semantic' && row.semantic !== 'complete') return undefined;
  const out: VoiceTimingEndpoint = { by: row.by as VoiceTimingEndpoint['by'], semantic: row.semantic as VoiceTimingEndpoint['semantic'] };
  if (row.reason !== undefined) { if (!voiceTimingEndpointReasons.includes(row.reason as string)) return undefined; out.reason = row.reason as string; }
  if (row.latencyMs !== undefined) { if (typeof row.latencyMs !== 'number' || !Number.isFinite(row.latencyMs) || row.latencyMs < 0 || row.latencyMs >= 3_600_000) return undefined; out.latencyMs = Math.round(row.latencyMs); }
  return out;
}
const voiceTimingKey = 'alphaphone:voice-timing:v1';
const voiceTimingLimit = 200;
const voiceTimingOrder: VoiceTimingMark[] = ['recording-end', 'transcript-ready', 'send', 'first-token', 'final-reply', 'first-audio'];
const voiceTimingRoutes = ['on-device', 'browser', 'local-agent', 'eliza-cloud', 'paired-agent', 'development-agent', 'manual'];
let voiceTimingActive: { id: string; base: number; entry?: VoiceTimingEntry; native?: string } | undefined;
let voiceTimingClock: () => number = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

function voiceTimingStore(): Storage | undefined { try { return globalThis.localStorage; } catch { return undefined; } }
function voiceTimingValid(value: unknown): value is VoiceTimingRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (row.version !== 1 || typeof row.id !== 'string' || !/^[0-9a-f-]{36}$/.test(row.id) || !Number.isFinite(row.recordedAt) || typeof row.cold !== 'boolean' || !voiceTimingRoutes.includes(row.route as string)) return false;
  if ((row.entry !== undefined && row.entry !== 'conversation' && row.entry !== 'notes') || (row.policy !== undefined && row.policy !== 'auto-send' && row.policy !== 'review')) return false;
  if (!row.marks || typeof row.marks !== 'object' || Array.isArray(row.marks)) return false;
  if (row.live !== undefined && !voiceTimingLive(row.live)) return false;
  if (row.endpoint !== undefined && !voiceTimingEndpoint(row.endpoint)) return false;
  if (row.heard !== undefined && !voiceTimingHeard.includes(row.heard as string)) return false;
  if (row.nativeTurn !== undefined && (typeof row.nativeTurn !== 'string' || !nativeTurnPattern.test(row.nativeTurn))) return false;
  return Object.entries(row.marks as Record<string, unknown>).every(([key, at]) => voiceTimingOrder.includes(key as VoiceTimingMark) && typeof at === 'number' && Number.isFinite(at) && at >= 0 && at < 3_600_000);
}
/** Every stored record that passes validation, oldest first. */
export function voiceTimingRecords(): VoiceTimingRecord[] {
  try { const raw = voiceTimingStore()?.getItem(voiceTimingKey); const parsed = raw ? JSON.parse(raw) : []; return Array.isArray(parsed) ? parsed.filter(voiceTimingValid) : []; }
  catch { return []; }
}
function voiceTimingSave(row: VoiceTimingRecord) {
  try {
    const rows = voiceTimingRecords().filter(item => item.id !== row.id);
    rows.push(row);
    voiceTimingStore()?.setItem(voiceTimingKey, JSON.stringify(rows.slice(-voiceTimingLimit)));
  } catch { /* Timing is diagnostic; it never blocks a voice turn. */ }
}
/** Start a conversation turn at the end of recording. Any unfinished turn is abandoned. */
export function beginVoiceTurn(input: { route: string; cold: boolean; entry?: VoiceTimingEntry; policy?: VoiceSendPolicy }): string | undefined {
  abandonVoiceTurn();
  if (!voiceTimingRoutes.includes(input.route) || typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') return undefined;
  const id = crypto.randomUUID();
  voiceTimingActive = { id, base: voiceTimingClock(), ...(input.entry === 'conversation' || input.entry === 'notes' ? { entry: input.entry } : {}) };
  const source = { ...(input.entry === 'conversation' || input.entry === 'notes' ? { entry: input.entry } : {}), ...(input.policy === 'auto-send' || input.policy === 'review' ? { policy: input.policy } : {}) };
  voiceTimingSave({ version: 1, id, recordedAt: Date.now(), route: input.route, cold: input.cold === true, ...source, marks: { 'recording-end': 0 } });
  return id;
}
/** Record one mark for the active turn (or the named turn while it is still active). */
export function markVoiceTiming(mark: VoiceTimingMark, turn?: string): boolean {
  const active = voiceTimingActive;
  if (!active || (turn !== undefined && turn !== active.id) || !voiceTimingOrder.includes(mark)) return false;
  const row = voiceTimingRecords().find(item => item.id === active.id);
  if (!row || row.outcome || row.marks[mark] !== undefined) return false;
  const at = Math.max(0, Math.round(voiceTimingClock() - active.base));
  const index = voiceTimingOrder.indexOf(mark);
  // Reply and audio marks measure from send; send measures from a ready transcript.
  if (index >= 3 && row.marks.send === undefined) return false;
  if (mark === 'send' && row.marks['transcript-ready'] === undefined) return false;
  if (voiceTimingOrder.slice(0, index).some(prior => (row.marks[prior] ?? -1) > at)) return false;
  row.marks[mark] = at; voiceTimingSave(row);
  forwardNativeStage(mark, active);
  if (mark === 'first-audio') voiceTimingActive = undefined;
  return true;
}
/**
 * Installs (or, with undefined, removes) the native stage reporter. Conversation turns only: Notes
 * dictation is not a voice-assistant latency turn. Diagnostic: a failing sink never affects a turn.
 */
export function setNativeVoiceStageSink(sink: NativeVoiceStageSink | undefined) { nativeVoiceStageSink = sink; }
function forwardNativeStage(mark: VoiceTimingMark, turn: { id: string; entry?: VoiceTimingEntry; native?: string }) {
  const stage = nativeVoiceStages[mark], sink = nativeVoiceStageSink;
  if (!stage || !sink || turn.entry !== 'conversation') return;
  let pending: Promise<string | undefined>;
  try { pending = Promise.resolve(sink(stage, turn.native)); } catch { return; }
  void pending.then(id => {
    if (typeof id !== 'string' || !nativeTurnPattern.test(id) || turn.native !== undefined && turn.native !== id) return;
    turn.native = id;
    const row = voiceTimingRecords().find(item => item.id === turn.id);
    if (row && row.nativeTurn === undefined) { row.nativeTurn = id; voiceTimingSave(row); }
  }).catch(() => { /* Diagnostic only. */ });
}
/** The native latency turn the active conversation turn is linked to, for its reply's synthesis. */
export function nativeVoiceTurnId(): string | undefined { return voiceTimingActive?.native; }
/** Attach live ASR numbers to the active turn (or the named one while it is still active). */
export function recordLiveVoiceTiming(live: unknown, turn?: string): boolean {
  const active = voiceTimingActive, numbers = voiceTimingLive(live);
  if (!active || !numbers || (turn !== undefined && turn !== active.id)) return false;
  const row = voiceTimingRecords().find(item => item.id === active.id);
  if (!row || row.outcome || row.live) return false;
  row.live = numbers; voiceTimingSave(row);
  return true;
}
/** Attach how the active voice-assistant turn was endpointed. Enums and numbers only. */
export function recordEndpointVoiceTiming(endpoint: unknown, turn?: string): boolean {
  const active = voiceTimingActive, value = voiceTimingEndpoint(endpoint);
  if (!active || !value || (turn !== undefined && turn !== active.id)) return false;
  const row = voiceTimingRecords().find(item => item.id === active.id);
  if (!row || row.outcome || row.endpoint) return false;
  row.endpoint = value; voiceTimingSave(row);
  return true;
}
/**
 * Attach the heard-content outcome to a stored turn by id (it may have finished already: an
 * interruption follows the first audio). First outcome wins.
 */
export function recordHeardVoiceTiming(turn: string | undefined, heard: unknown): boolean {
  if (typeof turn !== 'string' || !voiceTimingHeard.includes(heard as string)) return false;
  const row = voiceTimingRecords().find(item => item.id === turn);
  if (!row || row.heard) return false;
  row.heard = heard as HeardOutcome; voiceTimingSave(row);
  return true;
}
/** The turn ended without a reply (cancelled, discarded, typed instead). Kept as abandoned. */
export function abandonVoiceTurn() {
  const active = voiceTimingActive; voiceTimingActive = undefined; if (!active) return;
  const row = voiceTimingRecords().find(item => item.id === active.id);
  if (row && row.marks['final-reply'] === undefined) voiceTimingSave({ ...row, outcome: 'abandoned' });
}
/** Finish the active turn after its final reply when no audio will follow. */
export function finishVoiceTurn(turn?: string) { if (voiceTimingActive && (turn === undefined || turn === voiceTimingActive.id)) voiceTimingActive = undefined; }
export function activeVoiceTurn() { return voiceTimingActive?.id; }
/**
 * The send boundary of one voice entry turn whose transcript is ready. 'auto-send' sends the
 * transcript as it is; 'review' sends only what the user confirms in `review` (resolving null
 * discards it). The send mark is taken at that boundary, so a reviewed turn's review time is
 * recorded between transcript-ready and send. A discarded or failed send abandons the turn.
 * Returns null when nothing was sent.
 */
export function sendVoiceEntry<T>(input: { policy: VoiceSendPolicy; transcript: string; review: (text: string) => Promise<string | null>; send: (text: string) => Promise<T> }): Promise<{ text: string; result: T } | null> { return voiceEntrySend(input); }
async function voiceEntrySend<T>(input: { policy: VoiceSendPolicy; transcript: string; review: (text: string) => Promise<string | null>; send: (text: string) => Promise<T> }): Promise<{ text: string; result: T } | null> {
  // Bound to the turn active now; a later turn is never marked or abandoned by this one.
  const turn = voiceTimingActive?.id, retire = () => { if (turn !== undefined && turn === voiceTimingActive?.id) abandonVoiceTurn(); };
  let text: string | null = input.transcript;
  try { if (input.policy === 'review') text = await input.review(input.transcript); }
  catch (error) { retire(); throw error; }
  text = typeof text === 'string' ? text.trim() : '';
  if (!text) { retire(); return null; }
  if (turn !== undefined) markVoiceTiming('send', turn);
  try { return { text, result: await input.send(text) }; }
  catch (error) { retire(); throw error; }
}
/** JSON export for the latency aggregator. Contains no text or account identifiers. */
export function exportVoiceTiming(): string {
  return JSON.stringify({ format: 'alpha-voice-timing-v1', exportedAt: new Date().toISOString(), marks: voiceTimingOrder, records: voiceTimingRecords() }, null, 2);
}
export function clearVoiceTiming() { voiceTimingActive = undefined; try { voiceTimingStore()?.removeItem(voiceTimingKey); } catch { /* Nothing stored. */ } }
/** Test hook: a deterministic clock. */
export function setVoiceTimingClock(clock: () => number) { voiceTimingClock = clock; }
