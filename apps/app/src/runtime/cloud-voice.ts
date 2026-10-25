import { playOwnedSpeech } from '../local-speech-playback';
import { registerPlugin } from '../platform-plugins';
import { type PluginListenerHandle } from '@capacitor/core';
import { connectionController } from './connection-ui';

export type VoiceClip = { recordingId: string; durationMs: number };
const native = registerPlugin<{
  startRecording(): Promise<{ recordingId: string; maxDurationMs: number }>;
  stopRecording(): Promise<VoiceClip>;
  cancelRecording(): Promise<void>;
  transcribeRecording(input: { recordingId: string; requestId: string; environment: string; credentialId: string }): Promise<{ text: string; local: false }>;
  synthesize(input: { text: string; requestId: string; environment: string; credentialId: string }): Promise<{ playbackId: string }>;
  play(input: { playbackId: string }): Promise<void>;
  stopPlayback(input?: { requestId: string }): Promise<void>;
  cancel(input: { requestId: string }): Promise<void>;
  addListener(event: 'recordingStopped', callback: (clip: VoiceClip) => void): Promise<PluginListenerHandle>;
  addListener(event: 'playbackEnded' | 'playbackFailed' | 'playbackStopped', callback: (event: { playbackId?: string }) => void): Promise<PluginListenerHandle>;
}>('AlphaVoiceCloud');

/** Binds all audio to the explicitly selected account. Native code owns the
 * private recording, bearer credential, upload and decoded playback file. */
export function createCloudVoice() {
  const environment = connectionController.getCloudEnvironment();
  const binding = connectionController.getCloudClient();
  const sessionId = binding?.sessionId, credentialId = binding?.credentialId;
  if (!environment || !sessionId || !credentialId) throw new Error('Sign in to Alpha Phone to use Cloud voice.');
  const check = () => {
    if (environment !== connectionController.getCloudEnvironment() || sessionId !== connectionController.getCloudClient()?.sessionId || credentialId !== connectionController.getCloudClient()?.credentialId) throw new DOMException('Voice account changed', 'AbortError');
  };
  return {
    cloud: true as const,
    async startRecording() { check(); const result = await native.startRecording(); check(); return result; },
    async stopRecording() { check(); const result = await native.stopRecording(); check(); return result; },
    async transcribeRecording(input: { recordingId: string; requestId: string }) {
      check(); const result = await native.transcribeRecording({ ...input, environment, credentialId }); check();
      if (typeof result.text !== 'string' || !result.text.trim() || result.local !== false) throw new Error('Eliza Cloud returned no usable transcript.');
      return result;
    },
    cancel: (input: { requestId: string }) => native.cancel(input),
    async cancelRecording() { await native.cancelRecording(); },
    addListener: (event: 'recordingStopped', callback: (clip: VoiceClip) => void) => native.addListener(event, value => {
      try { check(); callback(value); } catch { /* Stale account events never update the new account. */ }
    }),
    async speak(text: string, signal: AbortSignal) {
      check();signal.throwIfAborted();const owned=new AbortController(),cancel=()=>owned.abort(signal.reason),current=()=>{check();if(document.hidden||connectionController.getSnapshot().open)throw new DOMException('Voice review changed','AbortError');};
      const changed=()=>{try{current();}catch(error){owned.abort(error);}};
      const unsubscribe=connectionController.subscribe(changed);document.addEventListener('visibilitychange',changed);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
      try{await playOwnedSpeech(native,owned.signal,requestId=>native.synthesize({text,requestId,environment,credentialId}),current);}
      finally{unsubscribe();document.removeEventListener('visibilitychange',changed);signal.removeEventListener('abort',cancel);}
    },
  };
}
