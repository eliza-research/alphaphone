import type {AssistantCapture, AssistantListenHandlers} from './voice-assistant';

type EchoContext = {recentAgentReply: string; replyAgeMs: number; agentSpeaking: boolean};
type Segment = {cue?: string; drop?: boolean; at: number; end?: number; result?: {text: string | null}; started?: boolean; ended?: boolean};

/**
 * The spoken model acknowledgement (createBatchProgressAcknowledgment) on the live voice paths:
 * streaming Cloud speech and on-device live ASR. Their one capture stays open for barge-in, so
 * VoiceAssistantSession would take the cue's own echo as held speech and interrupt its turn.
 * From the moment a cue is played until its playback settles, the capture treats it as playback,
 * as the session treats a reply:
 *  - over a capture without echo cancellation, speech that starts in the cue is ignored;
 *  - over an echo-cancelled capture, it is held and reaches the session only when its transcript
 *    passes the echo gate against the cue, so echo never interrupts by time alone.
 * Segments reach the session in capture order. A cue never starts while the user is speaking (it
 * is dropped: silence). The cue is never reply text, heard or unheard.
 */
export function createLiveCueGate(echoGate: (text: string, context: EchoContext) => boolean) {
  let cue: string | undefined;
  let active: Segment[] = [];
  return {
    async play(text: string, speak: () => Promise<void>): Promise<void> {
      if (active.some(segment => segment.end === undefined)) return;
      cue = text;
      try { await speak(); } finally { cue = undefined; }
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
            if (segment.cue !== undefined) {
              // Held until its transcript; later speech waits so the session keeps capture order.
              if (!segment.result) return;
              segments.splice(index, 1);
              const text = segment.result.text;
              if (text && echoGate(text, {recentAgentReply: segment.cue, replyAgeMs: 0, agentSpeaking: true})) {
                handlers.onSpeechStart(segment.at); handlers.onSpeechEnd(segment.end!); handlers.onSegment(text);
              }
              continue;
            }
            if (!segment.started) { segment.started = true; handlers.onSpeechStart(segment.at); }
            if (segment.end !== undefined && !segment.ended) { segment.ended = true; handlers.onSpeechEnd(segment.end); }
            if (!segment.result) { index++; continue; }
            segments.splice(index, 1); handlers.onSegment(segment.result.text);
          }
        };
        const capture = await listen({
          ...handlers,
          onSpeechStart: at => {
            segments.push(cue === undefined ? {at} : fullDuplex ? {at, cue} : {at, drop: true});
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
