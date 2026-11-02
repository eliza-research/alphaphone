import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {tsImport} from 'tsx/esm/api';
import {cloudVoiceViewFixture,load} from './fixtures/cloud-voice-view.mjs';
import {voiceFakeClock} from './fixtures/shared-batch-voice.mjs';

// The actual adapter over the actual shared voice source projected from the pin: the realtime
// client and microphone capture, the assistant session, Cloud stream and live dictation. Only the
// sensor, audio graph, server and native bridge are synthetic. No microphone or provider is used.
// These rows need the SDK's release commit. Below that pin they run as todo, so the gap stays
// visible; once the pin carries it they are ordinary rows.
const shared='.eliza/client-features/packages/';
const released=fs.readFileSync(shared+'voice/src/voice-assistant-session.ts','utf8').includes('this.unreleased.size')&&fs.readFileSync(shared+'ui/src/voice/voice-session-mic-capture.ts','utf8').includes('VoiceMicReleaseError');
const row=(name,run)=>test(name,released?{}:{todo:'needs the SDK release commit at the pin'},run);

const settle=async f=>{for(let count=0;count<40;count++)await f.tick();};
async function realtimeClient(){
 const out=await build({entryPoints:[shared+'ui/src/voice/voice-session-client-core.ts'],bundle:true,format:'cjs',platform:'browser',write:false,logLevel:'silent',alias:{'@elizaos/host/voice/ui-context':path.resolve(shared,'host/src/voice/ui-context.ts'),'@elizaos/core/view-interaction':path.resolve(shared,'core/src/view-interaction.ts'),'@elizaos/core/logging':path.resolve(shared,'core/src/logging.ts'),'@elizaos/voice/turn':path.resolve(shared,'voice/src/turn.ts'),'@elizaos/core/speech':path.resolve(shared,'core/src/speech.ts')},
  plugins:[{name:'worklet',setup(context){context.onResolve({filter:/\.worklet|audio-worklet-module-urls/},args=>({path:args.path,namespace:'worklet'}));context.onLoad({filter:/.*/,namespace:'worklet'},()=>({contents:'export const resolveAudioWorkletModuleUrl=()=>"";export default ""',loader:'js'}));}}]});
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'voice-release-composed-')),file=path.join(directory,'client.cjs');
 fs.writeFileSync(file,out.outputFiles[0].text);
 try{return createRequire(import.meta.url)(file).createVoiceSessionClient;}finally{fs.rmSync(directory,{recursive:true,force:true});}
}
const createVoiceSessionClient=await realtimeClient();

function realtime(){
 const f=cloudVoiceViewFixture({native:false,platform:'web',account:null}),calls=[],state={clients:0,streams:0,tracks:[],sources:[]};
 const agent={async request(route){calls.push(route);
  if(route.includes('/health'))return {ready:true,conversationId:f.conversation,agentId:'synthetic-agent',speechRoute:'cloud',speechProvider:'cartesia',providerAdmission:'at-session-start'};
  if(route==='/api/views/voice-channel')return {wsUrl:'ws://localhost/__alpha-local-renderer/ws?sessionId=synthetic',expiresAt:Date.now()+120000};
  if(route.includes('/consent'))return {consentNonce:'nonce'};
  if(route.includes('/revoke'))return {revoked:true};
  if(route==='/api/v1/voice/session')return {sessionId:'session-1',token:'one-use',wsUrl:'ws://localhost/voice',expiresAt:Date.now()+600000,uplink:{codecs:['pcm16']},downlink:{codecs:['pcm16']}};
  return {};}};
 Object.assign(f.box.connectionController,{getBrowserSpeechAgent:()=>agent,voiceRendererClientId:()=>'11111111-1111-4111-8111-111111111111',voiceConversationCurrent:()=>true,voiceRendererMetadata:()=>({viewDelivery:'completed-action'}),async refreshDeveloperVoiceHistory(){}});
 const node=()=>({connect(){return this;},disconnect(){}});
 class Socket{constructor(){this.binaryType='blob';this.readyState=0;this.listeners=new Map();queueMicrotask(()=>{this.readyState=1;this.emit('open',{});});}
  addEventListener(type,listener){this.listeners.set(type,[...(this.listeners.get(type)??[]),listener]);}
  emit(type,event){for(const listener of this.listeners.get(type)??[])listener(event);}
  send(data){if(typeof data==='string'&&JSON.parse(data).t==='hello')queueMicrotask(()=>this.emit('message',{data:JSON.stringify({t:'ready',sessionId:'session-1',traceId:'ready-1'})}));}
  close(){if(this.readyState===3)return;this.readyState=3;this.emit('close',{});}}
 Object.assign(f.box,{testMocksEnabled:true,developmentCloudRealtimeVoiceEnabled:true,HTMLElement:class {},React:{createElement:()=>null},VoiceActivity:()=>null,console:{warn(){}},
  validateUuid:()=>true,readDevicePreferences:async()=>({askBeforeAgentActions:true}),location:{host:'localhost'},URL,Response,
  WebSocket:class {constructor(){f.socket=this;queueMicrotask(()=>this.onopen?.());}close(){}},
  loadClient:async()=>({createVoiceSessionClient:options=>{state.clients++;return createVoiceSessionClient({...options,webSocketFactory:()=>new Socket(),
   getUserMedia:async()=>{state.streams++;const track={readyState:'live',enabled:true,stopRefused:false,stop(){if(this.stopRefused)throw Error('track stop refused');this.readyState='ended';}};state.tracks.push(track);return {getTracks:()=>[track],getAudioTracks:()=>[track]};},
   createMicAudioContext:()=>({sampleRate:16000,state:'running',destination:node(),createMediaStreamSource:()=>{const source={...node(),disconnectFault:false,disconnect(){if(this.disconnectFault)throw Error('disconnect refused');}};state.sources.push(source);return source;},createScriptProcessor:()=>({...node(),onaudioprocess:null}),async resume(){},close:()=>state.contextClose?.()??Promise.resolve()}),
   createPlaybackAudioContext:()=>({sampleRate:16000,state:'running',destination:node(),createScriptProcessor:()=>({...node(),onaudioprocess:null}),async resume(){},async close(){}})});}})});
 load('runtime/development-cartesia-conversation.ts',f.box,['developmentCartesiaConversation'],source=>source.replace(/^export \{.*\} from .*;\n/gm,'').replace("await import('@elizaos/ui/voice/voice-session-client')",'await loadClient()'));
 return Object.assign(f,{state,calls});
}
row('realtime: a normal Stop ends the track and returns quietly to Talk',async()=>{
 const f=realtime();
 try{
  await f.shell.startVoice();await settle(f);assert.equal(f.state.tracks.length,1);assert.equal(f.state.tracks[0].readyState,'live');
  f.renderChat().stop();await settle(f);assert.equal(f.state.tracks[0].readyState,'ended');assert.equal(f.renderChat(),null);assert.deepEqual(f.shell.messages,[]);
 }finally{f.close();await settle(f);}
});
row('realtime: a throwing disconnect still ends the live track, and voice returns quietly to Talk',async()=>{
 const f=realtime();
 try{
  await f.shell.startVoice();await settle(f);f.state.sources[0].disconnectFault=true;
  f.renderChat().stop();await settle(f);assert.equal(f.state.tracks[0].readyState,'ended');assert.equal(f.renderChat(),null);
  await f.shell.startVoice();await settle(f);assert.equal(f.state.streams,2);
 }finally{f.close();await settle(f);}
});
row('realtime: a refusing track holds the quiet panel, no plugin stands in, Talk opens nothing, and only its own end returns to Talk',async()=>{
 const f=realtime();
 try{
  await f.shell.startVoice();await settle(f);const track=f.state.tracks[0];track.stopRefused=true;
  f.renderChat().stop();await settle(f);
  assert.equal(track.readyState,'live');assert.equal(f.renderChat().state,'stopping');assert.equal(f.renderChat().problem,false);assert.deepEqual(f.shell.messages,[]);
  assert.equal(f.pluginCancels||0,0);assert.equal(f.recordingCancels.length,0);
  await f.shell.startVoice();await settle(f);assert.equal(f.state.clients,1,'no second paid session');assert.equal(f.state.streams,1);
  f.renderChat().stop();await settle(f);assert.equal(f.renderChat().state,'stopping','still refused');assert.equal(track.readyState,'live');
  track.stopRefused=false;f.renderChat().stop();await settle(f);assert.equal(track.readyState,'ended');assert.equal(f.renderChat(),null);
  assert.equal(f.calls.filter(route=>route.includes('/revoke')).length,1);
  await f.shell.startVoice();await settle(f);assert.equal(f.state.clients,2);assert.equal(f.state.streams,2);
 }finally{for(const track of f.state.tracks)track.stopRefused=false;f.close();await settle(f);}
});
row('realtime: an audio graph whose close never settles holds nothing once the track has ended',async()=>{
 const f=realtime();
 try{
  await f.shell.startVoice();await settle(f);f.state.contextClose=()=>new Promise(()=>{});
  f.renderChat().stop();await settle(f);assert.equal(f.state.tracks[0].readyState,'ended');assert.equal(f.renderChat(),null);
 }finally{f.close();await settle(f);}
});

/** The live route with the real session over the real Cloud stream; `n` is the synthetic bridge. */
function liveStream(){
 const clock=voiceFakeClock(),f=cloudVoiceViewFixture({cloudProfile:true,clock});
 Object.assign(f.box,{React:{createElement:()=>null},VoiceActivity:()=>null,randomId:()=>crypto.randomUUID(),createHeardReporter:()=>({report:async()=>'not-needed'}),recordEndpointVoiceTiming(){},activeVoiceTurn:()=>undefined,recordHeardVoiceTiming(){},shouldRespondToVoiceTurn:()=>true,buildVoiceTurnSignal:()=>({}),toSpeakableText:text=>text,nativeCloudStreamingAvailable:()=>true});
 load('../../../.eliza/client-features/packages/voice/src/voice-assistant-session.ts',f.box,['VoiceAssistantSession']);
 load('../../../.eliza/client-features/packages/voice/src/native-cloud-speech.ts',f.box,['createCloudStreamingSpeech']);
 const create=f.box.createCloudStreamingSpeech,n={open:new Set(),opened:0,stops:0,refuse:false};
 const port={async addListener(_event,callback){n.emit=callback;return {remove:async()=>{}};},
  async startCloudSpeech({sessionId}){if(n.open.size)throw Error('Voice is already active');n.opened++;n.open.add(sessionId);return {sessionId,sampleRate:16000,echoCancelled:true};},
  async stopCloudSpeech({sessionId}){n.stops++;n.releaseMute?.();await n.stopGate;if(n.refuse)throw Error('stopCloudSpeech refused');n.open.delete(sessionId);},
  async setCloudSpeechMuted({muted}){if(muted)await n.muteGate;},async speakCloudSpeech(){},async cancelCloudSpeech(){}};
 f.box.createCloudStreamingSpeech=input=>create(input,port);
 return Object.assign(f,{clock,n});
}
row('live stream: a refused capture stop holds the panel, Talk opens no second paid session, and Stop reaches the bridge again',async()=>{
 const f=liveStream(),{n,clock}=f;
 try{
  await f.shell.startVoice();await clock.flush();assert.equal(n.open.size,1);
  n.refuse=true;f.renderChat().stop();await clock.flush();
  assert.equal(f.renderChat().state,'stopping','the session is still open');assert.equal(f.renderChat().problem,false);assert.equal(n.open.size,1);assert.deepEqual(f.shell.messages,[]);
  await f.shell.startVoice();await clock.flush();assert.equal(n.opened,1,'no second paid session');
  const asked=n.stops;f.renderChat().stop();await clock.flush();assert.ok(n.stops>asked,'Stop reached the bridge');assert.equal(f.renderChat().state,'stopping');
  n.refuse=false;f.renderChat().stop();await clock.flush();assert.equal(n.open.size,0);assert.equal(f.renderChat(),null);
  await f.shell.startVoice();await clock.flush();assert.equal(n.opened,2);assert.equal(f.renderChat().state,'listening');
 }finally{n.refuse=false;f.close();await clock.advance(3000);}
});
row('live stream: Mute, then Stop with the cancel unanswered, holds the panel until the bridge answers',async()=>{
 const f=liveStream(),{n,clock}=f;let answerStop;
 try{
  await f.shell.startVoice();await clock.flush();
  n.muteGate=new Promise(resolve=>n.releaseMute=resolve);f.renderChat().toggleMute();await clock.flush();
  n.stopGate=new Promise(resolve=>answerStop=resolve);f.renderChat().stop();await clock.flush();
  assert.equal(f.renderChat().state,'stopping','the cancel has not answered');assert.equal(n.open.size,1);
  n.stopGate=undefined;answerStop();await clock.advance(3000);assert.equal(n.open.size,0);assert.equal(f.renderChat(),null);
 }finally{n.stopGate=undefined;answerStop?.();f.close();await clock.advance(11000);}
});
row('live stream: a normal Stop asks the bridge once and returns quietly to Talk',async()=>{
 const f=liveStream(),{n,clock}=f;
 try{
  await f.shell.startVoice();await clock.flush();f.renderChat().stop();await clock.flush();
  assert.equal(n.stops,1);assert.equal(n.open.size,0);assert.equal(f.renderChat(),null);assert.deepEqual(f.shell.messages,[]);
  await clock.advance(20000);assert.equal(n.stops,1,'a confirmed stop is asked nothing more');
 }finally{f.close();await clock.advance(3000);}
});

row('on-device live: a refused native stop holds the panel, Talk opens no second capture, and Stop reaches the bridge again',async()=>{
 const {createNativeLiveVoice}=await tsImport(new URL('../'+shared+'voice/src/native-live-voice.ts',import.meta.url).href,{parentURL:import.meta.url});
 const clock=voiceFakeClock(),f=cloudVoiceViewFixture({cloudProfile:false,native:true,platform:'android',clock});
 const open=new Set();let refused=false,starts=0,stops=0;
 const port={async liveCaptureStatus(){return {available:true,nativeTransport:true};},async addListener(){return {remove:async()=>{}};},
  async startLiveCapture({captureId}){if(open.size)throw Error('A capture is already active');starts++;open.add(captureId);return {captureId,sampleRate:16000,echoCancelled:true,nativeAsr:true};},
  async stopLiveCapture({captureId}){stops++;if(refused)throw Error('stopLiveCapture refused');open.delete(captureId);return {captureId,durationMs:1,serverClosed:true};}};
 const voice=createNativeLiveVoice({port,available:()=>true,resident:()=>({sessionId:'agent-session',ownerId:'synthetic-owner',request:async()=>({})})});
 Object.assign(f.box,{React:{createElement:()=>null},VoiceActivity:()=>null,randomId:()=>crypto.randomUUID(),nativeLiveVoiceReady:async()=>true,nativeAssistantListener:options=>voice.assistantListener(options),createEndpointChain:()=>async()=>'unavailable',residentEndpoint:()=>undefined,clefEndpointStage:()=>undefined,recordHeardVoiceTiming(){},recordEndpointVoiceTiming(){},activeVoiceTurn:()=>undefined,createHeardReporter:()=>({report:async()=>'not-needed'}),shouldRespondToVoiceTurn:()=>true,buildVoiceTurnSignal:()=>({}),toSpeakableText:text=>text});
 f.box.connectionController.voiceConversationCurrent=()=>true;
 load('../../../.eliza/client-features/packages/voice/src/voice-assistant-session.ts',f.box,['VoiceAssistantSession']);
 try{
  await f.shell.startVoice();await clock.flush();assert.equal(f.renderChat().state,'listening');assert.equal(open.size,1);
  refused=true;f.renderChat().stop();await clock.flush();
  assert.equal(f.renderChat().state,'stopping');assert.equal(open.size,1);assert.deepEqual(f.shell.messages,[]);
  await f.shell.startVoice();await clock.flush();assert.equal(starts,1,'no second capture');
  const asked=stops;f.renderChat().stop();await clock.flush();assert.ok(stops>asked,'Stop reached the bridge');assert.equal(f.renderChat().state,'stopping');
  refused=false;await clock.advance(3000);assert.equal(open.size,0);assert.equal(f.renderChat(),null,'the timer found its answer');
  await f.shell.startVoice();await clock.flush();assert.equal(starts,2);
 }finally{refused=false;f.close();await clock.advance(3000);}
});
row('live dictation: a refused discard holds the panel, the repeat asks the same capture, and only its answer ends it',async()=>{
 const {createLiveDictation}=await tsImport(new URL('../'+shared+'voice/src/live-voice-session.ts',import.meta.url).href,{parentURL:import.meta.url});
 const f=cloudVoiceViewFixture({cloudProfile:false,native:true,platform:'android'});
 let open=0,refused=true,cancels=0;
 const capture=async()=>{open++;return {startedAt:0,echoCancelled:false,speaking:()=>false,close:async()=>({durationMs:1}),cancel:async()=>{cancels++;if(refused)throw Error('stopLiveCapture refused');open--;}};};
 Object.assign(f.box,{React:{createElement:()=>null},VoiceActivity:()=>null,HTMLElement:class {},nativeLiveVoiceReady:async()=>true,createNativeLiveDictation:()=>createLiveDictation(capture)});
 try{
  f.shell.startTranscription();await settle(f);assert.equal(open,1);assert.equal(f.renderChat().state,'recording');
  f.renderChat().discard();await settle(f);assert.equal(f.renderChat().state,'stopping');assert.equal(open,1);assert.equal(cancels,1);
  f.renderChat().stop();await settle(f);assert.equal(f.renderChat().state,'stopping','the held Stop proves nothing while the capture refuses');assert.equal(cancels,2);assert.equal(open,1);
  f.shell.startTranscription();await settle(f);assert.equal(open,1,'no capture over it');
  refused=false;f.renderChat().stop();await settle(f);assert.equal(open,0);assert.equal(f.renderChat(),null);
 }finally{refused=false;f.close();await settle(f);}
});

/** Dictation over the real native live voice; `n` is the synthetic bridge. */
async function nativeDictation(){
 const {createNativeLiveVoice}=await tsImport(new URL('../'+shared+'voice/src/native-live-voice.ts',import.meta.url).href,{parentURL:import.meta.url});
 const n={open:new Set(),refused:false,starts:0,stops:0};
 const port={async liveCaptureStatus(){return {available:true,nativeTransport:true};},async addListener(){return {remove:async()=>{}};},
  async startLiveCapture({captureId}){n.starts++;if(n.denied)throw n.denied;n.open.add(captureId);if(n.failStart)throw n.failStart;return {captureId,sampleRate:16000,echoCancelled:false,nativeAsr:true};},
  async stopLiveCapture({captureId}){n.stops++;if(n.refused)throw Error('stopLiveCapture refused');n.open.delete(captureId);return {captureId,durationMs:1,serverClosed:true};}};
 const voice=createNativeLiveVoice({port,available:()=>true,resident:()=>({sessionId:'agent-session',ownerId:'synthetic-owner',request:async()=>({})})});
 const f=cloudVoiceViewFixture({cloudProfile:false,native:true,platform:'android'});
 Object.assign(f.box,{React:{createElement:()=>null},VoiceActivity:()=>null,HTMLElement:class {},nativeLiveVoiceReady:async()=>true,createNativeLiveDictation:()=>voice.dictation()});
 return Object.assign(f,{n});
}
row('live dictation: a failed open whose native stop refused holds the panel, Discard holds, the next Transcribe opens nothing, and only its answer frees it',async()=>{
 const f=await nativeDictation(),{n}=f;
 try{
  n.refused=true;n.failStart=Error('start failed after the input opened');
  f.shell.startTranscription();await settle(f);
  assert.equal(f.renderChat().state,'stopping');assert.notEqual(f.renderChat().primaryLabel,'Start recording');assert.equal(n.open.size,1);assert.equal(n.starts,1);assert.deepEqual(f.shell.messages,[]);
  const asked=n.stops;f.renderChat().discard();await settle(f);assert.equal(f.renderChat().state,'stopping','Discard holds');assert.ok(n.stops>asked,'Discard reached the bridge');
  n.failStart=undefined;f.shell.startTranscription();await settle(f);assert.equal(n.starts,1,'no second capture over it');assert.equal(n.open.size,1);
  n.refused=false;f.renderChat().discard();await settle(f);assert.equal(n.open.size,0);assert.equal(f.renderChat().state,'ready');
  f.renderChat().stop();await settle(f);assert.equal(n.starts,2);assert.equal(f.renderChat().state,'recording');
 }finally{n.refused=false;n.failStart=undefined;f.close();await settle(f);}
});
row('live dictation: a plain denied start asks once and holds nothing',async()=>{
 const f=await nativeDictation(),{n}=f;
 try{
  n.denied=Object.assign(Error('denied'),{code:'permission-denied'});
  f.shell.startTranscription();await settle(f);
  assert.equal(n.stops,1);assert.equal(n.open.size,0);assert.notEqual(f.renderChat().state,'stopping');assert.deepEqual(f.shell.messages,[]);
  f.renderChat().discard();await settle(f);assert.equal(f.renderChat(),null);assert.equal(n.stops,1);
  n.denied=undefined;f.shell.startTranscription();await settle(f);assert.equal(n.starts,2);assert.equal(f.renderChat().state,'recording');
 }finally{f.close();await settle(f);}
});

/** Dictation over the real live dictation, on a capture this row controls. */
async function controlledDictation(options){
 const {createLiveDictation}=await tsImport(new URL('../'+shared+'voice/src/live-voice-session.ts',import.meta.url).href,{parentURL:import.meta.url});
 const c={live:0,cancels:0,refused:false,opens:0};
 const capture=async input=>{c.opens++;c.live++;c.lost=input.onLost;return {startedAt:0,echoCancelled:false,speaking:()=>false,close:async()=>{if(c.closeError)throw c.closeError;c.live--;return {durationMs:1};},cancel:async()=>{c.cancels++;if(c.refused)throw Error('stopLiveCapture refused');c.live--;}};};
 const f=cloudVoiceViewFixture({cloudProfile:false,native:true,platform:'android'});
 Object.assign(f.box,{React:{createElement:()=>null},VoiceActivity:()=>null,HTMLElement:class {},nativeLiveVoiceReady:async()=>true,createNativeLiveDictation:()=>createLiveDictation(capture,options)});
 f.shell.startTranscription();await settle(f);assert.equal(f.renderChat().state,'recording');
 return Object.assign(f,{c});
}
for(const [name,options,end] of [
 ['a Stop whose finalize fails',undefined,async f=>{f.c.closeError=Error('close unconfirmed');f.renderChat().stop();await settle(f);}],
 ['a lost capture',undefined,async f=>{f.c.lost(Error('route gone'));await settle(f);}],
 ['a timer finish that fails',{maxDurationMs:1000},async f=>{f.c.closeError=Error('close unconfirmed');await new Promise(resolve=>setTimeout(resolve,1100));await settle(f);}],
])row(`live dictation: ${name} with its cancel refused holds the quiet panel, Discard asks again, and only its answer returns to ready`,async()=>{
 const f=await controlledDictation(options),{c}=f;
 try{
  c.refused=true;await end(f);
  assert.equal(f.renderChat().state,'stopping');assert.notEqual(f.renderChat().primaryLabel,'Start recording');assert.equal(c.live,1);assert.deepEqual(f.shell.messages,[]);
  const asked=c.cancels;assert.ok(asked>=1);f.renderChat().discard();await settle(f);assert.equal(c.cancels,asked+1);assert.equal(f.renderChat().state,'stopping');
  f.shell.startTranscription();await settle(f);assert.equal(c.opens,1,'no capture over it');
  c.refused=false;f.renderChat().discard();await settle(f);assert.equal(c.live,0);assert.equal(f.renderChat().state,'ready');assert.equal(f.renderChat().primaryLabel,'Start recording');
 }finally{c.refused=false;f.close();await settle(f);}
});
row('live dictation: a too-short Stop that the capture confirms returns to ready with no line',async()=>{
 const f=await controlledDictation(),{c}=f;
 try{
  c.closeError=Error('too short');f.renderChat().stop();await settle(f);
  assert.equal(c.live,0);assert.equal(c.cancels,1,'one capture answer');assert.equal(f.renderChat().state,'ready');assert.doesNotMatch(f.renderChat().lines[0].t,/^Stopping/);assert.deepEqual(f.shell.messages,[]);
 }finally{f.close();await settle(f);}
});
