import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { registerPlugin } from '../platform-plugins';
import { connectionController } from './connection-ui';
import { createLiveDictation, LIVE_ASR_PATH, LIVE_ASR_STATUS_PATH, liveAssistantListener, type LiveAudioFrame, type LiveCaptureOpenOptions, type LiveCaptureStream, type LiveVadEdge, type LiveVoiceLatency, type LiveVoiceTransport } from './live-voice';
import { createLiveSegmentStream } from './live-segment-stream';
import {openNativeResidentCapture, type NativeResidentPort} from './native-resident-capture';

/**
 * Continuous native live capture (AlphaVoiceCloud: app-process microphone with Silero VAD) feeding
 * the resident agent's on-device streaming ASR. Two consumers:
 *
 *  - the voice assistant (voice-assistant.ts) keeps one capture open for the conversation, with
 *    platform echo cancellation so the user can interrupt a spoken reply;
 *  - live dictation (Transcribe) records until Stop and returns exactly the audio up to Stop.
 *
 * Only VAD segment audio leaves the app process, and only to the on-device agent of the owner who
 * started the capture: the transport refuses every request once the resident session changed.
 * Nothing is stored or logged. Interim partials appear only when the agent transport carries an
 * event stream; Android uses an ephemeral voice-only feed bound to the resident owner.
 */
type FramesEvent = { captureId?: unknown; frames?: unknown; vad?: unknown; peak?: unknown };
type EndedEvent = { captureId?: unknown; error?: unknown };
const plugin = registerPlugin<{
  liveCaptureStatus(): Promise<{ available?: unknown; nativeTransport?: unknown }>;
  startLiveCapture(input: { captureId: string; echoCancel?: boolean }): Promise<{ captureId?: unknown; sampleRate?: unknown; echoCancelled?: unknown }>;
  stopLiveCapture(input: { captureId: string }): Promise<{ captureId?: unknown; durationMs?: unknown }>;
  addListener(event: 'liveCaptureFrames', callback: (event: FramesEvent) => void): Promise<PluginListenerHandle>;
  addListener(event: 'liveCaptureEnded', callback: (event: EndedEvent) => void): Promise<PluginListenerHandle>;
}>('AlphaVoiceCloud');

const isFrame = (value: unknown): value is LiveAudioFrame => {
  const row = value as Partial<LiveAudioFrame> | null;
  return !!row && typeof row.pcm16 === 'string' && row.pcm16.length <= 64 * 1024 && row.sampleRate === 16000 && row.channels === 1 && Number.isSafeInteger(row.samples) && (row.samples as number) > 0 && Number.isFinite(row.timestamp);
};
const isEdge = (value: unknown): value is LiveVadEdge => {
  const row = value as Partial<LiveVadEdge> | null;
  return !!row && (row.type === 'speech-start' || row.type === 'speech-end') && Number.isFinite(row.timestampMs);
};

/** The live route is usable: the native capture with VAD is present and the agent reports a streaming loader. */
export async function nativeLiveVoiceReady(signal: AbortSignal): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('AlphaVoiceCloud')) return false;
  const resident = connectionController.getResidentLiveVoice();
  if (!resident) return false;
  try {
    const status = await plugin.liveCaptureStatus();
    signal.throwIfAborted();
    if (status?.available !== true) return false;
    const agent = await resident.request(LIVE_ASR_STATUS_PATH, undefined, signal) as { ready?: unknown } | null;
    signal.throwIfAborted();
    return agent?.ready === true;
  } catch (error) {
    if (signal.aborted) throw error;
    return false;
  }
}

/**
 * The live ASR transport of the current owner's resident agent, or null. Requests after the
 * resident session changed are refused, so audio never reaches another owner's agent. When the
 * resident connection exposes an agent event stream (`subscribe`), interim partials flow through it.
 */
export function residentLiveTransport(): LiveVoiceTransport | null {
  const resident = connectionController.getResidentLiveVoice();
  if (!resident) return null;
  const owner = resident.sessionId;
  const same = () => connectionController.getResidentLiveVoice()?.sessionId === owner;
  return {
    post: (body, signal) => same() ? resident.request(LIVE_ASR_PATH, body, signal) : Promise.reject(Object.assign(Error('The agent session changed.'), { status: 409 })),
    ...(typeof resident.subscribe === 'function' ? { subscribe: (listener: (envelope: unknown) => void) => resident.subscribe!(envelope => { if (same()) listener(envelope); }) } : {}),
  };
}

export type NativeLiveStream = Awaited<ReturnType<typeof openNativeLiveStream>>;
/** Opens one native capture and its agent live session. */
export async function openNativeLiveStream(input: LiveCaptureOpenOptions): Promise<LiveCaptureStream> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('AlphaVoiceCloud')) throw Error('Live voice is unavailable.');
  input.signal.throwIfAborted();
  const transport = residentLiveTransport();
  if (!transport) throw Error('The on-device agent is not connected.');
  const capability=await plugin.liveCaptureStatus?.();
  input.signal.throwIfAborted();
  if(capability?.nativeTransport===true){
    const owner=connectionController.getResidentReadingBinding();
    if(!owner)throw Error('The on-device agent is not connected.');
    const resident=connectionController.getResidentLiveVoice();
    return openNativeResidentCapture(plugin as unknown as NativeResidentPort,{
      ...input,ownerId:owner.ownerId,
      current:()=>{const now=connectionController.getResidentReadingBinding();return now?.ownerId===owner.ownerId&&now.sessionId===owner.sessionId;},
      subscribe:resident?.subscribe,
    });
  }
  // Compatibility with an older native package: PCM still crosses the renderer on this path.
  let accepting = true, stopping = false, lost = false;
  const lose = (error: unknown) => { if (stopping || lost) return; lost = true; input.onLost(error); };
  const stream = createLiveSegmentStream({
    transport, ...(input.roomId ? { roomId: input.roomId } : {}),
    onSpeechStart: at => input.onSpeechStart?.(at),
    onSpeechEnd: at => input.onSpeechEnd?.(at),
    onSegment: (text, latency) => input.onSegment(text, latency),
    onInterim: text => input.onInterim?.(text),
    onFatal: code => lose(Object.assign(Error('On-device transcription is unavailable.'), { code: 'live-asr', reason: code })),
  });
  const captureId = crypto.randomUUID();
  const handles: PluginListenerHandle[] = [];
  let ended!: () => void;
  const endedPromise = new Promise<void>(resolve => { ended = resolve; });
  const detach = () => Promise.all(handles.splice(0).map(handle => handle.remove().catch(() => {})));
  try {
  handles.push(await plugin.addListener('liveCaptureFrames', event => {
    if (!accepting || event?.captureId !== captureId) return;
    const frames = Array.isArray(event.frames) ? event.frames.filter(isFrame) : [];
    const vad = Array.isArray(event.vad) ? event.vad.filter(isEdge) : [];
    if (typeof event.peak === 'number' && Number.isFinite(event.peak)) input.onLevel?.(Math.max(0, Math.min(1, event.peak)));
    void stream.accept(frames, vad);
  }));
  handles.push(await plugin.addListener('liveCaptureEnded', event => {
    if (event?.captureId !== captureId) return;
    ended();
    if (!stopping) { accepting = false; lose(Object.assign(Error('The microphone stopped.'), { code: 'capture', ...(typeof event.error === 'string' ? { reason: event.error } : {}) })); }
  }));
  } catch (error) { stream.cancel(); await detach(); throw error; }
  let stopped: Promise<void> | undefined;
  const stopNative = () => stopped ??= (async () => {
    stopping = true;
    try { await plugin.stopLiveCapture({ captureId }); } catch { /* Already stopped. */ }
    // The native thread flushes its last frames before it reports the end (its stop waits up to 1.5 s).
    await Promise.race([endedPromise, new Promise(resolve => setTimeout(resolve, 2000))]);
    accepting = false;
    await detach();
  })();
  const abort = () => { stream.cancel(); void stopNative(); };
  let echoCancelled = false;
  try {
    input.signal.throwIfAborted();
    input.signal.addEventListener('abort', abort, { once: true });
    const result = await plugin.startLiveCapture({ captureId, echoCancel: input.echoCancel });
    if (result?.captureId !== captureId || result.sampleRate !== 16000) throw Error('Live capture identity changed.');
    echoCancelled = input.echoCancel && result.echoCancelled === true;
    input.signal.throwIfAborted();
  } catch (error) { input.signal.removeEventListener('abort', abort); stream.cancel(); await stopNative(); throw error; }
  const startedAt = Date.now();
  return {
    startedAt,
    /** The platform echo canceller is active on this capture. */
    echoCancelled,
    speaking: () => stream.speaking(),
    /** Stop now and finalize: results for audio up to this moment arrive before this resolves. */
    async close(at = Date.now()) {
      input.signal.removeEventListener('abort', abort);
      stream.cutoff(at);
      await stopNative();
      await stream.close();
      return { durationMs: Math.max(0, at - startedAt) };
    },
    /** Stop now and discard. */
    async cancel() {
      input.signal.removeEventListener('abort', abort);
      stream.cancel();
      await stopNative();
    },
  };
}

/** The voice assistant's listen port over the native capture (echo-cancelled; shared `liveAssistantListener`). */
export function nativeAssistantListener(options: { roomId?: string; onInterim?: (text: string) => void; onLatency?: (latency: LiveVoiceLatency) => void } = {}) {
  return liveAssistantListener(openNativeLiveStream, options);
}

/**
 * Transcribe (dictation) over the native live capture, the shared `createLiveDictation`: Stop
 * finalizes exactly the audio up to Stop and the text only ever becomes an editable draft.
 */
export function createNativeLiveDictation(options: { roomId?: string; onInterim?: (text: string) => void; onLatency?: (latency: LiveVoiceLatency) => void; maxDurationMs?: number } = {}) {
  return createLiveDictation(openNativeLiveStream, options);
}
export type NativeLiveDictation = ReturnType<typeof createNativeLiveDictation>;
