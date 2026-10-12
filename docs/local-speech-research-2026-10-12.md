# On-device speech research and native integration — October 12, 2026

Status: researched implementation plan, **no new model downloaded, benchmarked or
admitted**. Owner policy requires all production STT/TTS on the phone, through an
Android native bridge to Eliza's reviewed llama.cpp/inference build. There is no
Cloud speech fallback. Speech remains usable offline and signed out. Hosted text
inference is a separate service, not a hosted agent or speech engine.

## Findings and recommended evaluation order

Hugging Face model cards and publisher sources were checked on 2026-10-12.
“Latest” does not establish fastest on Pixel 10a. Published measurements below use
different hardware, engines and corpora and are not a comparative phone benchmark.

| Candidate | Primary evidence | Engineering disposition |
| --- | --- | --- |
| Moonshine Streaming Tiny/Small/Medium | [Publisher model card](https://huggingface.co/moonshine-ai/moonshine-streaming-small): English, 34M/123M/245M parameters, streaming encoder; card warns the Transformers path is not fully efficient streaming | First STT challenger: compare Tiny for latency and Small for accuracy against current Whisper. Implement real incremental native execution; a Python/GPU example is not Android support. |
| Whisper current packaged model | Existing pinned Alpha speech assets and admission ledger | Baseline for regression, accuracy and latency; no assumption that its earlier failed qualification has become a pass. |
| Parakeet TDT 0.6B v3 | [NVIDIA card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) | Larger STT accuracy/language comparator; benchmark memory and native compatibility before considering it the phone default. |
| Qwen3-ASR 0.6B | [Qwen card](https://huggingface.co/Qwen/Qwen3-ASR-0.6B) | Additional STT comparator; published server throughput does not prove mobile latency or loader compatibility. |
| Kokoro-82M | [Publisher card](https://huggingface.co/hexgrad/Kokoro-82M), Apache-2.0; actual Kokoro code exists in the pinned Eliza llama.cpp fork | First native TTS integration baseline because the requested fork already has implementation. Measure cold/warm first audio and sustained generation; preserve correct phonemization. |
| Paradee-8M v1.0 | [Publisher card](https://huggingface.co/sahilmahendrakar/Paradee-8M-v1.0), October 2026, 8.07M, single English `af_heart` voice, ~9 MB int8 ONNX; publisher reports ~18x real time on one Apple M4 Pro CPU thread | Highest-priority small TTS challenger. Very recent, single voice, phonemizer-sensitive. ONNX assets are not directly loadable by llama.cpp; integrate a reviewed native backend or port upstream, then establish Pixel results. |
| Supertonic 3 | [Publisher card](https://huggingface.co/Supertone/supertonic-3), ~99M, ONNX, 31 languages, OpenRAIL-M weights / MIT sample code | Fast multilingual TTS challenger. Native backend integration and on-phone quality/speed comparison required. Record exact model/voice terms; do not call all assets MIT. |
| Pocket TTS | [Kyutai card](https://huggingface.co/kyutai/pocket-tts), ~100M, streaming, publisher reports ~200 ms first chunk and ~6x real time on MacBook Air M4 using two cores | Streaming TTS comparator. Current card lists CC-BY-4.0 and gated files; pin model/voice terms separately from engine code. Desktop figures and reference PyTorch runtime are not an Android qualification. |

Recommendation: start the JNI contract with the fork's Kokoro path and an STT
backend audit, compare Moonshine Tiny/Small and Paradee/Supertonic against it, then
admit the fastest candidate that meets quality and thermal requirements. Do not
commit a production model purely from these cards. An ONNX engine may live behind
the common native inference API if required, but that is explicit upstream work,
not a claim that a GGUF conversion alone makes the architecture supported.

## What exists in Eliza and what does not yet follow

Inspected Alpha pin: `13c98575987a121decc45b161b0c8a4ee698554e`.
Read-only GitHub inspection of Eliza develop `6aada8ad52f1129bf0a8d96dd64dab24634be9f0`
also showed the same nested llama.cpp revision:
`ea8b3f2dfc2641dea3e6238bc6dd99595584b076`.

- [`plugins/plugin-local-inference/src/services/voice/ffi-bindings.ts`](https://github.com/elizaOS/eliza/blob/13c98575987a121decc45b161b0c8a4ee698554e/plugins/plugin-local-inference/src/services/voice/ffi-bindings.ts)
  declares native ASR, timed ASR, TTS streaming/cancellation and optional Kokoro
  capability/load/synthesize/G2P APIs. A declaration/capability probe is not proof
  that an Android library exports or correctly executes every function.
- The [fork tree](https://github.com/elizaOS/llama.cpp/tree/ea8b3f2dfc2641dea3e6238bc6dd99595584b076/tools/kokoro)
  includes Kokoro source, headers, GGUF conversion and tests. It also has a Whisper
  encoder under multimodal tooling; an encoder alone is not a complete STT route.
  This inspection did not establish Moonshine, Paradee, Supertonic or Clef
  end-to-end Android support.
- Alpha's current [`build-no-espeak.py`](https://github.com/elizaOS/eliza/blob/13c98575987a121decc45b161b0c8a4ee698554e/packages/app/scripts/local-speech/build-no-espeak.py)
  builds Sherpa ONNX 1.13.8 JNI with ONNX Runtime. Product scripts delegate to that
  upstream pipeline. The installed speech pipeline is therefore **not already the
  requested unified llama.cpp JNI path**.
- Generic JNI/engine/model work belongs in reviewed Eliza/fork commits. Consume
  those through source-pin updates and reproduce both APK variants; never edit
  `vendor/eliza` in place or weaken asset qualification to force a build.

## Native execution contract

1. Keep model contexts warm in a bounded native service after the user enables
   voice. Pin engine, backend, models, tokenizer, phonemizer, voices and ABI hashes.
   Expose prepare/capabilities/start/append/finalize/cancel/release plus structured
   timings and errors. Loading must not block the UI/audio callback thread.
2. Capture PCM with native audio APIs, stream through VAD/STT on native workers,
   publish partial/final text events to the renderer. Use bounded queues and
   backpressure; avoid base64 PCM and per-chunk Capacitor crossings.
3. Stream text chunks into native TTS, producing PCM directly to native playback.
   Benchmark CPU/NEON first and available accelerators separately. Do not assume
   Pixel hardware supports an Adreno-specific or desktop CUDA path.
4. Every operation carries owner/session/generation identity. Cancellation stops
   inference and flushes unplayed audio promptly; obsolete callbacks cannot
   publish text, audio or tool proposals. A completed external action cannot be
   “undone” by audio cancellation and must retain its receipt.
5. Add acoustic echo cancellation/self-playback discrimination that still permits
   genuine barge-in. Blanket disabling the microphone during TTS fails the desired
   experience. Preserve audio focus, Bluetooth/headset, calls and microphone privacy.
6. Offline/signed-out recognition and synthesis require no account, billing call
   or network model fetch at use. An unavailable engine reports repair/typing;
   it must not fall back to Cloud speech or an unverified OS recognizer.

## Dictation, voice assistant and Clef

The owner specified two controls, superseding manual-send-only P-01:

- **Transcribe:** explicit capture; Stop finalizes STT and inserts editable text.
  No assistant request is submitted until Send. Cancellation discards transient
  capture; an explicitly saved voice note follows Notes retention.
- **Voice assistant:** local capture/VAD/STT; after a short gap ask semantic
  endpoint detection whether the user is done; a longer gap submits automatically.
  New speech resets pending endpoint timers. If submission or response already
  began, cancel that generation and playback, then continue using the added speech.
  Do not duplicate the old turn or retain unplayed assistant text as if heard.

Initial **engineering tuning values, not accepted measurements**: short gap 300 ms,
long gap 1,200 ms, configurable for slow speakers. Semantic scores may delay an
unfinished phrase until the long-gap boundary; speech resumption always wins over
a racing timer. Set a bounded detector deadline and never wait indefinitely.

The likely named Clef is [Cloudflare Clef-Flash](https://huggingface.co/Cloudflare/clef-flash)
(9B; full Clef is 27B), a structured decision model. It is not a small acoustic VAD.
Verify the intended variant and native loader/decision-head support, then evaluate
`continue` versus `finished` on incremental transcripts. Phone memory, cold/warm
latency, decision quality and battery are open. Do not use a hosted Clef call to
silently satisfy this local pipeline or substitute another model without recording
that change. A compact [Smart Turn v3](https://huggingface.co/pipecat-ai/smart-turn-v3)
8M acoustic endpoint model is a useful benchmark comparator, not an approved Clef
replacement. The issue explicitly owns resolving Clef feasibility.

[OpenAI's documented VAD behavior](https://developers.openai.com/api/docs/guides/realtime-vad)
provides a behavioral reference for semantic endpoints and automatic interruption.
It does not establish ChatGPT's private implementation or require using OpenAI's
hosted speech service. Alpha implements the requested experience locally.

## Performance and acceptance protocol

Owner metric: `first audible response sample - last user speech audio sample`.
Include endpoint delay, STT finalization, Cloud text-model latency if used, TTS and
playback buffers. A silent filler or earcon is not the first answer. Recompute the
input boundary when a user continues. Dictation separately records Stop→editable
text; never subtract review time from an assistant-mode wall-clock measurement.

Engineering targets to validate on Pixel 10a, not performance claims:

| Metric | Initial target |
| --- | --- |
| STT/TTS sustained real-time factor (compute seconds / audio seconds) | p95 <= 0.25 (at least 4x real time); report each engine separately |
| Warm STT finalization after actual speech end, excluding endpoint wait | p95 <= 250 ms |
| TTS text-ready to first playable PCM | p95 <= 200 ms; audible playback measured separately |
| Detected barge-in to playback stop | p95 <= 100 ms |
| Subscription/rate-limit added service admission latency | No extra billing network round trip; target p95 <= 5 ms at the service |
| Voice-assistant end-to-end simple query | Existing <= 6 s upper budget; publish full p50/p95 and optimize toward conversational latency |

Use at least 50 representative simple turns and a 30-minute sustained session;
record cold/warm runs, ARM64 device and x86_64 emulator separately, wall times,
model/source hashes, memory, power/thermal, errors, STT word errors and TTS listening
quality. Include names, numbers, addresses, pauses, noise, echo and interruptions.
Always-on listening additionally needs locked/idle/background and daily battery
qualification. No synthetic waveform alone qualifies real microphone/speaker UX.
