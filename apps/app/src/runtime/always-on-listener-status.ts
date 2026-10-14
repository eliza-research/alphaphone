/**
 * Renderer contract for the AOSP image's always-on listener (issue #424). The listener is a
 * separate privileged, network-less package; Alpha only reads its status, pauses it or turns it
 * off, and opens its own consent screen. Nothing here can turn listening on or resume it.
 */
export const LISTENER_STATES = [
  'OFF', 'PERMISSION_REQUIRED', 'NOTIFICATIONS_REQUIRED', 'STOPPED_AFTER_ERRORS', 'PAUSED_OTHER_USER', 'WAITING_FOR_UNLOCK', 'SPEECH_UNAVAILABLE',
  'PAUSED_USER', 'PAUSED_CALL', 'PAUSED_MIC_IN_USE', 'PAUSED_MIC_UNAVAILABLE', 'LISTENING',
] as const;
export type ListenerState = typeof LISTENER_STATES[number];

export type ListenerStatus =
  | { available: false }
  | { available: true; state: ListenerState; label: string; consented: boolean; listening: boolean; microphoneOpen: boolean };

/**
 * How the assistant surface was opened: by the listener's wake phrase, or any other assist entry.
 * 'listener' is reported at most once per launch (the native side consumes it), so a consumer that
 * starts a voice turn on it cannot fire twice. The listener only invokes Alpha while the phone is
 * unlocked; a consumer must still never start capture behind the keyguard.
 */
export type AssistantInvocation = 'listener' | 'assist' | null;

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};

/**
 * Validates the native reply. Anything malformed is reported as unavailable; an unknown state
 * is never presented as listening.
 */
export function parseListenerStatus(raw: unknown): ListenerStatus {
  const value = record(raw);
  if (value.available !== true) return { available: false };
  const state = LISTENER_STATES.find(candidate => candidate === value.state);
  if (!state) return { available: false };
  const label = typeof value.label === 'string' && value.label.length > 0 && value.label.length <= 80 ? value.label : 'Listening off';
  return {
    available: true, state, label,
    consented: value.consented === true,
    // Only the listener's own LISTENING state means audio is being analysed.
    listening: state === 'LISTENING' && value.listening === true,
    microphoneOpen: value.microphoneOpen === true,
  };
}

export function parseAssistantInvocation(raw: unknown): AssistantInvocation {
  const value = record(raw);
  if (value.assistant !== true) return null;
  return value.invocation === 'listener' ? 'listener' : 'assist';
}
