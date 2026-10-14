import { testMocksEnabled } from '../build-flags';
import { browserDevProfile } from '../browser/dev-profile';
import { connectionController } from './connection-ui';

/** Production speech uses the on-device route (P-13/P-29). An explicit manual
 * recording remains available without speech models or an account. Legacy Cloud
 * preferences are retained for migration but cannot select production speech.
 * Ongoing conversation has a separate adapter and must obey the same policy. */
// Plain constants and function exports only: Node contract tests evaluate this source directly.
const voiceRouteKey = 'alphaphone:voice-route:v1';
const speakRepliesKey = 'alphaphone:speak-replies:v1';
const voicePreferencesEvent = 'alpha:voice-preferences';
/** Storage keys and the change event, for Settings and diagnostics. */
export function voicePreferenceKeys() { return { route: voiceRouteKey, speakReplies: speakRepliesKey, event: voicePreferencesEvent }; }
export type VoiceRouteChoice = 'device' | 'cloud';
export type VoicePreference = 'default' | 'device' | 'agent' | 'manual';

function storage(): Storage | undefined { try { return globalThis.localStorage; } catch { return undefined; } }
function read(key: string): unknown { try { const raw = storage()?.getItem(key); return raw == null ? null : JSON.parse(raw); } catch { return null; } }
function write(key: string, value: object): boolean {
  const text = JSON.stringify(value);
  try { const store = storage(); if (!store) return false; store.setItem(key, text); if (store.getItem(key) !== text) return false; }
  catch { return false; }
  try { if (typeof window !== 'undefined' && typeof Event === 'function') window.dispatchEvent(new Event(voicePreferencesEvent)); } catch { /* Notification is advisory. */ }
  return true;
}
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** The persisted route. Anything but a complete, disclosed Cloud record reads as on-device. */
export function voiceRoutePreference(): VoiceRouteChoice {
  if (!testMocksEnabled) return 'device';
  const value = record(read(voiceRouteKey));
  return value && value.version === 1 && value.route === 'cloud' && value.disclosed === 'cloud-speech-uses-credits' && Number.isFinite(value.chosenAt) ? 'cloud' : 'device';
}
/**
 * Persist an explicit route choice. Cloud requires the caller to have shown the Cloud speech
 * disclosure. Returns false when the choice could not be confirmed in storage; the
 * route then stays on-device.
 */
export function chooseVoiceRoute(route: VoiceRouteChoice, disclosure?: { disclosed: 'cloud-speech-uses-credits' }): boolean {
  if (!testMocksEnabled && route === 'cloud') return false;
  if (route === 'cloud' && disclosure?.disclosed !== 'cloud-speech-uses-credits') return false;
  return write(voiceRouteKey, route === 'cloud' ? { version: 1, route, disclosed: disclosure!.disclosed, chosenAt: Date.now() } : { version: 1, route: 'device', chosenAt: Date.now() });
}
/** Disclosure shown wherever Cloud speech can be chosen. */
export function cloudSpeechDisclosure() { return 'Eliza Cloud speech uploads recordings and reply text to your Cloud account and counts toward your plan allowance.'; }

/** Opt-in: replies to voice-originated turns are read aloud. Off unless explicitly enabled. */
export function speakRepliesEnabled(): boolean { const value = record(read(speakRepliesKey)); return !!value && value.version === 1 && value.enabled === true; }
export function setSpeakReplies(enabled: boolean): boolean { return write(speakRepliesKey, { version: 1, enabled: enabled === true }); }

/** A usable Cloud speech account is signed in for this renderer. */
export function cloudVoiceAvailable(): boolean {
  return !browserDevProfile && connectionController.getCloudEnvironment() !== null && connectionController.getCloudClient() !== null;
}

/** Production never falls back to a network speech provider. Manual recording is explicit. */
export function selectVoiceRoute(preference: 'default' | 'device' | 'agent' | 'manual' = 'default'): 'device' | 'cloud' | 'agent' | 'manual' {
  if (preference === 'manual') return 'manual';
  if (!testMocksEnabled || preference === 'device') return 'device';
  return 'cloud';
}
