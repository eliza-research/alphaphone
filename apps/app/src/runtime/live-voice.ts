/**
 * Live voice: the app process captures the microphone and runs Silero VAD (on Android, through
 * libelizainference in AlphaVoiceCloudPlugin), and the resident agent transcribes the stream on
 * this device with its Phonon-2 streaming decoder (`POST /api/asr/local-inference/live`,
 * elizaOS #36213 / #36214). Nothing here leaves the phone.
 *
 * Wire contract (upstream plugin-local-inference routes/local-inference-asr-live.ts):
 *   request  {sessionId, roomId?, frames?: AudioFrameEvent[], vad?: [{type, timestampMs}], close?}
 *   response {ok, sessionId, mode, framesReceived, final?: {turnId, text, mode, asrFinalFromSpeechEndMs}}
 * Interim text arrives only as ephemeral `voice-transcript` agent events (`agent_event`
 * envelopes on the agent's event socket): speech-start, partial (the full running text, not a
 * delta, with an increasing seq), final, error. Each carries the client's sessionId and the
 * turnId of one VAD segment.
 *
 * Rules kept here:
 *  - Partials are interim display only. They replace the previous interim text, are held in this
 *    closure and never stored, logged, sent as a message or written to a draft.
 *  - Events from another session, or from a turn that is not the current one, are dropped.
 *  - A turn's final is delivered once (it can arrive both in the HTTP response and as an event);
 *    the caller applies the existing voice send policy to it.
 *  - Latency is reported as numbers only.
 *
 * Plain function exports: Node contract tests and the browser spec evaluate this source directly.
 */
export const LIVE_ASR_PATH = '/api/asr/local-inference/live';
export const LIVE_ASR_STATUS_PATH = '/api/asr/local-inference/live/status';
export const LIVE_SAMPLE_RATE = 16000;
const MAX_TEXT = 16000;
const MAX_FRAMES_PER_POST = 64;

export type LiveAudioFrame = { pcm16: string; sampleRate: 16000; channels: 1; samples: number; timestamp: number };
export type LiveVadEdge = { type: 'speech-start' | 'speech-end'; timestampMs: number };
export type LiveMode = 'stream' | 'batch' | 'unknown';
export type LiveFinal = { turnId: string; text: string; mode: LiveMode; asrFinalFromSpeechEndMs: number | null };
/** Numbers only: no text, no identifiers beyond the random turn id the caller already holds. */
export type LiveVoiceLatency = { mode: LiveMode; partials: number; firstPartialMs?: number; finalFromSpeechEndMs?: number; asrFinalFromSpeechEndMs?: number };

export interface LiveVoiceTransport {
  /** One POST to LIVE_ASR_PATH through the owner-authenticated local agent transport. */
  post(body: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  /**
   * The agent's event stream (`agent_event` envelopes), when this transport carries one. The
   * Android agent IPC (port-free, http_request only) carries none, so there the caller shows
   * no interim text and receives the final from the HTTP response.
   */
  subscribe?(listener: (envelope: unknown) => void): () => void;
}

export interface LiveVoiceSessionOptions {
  transport: LiveVoiceTransport;
  roomId?: string;
  now?: () => number;
  /** Replace the interim text ('' clears it). Display only. */
  onInterim?: (text: string) => void;
  onFinal?: (final: LiveFinal, latency: LiveVoiceLatency) => void;
  onError?: (code: 'ASR_FAILED' | 'LIVE_ASR_UNAVAILABLE' | 'TRANSPORT') => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isTurnId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128;
const mode = (value: unknown): LiveMode => (value === 'stream' || value === 'batch' ? value : 'unknown');
const boundedText = (value: unknown): string | undefined => (typeof value === 'string' && value.length <= MAX_TEXT ? value : undefined);
const millis = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 3_600_000 ? Math.round(value) : null);

/** Parse a live-route `final` object. Returns undefined for anything else. */
export function parseLiveFinal(value: unknown): LiveFinal | undefined {
  if (!isRecord(value) || !isTurnId(value.turnId)) return;
  const text = boundedText(value.text);
  if (text === undefined) return;
  return { turnId: value.turnId, text: text.trim(), mode: mode(value.mode), asrFinalFromSpeechEndMs: millis(value.asrFinalFromSpeechEndMs) };
}

type TranscriptEvent =
  | { phase: 'speech-start'; turnId: string }
  | { phase: 'partial'; turnId: string; text: string; seq: number }
  | { phase: 'final'; final: LiveFinal }
  | { phase: 'error'; turnId: string };

/** Accepts only a `voice-transcript` agent_event for `sessionId`; everything else is ignored. */
export function parseVoiceTranscriptEnvelope(envelope: unknown, sessionId: string): TranscriptEvent | undefined {
  if (!isRecord(envelope) || envelope.type !== 'agent_event' || envelope.stream !== 'voice-transcript') return;
  const payload = envelope.payload;
  if (!isRecord(payload) || payload.type !== 'voice-transcript' || payload.sessionId !== sessionId || !isTurnId(payload.turnId)) return;
  switch (payload.phase) {
    case 'speech-start': return { phase: 'speech-start', turnId: payload.turnId };
    case 'partial': {
      const text = boundedText(payload.text);
      if (text === undefined || !Number.isSafeInteger(payload.seq) || (payload.seq as number) < 1) return;
      return { phase: 'partial', turnId: payload.turnId, text, seq: payload.seq as number };
    }
    case 'final': { const final = parseLiveFinal(payload); return final ? { phase: 'final', final } : undefined; }
    case 'error': return { phase: 'error', turnId: payload.turnId };
    default: return;
  }
}

function randomId(): string {
  const value = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  return `alpha-live-${value}`;
}

/**
 * One live session per voice conversation. `push` forwards the app-process frames and VAD edges
 * in order (one request at a time); `endTurn` closes an open segment when the conversation stops
 * listening for its own reasons; `close` finalizes and releases the agent session.
 */
export function createLiveVoiceSession(options: LiveVoiceSessionOptions) {
  const sessionId = randomId();
  const now = options.now ?? (() => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()));
  const controller = new AbortController();
  let chain: Promise<void> = Promise.resolve();
  let disposed = false;
  let current: string | undefined;
  let lastSeq = 0;
  let interim = '';
  const finalized = new Set<string>();
  // Client clock marks for the open utterance (numbers only).
  let speechStartAt: number | undefined, speechEndAt: number | undefined, firstPartialAt: number | undefined, partials = 0, responseMode: LiveMode = 'unknown';
  // A failed turn is reported by its 502 response and, where an event stream exists, also by an error
  // event. Each report from one source cancels one unmatched report from the other.
  const deduplicate = typeof options.transport.subscribe === 'function';
  let eventFailures = 0, responseFailures = 0;
  const failed = (source: 'event' | 'response') => {
    if (deduplicate && source === 'event' && responseFailures > 0) { responseFailures--; return false; }
    if (deduplicate && source === 'response' && eventFailures > 0) { eventFailures--; return false; }
    if (deduplicate) { if (source === 'event') eventFailures++; else responseFailures++; }
    return true;
  };
  const waiting: Array<(final: LiveFinal | null) => void> = [];

  const setInterim = (text: string) => { if (text === interim) return; interim = text; options.onInterim?.(text); };
  const resetTurnMarks = () => { speechStartAt = undefined; speechEndAt = undefined; firstPartialAt = undefined; partials = 0; };
  const deliver = (final: LiveFinal) => {
    if (disposed || finalized.has(final.turnId)) return;
    // A final for an older turn than the one in progress is still that utterance's text; a
    // final never revives a turn once a later one was finalized.
    finalized.add(final.turnId);
    const at = now();
    const latency: LiveVoiceLatency = {
      mode: final.mode !== 'unknown' ? final.mode : responseMode,
      partials,
      ...(firstPartialAt !== undefined && speechStartAt !== undefined ? { firstPartialMs: Math.max(0, Math.round(firstPartialAt - speechStartAt)) } : {}),
      ...(speechEndAt !== undefined ? { finalFromSpeechEndMs: Math.max(0, Math.round(at - speechEndAt)) } : {}),
      ...(final.asrFinalFromSpeechEndMs !== null ? { asrFinalFromSpeechEndMs: final.asrFinalFromSpeechEndMs } : {}),
    };
    if (current === undefined || current === final.turnId) { current = undefined; lastSeq = 0; setInterim(''); }
    resetTurnMarks();
    options.onFinal?.(final, latency);
    for (const resolve of waiting.splice(0)) resolve(final);
  };
  const onEvent = (envelope: unknown) => {
    if (disposed) return;
    const event = parseVoiceTranscriptEnvelope(envelope, sessionId);
    if (!event) return;
    if (event.phase === 'final') { deliver(event.final); return; }
    if (finalized.has(event.turnId)) return; // a finished turn's late event
    if (event.phase === 'speech-start') { current = event.turnId; lastSeq = 0; setInterim(''); return; }
    if (current === undefined) { current = event.turnId; lastSeq = 0; } // the speech-start event was missed
    if (event.turnId !== current) return; // stale turn
    if (event.phase === 'partial') {
      if (event.seq <= lastSeq) return;
      lastSeq = event.seq; partials++;
      if (firstPartialAt === undefined) firstPartialAt = now();
      setInterim(event.text);
      return;
    }
    // error: the turn produced no transcript.
    current = undefined; lastSeq = 0; setInterim(''); resetTurnMarks();
    if (!failed('event')) return;
    options.onError?.('ASR_FAILED');
    for (const resolve of waiting.splice(0)) resolve(null);
  };
  const unsubscribe = options.transport.subscribe?.(onEvent);

  const send = (body: Record<string, unknown>) => {
    const run = async () => {
      if (disposed) return;
      let response: unknown;
      try { response = await options.transport.post({ sessionId, ...(options.roomId ? { roomId: options.roomId } : {}), ...body }, controller.signal); }
      catch (error) {
        if (disposed || controller.signal.aborted) return;
        const status = (error as { status?: unknown })?.status;
        // 502 with code ASR_FAILED is the route's per-turn failure: that segment has no transcript.
        if (status === 502 && (error as { data?: { code?: unknown } })?.data?.code === 'ASR_FAILED') {
          current = undefined; lastSeq = 0; setInterim(''); resetTurnMarks();
          if (failed('response')) options.onError?.('ASR_FAILED');
          for (const resolve of waiting.splice(0)) resolve(null);
          return;
        }
        options.onError?.(status === 503 || status === 429 ? 'LIVE_ASR_UNAVAILABLE' : 'TRANSPORT');
        for (const resolve of waiting.splice(0)) resolve(null);
        return;
      }
      if (disposed || !isRecord(response)) return;
      responseMode = mode(response.mode);
      const final = parseLiveFinal(response.final);
      if (final) deliver(final);
    };
    const next = chain.then(run, run);
    chain = next.catch(() => {});
    return next;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true; controller.abort(); unsubscribe?.(); setInterim(''); current = undefined;
    for (const resolve of waiting.splice(0)) resolve(null);
  };

  return {
    sessionId,
    /** Interim text currently shown ('' when none). */
    interim: () => interim,
    /** Forward app-process frames (16 kHz mono s16, base64) and the VAD edges for that audio. */
    push(frames: readonly LiveAudioFrame[], vad: readonly LiveVadEdge[] = []) {
      if (disposed) return Promise.resolve();
      const at = now();
      for (const edge of vad) {
        if (edge.type === 'speech-start') { resetTurnMarks(); speechStartAt = at; }
        else speechEndAt = at;
      }
      const posts: Promise<void>[] = [];
      for (let index = 0; index < Math.max(1, frames.length); index += MAX_FRAMES_PER_POST) {
        const slice = frames.slice(index, index + MAX_FRAMES_PER_POST);
        const first = index === 0, last = index + MAX_FRAMES_PER_POST >= frames.length;
        // speech-start rides with the first slice, speech-end with the last (the route applies
        // start edges, then frames, then end edges within one request).
        const edges = vad.filter(edge => (edge.type === 'speech-start' && first) || (edge.type === 'speech-end' && last));
        if (!slice.length && !edges.length) continue;
        posts.push(send({ ...(slice.length ? { frames: slice } : {}), ...(edges.length ? { vad: edges } : {}) }));
      }
      return Promise.all(posts).then(() => {});
    },
    /** Resolves with the next delivered final (or null on a turn error / transport failure). */
    nextFinal(signal?: AbortSignal): Promise<LiveFinal | null> {
      if (disposed) return Promise.resolve(null);
      return new Promise((resolve, reject) => {
        const settle = (value: LiveFinal | null) => { signal?.removeEventListener('abort', abort); resolve(value); };
        const abort = () => { const index = waiting.indexOf(settle); if (index >= 0) waiting.splice(index, 1); reject(signal?.reason ?? new DOMException('Live voice cancelled', 'AbortError')); };
        if (signal?.aborted) { abort(); return; }
        signal?.addEventListener('abort', abort, { once: true });
        waiting.push(settle);
      });
    },
    /** Close the open segment now (the conversation decided the user finished). */
    endTurn(atMs?: number) { speechEndAt ??= now(); return send({ vad: [{ type: 'speech-end', timestampMs: Number.isFinite(atMs) ? atMs! : Date.now() }] }); },
    /** Finalize any open segment and release the agent session. */
    async close() {
      if (disposed) return;
      try { await send({ close: true }); } finally { dispose(); }
    },
    dispose,
  };
}

/** `agent_event` envelopes from an agent event WebSocket (`/ws`), for transports that have one. */
export function webSocketAgentEvents(open: () => WebSocket): (listener: (envelope: unknown) => void) => () => void {
  return listener => {
    const socket = open();
    const message = (event: MessageEvent) => {
      if (typeof event.data !== 'string' || event.data.length > 64 * 1024) return;
      try { listener(JSON.parse(event.data)); } catch { /* Not an event frame. */ }
    };
    socket.addEventListener('message', message);
    return () => { socket.removeEventListener('message', message); try { socket.close(); } catch { /* Already closed. */ } };
  };
}

/** Encode Float32 PCM in [-1, 1] as one 16 kHz mono s16 base64 frame (the AudioFrameEvent wire format). */
export function encodeLiveFrame(samples: Float32Array, timestamp: number): LiveAudioFrame {
  const bytes = new Uint8Array(samples.length * 2);
  for (let index = 0; index < samples.length; index++) {
    const value = Math.max(-1, Math.min(1, samples[index] || 0));
    const int = Math.round(value < 0 ? value * 32768 : value * 32767);
    bytes[index * 2] = int & 0xff; bytes[index * 2 + 1] = (int >> 8) & 0xff;
  }
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return { pcm16: btoa(binary), sampleRate: LIVE_SAMPLE_RATE, channels: 1, samples: samples.length, timestamp };
}
