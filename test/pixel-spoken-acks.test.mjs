import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {cloudVoiceViewFixture} from './fixtures/cloud-voice-view.mjs';
import {voiceFakeClock} from './fixtures/shared-batch-voice.mjs';

// Spoken model acknowledgements on the Pixel (native platform): the batch fallback, streaming
// Cloud speech and on-device live voice. The cue is only ever the model's own label; nothing
// canned is spoken, and a missing or dropped ack is silence.
const ACK='Checking your calendar now.',REPLY='Synthetic matching reply.';
const progress=(input,patch={})=>input.onProgress?.({turnId:input.turnId,conversationId:input.binding.conversationId,ownerId:input.binding.session.ownerId,kind:'thinking',label:ACK,...patch});
const silent=[{label:''},{label:'   '},{label:undefined},{label:'x'.repeat(161)},{kind:'running_tool',toolName:'calendar.read',label:undefined},{kind:'running_action',actionName:'CALENDAR',label:'Using Calendar'}];

// The views run in a VM realm with the host's DOMException; as in the app's WebView, an
// AbortError must also be an Error there, so the realm shares the host's Error.
function viewFixture(options){const f=cloudVoiceViewFixture(options);f.box.Error=Error;return f;}

// --- Batch fallback (streaming route absent, or direct inference): one Cloud TTS request per cue.
async function batchTurn(options={}){
 const clock=voiceFakeClock(),f=viewFixture({cloudProfile:true,clock,peak:.5,holdReply:true,...options});
 f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;
 await f.shell.startVoice();await clock.flush();await clock.advance(700);f.peak=0;await clock.advance(1200);
 assert.equal(f.native,options.native??true);assert.equal(f.sends,1);assert.equal(f.activeRecording,null,'the clip capture is retired before any cue');
 return {f,clock,input:f.sendInputs[0],texts:()=>(f.speechInputs||[]).map(value=>value.text)};
}
async function closeBatch({f,clock}){f.releasePlaybackCleanup?.();f.finishPlayback?.();f.releaseReply?.();await clock.flush();f.close();await clock.flush();}

test('native batch: the model acknowledgement is spoken once, then the reply',async()=>{
 const t=await batchTurn();
 try{
  progress(t.input);await t.clock.flush();progress(t.input);progress(t.input,{label:'Different later words.'});await t.clock.flush();
  assert.deepEqual(t.texts(),[ACK]);
  t.f.releaseReply();await t.clock.flush();
  assert.deepEqual(t.texts(),[ACK,REPLY]);
 }finally{await closeBatch(t);}
});

test('native batch: an empty, oversized, unlabelled or activity-only ack is silent; no canned line',async()=>{
 const t=await batchTurn();
 try{
  for(const patch of silent)progress(t.input,patch);await t.clock.flush();
  assert.deepEqual(t.texts(),[]);
  t.f.releaseReply();await t.clock.flush();
  assert.deepEqual(t.texts(),[REPLY]);
 }finally{await closeBatch(t);}
});

test('native batch: reply_ready preempts a playing ack and the reply waits for its cleanup',async()=>{
 const t=await batchTurn({holdPlayback:true,holdPlaybackCleanup:true});
 try{
  progress(t.input);await t.clock.flush();assert.deepEqual(t.texts(),[ACK]);assert.ok(t.f.activePlayback,'the ack is playing');
  t.input.onReplyStarted();await t.clock.flush();
  assert.equal(t.f.stopPlaybackInputs?.length,1,'the playing ack is stopped');
  t.f.releaseReply();await t.clock.flush();
  assert.deepEqual(t.texts(),[ACK],'no reply audio before the ack cleanup is confirmed');
  t.f.releasePlaybackCleanup();await t.clock.advance(0);
  assert.deepEqual(t.texts(),[ACK,REPLY]);
 }finally{await closeBatch(t);}
});

// --- Streaming Cloud speech (the Pixel default on Cloud) and on-device live voice.
function loadSession(f){
 const source=fs.readFileSync('.eliza/client-features/packages/voice/src/voice-assistant-session.ts','utf8').replace(/^import .*;\n/gm,'').replaceAll('export class','class').replaceAll('export const','const').replaceAll('export function','function').replaceAll('export interface','interface').replaceAll('export type','type');
 vm.runInNewContext('{'+stripTypeScriptTypes(source)+';globalThis.VoiceAssistantSession=VoiceAssistantSession;}',f.box);
 f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;f.box.randomId=()=>crypto.randomUUID();
 f.box.createHeardReporter=()=>({report:async()=>'not-needed'});
 f.box.recordEndpointVoiceTiming=()=>{};f.box.activeVoiceTurn=()=>undefined;f.box.recordHeardVoiceTiming=()=>{};f.box.toSpeakableText=text=>text;
}
/** One speaker for the live paths: `hold` keeps matching speech playing; `holdStart` delays its
 * first audio until `start()`; `holdCancel` keeps its cancellation pending. */
function speaker(){
 const s={plays:[],hold:()=>false,holdStart:()=>false,holdCancel:false,overlap:false};
 s.speak=(text,signal,onStarted)=>{
  signal.throwIfAborted();
  if(s.plays.some(play=>play.active))s.overlap=true;
  const play={text,signal,active:true};s.plays.push(play);
  return new Promise((resolve,reject)=>{
   play.start=()=>{if(!play.started){play.started=true;onStarted?.();}};
   if(!s.holdStart(text))play.start();
   play.finish=()=>{if(!play.active)return;play.active=false;resolve();};
   signal.addEventListener('abort',()=>{const settle=()=>{play.active=false;reject(signal.reason??new DOMException('Speech cancelled','AbortError'));};if(s.holdCancel)play.releaseCancel=settle;else settle();},{once:true});
   if(!s.hold(text))queueMicrotask(play.finish);
  });
 };
 s.spoken=()=>s.plays.map(play=>play.text);
 return s;
}
function streamingFixture({fullDuplex=true}={}){
 const clock=voiceFakeClock(),f=viewFixture({cloudProfile:true,clock,holdReply:true});
 loadSession(f);
 const s=speaker();s.listens=0;s.closes=0;
 f.box.nativeCloudStreamingAvailable=()=>true;
 f.box.createCloudStreamingSpeech=()=>({
  async listen(input){s.listens++;s.handlers=input;return {fullDuplex,close:async()=>{s.closes++;},cancel:async()=>{}};},
  speak:s.speak,
  async stop(){},
 });
 return Object.assign(f,{clock,s});
}
function onDeviceLiveFixture(){
 const clock=voiceFakeClock(),f=viewFixture({clock,holdReply:true});
 loadSession(f);
 const s=speaker();
 f.box.nativeLiveVoiceReady=async()=>true;
 f.box.nativeAssistantListener=()=>async input=>{s.handlers=input;return {fullDuplex:true,close:async()=>{},cancel:async()=>{}};};
 f.box.createEndpointChain=()=>async()=>'unavailable';f.box.residentEndpoint=()=>undefined;f.box.clefEndpointStage=()=>undefined;
 f.box.createOnDeviceVoice=()=>({ready:async()=>true,playbackReady:async()=>true,speak:(text,signal,onStarted)=>s.speak(text,signal,onStarted)});
 return Object.assign(f,{clock,s});
}
async function liveTurn(f,gapMs=0){
 await f.shell.startVoice();await f.clock.flush();const h=f.s.handlers;assert.ok(h,'the live capture is open');
 h.onSpeechStart(0);h.onSpeechEnd(20);h.onSegment('Add lunch with Sam tomorrow.');await f.clock.advance(gapMs);
 assert.equal(f.sends,1);return f.sendInputs[0];
}
async function closeLive(f){for(const play of f.s.plays){play.releaseCancel?.();play.finish?.();}f.releaseReply?.();await f.clock.flush();f.close();await f.clock.flush();}

test('native streaming: the model acknowledgement plays once on the speech socket, then the reply, with no batch speech',async()=>{
 const f=streamingFixture();
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();progress(input);progress(input,{label:'Different later words.'});await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK]);
  f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK,REPLY]);assert.equal(f.s.overlap,false);
  assert.equal(f.cloudSpeech,0,'no Cloud TTS request beside the socket');assert.equal(f.uploads,0);assert.equal(f.starts,0);
 }finally{await closeLive(f);}
});

test('native streaming: an empty, oversized, unlabelled or activity-only ack is silent; no canned line',async()=>{
 const f=streamingFixture();
 try{
  const input=await liveTurn(f);
  for(const patch of silent)progress(input,patch);await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[]);
  f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[REPLY]);
 }finally{await closeLive(f);}
});

test('native streaming: reply_ready preempts a playing ack; the reply waits for its cancellation and never overlaps it',async()=>{
 const f=streamingFixture();f.s.hold=text=>text===ACK;f.s.holdCancel=true;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0];assert.equal(ack.active,true);
  input.onReplyStarted();await f.clock.flush();assert.equal(ack.signal.aborted,true,'reply_ready cancels the ack');
  f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK],'no reply audio before the ack cancellation settles');
  ack.releaseCancel();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK,REPLY]);assert.equal(f.s.overlap,false);
 }finally{await closeLive(f);}
});

test('native streaming: a reply that arrives while the ack plays also preempts it',async()=>{
 const f=streamingFixture();f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0];
  f.releaseReply();await f.clock.flush();
  assert.equal(ack.signal.aborted,true);assert.deepEqual(f.s.spoken(),[ACK,REPLY]);assert.equal(f.s.overlap,false);
 }finally{await closeLive(f);}
});

test('native streaming: Stop cancels a playing ack and the turn, and waits for the ack cleanup',async()=>{
 const f=streamingFixture();f.s.hold=text=>text===ACK;f.s.holdCancel=true;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0];
  let stopped=false;const stopping=f.shell.stopVoiceConversation().then(()=>{stopped=true;});await f.clock.flush();
  assert.equal(ack.signal.aborted,true,'Stop cancels the ack');assert.equal(input.signal.aborted,true,'and the turn');
  assert.equal(stopped,false,'Stop settles only after the ack cleanup');
  ack.releaseCancel();await f.clock.flush();await stopping;assert.equal(stopped,true);
  f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK],'nothing is spoken after Stop');
 }finally{await closeLive(f);}
});

test('native streaming: Mute during an ack turns the microphone off at once; the cue never reopens it',async()=>{
 const f=streamingFixture();f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0];
  f.renderChat().toggleMute();await f.clock.flush();
  assert.equal(f.s.closes,1,'Mute closes the capture');assert.equal(f.renderChat().muted,'true');
  // Mute is microphone-only, as for a reply: the turn and its cue continue.
  assert.equal(input.signal.aborted,false);assert.equal(ack.active,true);
  ack.finish();f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK,REPLY]);assert.equal(f.s.listens,1,'the microphone stays off after the ack and the reply');
  f.renderChat().toggleMute();await f.clock.flush();assert.equal(f.s.listens,2,'Unmute reopens it');
 }finally{await closeLive(f);}
});

test('native streaming: the ack echo held past the barge-in window never interrupts its own turn',async()=>{
 const f=streamingFixture();f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  h.onSpeechStart(100);await f.clock.advance(2000);
  h.onSpeechEnd(2100);h.onSegment('checking your calendar now');await f.clock.advance(0);
  assert.equal(input.signal.aborted,false,'echo of the ack is not a barge-in');assert.equal(ack.signal.aborted,false);assert.equal(f.sends,1);
  ack.finish();f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK,REPLY]);
 }finally{await closeLive(f);}
});

test('native streaming: real speech during the ack still barges in by its transcript',async()=>{
 const f=streamingFixture();f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  h.onSpeechStart(100);await f.clock.advance(300);h.onSpeechEnd(400);h.onSegment('Actually make it Friday instead.');await f.clock.advance(0);
  assert.equal(input.signal.aborted,true,'the turn is interrupted');assert.equal(ack.signal.aborted,true,'and its ack cancelled');
  f.releaseReply();await f.clock.advance(0);
  assert.equal(f.sends,2);assert.equal(f.sendInputs[1].text,'Actually make it Friday instead.');
 }finally{await closeLive(f);}
});

test('native streaming without echo cancellation: speech during the ack is ignored, as during a reply',async()=>{
 const f=streamingFixture({fullDuplex:false});f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  h.onSpeechStart(100);await f.clock.advance(2000);h.onSpeechEnd(2100);h.onSegment('Actually make it Friday instead.');await f.clock.advance(0);
  assert.equal(input.signal.aborted,false);assert.equal(f.sends,1);
  ack.finish();f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK,REPLY]);
 }finally{await closeLive(f);}
});

test('on-device live voice: the model acknowledgement plays through on-device speech once, then the reply',async()=>{
 const f=onDeviceLiveFixture();
 try{
  const input=await liveTurn(f,1300);
  progress(input);await f.clock.flush();progress(input);await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK]);
  f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK,REPLY]);assert.equal(f.s.overlap,false);assert.equal(f.cloudSpeech,0);
 }finally{await closeLive(f);}
});

// --- A dropped ack is silence on every path: a cue that fails to play never costs the reply.
test('native batch: an ack whose Cloud speech request fails is silence; the reply is still spoken',async()=>{
 const t=await batchTurn();const synthesize=t.f.driver.synthesize;
 t.f.driver.synthesize=async input=>{if(input.text!==ACK)return synthesize(input);(t.f.speechInputs??=[]).push(input);throw Object.assign(Error('Cloud speech failed'),{code:'voice-http-502'});};
 try{
  progress(t.input);await t.clock.flush();assert.deepEqual(t.texts(),[ACK]);
  t.f.releaseReply();await t.clock.flush();
  assert.deepEqual(t.texts(),[ACK,REPLY],'no canned line in its place, and the reply plays');
  assert.notEqual(t.f.renderChat()?.state,'error');
 }finally{await closeBatch(t);}
});

// The browser's clip loop speaks the ack through the same wrapper, so a failed ack is silence there
// too (at 445e5744 it ended the web conversation). A failed reply still ends it, as before.
for(const failing of [ACK,REPLY])
test(`browser batch: ${failing===ACK?'an ack whose Cloud speech request fails is silence; the reply is spoken and the conversation goes on':'a reply whose Cloud speech request fails still ends the conversation with its notice'}`,async()=>{
 const t=await batchTurn({native:false,platform:'web'});const synthesize=t.f.driver.synthesize;
 t.f.driver.synthesize=async input=>{if(input.text!==failing)return synthesize(input);(t.f.speechInputs??=[]).push(input);throw Object.assign(Error('Cloud speech failed'),{code:'voice-http-502'});};
 try{
  progress(t.input);await t.clock.flush();assert.deepEqual(t.texts(),[ACK]);
  // Microtasks drain before any timer, as in the app: the reply's speech and its failure settle first.
  t.f.releaseReply();for(let i=0;i<10;i++)await t.clock.flush();
  assert.deepEqual(t.texts(),[ACK,REPLY]);
  if(failing===ACK)assert.notEqual(t.f.renderChat()?.state,'error');
  else{assert.equal(t.f.renderChat()?.state,'error');assert.match(t.f.renderChat()?.lines?.[0]?.t,/\(502\)/);}
 }finally{await closeBatch(t);}
});

// A speak call the speaker refuses fails only that utterance (the socket's failures: 'speech socket' below).
test('native streaming: an ack whose speech call is refused is silence; the reply is still spoken and the conversation goes on',async()=>{
 const f=streamingFixture();const speak=f.s.speak;
 f.s.speak=(text,signal,onStarted)=>text===ACK?Promise.reject(Error('Speech could not start')):speak(text,signal,onStarted);
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();
  f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[REPLY]);assert.equal(input.signal.aborted,false);
  assert.equal(f.renderChat()?.state,'listening');
 }finally{await closeLive(f);}
});

// --- The ack's echo tail: speech the capture reports just after the cue's audio ended.
test('native streaming: echo of the ack that starts after its audio ended neither interrupts its turn nor is sent',async()=>{
 const f=streamingFixture();f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  ack.finish();await f.clock.flush();
  h.onSpeechStart(1);await f.clock.advance(800);
  assert.equal(input.signal.aborted,false,'held past the barge-in window, the tail does not interrupt by time');
  h.onSpeechEnd(2);h.onSegment('calendar now');await f.clock.advance(0);
  h.onSpeechStart(3);h.onSpeechEnd(4);h.onSegment('your calendar now');await f.clock.advance(0);
  assert.equal(input.signal.aborted,false);assert.equal(f.sends,1);
  await f.clock.advance(2000);
  h.onSpeechStart(5);h.onSpeechEnd(6);h.onSegment('your calendar now');await f.clock.advance(0);
  assert.equal(input.signal.aborted,false,'later echo carries no transcript');assert.equal(f.sends,1);
  f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK,REPLY]);assert.equal(f.sends,1,'the echo is never sent as a turn');
 }finally{await closeLive(f);}
});

test('native streaming: real speech just after the ack still barges in by its transcript',async()=>{
 const f=streamingFixture();f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  ack.finish();await f.clock.flush();
  h.onSpeechStart(1);await f.clock.advance(300);h.onSpeechEnd(2);h.onSegment('Actually make it Friday instead.');await f.clock.advance(0);
  assert.equal(input.signal.aborted,true);
  f.releaseReply();await f.clock.advance(0);
  assert.equal(f.sends,2);assert.equal(f.sendInputs[1].text,'Actually make it Friday instead.');
 }finally{await closeLive(f);}
});

test('native streaming without echo cancellation: echo of the ack that starts after its audio ended neither interrupts its turn nor is sent',async()=>{
 const f=streamingFixture({fullDuplex:false});f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  ack.finish();await f.clock.flush();
  h.onSpeechStart(1);await f.clock.advance(800);
  assert.equal(input.signal.aborted,false,'held past the barge-in window, the tail does not interrupt by time');
  h.onSpeechEnd(2);h.onSegment('your calendar now');await f.clock.advance(0);
  assert.equal(input.signal.aborted,false);assert.equal(f.sends,1);
  f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK,REPLY]);assert.equal(f.sends,1,'the echo is never sent as a turn');
 }finally{await closeLive(f);}
});

test('native streaming without echo cancellation: real speech just after the ack still barges in by its transcript',async()=>{
 const f=streamingFixture({fullDuplex:false});f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  ack.finish();await f.clock.flush();
  h.onSpeechStart(1);await f.clock.advance(300);h.onSpeechEnd(2);h.onSegment('Actually make it Friday instead.');await f.clock.advance(0);
  assert.equal(input.signal.aborted,true);
  f.releaseReply();await f.clock.advance(0);
  assert.equal(f.sends,2);assert.equal(f.sendInputs[1].text,'Actually make it Friday instead.');
 }finally{await closeLive(f);}
});

test('on-device live voice: echo of the ack that starts after its audio ended does not interrupt its turn',async()=>{
 const f=onDeviceLiveFixture();f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f,1300);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  ack.finish();await f.clock.flush();
  h.onSpeechStart(1);await f.clock.advance(800);h.onSpeechEnd(2);h.onSegment('your calendar now');await f.clock.advance(1300);
  assert.equal(input.signal.aborted,false);assert.equal(f.sends,1);
  f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK,REPLY]);assert.equal(f.sends,1);
 }finally{await closeLive(f);}
});

test('native streaming without echo cancellation: speech that starts before the ack audio is not discarded',async()=>{
 const f=streamingFixture({fullDuplex:false});f.s.hold=text=>text===ACK;f.s.holdStart=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  h.onSpeechStart(1);ack.start();await f.clock.advance(800);
  assert.equal(input.signal.aborted,true,'held as without a cue, it interrupts the pending turn after 700 ms');assert.equal(ack.signal.aborted,true);
  h.onSpeechEnd(2);h.onSegment('Actually make it Friday instead.');
  f.releaseReply();await f.clock.advance(0);
  assert.equal(f.sends,2);assert.equal(f.sendInputs[1].text,'Actually make it Friday instead.');
 }finally{await closeLive(f);}
});

// --- On-device recorded-clip loop (the Pixel when on-device live ASR is not ready).
function onDeviceBatchFixture(){
 const clock=voiceFakeClock(),f=viewFixture({clock,peak:.5,holdReply:true});
 f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;
 const s=speaker();
 f.box.nativeLiveVoiceReady=async()=>false;
 f.box.createOnDeviceVoice=()=>({ready:async()=>true,playbackReady:async()=>true,transcribe:async()=>({text:'Add lunch with Sam tomorrow.'}),speak:(text,signal,onStarted)=>s.speak(text,signal,onStarted)});
 return Object.assign(f,{clock,s});
}
test('on-device batch: the model acknowledgement plays through on-device speech once, after the clip is retired, then the reply',async()=>{
 const f=onDeviceBatchFixture();
 try{
  await f.shell.startVoice();await f.clock.flush();await f.clock.advance(700);f.peak=0;await f.clock.advance(1200);
  assert.equal(f.sends,1);assert.equal(f.activeRecording,null,'the clip capture is retired before any cue');
  const input=f.sendInputs[0];
  progress(input);await f.clock.flush();progress(input);progress(input,{label:'Different later words.'});await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK]);
  f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK,REPLY]);assert.equal(f.s.overlap,false);assert.equal(f.cloudSpeech,0);
 }finally{await closeLive(f);}
});

// --- Streaming Cloud speech through the shared native-cloud-speech.ts module over a port that
// keeps the native bridge's rules (SpeechStreamBridgePlugin, patches/eliza/cloud-speech-native.patch):
// one utterance at a time, and a cancelled utterance drains before the speaker takes the next one;
// audio-end only follows audio-start (the playback exists from the first PCM); Cloud's 'complete'
// with no PCM, and any Cloud error frame, fail the whole session through its error event, and the
// retired session refuses later speech. A refused speak call (audio focus, busy speaker) fails only
// that utterance.
function socketFixture(){
 const clock=voiceFakeClock(),f=viewFixture({cloudProfile:true,clock,holdReply:true});
 loadSession(f);
 const source=fs.readFileSync('.eliza/client-features/packages/voice/src/native-cloud-speech.ts','utf8').replace(/^import .*;\n/gm,'').replaceAll('export function','function').replaceAll('export interface','interface');
 vm.runInNewContext('{'+stripTypeScriptTypes(source)+';globalThis.createSharedCloudStreamingSpeech=createCloudStreamingSpeech;}',f.box);
 const n={spoken:[],refused:[],cancels:0,stops:0,utterance:null,draining:false,holdCancel:false};
 const port={
  async addListener(_event,callback){n.emit=callback;return {remove:async()=>{}};},
  async startCloudSpeech(input){n.sessionId=input.sessionId;return {sessionId:input.sessionId,sampleRate:16000,echoCancelled:true};},
  async stopCloudSpeech(){n.stops++;n.utterance=null;},
  async setCloudSpeechMuted(){},
  async speakCloudSpeech({utteranceId,text}){if(n.retired)throw Error('Invalid speech request');if(n.utterance||n.draining||n.refuse?.(text)){n.refused.push(text);throw Error('Speech could not start');}n.utterance={id:utteranceId,text,started:false};n.spoken.push(text);},
  async cancelCloudSpeech({utteranceId}){n.cancels++;if(n.retired||n.utterance?.id!==utteranceId)return;n.utterance=null;n.draining=true;if(n.holdCancel)await new Promise(resolve=>n.releaseCancel=resolve);n.draining=false;},
 };
 const event=value=>n.emit({sessionId:n.sessionId,...value});
 n.audioStart=()=>{n.utterance.started=true;event({type:'audio-start',utteranceId:n.utterance.id});};
 n.audioEnd=()=>{assert.equal(n.utterance.started,true,'the bridge ends only an utterance whose audio started');const id=n.utterance.id;n.utterance=null;event({type:'audio-end',utteranceId:id});};
 // The bridge's fail(): one error event for the whole session, which is then retired.
 n.fail=code=>{n.retired=true;n.utterance=null;event({type:'error',code});};
 // Cloud's 'complete' for the utterance: played out, or with no PCM a protocol failure.
 n.complete=()=>n.utterance.started?n.audioEnd():n.fail('protocol');
 n.cloudError=()=>n.fail('unavailable');
 n.utter=text=>{event({type:'speech-start'});event({type:'speech-end',text});};
 f.box.nativeCloudStreamingAvailable=()=>true;
 f.box.createCloudStreamingSpeech=input=>f.box.createSharedCloudStreamingSpeech(input,port);
 return Object.assign(f,{clock,n});
}
async function socketTurn(f){
 await f.shell.startVoice();await f.clock.flush();assert.equal(typeof f.n.emit,'function','the speech socket is open');
 f.n.utter('Add lunch with Sam tomorrow.');await f.clock.advance(0);
 assert.equal(f.sends,1);return f.sendInputs[0];
}
async function closeSocket(f){f.n.releaseCancel?.();f.releaseReply?.();await f.clock.flush();f.close();await f.clock.flush();}

test('speech socket: the ack plays once; reply_ready cancels it and the reply starts only after the native cancel drains',async()=>{
 const f=socketFixture(),n=f.n;n.holdCancel=true;
 try{
  const input=await socketTurn(f);
  progress(input);await f.clock.flush();progress(input);await f.clock.flush();
  assert.deepEqual(n.spoken,[ACK]);n.audioStart();await f.clock.flush();
  input.onReplyStarted();f.releaseReply();await f.clock.flush();
  assert.equal(n.cancels,1);assert.deepEqual(n.spoken,[ACK],'no reply request while the cancelled ack drains');
  n.releaseCancel();await f.clock.flush();
  assert.deepEqual(n.spoken,[ACK,REPLY]);assert.deepEqual(n.refused,[],'the native speaker never refuses the reply');
  n.audioStart();n.audioEnd();await f.clock.flush();
  assert.equal(f.renderChat()?.state,'listening');assert.equal(f.cloudSpeech,0);assert.equal(f.uploads,0);
 }finally{await closeSocket(f);}
});

/** Records whether the agent request completed with its reply (the shell's sendVoiceTurn). */
function watchReply(f){const send=f.shell.sendVoiceTurn.bind(f.shell),seen={};f.shell.sendVoiceTurn=input=>send(input).then(reply=>{seen.reply=reply;return reply;},error=>{seen.error=error;throw error;});return seen;}
// The one capture end that may wait for the ack's turn: the bridge's 'protocol' failure while the ack
// was requested, none of its audio played and its turn's request is pending. Cloud completing the
// ack with no audio fails the socket that way. 'protocol' is also the bridge's code for any other
// fault in its message handler, which the renderer cannot tell apart, so such a fault waits too.
test('speech socket: Cloud completes the ack without audio: the ack is silence, the agent request and its reply are kept, then the conversation ends',async()=>{
 const f=socketFixture(),n=f.n,seen=watchReply(f);
 try{
  const input=await socketTurn(f);
  progress(input);await f.clock.flush();assert.deepEqual(n.spoken,[ACK]);
  n.complete();await f.clock.flush();await f.clock.advance(2000);
  assert.equal(input.signal.aborted,false,'the failed ack never cancels the agent request');
  assert.equal(f.renderChat()?.state,'thinking');assert.ok(n.stops>=1,'the failed socket is stopped');
  f.releaseReply();await f.clock.flush();
  assert.equal(seen.error,undefined);assert.equal(seen.reply?.text,REPLY,'the agent request completed with its reply');
  assert.equal(f.renderChat()?.state,'error','the speech socket is gone, so the conversation ends after the turn');
  assert.equal(f.renderChat()?.lastReply,REPLY);assert.match(f.renderChat()?.lines?.[0]?.t,/^Voice stopped\./,'the existing stopped notice');
  assert.deepEqual(n.spoken,[ACK],'nothing is spoken on the retired socket, and no canned line');
 }finally{await closeSocket(f);}
});

test('speech socket: the held end of an ack completed without audio also follows a request that fails',async()=>{
 const f=socketFixture(),n=f.n,send=f.shell.sendVoiceTurn.bind(f.shell);
 f.shell.sendVoiceTurn=input=>send(input).then(()=>{throw Error('Local agent response interrupted.');});
 try{
  const input=await socketTurn(f);
  progress(input);await f.clock.flush();n.complete();await f.clock.flush();
  assert.equal(input.signal.aborted,false);assert.equal(f.renderChat()?.state,'thinking');
  f.releaseReply();await f.clock.flush();
  assert.equal(f.renderChat()?.state,'error','the session ends once the request settles');assert.deepEqual(n.spoken,[ACK]);
 }finally{await closeSocket(f);}
});

test('speech socket: a socket failure with no ack in flight still ends the conversation and cancels the request at once',async()=>{
 const f=socketFixture(),n=f.n,seen=watchReply(f);
 try{
  const input=await socketTurn(f);
  n.cloudError();await f.clock.flush();
  assert.equal(input.signal.aborted,true);assert.equal(f.renderChat()?.state,'error');
  f.releaseReply();await f.clock.flush();assert.equal(seen.reply,undefined);
 }finally{await closeSocket(f);}
});

test('speech socket: a socket failure after the ack played out cancels the request at once, as without an ack',async()=>{
 const f=socketFixture(),n=f.n;
 try{
  const input=await socketTurn(f);
  progress(input);await f.clock.flush();n.audioStart();n.complete();await f.clock.flush();
  n.cloudError();await f.clock.flush();
  assert.equal(input.signal.aborted,true);assert.equal(f.renderChat()?.state,'error');
 }finally{await closeSocket(f);}
});

// The classified code alone never holds: only while the ack is requested and has no audio yet.
for(const [name,before] of [['with no ack in flight',async()=>{}],['after the ack played out',async(f,input)=>{progress(input);await f.clock.flush();f.n.audioStart();f.n.complete();}]])
test(`speech socket: a 'protocol' failure ${name} ends the conversation and cancels the request at once`,async()=>{
 const f=socketFixture(),n=f.n,seen=watchReply(f);
 try{
  const input=await socketTurn(f);
  await before(f,input);await f.clock.flush();
  n.fail('protocol');await f.clock.flush();
  assert.equal(input.signal.aborted,true);assert.equal(f.renderChat()?.state,'error');
  f.releaseReply();await f.clock.flush();assert.equal(seen.reply,undefined);
 }finally{await closeSocket(f);}
});

test('speech socket: an ack the speaker refuses is silence; the reply is spoken and the conversation goes on',async()=>{
 const f=socketFixture(),n=f.n;n.refuse=text=>text===ACK;
 try{
  const input=await socketTurn(f);
  progress(input);await f.clock.flush();assert.deepEqual(n.refused,[ACK]);
  f.releaseReply();await f.clock.flush();
  assert.deepEqual(n.spoken,[REPLY]);n.audioStart();n.complete();await f.clock.flush();
  assert.equal(input.signal.aborted,false);assert.equal(f.renderChat()?.state,'listening');
 }finally{await closeSocket(f);}
});

test('speech socket: Stop after a failed ack cancels the turn, and its held failure stays quiet',async()=>{
 const f=socketFixture(),n=f.n;
 try{
  const input=await socketTurn(f);
  progress(input);await f.clock.flush();n.complete();await f.clock.flush();
  await f.shell.stopVoiceConversation();await f.clock.flush();
  assert.equal(input.signal.aborted,true);assert.equal(f.renderChat()?.state,undefined,'Stop closes the conversation');
  f.releaseReply();await f.clock.flush();
  assert.equal(f.renderChat()?.state,undefined,'no error surfaces after Stop');assert.deepEqual(n.spoken,[ACK]);
 }finally{await closeSocket(f);}
});

test('speech socket: Stop cancels a playing ack and stops the socket; nothing is spoken after Stop',async()=>{
 const f=socketFixture(),n=f.n;
 try{
  const input=await socketTurn(f);
  progress(input);await f.clock.flush();n.audioStart();await f.clock.flush();
  await f.shell.stopVoiceConversation();await f.clock.flush();
  assert.equal(input.signal.aborted,true);assert.equal(n.cancels,1,'the ack is cancelled');assert.ok(n.stops>=1,'and the socket stopped');
  f.releaseReply();await f.clock.flush();
  assert.deepEqual(n.spoken,[ACK]);
 }finally{await closeSocket(f);}
});

test('speech socket: Cloud reports the ack echo after the ack audio ended; it neither interrupts nor is sent',async()=>{
 const f=socketFixture(),n=f.n;
 try{
  const input=await socketTurn(f);
  progress(input);await f.clock.flush();n.audioStart();n.audioEnd();await f.clock.flush();
  n.emit({sessionId:n.sessionId,type:'speech-start'});await f.clock.advance(900);
  n.emit({sessionId:n.sessionId,type:'speech-end',text:'your calendar now'});await f.clock.advance(0);
  assert.equal(input.signal.aborted,false);assert.equal(f.sends,1);
  f.releaseReply();await f.clock.flush();n.audioStart();n.audioEnd();await f.clock.flush();
  assert.deepEqual(n.spoken,[ACK,REPLY]);assert.equal(f.sends,1);
 }finally{await closeSocket(f);}
});

// --- Lifecycle: every capture end other than that held 'protocol' failure stays immediate, exactly
// as without an ack (445e5744). Each case runs twice, with the ack playing and with no ack (a label
// that is silence), and the outcome at the moment of the end must match.
const outcome=(f,input,seen)=>({aborted:input.signal.aborted,state:f.renderChat()?.state,line:f.renderChat()?.lines?.[0]?.t,replied:seen.reply!==undefined});
async function sameAsWithoutAck(run){
 const withAck=await run(ACK),withoutAck=await run('');
 assert.equal(withAck.spoken,1,'the ack was playing');assert.equal(withoutAck.spoken,0);
 assert.deepEqual(withAck.atEnd,withoutAck.atEnd,'the end is handled as without an ack');
 assert.equal(withAck.atEnd.aborted,true,'the request is cancelled at once');
 return withAck.atEnd;
}
// The conversation's own fences: Stop, leaving the view, and an owner session change.
const fences=[['Stop',f=>f.shell.stopVoiceConversation()],['navigation away',f=>f.shell.openView('notes')],['an owner session change',f=>{f.agent='another-agent-session';f.changed();}]];
// The bridge's session failures and retirements (SpeechStreamBridgePlugin fail/retire codes), an
// unknown code and no code; 'protocol' too once the ack's audio has started.
const socketEnds=['call-active','audio-focus-lost','expired','capture','permission-denied','unavailable','connection-lost','playback','closed','an-unknown-code',undefined];
for(const audible of [false,true])for(const code of audible?[...socketEnds,'protocol']:socketEnds)
test(`speech socket: '${code??'no code'}' while the ack ${audible?'plays':'waits for its first audio'} stops the conversation and its request at once`,async()=>{
 const atEnd=await sameAsWithoutAck(async label=>{
  const f=socketFixture(),n=f.n,seen=watchReply(f);
  try{
   const input=await socketTurn(f);
   progress(input,{label});await f.clock.flush();const spoken=n.spoken.length;
   if(audible&&spoken)n.audioStart();await f.clock.flush();
   n.fail(code);await f.clock.flush();
   const result={spoken,atEnd:outcome(f,input,seen)};
   f.releaseReply();await f.clock.flush();assert.equal(seen.reply,undefined,'the cancelled request never completes');assert.equal(n.spoken.length,spoken,'nothing more is spoken');
   return result;
  }finally{await closeSocket(f);}
 });
 assert.equal(atEnd.state,'error');
});

for(const [name,act] of fences)
test(`speech socket: ${name} while the ack plays cancels the ack and the turn at once`,async()=>{
 await sameAsWithoutAck(async label=>{
  const f=socketFixture(),n=f.n,seen=watchReply(f);
  try{
   const input=await socketTurn(f);
   progress(input,{label});await f.clock.flush();const spoken=n.spoken.length;if(spoken)n.audioStart();await f.clock.flush();
   void act(f);await f.clock.flush();
   const result={spoken,atEnd:outcome(f,input,seen)};
   if(spoken)assert.equal(n.cancels,1,'the ack is cancelled');
   f.releaseReply();await f.clock.flush();assert.equal(n.spoken.length,spoken);
   return result;
  }finally{await closeSocket(f);}
 });
});

// Mute closes the capture first, so the socket's later failure reaches no capture: as without an ack.
test('speech socket: Mute during an ack, then a socket failure: handled as without an ack, muted and after Unmute',async()=>{
 const run=async label=>{
  const f=socketFixture(),n=f.n,seen=watchReply(f);
  try{
   const input=await socketTurn(f);
   progress(input,{label});await f.clock.flush();const spoken=n.spoken.length;
   f.renderChat().toggleMute();await f.clock.flush();
   n.fail('protocol');await f.clock.flush();
   const muted=outcome(f,input,seen);
   f.renderChat().toggleMute();await f.clock.flush();
   const unmuted=outcome(f,input,seen);
   return {spoken,muted,unmuted};
  }finally{await closeSocket(f);}
 };
 const withAck=await run(ACK),withoutAck=await run('');
 assert.equal(withAck.spoken,1);assert.equal(withoutAck.spoken,0);
 assert.deepEqual(withAck.muted,withoutAck.muted);assert.deepEqual(withAck.unmuted,withoutAck.unmuted);
 assert.equal(withAck.unmuted.state,'error','Unmute finds the socket gone');assert.equal(withAck.unmuted.aborted,true);
});

// On-device live voice: its own speaker plays the ack, so no capture end is ever the ack's: all
// are immediate ('protocol' included).
const deviceEnds=[
 ['capture failure',Object.assign(Error('Microphone capture was interrupted.'),{code:'capture'})],
 ['phone call',Object.assign(Error('Voice paused.'),{code:'capture',reason:'call-active'})],
 ['audio focus loss',Object.assign(Error('Voice paused.'),{code:'capture',reason:'audio-focus-lost'})],
 ['expiry',Object.assign(Error('Live transcription expired.'),{code:'live-asr',reason:'expired'})],
 ['permission',Object.assign(Error('Microphone permission denied'),{code:'permission-denied'})],
 ['protocol',Object.assign(Error('Cloud streaming speech is unavailable.'),{code:'protocol'})],
 ['unknown code',Object.assign(Error('Something else.'),{code:'an-unknown-code'})],
 ['no error',undefined],
];
for(const audible of [false,true])for(const [name,error] of deviceEnds)
test(`on-device live voice: ${name} while the ack ${audible?'plays':'waits for its first audio'} stops the conversation and its request at once`,async()=>{
 const atEnd=await sameAsWithoutAck(async label=>{
  const f=onDeviceLiveFixture(),seen=watchReply(f);f.s.hold=text=>text===ACK;if(!audible)f.s.holdStart=text=>text===ACK;
  try{
   const input=await liveTurn(f,1300);
   progress(input,{label});await f.clock.flush();const spoken=f.s.plays.length;
   f.s.handlers.onEnd(error);await f.clock.flush();
   const result={spoken,atEnd:outcome(f,input,seen)};
   if(spoken)assert.equal(f.s.plays[0].signal.aborted,true,'the ack is cancelled with its turn');
   f.releaseReply();await f.clock.flush();assert.equal(f.s.plays.length,spoken);
   return result;
  }finally{await closeLive(f);}
 });
 assert.equal(atEnd.state,'error');
});

for(const [name,act] of fences)
test(`on-device live voice: ${name} while the ack plays cancels the ack and the turn at once`,async()=>{
 await sameAsWithoutAck(async label=>{
  const f=onDeviceLiveFixture(),seen=watchReply(f);f.s.hold=text=>text===ACK;
  try{
   const input=await liveTurn(f,1300);
   progress(input,{label});await f.clock.flush();const spoken=f.s.plays.length;
   void act(f);await f.clock.flush();
   const result={spoken,atEnd:outcome(f,input,seen)};
   if(spoken)assert.equal(f.s.plays[0].signal.aborted,true);
   return result;
  }finally{await closeLive(f);}
 });
});

// The recorded-clip loop: its capture is retired before any cue, so no capture can end while the
// ack plays. Stop and navigation cancel the ack and the turn at once; the ack's own playback
// failing for a lifecycle reason is silence and holds nothing (the turn goes on as without an ack).
for(const [name,act] of fences)
test(`native batch: ${name} while the ack plays cancels the ack and the turn at once`,async()=>{
 await sameAsWithoutAck(async label=>{
  const t=await batchTurn({holdPlayback:true}),seen=watchReply(t.f);
  try{
   progress(t.input,{label});await t.clock.flush();const spoken=t.texts().length;
   if(spoken)assert.ok(t.f.activePlayback,'the ack is playing');
   void act(t.f);await t.clock.flush();
   const result={spoken,atEnd:outcome(t.f,t.input,seen)};
   if(spoken)assert.equal(t.f.stopPlaybackInputs?.length,1,'the playing ack is stopped');
   t.f.releaseReply();await t.clock.flush();assert.equal(t.texts().length,spoken,'nothing is spoken after it');
   return result;
  }finally{await closeBatch(t);}
 });
});

for(const code of ['call-active','audio-focus-lost','expired','capture','permission-denied','an-unknown-code'])
test(`native batch: the ack's playback failing for '${code}' is silence and holds nothing; the turn goes on as without an ack`,async()=>{
 const run=async label=>{
  const t=await batchTurn(),seen=watchReply(t.f);const synthesize=t.f.driver.synthesize;
  t.f.driver.synthesize=async input=>{if(input.text!==ACK)return synthesize(input);(t.f.speechInputs??=[]).push(input);throw Object.assign(Error('Speech stopped'),{code});};
  try{
   progress(t.input,{label});await t.clock.flush();const spoken=t.texts().length;
   const during=outcome(t.f,t.input,seen);
   t.f.releaseReply();await t.clock.flush();
   return {spoken,during,after:outcome(t.f,t.input,seen),texts:t.texts().filter(text=>text!==ACK)};
  }finally{await closeBatch(t);}
 };
 const withAck=await run(ACK),withoutAck=await run('');
 assert.equal(withAck.spoken,1);assert.equal(withoutAck.spoken,0);
 assert.deepEqual(withAck.during,withoutAck.during);assert.deepEqual(withAck.after,withoutAck.after);assert.deepEqual(withAck.texts,withoutAck.texts);
 assert.equal(withAck.during.aborted,false);assert.deepEqual(withAck.texts,[REPLY]);
});

// --- The live capture with and without an ack (adapter level: the session's own rules apply).
test('native streaming: with no ack, capture events reach the session as before: held speech interrupts the pending turn after 700 ms',async()=>{
 const f=streamingFixture();
 try{
  const input=await liveTurn(f);
  progress(input,{label:''});await f.clock.flush();assert.deepEqual(f.s.spoken(),[]);
  const h=f.s.handlers;h.onSpeechStart(1);await f.clock.advance(800);
  assert.equal(input.signal.aborted,true);
  h.onSpeechEnd(2);h.onSegment('Move it to noon.');f.releaseReply();await f.clock.advance(0);
  assert.equal(f.sends,2);assert.equal(f.sendInputs[1].text,'Move it to noon.');
 }finally{await closeLive(f);}
});

test('native streaming: speech held in the ack keeps capture order with later speech; only the later words are sent',async()=>{
 const f=streamingFixture();f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  h.onSpeechStart(1);h.onSpeechEnd(2);ack.finish();await f.clock.flush();await f.clock.advance(1600);
  h.onSpeechStart(3);h.onSegment('checking your calendar now');await f.clock.advance(0);
  assert.equal(input.signal.aborted,false,'the held echo carries no transcript');
  h.onSpeechEnd(4);h.onSegment('Move it to noon.');await f.clock.advance(0);
  assert.equal(input.signal.aborted,true,'the later speech interrupts by its transcript');
  f.releaseReply();await f.clock.advance(0);
  assert.equal(f.sends,2);assert.equal(f.sendInputs[1].text,'Move it to noon.');
 }finally{await closeLive(f);}
});

test('native streaming without echo cancellation: speech ignored in the ack never takes a later segment\'s words',async()=>{
 const f=streamingFixture({fullDuplex:false});f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  h.onSpeechStart(1);h.onSpeechEnd(2);ack.finish();await f.clock.flush();await f.clock.advance(1600);
  h.onSpeechStart(3);h.onSpeechEnd(4);
  h.onSegment('Actually make it Friday.');await f.clock.advance(0);
  assert.equal(input.signal.aborted,false,'the words of the ignored segment are not the session\'s');
  h.onSegment('Move it to noon.');await f.clock.advance(0);
  assert.equal(input.signal.aborted,true);
  f.releaseReply();await f.clock.advance(0);
  assert.equal(f.sends,2);assert.equal(f.sendInputs[1].text,'Move it to noon.');
 }finally{await closeLive(f);}
});

// The echo tail is CUE_TAIL_MS (1500 ms) after the ack's audio settles: a start inside it is held
// to its transcript; a start after it is the session's again (its 700 ms rule).
for(const [after,interrupts] of [[1000,false],[1600,true]])
test(`native streaming: speech that starts ${after} ms after the ack audio ended ${interrupts?'interrupts by time again':'is still held to its transcript'}`,async()=>{
 const f=streamingFixture();f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  ack.finish();await f.clock.flush();await f.clock.advance(after);
  h.onSpeechStart(1);await f.clock.advance(800);
  assert.equal(input.signal.aborted,interrupts);
 }finally{await closeLive(f);}
});

test('native streaming: an ack never starts over the user: it is silence while their speech is open',async()=>{
 const f=streamingFixture();
 try{
  const input=await liveTurn(f);const h=f.s.handlers;
  h.onSpeechStart(1);progress(input);await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[],'no ack over the user');
  h.onSpeechEnd(2);h.onSegment(null);await f.clock.advance(0);
  progress(input);await f.clock.flush();assert.deepEqual(f.s.spoken(),[],'one ack per turn: dropped is silence');
  f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[REPLY]);assert.equal(input.signal.aborted,false);
 }finally{await closeLive(f);}
});

test('native streaming: an ack cancelled before its first audio leaves no echo window: held speech interrupts by time, as without an ack',async()=>{
 const f=streamingFixture();f.s.hold=text=>text===ACK;f.s.holdStart=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  input.onReplyStarted();await f.clock.flush();assert.equal(ack.signal.aborted,true);assert.equal(ack.started,undefined,'no ack audio');
  h.onSpeechStart(1);await f.clock.advance(800);
  assert.equal(input.signal.aborted,true);
 }finally{await closeLive(f);}
});

test('native streaming: speech that starts before the ack audio is still checked against the ack: its echo carries no transcript',async()=>{
 const f=streamingFixture();f.s.hold=text=>text===ACK;f.s.holdStart=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  h.onSpeechStart(1);ack.start();h.onSpeechEnd(2);h.onSegment('your calendar now');await f.clock.advance(0);
  assert.equal(input.signal.aborted,false);assert.equal(f.sends,1);
  await f.clock.advance(800);assert.equal(input.signal.aborted,false,'a closed segment never confirms by time');
 }finally{await closeLive(f);}
});

test('native streaming: past the echo window the ack\'s words are the user\'s',async()=>{
 const f=streamingFixture();f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0],h=f.s.handlers;
  ack.finish();await f.clock.flush();await f.clock.advance(9001);
  h.onSpeechStart(1);h.onSpeechEnd(2);h.onSegment('your calendar now');await f.clock.advance(0);
  assert.equal(input.signal.aborted,true);
  f.releaseReply();await f.clock.advance(0);
  assert.equal(f.sends,2);assert.equal(f.sendInputs[1].text,'your calendar now');
 }finally{await closeLive(f);}
});

// Speech ignored in the ack (no echo cancellation) is left open on the closed capture; held speech
// is not, since Mute hands it to the session (below).
test('native streaming without echo cancellation: a reopened capture (Mute, then Unmute) carries no ignored speech or speaking state from the closed one',async()=>{
 const f=streamingFixture({fullDuplex:false});f.s.hold=text=>text===ACK;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();const ack=f.s.plays[0];
  f.s.handlers.onSpeechStart(1);
  f.renderChat().toggleMute();await f.clock.flush();ack.finish();f.releaseReply();await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK,REPLY]);
  f.renderChat().toggleMute();await f.clock.flush();assert.equal(f.s.listens,2);
  const h=f.s.handlers;h.onSpeechStart(1);h.onSpeechEnd(2);h.onSegment('And lunch on Friday.');await f.clock.advance(0);
  assert.equal(f.sends,2);progress(f.sendInputs[1]);await f.clock.flush();
  assert.deepEqual(f.s.spoken(),[ACK,REPLY,ACK],'the next ack plays: the closed capture no longer counts as speaking');
 }finally{await closeLive(f);}
});

// The echo window holds speech only while the ack's own turn request is pending. Each case runs with
// the ack and with no ack (sameAsWithoutAck); the session must see the same thing. Speech ends pass
// Infinity: the session then measures its gaps from the current time.
const liveRoutes=[['native streaming',()=>streamingFixture(),0],['on-device live voice',()=>onDeviceLiveFixture(),1300]];
// After the ack's turn is interrupted, a start is the session's at once, so a pause shorter than the
// session's long gap keeps a correction in one utterance (on-device; streaming endpoints at 0 ms).
for(const [route,make,gapMs] of liveRoutes)
test(`${route}: a barge-in over the ack, then more words after a pause, is endpointed as without an ack`,async()=>{
 const atEnd=await sameAsWithoutAck(async label=>{
  const f=make();f.s.hold=text=>text===ACK;
  try{
   const input=await liveTurn(f,gapMs);
   progress(input,{label});await f.clock.flush();const spoken=f.s.plays.length;const h=f.s.handlers;
   h.onSpeechStart(1);await f.clock.advance(300);h.onSpeechEnd(Infinity);h.onSegment('Wait, put the lunch on');await f.clock.advance(0);
   const aborted=input.signal.aborted;
   // The interrupted request is still settling: its interruption alone ends the window.
   await f.clock.advance(600);h.onSpeechStart(2);await f.clock.advance(900);
   h.onSpeechEnd(Infinity);h.onSegment("Friday's list instead please");await f.clock.advance(0);
   f.releaseReply();await f.clock.advance(gapMs);
   return {spoken,atEnd:{aborted,sent:f.sendInputs.map(value=>value.text)}};
  }finally{await closeLive(f);}
 });
 if(gapMs)assert.deepEqual(atEnd.sent,['Add lunch with Sam tomorrow.',"Wait, put the lunch on Friday's list instead please"]);
});

// Mute finalizes speech up to now: speech held in the ack's window reaches the session at Mute, and
// the closed capture's last segment is then handled as without an ack.
for(const [route,make,gapMs] of liveRoutes)
test(`${route}: Mute while speech held in the ack window is open finalizes it as without an ack`,async()=>{
 const atEnd=await sameAsWithoutAck(async label=>{
  const f=make();f.s.hold=text=>text===ACK;
  try{
   const input=await liveTurn(f,gapMs);
   progress(input,{label});await f.clock.flush();const spoken=f.s.plays.length;const h=f.s.handlers;
   h.onSpeechStart(1);await f.clock.advance(300);
   f.renderChat().toggleMute();await f.clock.flush();
   // The closed capture delivers its open segment's end and final, as a real close does.
   h.onSpeechEnd(Infinity);h.onSegment('Actually make it Friday instead.');await f.clock.advance(0);
   const aborted=input.signal.aborted;
   f.releaseReply();await f.clock.advance(gapMs);
   return {spoken,atEnd:{aborted,muted:f.renderChat().muted,sent:f.sendInputs.map(value=>value.text)}};
  }finally{await closeLive(f);}
 });
 assert.equal(atEnd.muted,'true');assert.deepEqual(atEnd.sent,['Add lunch with Sam tomorrow.','Actually make it Friday instead.']);
});

// Once the ack's turn is answered (its request settled), a start is the session's at once: before
// the reply's first audio, held speech interrupts it after 700 ms, as without an ack.
test('native streaming: once the ack\'s turn is answered, speech in its echo window reaches the session at once',async()=>{
 await sameAsWithoutAck(async label=>{
  const f=streamingFixture();f.s.hold=text=>text===ACK||text===REPLY;f.s.holdStart=text=>text===REPLY;
  try{
   const input=await liveTurn(f);
   progress(input,{label});await f.clock.flush();const spoken=f.s.plays.length;
   f.releaseReply();await f.clock.flush();
   assert.equal(f.s.spoken().at(-1),REPLY,'the reply is requested, its audio not yet started');
   f.s.handlers.onSpeechStart(1);await f.clock.advance(800);
   return {spoken,atEnd:{aborted:input.signal.aborted}};
  }finally{await closeLive(f);}
 });
});

// Speech held in the ack's tail and still open when the ack's turn is answered reaches the session
// then, as at Mute, before the reply's first audio. So a correction spoken across the reply's start
// cuts the reply and is sent, as without an ack, whether it ends on its own or at Mute. Without
// echo cancellation it otherwise reached the session only once the reply played, and was ignored.
for(const fullDuplex of [false,true])for(const mute of [false,true])
test(`native streaming${fullDuplex?'':' without echo cancellation'}: a correction held in the ack's tail and still open when the reply starts ${mute?'and finalized by Mute':'and ending on its own'} cuts the reply and is sent, as without an ack`,async()=>{
 const atEnd=await sameAsWithoutAck(async label=>{
  const f=streamingFixture({fullDuplex});f.s.hold=text=>text===ACK||text===REPLY;
  try{
   const input=await liveTurn(f);
   progress(input,{label});await f.clock.flush();const spoken=f.s.plays.length;
   await f.clock.advance(500);f.s.plays[0]?.finish();await f.clock.flush();
   await f.clock.advance(200);const h=f.s.handlers;h.onSpeechStart(1);
   await f.clock.advance(300);f.releaseReply();await f.clock.flush();
   const reply=f.s.plays.find(play=>play.text===REPLY);assert.equal(reply?.started,true,'the reply plays while the speech is open');
   await f.clock.advance(100);if(mute){f.renderChat().toggleMute();await f.clock.flush();}
   h.onSpeechEnd(Infinity);h.onSegment('No wait, make it Friday instead please.');await f.clock.advance(0);await f.clock.flush();
   return {spoken,atEnd:{aborted:input.signal.aborted,replyCut:reply.signal.aborted,sent:f.sendInputs.map(value=>value.text)}};
  }finally{await closeLive(f);}
 });
 assert.equal(atEnd.replyCut,true);assert.deepEqual(atEnd.sent,['Add lunch with Sam tomorrow.','No wait, make it Friday instead please.']);
});

// The ack's own echo released that way still meets the echo gate: it neither cuts the reply nor is sent.
for(const fullDuplex of [false,true])
test(`native streaming${fullDuplex?'':' without echo cancellation'}: the ack's echo held in its tail and still open when the reply starts neither cuts the reply nor is sent`,async()=>{
 const f=streamingFixture({fullDuplex});f.s.hold=text=>text===ACK||text===REPLY;
 try{
  const input=await liveTurn(f);
  progress(input);await f.clock.flush();f.s.plays[0].finish();await f.clock.flush();
  const h=f.s.handlers;h.onSpeechStart(1);await f.clock.advance(300);
  f.releaseReply();await f.clock.flush();
  const reply=f.s.plays.find(play=>play.text===REPLY);assert.equal(reply?.started,true);
  await f.clock.advance(800);h.onSpeechEnd(Infinity);h.onSegment('your calendar now');await f.clock.advance(0);await f.clock.flush();
  assert.equal(reply.signal.aborted,false);assert.equal(input.signal.aborted,false);assert.equal(f.sends,1);
 }finally{await closeLive(f);}
});

// An owner-review pause closes the microphone and the session drops what it heard, so speech held
// in the ack's window when its turn pauses is dropped with it: past the session's 700 ms rule the
// paused turn and its review stay, the same as a turn with no ack and no speech. Handed to the
// session at the pause instead, its barge-in timer outlived the dropped speech and cut the turn.
const PAUSE={complete:false,awaitingUserInput:{proposalId:'proposal-1',digest:'digest-1'}};
for(const [route,make,gapMs,heldIn] of [['native streaming',()=>streamingFixture(),0,['the ack','its tail']],['native streaming without echo cancellation',()=>streamingFixture({fullDuplex:false}),0,['its tail']],['on-device live voice',()=>onDeviceLiveFixture(),1300,['the ack','its tail']]])
for(const where of heldIn)
test(`${route}: speech held in ${where} when the ack's turn pauses for owner review is dropped; the pause stays`,async()=>{
 const run=async label=>{
  const f=make();f.s.hold=text=>text===ACK;f.badReply=PAUSE;
  try{
   const input=await liveTurn(f,gapMs);
   progress(input,{label});await f.clock.flush();const spoken=f.s.plays.length;
   if(where==='its tail'){f.s.plays[0]?.finish();await f.clock.flush();await f.clock.advance(200);}
   if(label)f.s.handlers.onSpeechStart(1);
   await f.clock.advance(300);f.releaseReply();await f.clock.flush();
   // The session cancelled the capture at the pause: nothing more is heard from it.
   await f.clock.advance(800);await f.clock.flush();
   return {spoken,later:{state:f.renderChat()?.state,aborted:input.signal.aborted,sends:f.sends,replied:f.s.spoken().includes(REPLY)}};
  }finally{await closeLive(f);}
 };
 const withAck=await run(ACK),withoutAck=await run('');
 assert.equal(withAck.spoken,1,'the ack was playing');assert.equal(withoutAck.spoken,0);
 assert.deepEqual(withAck.later,withoutAck.later);
 assert.deepEqual(withAck.later,{state:'awaiting-user-input',aborted:false,sends:1,replied:false});
});

// A 'protocol' failure waits only for a pending turn: once the ack's turn is interrupted (its
// cancelled ack still draining, none of its audio played), the end is immediate.
test('speech socket: a \'protocol\' failure once the ack\'s turn was interrupted ends the conversation at once, as without an ack',async()=>{
 const atEnd=await sameAsWithoutAck(async label=>{
  const f=socketFixture(),n=f.n,seen=watchReply(f);n.holdCancel=true;
  try{
   const input=await socketTurn(f);
   progress(input,{label});await f.clock.flush();const spoken=n.spoken.length;
   n.emit({sessionId:n.sessionId,type:'speech-start'});await f.clock.advance(800);
   assert.equal(input.signal.aborted,true,'held speech interrupts the pending turn');
   n.fail('protocol');await f.clock.flush();
   return {spoken,atEnd:outcome(f,input,seen)};
  }finally{await closeSocket(f);}
 });
 assert.equal(atEnd.state,'error');
});

// --- The ack lives in the owning voice adapter: no Alpha cue module, and no live path claims a
// retired capture (the helper takes null there; the clip loop still requires retirement).
test('the ack is folded into the voice adapter: no cue module, and only the clip loop claims a retired capture',()=>{
 const adapter=fs.readFileSync('apps/app/src/prototype/voice-adapter.ts','utf8');
 assert.equal(fs.existsSync('apps/app/src/runtime/live-voice-cue.ts'),false);
 assert.doesNotMatch(adapter,/captureRetired:\(\)=>true/);
 assert.equal((adapter.match(/cueSpeech=\{captureRetired:/g)||[]).length,2);
 assert.match(adapter,/cueSpeech=\{captureRetired:null,/);
 assert.match(adapter,/cueSpeech=\{captureRetired:\(\)=>batchCaptureRetired,/);
});
