import {markTtsPlaybackStarted,markTtsPlaybackEnded} from '../../../../.eliza/client-features/packages/ui/src/voice/tts-playback-activity.ts';
import { playOwnedSpeech } from '../local-speech-playback';
import { registerPlugin } from '../platform-plugins';
import { type PluginListenerHandle } from '@capacitor/core';
import { connectionController } from './connection-ui';

/** Native status codes retain recovery meaning without exposing a provider response body. */
export function cloudVoiceFailure(error: unknown): string | null {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === 'voice-http-401' || code === 'voice-http-403') return 'Sign in to Eliza Cloud again in Settings, then retry voice.';
  if (code === 'voice-http-402') return 'Eliza Cloud declined cloud voice for your account\'s billing. Check your account in Settings, then retry.';
  return null;
}

export type VoiceClip = { recordingId: string; durationMs: number };
const native = registerPlugin<{
  startRecording(): Promise<{ recordingId: string; maxDurationMs: number }>;
  stopRecording(): Promise<VoiceClip>;
  getRecordingMetrics(input:{recordingId:string}):Promise<{recordingId:string;peak:number;rms?:number}>;
  cancelRecording(): Promise<void>;
  transcribeRecording(input: { recordingId: string; requestId: string; environment: string; credentialId: string }): Promise<{ text: string; local: false }>;
  synthesize(input: { text: string; requestId: string; environment: string; credentialId: string; replace?:boolean }): Promise<{ playbackId: string }>;
  play(input: { playbackId: string;replace?:boolean }): Promise<void>;
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
  if (!environment || !sessionId || !credentialId) throw new Error('Sign in to Eliza Cloud to use Cloud voice.');
  const check = () => {
    if (environment !== connectionController.getCloudEnvironment() || sessionId !== connectionController.getCloudClient()?.sessionId || credentialId !== connectionController.getCloudClient()?.credentialId) throw new DOMException('Voice account changed', 'AbortError');
  };
  return {
    cloud: true as const,
    async startRecording() { check(); const result = await native.startRecording(); check(); return result; },
    async getRecordingMetrics(recordingId:string){check();const value=await native.getRecordingMetrics({recordingId});check();if(value.recordingId!==recordingId||!Number.isFinite(value.peak)||value.peak<0||value.peak>1||(value.rms!==undefined&&(!Number.isFinite(value.rms)||value.rms<0||value.rms>1)))throw Error('Recording metrics were not verified.');return value;},
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
    async speak(text: string, signal: AbortSignal,onStarted?:()=>void,queue=false,assertCurrent?:()=>void) {
      check();signal.throwIfAborted();const owned=new AbortController(),cancel=()=>owned.abort(signal.reason),current=()=>{check();assertCurrent?.();if(document.hidden||connectionController.getSnapshot().open)throw new DOMException('Voice review changed','AbortError');};
      const changed=()=>{try{current();}catch(error){owned.abort(error);}};
      const unsubscribe=connectionController.subscribe(changed);document.addEventListener('visibilitychange',changed);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
      let marked=false;
      try{await playOwnedSpeech(native,owned.signal,requestId=>native.synthesize({text,requestId,environment,credentialId,...(queue?{replace:false}:{})}),current,()=>{current();if(onStarted)onStarted();else{marked=true;markTtsPlaybackStarted();}},true,queue);}
      finally{if(marked)markTtsPlaybackEnded();unsubscribe();document.removeEventListener('visibilitychange',changed);signal.removeEventListener('abort',cancel);}
    },
  };
}
