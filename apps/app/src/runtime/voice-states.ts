/** Pure recorder state helpers: failure classification and transcript provenance. */
export type VoiceFailure = 'denied' | 'no-microphone' | 'no-speech' | 'local-agent' | 'recognition';
export type TranscriptProvenance = { route: string; engine?: string; model?: string; modelRevision?: string; runtime?: string; language?: string };
type Reason = { name?: unknown; code?: unknown } | null | undefined;

/** Failures with their own state. Cancellation is never reported as a failure here. */
export function voiceFailure(reason: unknown, transcribing: boolean): VoiceFailure | null {
  const value = (reason && typeof reason === 'object' ? reason : undefined) as Reason;
  const name = typeof value?.name === 'string' ? value.name : '', code = typeof value?.code === 'string' ? value.code : '';
  if (name === 'AbortError') return null;
  // Android's AlphaVoiceCloud rejects a refused RECORD_AUDIO request with code 'permission-denied'.
  if (!transcribing && (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError' || code === 'permission-denied')) return 'denied';
  if (!transcribing && (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError')) return 'no-microphone';
  if (code === 'no-speech') return 'no-speech';
  // The web build has no in-browser recognizer; local speech needs the local agent (libelizainference).
  if (code === 'local-agent-required' || code === 'local-agent-starting') return 'local-agent';
  if (code === 'recognition-failed') return 'recognition';
  return null;
}

/** The recorder's recovery control for a refused microphone: the phone's app settings. A browser has none. */
export const DENIED_SETTINGS_LABEL = 'Open app settings';
export function deniedSettingsChoice(input: { failure: string; stage: string; busy: boolean; native: boolean }): boolean {
  return input.native && input.failure === 'denied' && input.stage === 'ready' && !input.busy;
}

const field = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : undefined;
/** Where a transcript came from. Only fields reported by the engine are recorded, never guessed. */
export function transcriptProvenance(result: Record<string, unknown>, route: { onDevice: boolean; native: boolean; paired: boolean; cloud: boolean }): TranscriptProvenance {
  const reported = field(result.route);
  const name = route.cloud ? 'eliza-cloud' : route.paired ? 'paired-agent' : route.onDevice ? (route.native ? 'on-device' : reported || 'browser') : 'development-agent';
  const provenance: TranscriptProvenance = { route: name };
  for (const key of ['engine', 'model', 'modelRevision', 'runtime', 'language'] as const) { const value = field(result[key]); if (value) provenance[key] = value; }
  return provenance;
}
