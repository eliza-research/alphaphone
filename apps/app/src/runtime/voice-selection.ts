import { testMocksEnabled } from '../build-flags';
import { browserDevProfile } from '../browser/dev-profile';
import { connectionController } from './connection-ui';

/** Production currently preserves main's Cloud speech policy. Local/manual requests are
 * test-only. Legacy preference storage remains readable for migration, but does not
 * select the production route. This legacy Cloud route must migrate to the mandatory local speech policy P-13/P-29; ongoing chat auto-send is approved by P-39. */
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
  if (!testMocksEnabled) return 'cloud';
  const value = record(read(voiceRouteKey));
  return value && value.version === 1 && value.route === 'cloud' && value.disclosed === 'cloud-speech-uses-credits' && Number.isFinite(value.chosenAt) ? 'cloud' : 'device';
}
/**
 * Persist an explicit route choice. Cloud requires the caller to have shown the Cloud speech
 * disclosure. Returns false when the choice could not be confirmed in storage; the
 * route then stays on-device.
 */
export function chooseVoiceRoute(route: VoiceRouteChoice, disclosure?: { disclosed: 'cloud-speech-uses-credits' }): boolean {
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

/** Explicit local/manual routes are available only in test-mocks builds. */
export function selectVoiceRoute(preference: 'default' | 'device' | 'agent' | 'manual' = 'default'): 'device' | 'cloud' | 'agent' | 'manual' {
  if (testMocksEnabled && (preference === 'device' || preference === 'manual')) return preference;
  return 'cloud';
}
