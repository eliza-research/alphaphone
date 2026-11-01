import type {AssistantCapture, AssistantListenHandlers} from './voice-assistant';

type EchoContext = {recentAgentReply: string; replyAgeMs: number; agentSpeaking: boolean};
/** One played cue: its model text, whether its audio started, and when its playback settled. */
type Cue = {text: string; audible: boolean; settledAt?: number};
type Segment = {held?: Cue; drop?: boolean; echoOf?: Cue; at: number; end?: number; result?: {text: string | null}; started?: boolean; ended?: boolean};

/** Over an echo-cancelled capture, speech that starts this soon after an audible cue settles is
 * held as if it started in the cue: residual echo of the cue's last words, and a speech start
 * reported after the audio ended (the native VAD, or Cloud's endpointing over the socket), arrive
 * after the playback has settled. */
export const CUE_TAIL_MS = 1500;

/**
 * The spoken model acknowledgement (createBatchProgressAcknowledgment) on the live voice paths:
 * streaming Cloud speech and on-device live ASR. Their one capture stays open for barge-in, so
 * VoiceAssistantSession would take the cue's own echo as held speech and interrupt its turn by
 * time (700 ms), or send it as the next turn. The capture treats the cue's audio as playback, as
 * the session treats a reply:
 *  - over an echo-cancelled capture, speech that starts from the cue's first audio until
 *    CUE_TAIL_MS after its playback settles is held, and reaches the session only when its
 *    transcript passes the echo gate against the cue: the cue's echo never interrupts by time and
 *    is never sent, and real speech interrupts by its transcript;
 *  - over a capture without echo cancellation, speech that starts while the cue's audio plays is
 *    ignored, as during a reply;
 *  - other speech (before the cue's first audio, or after it) reaches the session at once, as
 *    without a cue, and its transcript is still checked against the cue for the session's echo
 *    window (ECHO_WINDOW_MS from the cue's settle), as the session checks one against a reply.
 * Segments reach the session in capture order. A cue never starts while the user is speaking or
 * another cue plays (it is dropped: silence). The cue is never reply text, heard or unheard.
 */
export function createLiveCueGate(echoGate: (text: string, context: EchoContext) => boolean) {
  let playing: Cue | undefined, last: Cue | undefined;
  let active: Segment[] = [];
  const echo = (cue: Cue): EchoContext => ({
    recentAgentReply: cue.audible ? cue.text : '',
    replyAgeMs: cue.settledAt === undefined ? 0 : Math.max(0, Date.now() - cue.settledAt),
    agentSpeaking: cue.audible && cue.settledAt === undefined,
  });
  return {
    /** Plays one cue; `speak` reports its first audio through `onStarted`. */
    async play(text: string, speak: (onStarted: () => void) => Promise<void>): Promise<void> {
      if (playing || active.some(segment => segment.end === undefined)) return;
      const cue: Cue = {text, audible: false};
      playing = cue;
      try { await speak(() => { cue.audible = true; }); }
      finally {
        playing = undefined; cue.settledAt = Date.now();
        if (cue.audible) last = cue;
      }
    },
    listen(listen: (handlers: AssistantListenHandlers) => Promise<AssistantCapture>) {
      return async (handlers: AssistantListenHandlers): Promise<AssistantCapture> => {
        const segments: Segment[] = [];
        let fullDuplex = false;
        active = segments;
        const pass = () => {
          for (let index = 0; index < segments.length;) {
            const segment = segments[index];
            if (segment.drop) {
              if (segment.result) segments.splice(index, 1); else index++;
              continue;
            }
            if (segment.held) {
              // Held until its transcript; later speech waits so the session keeps capture order.
              if (!segment.result) return;
              segments.splice(index, 1);
              const text = segment.result.text;
              if (text && echoGate(text, echo(segment.held))) {
                handlers.onSpeechStart(segment.at); handlers.onSpeechEnd(segment.end!); handlers.onSegment(text);
              }
              continue;
            }
            if (!segment.started) { segment.started = true; handlers.onSpeechStart(segment.at); }
            if (segment.end !== undefined && !segment.ended) { segment.ended = true; handlers.onSpeechEnd(segment.end); }
            if (!segment.result) { index++; continue; }
            segments.splice(index, 1);
            const text = segment.result.text;
            handlers.onSegment(text && segment.echoOf && !echoGate(text, echo(segment.echoOf)) ? null : text);
          }
        };
        const capture = await listen({
          ...handlers,
          onSpeechStart: at => {
            const tail = fullDuplex && last && Date.now() - last.settledAt! <= CUE_TAIL_MS ? last : undefined;
            segments.push(playing?.audible ? (fullDuplex ? {at, held: playing} : {at, drop: true})
              : tail ? {at, held: tail} : {at, echoOf: playing ?? last});
            pass();
          },
          onSpeechEnd: at => {
            const open = segments.find(segment => segment.end === undefined);
            if (!open) return;
            open.end = at; pass();
          },
          onSegment: text => {
            const closed = segments.find(segment => segment.end !== undefined && !segment.result);
            if (!closed) return;
            closed.result = {text}; pass();
          },
        });
        fullDuplex = capture.fullDuplex === true;
        return capture;
      };
    },
  };
}
