import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nativeSource, fixture, runJvm } from './fixtures/jvm-tools.mjs';

// Issue #397 streamed on-device speech output. Host-JVM checks of the pure queue/writer/focus classes
// plus source contracts for the Android wiring. Not AudioTrack, device playback or latency evidence.
const read = name => fs.readFileSync(nativeSource(name), 'utf8');
const strip = source => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

test('bounded PCM queue, streamed writer, cancellation, focus policy and chunk validation (host JVM)', () => {
  const sources = ['VoiceLatencyTrials.java', 'SpeechPcmQueue.java', 'StreamingSpeechPlayback.java', 'SpeechAudioFocusPolicy.java', 'SpeechStreamValidation.java'].map(nativeSource);
  assert.match(runJvm([...sources, fixture('StreamingSpeechTest.java')], 'ai.elizaresearch.alphaphone.StreamingSpeechTest'), /^PASS streaming speech/);
});

test('local speech streams through AudioTrack when the engine supports it and falls back only when it does not', () => {
  const plugin = strip(read('AlphaVoiceCloudPlugin.java')), output = strip(read('AudioTrackSpeechOutput.java')), paradee = strip(read('AlphaParadeeSpeech.java'));
  // Streaming is chosen by capability, never as an error fallback.
  assert.match(plugin, /if\(!engine\.supportsStreaming\(\)\)return false;streamLocal\(/);
  assert.match(plugin, /Boolean streamed=localEngine\.use\(/);
  assert.match(plugin, /if\(streamed\)return;/);
  assert.doesNotMatch(plugin.slice(plugin.indexOf('private void streamLocal('), plugin.indexOf('private static boolean settleRefusal(')), /File|createTempFile|FileOutputStream/, 'streamed audio is never written to storage');
  assert.match(paradee, /inference\.synthesizeStream\(text,1f,/);
  assert.match(paradee, /return inference\.supportsStreaming\(\);/);
  assert.match(paradee, /VoiceAssets\.install\(context\)\.openInference\(\)/);
  assert.doesNotMatch(paradee, /\.open(?:Asr|Voice)\(/);
  // AudioTrack MODE_STREAM, float mono, assistant speech attributes.
  assert.match(output, /setTransferMode\(AudioTrack\.MODE_STREAM\)/);
  assert.match(output, /ENCODING_PCM_FLOAT/);
  assert.match(output, /CHANNEL_OUT_MONO/);
  assert.match(strip(read('AlphaSpeechAudioFocus.java')), /USAGE_ASSISTANT\)\.setContentType\(AudioAttributes\.CONTENT_TYPE_SPEECH\)/);
  // Bounded capacity, early publication and stop/barge-in semantics.
  assert.match(plugin, /STREAM_CAPACITY=AlphaLocalSpeechEngine\.STREAM_RATE\*30;/);
  assert.match(plugin, /if\(streamPlayback!=null\)\{streamPlayback\.stop\(\);streamPlayback=null;AlphaVoiceLatencyProbe\.TRIALS\.stopped\(playbackTrial\);\}/);
  assert.match(plugin, /private static boolean keepsEngine\(Pending request\)\{return request\.keepEngine&&request\.cancelled;\}/, 'a cancelled stream keeps the models loaded');
  assert.match(plugin, /if\(request\.resolvedEarly\)\{\}else if/);
});

test('speech holds transient duckable audio focus only while it plays and never starts during a call', () => {
  const plugin = strip(read('AlphaVoiceCloudPlugin.java')), focus = strip(read('AlphaSpeechAudioFocus.java')), capture = strip(read('AlphaLiveVoiceCapture.java'));
  assert.match(focus, /new AudioFocusRequest\.Builder\(AudioManager\.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK\)/);
  assert.match(focus, /abandonAudioFocusRequest\(request\)/);
  assert.match(focus, /addOnModeChangedListener\(executor,modeListener\)/);
  for (const constant of ['MODE_IN_CALL', 'MODE_IN_COMMUNICATION', 'MODE_RINGTONE']) assert.match(focus, new RegExp(`AudioManager\\.${constant}`));
  // Focus is requested before both streamed and MediaPlayer playback and released with the playback.
  assert.match(plugin, /private void playStream\(PluginCall call\)\{\n  String refusal=focus\.acquire\(\);/);
  assert.match(plugin, /String refusal=focus\.acquire\(\);if\(refusal!=null\)\{preparingPlayback=null;clearPlayback\(\);call\.reject\(refusalMessage\(refusal\),refusal\);return;\}p\.start\(\);/);
  assert.match(plugin, /if\(focus!=null\)focus\.release\(\);/);
  // Calls: synthesis, recording and live capture refuse with an honest code; a call stops speech and capture.
  assert.match(plugin, /if\(focus!=null&&focus\.callActive\(\)\)\{call\.reject\(CALL_MESSAGE,SpeechAudioFocusPolicy\.CALL_ACTIVE\);return;\}/);
  assert.match(plugin, /Voice is paused while a phone call is active/);
  assert.match(plugin, /active\.interrupt\(SpeechAudioFocusPolicy\.CALL_ACTIVE\)/);
  assert.match(capture, /sink\.ended\(captureId,error!=null\?error:interruption\)/);
});
