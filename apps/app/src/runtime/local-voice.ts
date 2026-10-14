import { planLocalSpeech } from './local-speech-text';
import { speakLocalText } from '../local-speech-playback';
import { registerPlugin } from '../platform-plugins';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { connectionController } from './connection-ui';
const native = registerPlugin<{
  localSpeechStatus(input: { requestId: string }): Promise<{ ready: boolean; execution: string }>;
  transcribeLocalRecording(input: { recordingId: string; requestId: string }): Promise<LocalTranscript>;
  addListener(event: 'speechProgress', callback: (event: SpeechProgressEvent) => void): Promise<PluginListenerHandle>;
  releaseLocalSpeech(): Promise<void>;
  cancel(input: { requestId: string }): Promise<void>;
}>('AlphaVoiceCloud');
/** Provenance reported with a transcript. The browser build reports its Whisper engine and model. */
export type LocalTranscript = { text: string; local: true; execution: string; route?: string; engine?: string; model?: string; modelRevision?: string; runtime?: string; language?: string };
export type SpeechProgressEvent = { requestId?: string; phase: 'download'; loaded: number; total: number } | { requestId?: string; phase: 'initialize' | 'transcribe' };
let releaseWatcherInstalled = false;
function installReleaseWatcher() {
  if (releaseWatcherInstalled) return;
  releaseWatcherInstalled = true;
  const binding = () => [connectionController.getSnapshot().session?.sessionId, connectionController.getCloudClient()?.sessionId, document.documentElement.dataset.connectionMode].join(':');
  let previous = binding();
  const releaseChangedBinding = () => {
    const current = binding();
    if (current !== previous) { previous = current; void native.releaseLocalSpeech().catch(() => {}); }
  };
  connectionController.subscribe(releaseChangedBinding);
  if (typeof MutationObserver !== 'undefined') new MutationObserver(releaseChangedBinding).observe(document.documentElement, { attributes: true, attributeFilter: ['data-connection-mode'] });
}
/** On-device CPU speech. No origin, credential, provider API, or HTTP fallback. */
export function createOnDeviceVoice() {
  if (!Capacitor.isPluginAvailable('AlphaVoiceCloud') || document.documentElement.dataset.connectionMode === 'mock') return null;
  installReleaseWatcher();
  const binding = () => [connectionController.getSnapshot().session?.sessionId, connectionController.getCloudClient()?.sessionId, document.documentElement.dataset.connectionMode].join(':');
  const selected = binding();
  const check = () => {
    if (document.hidden || document.documentElement.dataset.connectionMode === 'mock' || connectionController.getSnapshot().open || selected !== binding()) throw new DOMException('Voice selection changed', 'AbortError');
  };
  async function operation<T>(signal: AbortSignal, run: (id: string, interrupted: Promise<never>, ownedSignal: AbortSignal) => Promise<T>): Promise<T> {
    check(); signal.throwIfAborted();
    const owned = new AbortController(); const id = crypto.randomUUID(); let reject!: (reason: unknown) => void;
    const interrupted = new Promise<never>((_, fail) => { reject = fail; }); void interrupted.catch(() => {});
    const cancel = () => { void native.cancel({ requestId: id }).catch(() => {}); owned.abort(new DOMException('Voice cancelled', 'AbortError')); reject(owned.signal.reason); };
    const unsubscribe = connectionController.subscribe(() => { try { check(); } catch { cancel(); } });
    const modeChanged = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(() => { try { check(); } catch { cancel(); } });
    modeChanged?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-connection-mode'] });
    const visibility = () => { if (document.hidden) cancel(); };
    signal.addEventListener('abort', cancel, { once: true }); document.addEventListener('visibilitychange', visibility);
    try { const result = await run(id, interrupted, owned.signal); check(); signal.throwIfAborted(); return result; }
    finally { modeChanged?.disconnect(); signal.removeEventListener('abort', cancel); document.removeEventListener('visibilitychange', visibility); unsubscribe(); }
  }
  return {
    async ready(signal: AbortSignal) { return operation(signal, async (requestId, interrupted) => { const result = await Promise.race([native.localSpeechStatus({ requestId }), interrupted]); return result.ready === true && result.execution === (Capacitor.isNativePlatform()?'device':'browser'); }); },
    async transcribe(recordingId: string, signal: AbortSignal, progress?: (event: SpeechProgressEvent) => void) { return operation(signal, async (requestId, interrupted) => {
      // Progress is advisory and bound to this request; a missing listener never blocks transcription.
      let handle: PluginListenerHandle | undefined, closed = false;
      if (progress) void native.addListener('speechProgress', event => { if (!closed && event?.requestId === requestId) progress(event); }).then(value => { if (closed) void value.remove(); else handle = value; }, () => {});
      try {
        const result = await Promise.race([native.transcribeLocalRecording({ recordingId, requestId }), interrupted]);
        if (result.execution !== (Capacitor.isNativePlatform()?'device':'browser') || result.local !== true || typeof result.text !== 'string' || !result.text.trim()) throw new Error('No usable on-device transcript');
        return result;
      } finally { closed = true; void handle?.remove(); }
    }); },
    async speak(text: string, signal: AbortSignal) {
      const chunks = planLocalSpeech(text);
      return operation(signal, async (_requestId, interrupted, ownedSignal) => {
        for (const chunk of chunks) {
          check(); ownedSignal.throwIfAborted();
          // The owned signal cancels playback. Await its native drain rather than
          // racing it with an early cancellation result that could admit new audio.
          await speakLocalText(chunk, ownedSignal, undefined, false, {execution:Capacitor.isNativePlatform()?'device':'browser',assertCurrent:check});
        }
      });
    },
  };
}
