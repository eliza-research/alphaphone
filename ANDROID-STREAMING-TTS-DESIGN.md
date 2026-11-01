# Android streaming Cloud TTS: design note (for Codex)

Status: design only. Nothing in `android/` or the speech bridge was changed. The browser and
development path in this branch already plays Cloud read-aloud while it downloads (see "Browser
reference" below). Android native TTS is Codex-owned; this note proposes the matching native change.

## Today

`AlphaVoiceCloudPlugin.synthesizeAudio` (android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaVoiceCloudPlugin.java)
posts `{text, format:"mp3"}` to Cloud `/api/v1/voice/tts`, checks `X-Eliza-TTS-Provider` and the
MIME type, then reads the whole body with `read(in, AUDIO_LIMIT, request)` (8 MiB). After that,
`LocalSpeechBridgePlugin.publishPreparedAudio` writes the clip to a cache file and `play()` opens
it with `MediaPlayer`. So the first audio frame waits for the last byte. On staging, the agent-side
drain of a 217 to 236 KB mp3 alone took 1,123 to 1,221 ms (CLOUD-LATENCY-MEASURED-20261101T1006.json).
Own-key speech (`CartesiaSpeech.synthesize`, `/tts/bytes`) is also downloaded whole.

On-device Paradee speech already streams: `streamLocal` offers PCM chunks to a
`StreamingSpeechPlayback` (bounded `SpeechPcmQueue`, AudioTrack MODE_STREAM writer). It publishes
the playbackId on the first chunk (`publishStream`, which resolves with `streaming:true`), and
`play()` routes it to `playStream`.

## Proposal: decode mp3 with MediaCodec into StreamingSpeechPlayback

Add one worker-thread class in the speech bridge, for example `ai.eliza.voice.StreamingMp3Speech`.
It takes an `InputStream` (the HTTP body), a `Guard`, and a factory for the playback. Its parts:

1. **Frame reader (pure Java, host-JVM testable).** Find the MPEG audio sync (`0xFFE`) and parse
   each 4-byte header: version, layer III, bitrate, sample rate, padding, channels. From those,
   compute the frame length. Skip an ID3v2 tag at the start. Reject free-format and reserved
   values. Every frame in a clip must have the same sample rate and channel count; a change is
   `failed("format-changed")`. Count compressed bytes against `AUDIO_LIMIT`. Read with a fixed
   buffer, and zero consumed input.
2. **Decoder.** Use `MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_AUDIO_MPEG)`, configured
   from the first header with `MediaFormat.createAudioFormat("audio/mpeg", rate, channels)`. Use
   `KEY_PCM_ENCODING = ENCODING_PCM_FLOAT` where it is supported (API 24+, minSdk is 29). Queue one
   or more whole frames per input buffer, then drain the output synchronously on the same worker
   (`dequeueOutputBuffer` with a short timeout). This avoids a second thread. On
   `INFO_OUTPUT_FORMAT_CHANGED`, re-read the rate and channel count, and fail if they differ from
   the playback's. Send `BUFFER_FLAG_END_OF_STREAM` when the body ends, then drain until the codec
   sets EOS.
3. **PCM to playback.** Downmix to mono float, which is what `StreamingSpeechPlayback.offer` takes.
   Create the playback only after the first header is parsed, so its `sampleRate` is the clip's
   rate: `new StreamingSpeechPlayback(capacity, rate, AUDIBLE_LEVEL, () -> AudioTrackSpeechOutput.open(rate), listener, System::nanoTime)`.
   Its constructor accepts 8 to 48 kHz. A 22.05, 24, 32, 44.1 or 48 kHz Cloud mp3 needs no
   resampling. `offer` blocks on the bounded queue, which paces the download to playback, as
   `streamLocal` does. Size the capacity in samples of the clip's rate, not `STREAM_RATE`.
4. **Publication.** Reuse the `publishStream` contract. The first decoded PCM chunk (not the
   headers) resolves the call with `{playbackId, streaming:true}`. That keeps the current
   failures before publication: an empty body, a wrong provider or MIME type, a non-2xx status
   and the `playback-busy` refusal all reject the synthesize call as they do now. Remove the
   request deadline on publication, exactly as `publishStream` does.
5. **Cancellation (Stop, barge-in, focus loss, `cancel({requestId})`, destroy).** Set
   `request.cancelNative = () -> { playback.stop(); connection.disconnect(); }`. The worker loop
   checks `request.cancelled || destroyed || playback.stopped()` before every read and every
   codec call, and its `finally` stops and releases the codec. `clearPlayback()` already calls
   `streamPlayback.stop()`, which discards queued PCM and makes `offer` return false.
6. **Failure after publication.** A read error, decoder error or truncated last frame calls
   `playback.fail("download-truncated")` (or `"decode-failed"`). That reports `playbackFailed`,
   never `playbackEnded`. This matches the SDK proxy (c4542751737), which destroys the response
   rather than ending it cleanly, and the browser path below. Heard-content accounting
   (`VoiceAssistantSession` `onHeard` with `playbackFailed`) needs no change.
7. **Fences.** Keep each check that runs today, and run it per chunk where it can change mid-body:
   - the Cloud credential generation and expiry (`credentialId` equals the slot's), or the own-key
     `OwnSpeech.check()` provider revision;
   - `CloudSpeechPolicy.requireProvider` and the MIME type, before the first byte;
   - the `AUDIO_LIMIT` on compressed bytes;
   - no cache file at all: PCM stays in the bounded queue and is zeroed after it is written.

   A paired agent's `/api/tts/paradee` is WAV and stays on the prepared-file path.

## Tests (suggested)

- Host JVM, next to `StreamingSpeechTest.java`: the frame reader on synthetic frames. Cover ID3
  skip, a split header across reads, a truncated last frame, a sample-rate change and the size
  limit. Also cover cancellation, using a fake decoder interface around MediaCodec.
- Instrumentation, extending `CloudVoiceInstrumentedTest`: a 127.0.0.1 fixture (the existing
  `instrumentationBaseUrl` hook) sends 1 s of silent frames and holds the rest. Assert that
  `play()` resolves and the AudioTrack head position advances before the body ends. Assert that
  Stop disconnects the fixture's socket. Assert that a fixture reset after the first chunk yields
  `playbackFailed`.
- Negative control: the same instrumentation case against the current `read()` path must time out
  waiting for playback.

The silent fixture frame used by the browser spec is 144 bytes: header `FF FB 18 C0` (MPEG-1
Layer III, 32 kbit/s, 32 kHz, mono) followed by zeros. That is 36 ms of silence per frame.

## Browser reference (this branch)

- `scripts/local-agent-dev-bridge.ts`: `/api/tts/cloud` is forwarded as binary `audio/mpeg`.
  Headers go out with the first chunk, and every chunk passes the owner check first. A failure
  after the first chunk destroys the response.
- `apps/app/src/runtime/local-agent.ts` `cloudSpeechAudio`: verifies the headers, checks the
  session and generation per chunk, enforces the 8 MiB cap, and is aborted by `disconnect()`.
- `apps/app/src/browser/streamed-speech.ts`: MediaSource playback, with the whole-Blob fallback.
- `test/browser/cloud-tts-streaming.spec.ts`: playback starts before the body ends, Stop aborts,
  the fallback works, and a truncation fails.

Expected effect: the foreground saving per spoken reply is bounded by the measured body drain,
1.1 to 1.2 s for a 217 to 236 KB first sentence on staging. It is reduced by the first-chunk and
decoder start time, which has not been measured on a device.
