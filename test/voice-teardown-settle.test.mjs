import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {cloudVoiceViewFixture} from './fixtures/cloud-voice-view.mjs';
import {voiceFakeClock} from './fixtures/shared-batch-voice.mjs';

// The actual voice adapter with the actual realtime conversation module. Only the SDK voice client,
// the developer agent (and its relay to Cloud) and the renderer socket are synthetic: no microphone,
// provider, network or Cloud account is used.
const realtimeSource=stripTypeScriptTypes(readFileSync('apps/app/src/runtime/development-cartesia-conversation.ts','utf8')
 .replace(/^import .*;\n/gm,'').replace(/^export \{.*\} from .*;\n/gm,'').replace("await import('@elizaos/ui/voice/voice-session-client')",'await loadClient()').replace(/^export /gm,''),{mode:'transform'});
const stuck=/Close the app|still stopping|Could not confirm|not finished stopping/;
const settle=async f=>{for(let count=0;count<20;count++)await f.tick();};

/** Realtime Cloud voice through the developer agent. `revoke` answers a ticket retirement through the relay. */
function realtime({revoke=()=>({revoked:true})}={}){
 const f=cloudVoiceViewFixture({native:false,platform:'web',account:null});
 const sdk={clients:0,starts:0,stops:0,muted:false},calls=[];
 const agent={async request(path){calls.push(path);
  if(path.includes('/health'))return {ready:true,conversationId:f.conversation,agentId:'synthetic-agent',speechRoute:'cloud',speechProvider:'cartesia',providerAdmission:'at-session-start'};
  if(path==='/api/views/voice-channel')return {wsUrl:'ws://localhost/__alpha-local-renderer/ws?sessionId=synthetic',expiresAt:Date.now()+120000};
  if(path.includes('/revoke'))return revoke();
  return {};}};
 Object.assign(f.box.connectionController,{getBrowserSpeechAgent:()=>agent,voiceRendererClientId:()=>'11111111-1111-4111-8111-111111111111',voiceConversationCurrent:()=>true,voiceRendererMetadata:()=>({viewDelivery:'completed-action'}),async refreshDeveloperVoiceHistory(){}});
 Object.assign(f.box,{testMocksEnabled:true,developmentCloudRealtimeVoiceEnabled:true,HTMLElement:class {},React:{createElement:()=>null},VoiceActivity:()=>null,
  validateUuid:()=>true,readDevicePreferences:async()=>({askBeforeAgentActions:true}),location:{host:'localhost'},URL,Response,
  WebSocket:class {constructor(){queueMicrotask(()=>this.onopen?.());}close(){this.closed=true;}},
  loadClient:async()=>({createVoiceSessionClient:options=>{const client=++sdk.clients;sdk.options=options;return {
   async start(){sdk.starts++;options.onMinted({sessionId:'session-'+client});options.onState({phase:'listening',traceId:null,finalTranscript:''});},
   async stop(){sdk.stops++;sdk.muted=false;},get microphoneMuted(){return sdk.muted;},setMicrophoneMuted(value){sdk.muted=value;},needsPlaybackUnlock:false,async unlockPlayback(){}};}})});
 vm.runInNewContext(realtimeSource+';globalThis.developmentCartesiaConversation=developmentCartesiaConversation;',f.box);
 const revokes=()=>calls.filter(path=>path.includes('/revoke'));
 // The SDK reduces each frame into accepted state before the raw callback (see development-cartesia-conversation.test.mjs).
 const turn=traceId=>{sdk.options.onState({phase:'thinking',traceId,finalTranscript:'check my notes'});sdk.options.onServerEvent({t:'stt_final',text:'check my notes',traceId});};
 return Object.assign(f,{sdk,calls,revokes,turn});
}
const relayDown=()=>{throw Object.assign(Error('Relay unavailable'),{status:503});};

test('a relay transport loss mid-turn ends realtime voice with one calm line, and voice starts again',async()=>{
 const f=realtime({revoke:relayDown});
 try{
  await f.shell.startVoice();assert.equal(f.renderChat().state,'listening');
  f.turn('turn-1');assert.equal(f.renderChat().muteAutomatically,true,'the microphone is held while Alpha works');
  f.sdk.options.onError(Error('voice session lost: server_error'));await settle(f);
  // The owner's panel may still be open on an older build; a Stop tap must never latch.
  f.renderChat()?.stop();await settle(f);
  assert.equal(f.renderChat(),null,'voice retired; nothing is stopping');
  assert.deepEqual(f.shell.messages,['Voice stopped. Tap the mic to talk again.']);
  assert.equal(f.sdk.stops,1);assert.equal(f.revokes().length,1,'the ticket retirement was tried once in the background');
  await f.shell.startVoice();
  assert.equal(f.renderChat().state,'listening');assert.equal(f.sdk.clients,2);assert.equal(f.sdk.starts,2);
  assert.equal(f.revokes().length,1,'nothing is retried or replayed');assert.equal(f.sends,0);
  assert.doesNotMatch(f.shell.messages.join('\n'),stuck);
 }finally{f.close();await settle(f);}
});

for(const [name,revoke] of [['refuses',relayDown],['never answers',()=>new Promise(()=>{})]])test(`Stop after a realtime error settles when the relay ${name} ticket retirement`,async()=>{
 const f=realtime({revoke});
 try{
  await f.shell.startVoice();f.turn('turn-1');
  f.sdk.options.onError(Error('The voice renderer disconnected. Start voice again.'));await settle(f);
  assert.equal(f.renderChat().state,'error');
  f.renderChat().stop();await settle(f);
  f.shell.back();f.renderChat()?.stop();await settle(f);
  assert.equal(f.renderChat(),null);assert.deepEqual(f.shell.messages,[],'a user Stop needs no extra line');
  assert.equal(f.revokes().length,1);
  await f.shell.startVoice();assert.equal(f.renderChat().state,'listening');assert.equal(f.sdk.starts,2);
  assert.doesNotMatch(f.shell.messages.join('\n'),stuck);
 }finally{f.close();await settle(f);}
});

test('normal realtime Stop, Mute, a normal turn and Back are unchanged, and voice starts again',async()=>{
 const f=realtime();
 try{
  await f.shell.startVoice();
  f.renderChat().toggleMute();assert.equal(f.sdk.muted,true);assert.equal(f.renderChat().muted,'true');
  f.renderChat().toggleMute();assert.equal(f.sdk.muted,false);
  f.turn('turn-1');assert.equal(f.renderChat().muteAutomatically,true);
  f.sdk.options.onServerEvent({t:'usage',traceId:'turn-1',sttMs:0,ttsChars:0});assert.equal(f.renderChat().muteAutomatically,false,'the hold ends with its own receipt');
  f.renderChat().stop();await settle(f);
  assert.equal(f.renderChat(),null);assert.equal(f.sdk.stops,1);assert.equal(f.revokes().length,1);
  await f.shell.startVoice();assert.equal(f.renderChat().state,'listening');
  f.shell.back();await settle(f);
  assert.equal(f.renderChat(),null,'Back still ends voice');assert.equal(f.sdk.stops,2);assert.equal(f.revokes().length,2);
  assert.deepEqual(f.shell.messages,[]);
 }finally{f.close();await settle(f);}
});

test('a batch capture release that never settles retires after a bounded wait, and voice starts again',async()=>{
 const clock=voiceFakeClock();
 const f=cloudVoiceViewFixture({cloudProfile:true,native:false,platform:'web',clock,peak:.5});
 f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;
 try{
  await f.shell.startVoice();await clock.flush();assert.equal(f.renderChat().state,'listening');assert.equal(f.starts,1);
  f.holdCaptureCancel=true;
  let released=0;f.driver.cancel=async input=>{if(!input)released++;};
  f.renderChat().stop();await clock.flush();assert.equal(f.renderChat().state,'stopping');
  f.renderChat().stop();f.shell.back();await f.shell.startVoice();await clock.flush();
  assert.equal(f.starts,1);assert.deepEqual(f.shell.messages,[],'taps while stopping add no toasts');
  await clock.advance(2999);assert.equal(f.renderChat().state,'stopping');assert.equal(released,0);
  await clock.advance(1);assert.equal(f.renderChat(),null);assert.equal(released,1,'the browser recorder and speaker are released outright');
  f.holdCaptureCancel=false;
  void f.shell.startVoice();await clock.flush();assert.equal(f.starts,2);assert.equal(f.renderChat().state,'listening');
  // The old native call finally answers, with a failure: it never releases the new capture.
  f.captureCancelError=Error('Late capture cancel failed');f.releaseCaptureCancel();await clock.advance(300);f.captureCancelError=undefined;
  assert.equal(released,1);assert.equal(f.renderChat().state,'listening','a late failure never stops the new capture');assert.equal(f.activeRecording,'synthetic-clip-2');
  assert.equal(f.uploads,0);assert.equal(f.sends,0);assert.doesNotMatch(f.shell.messages.join('\n'),stuck);
 }finally{f.holdCaptureCancel=false;f.releaseCaptureCancel?.();f.close();await clock.flush();}
});
