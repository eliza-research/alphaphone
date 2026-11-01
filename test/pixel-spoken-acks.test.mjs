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
const progress=(input,patch={})=>input.onProgress({turnId:input.turnId,conversationId:input.binding.conversationId,ownerId:input.binding.session.ownerId,kind:'thinking',label:ACK,...patch});
const silent=[{label:''},{label:'   '},{label:undefined},{label:'x'.repeat(161)},{kind:'running_tool',toolName:'calendar.read',label:undefined},{kind:'running_action',actionName:'CALENDAR',label:'Using Calendar'}];

// The views run in a VM realm with the host's DOMException; as in the app's WebView, an
// AbortError must also be an Error there, so the realm shares the host's Error.
function viewFixture(options){const f=cloudVoiceViewFixture(options);f.box.Error=Error;return f;}

// --- Batch fallback (streaming route absent, or direct inference): one Cloud TTS request per cue.
async function batchTurn(options={}){
 const clock=voiceFakeClock(),f=viewFixture({cloudProfile:true,clock,peak:.5,holdReply:true,...options});
 f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;
 await f.shell.startVoice();await clock.flush();await clock.advance(700);f.peak=0;await clock.advance(1200);
 assert.equal(f.native,true);assert.equal(f.sends,1);assert.equal(f.activeRecording,null,'the clip capture is retired before any cue');
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
/** One speaker for the live paths: `hold` keeps matching speech playing; `holdCancel` keeps its cancellation pending. */
function speaker(){
 const s={plays:[],hold:()=>false,holdCancel:false,overlap:false};
 s.speak=(text,signal,onStarted)=>{
  signal.throwIfAborted();
  if(s.plays.some(play=>play.active))s.overlap=true;
  const play={text,signal,active:true};s.plays.push(play);
  return new Promise((resolve,reject)=>{
   onStarted?.();
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
