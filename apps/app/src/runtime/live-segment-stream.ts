import { createLiveVoiceSession, type LiveAudioFrame, type LiveVadEdge, type LiveVoiceLatency, type LiveVoiceTransport } from './live-voice.ts';

/**
 * One continuous live capture mapped onto the agent's live ASR session (live-voice.ts): every VAD
 * segment the app process opens is forwarded with its frames, and every segment it closes yields
 * exactly one result (the agent's final transcript, or null when the segment produced none).
 *
 * Stop reconciliation: `cutoff(at)` marks the moment the user stopped, before the native capture
 * has finished stopping. Frames and edges stamped after `at` (still in flight from the native
 * thread) are dropped; frames up to `at` keep arriving through `accept`. Once the capture has
 * stopped, `close()` closes an open segment at `at` and delivers its final before resolving, so a
 * transcript holds exactly the audio up to the stop. `cancel()` discards: no further result is
 * delivered and the agent session is released.
 *
 * Interim text (`onInterim`) needs a transport with an event stream (`subscribe`). The Android
 * agent IPC carries none yet, so there the caller receives finals only; nothing is synthesized in
 * place of a partial. Plain module: Node contract tests evaluate it directly.
 */
export interface LiveSegmentHandlers {
  onSpeechStart?(atMs: number): void;
  onSpeechEnd?(atMs: number): void;
  onSegment(text: string | null, latency?: LiveVoiceLatency): void;
  /** The agent route is unavailable or the transport failed: the stream is unusable. */
  onFatal?(code: 'LIVE_ASR_UNAVAILABLE' | 'TRANSPORT'): void;
  onInterim?(text: string): void;
}

export function createLiveSegmentStream(input: { transport: LiveVoiceTransport; roomId?: string; now?: () => number } & LiveSegmentHandlers) {
  let open = false, cut: number | undefined, finished = false, discarded = false, expected = 0;
  const session = createLiveVoiceSession({
    transport: input.transport,
    ...(input.roomId ? { roomId: input.roomId } : {}),
    ...(input.now ? { now: input.now } : {}),
    onInterim: text => { if (!discarded) input.onInterim?.(text); },
    onFinal: (final, latency) => {
      if (discarded) return;
      if (expected <= 0) return; // A final for a segment this stream never closed.
      expected--;
      input.onSegment(final.text, latency);
    },
    onError: code => {
      if (discarded) return;
      if (code === 'ASR_FAILED') { if (expected > 0) { expected--; input.onSegment(null); } return; }
      const outstanding = expected; expected = 0;
      for (let index = 0; index < outstanding; index++) input.onSegment(null);
      input.onFatal?.(code);
    },
  });
  const closeSegment = (at: number) => {
    if (!open) return false;
    open = false; expected++;
    input.onSpeechEnd?.(at);
    return true;
  };
  return {
    sessionId: session.sessionId,
    /** True while a VAD segment is open. */
    speaking: () => open,
    /** Frames and VAD edges from the capture, in capture order. */
    accept(frames: readonly LiveAudioFrame[], vad: readonly LiveVadEdge[]) {
      if (finished) return Promise.resolve();
      const limit = cut;
      const kept = limit === undefined ? frames : frames.filter(frame => frame.timestamp <= limit);
      const edges: LiveVadEdge[] = [];
      for (const edge of vad) {
        if (limit !== undefined && edge.timestampMs > limit) continue;
        if (edge.type === 'speech-start') {
          if (open) continue;
          open = true; edges.push(edge);
          input.onSpeechStart?.(edge.timestampMs);
        } else if (closeSegment(edge.timestampMs)) edges.push(edge);
      }
      if (!kept.length && !edges.length) return Promise.resolve();
      return session.push(kept, edges);
    },
    /** The user stopped at `at` (epoch ms, the frames' clock). Later audio is never forwarded. */
    cutoff(at: number) { if (cut === undefined || at < cut) cut = at; },
    /** After the capture stopped: finalize audio up to the cutoff and release the agent session. */
    async close() {
      if (finished) return;
      finished = true;
      const at = cut ?? Date.now();
      if (closeSegment(at)) await session.endTurn(at);
      await session.close().catch(() => {});
      for (; expected > 0 && !discarded; expected--) input.onSegment(null);
    },
    /** Discard everything: no further results; the agent session is released. */
    cancel() {
      if (discarded) return;
      discarded = true; finished = true; open = false; expected = 0;
      // Releasing the agent session finalizes nothing anyone will read.
      void session.close().catch(() => {}).finally(() => session.dispose());
    },
  };
}
