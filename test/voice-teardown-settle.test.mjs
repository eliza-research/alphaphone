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
const still='Voice is still finishing. Try again in a moment, or use the keyboard.';

/** Realtime Cloud voice through the developer agent. `revoke` answers a ticket retirement through the relay;
 * `stop` is the SDK client's own local release. */
function realtime({revoke=()=>({revoked:true}),stop=async()=>{},clock}={}){
 const f=cloudVoiceViewFixture({native:false,platform:'web',account:null,clock});
 const sdk={clients:0,starts:0,stops:0,muted:false},calls=[];
 const agent={async request(path){calls.push(path);
  if(path.includes('/health'))return {ready:true,conversationId:f.conversation,agentId:'synthetic-agent',speechRoute:'cloud',speechProvider:'cartesia',providerAdmission:'at-session-start'};
  if(path==='/api/views/voice-channel')return {wsUrl:'ws://localhost/__alpha-local-renderer/ws?sessionId=synthetic',expiresAt:(clock?.Date??Date).now()+120000};
  if(path.includes('/revoke'))return revoke();
  return {};}};
 Object.assign(f.box.connectionController,{getBrowserSpeechAgent:()=>agent,voiceRendererClientId:()=>'11111111-1111-4111-8111-111111111111',voiceConversationCurrent:()=>true,voiceRendererMetadata:()=>({viewDelivery:'completed-action'}),async refreshDeveloperVoiceHistory(){}});
 Object.assign(f.box,{testMocksEnabled:true,developmentCloudRealtimeVoiceEnabled:true,HTMLElement:class {},React:{createElement:()=>null},VoiceActivity:()=>null,
  validateUuid:()=>true,readDevicePreferences:async()=>({askBeforeAgentActions:true}),location:{host:'localhost'},URL,Response,
  WebSocket:class {constructor(){queueMicrotask(()=>this.onopen?.());}close(){this.closed=true;}},
  loadClient:async()=>({createVoiceSessionClient:options=>{const client=++sdk.clients;sdk.options=options;return {
   async start(){sdk.starts++;options.onMinted({sessionId:'session-'+client});options.onState({phase:'listening',traceId:null,finalTranscript:''});},
   async stop(){sdk.stops++;sdk.muted=false;await stop();},get microphoneMuted(){return sdk.muted;},setMicrophoneMuted(value){sdk.muted=value;},needsPlaybackUnlock:false,async unlockPlayback(){}};}})});
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

/**
 * Recorded-clip Cloud voice. A recorder stop takes effect when it answers, as a late native answer
 * would: it ends whatever capture is active then. While `hold` is set, stops wait for `answerAll`.
 * `force` is how the plugin's own local stop of every capture and playback answers: BrowserVoice
 * cancel() in a browser; on the phone, AlphaVoiceCloud stopPlayback() beside its cancelRecording().
 * `overlaps` counts captures started while an older one was still active.
 */
const platforms=[{native:false,platform:'web'},{native:true,platform:'android'}];
function batch(platform){
 const clock=voiceFakeClock();
 const f=cloudVoiceViewFixture({cloudProfile:true,...platform,clock,peak:.5});
 f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;
 Object.assign(f,{clock,held:[],forced:0,overlaps:0,force:'answer',hold:false});
 const start=f.driver.startRecording;
 f.driver.startRecording=async()=>{if(f.activeRecording!==null)f.overlaps++;return start();};
 const stop=()=>new Promise((resolve,reject)=>{
  const answer=error=>{if(error)reject(error);else{f.activeRecording=null;resolve();}};
  if(f.hold)f.held.push(answer);else answer(f.cancelError);
 });
 f.driver.cancelRecording=stop;
 // On the phone the capture itself ends with its own cancelRecording() answer.
 const ended=()=>{if(!platform.native)f.activeRecording=null;};
 const own=async()=>{f.forced++;
  if(f.force==='reject')throw Error('The recorder did not answer its stop.');
  if(f.force==='hang')return new Promise(resolve=>f.held.push(()=>{ended();resolve();}));
  ended();};
 if(platform.native){const scoped=f.driver.stopPlayback;f.driver.stopPlayback=input=>input?scoped(input):own();}
 else f.driver.cancel=async input=>{if(!input)return own();};
 f.answerAll=async()=>{for(const answer of f.held.splice(0))answer();await clock.flush();};
 return f;
}
const calm=f=>{assert.deepEqual(f.shell.messages,[],'no toast');assert.doesNotMatch(JSON.stringify(f.renderChat()??null),stuck);};

for(const platform of platforms)test(platform.platform+': '+'a hung capture stop and a hung forced stop keep the new microphone blocked while chat stays usable',async()=>{
 const f=batch(platform),{clock}=f;
 try{
  await f.shell.startVoice();await clock.flush();assert.equal(f.renderChat().state,'listening');assert.equal(f.starts,1);
  f.hold=true;f.force='hang';
  f.renderChat().stop();await clock.flush();assert.equal(f.renderChat().state,'stopping');
  f.renderChat().stop();f.shell.back();await f.shell.startVoice();await clock.flush();
  assert.equal(f.starts,1);calm(f);
  await clock.advance(2999);assert.equal(f.renderChat().state,'stopping');assert.equal(f.forced,0);
  await clock.advance(1);assert.equal(f.renderChat(),null,'the stopping view settles after the bound');
  assert.equal(f.shell.renderVals().chatVoiceActive,false,'chat is usable');assert.equal(f.forced,1);
  assert.equal(f.activeRecording,'synthetic-clip-1','the old capture has not confirmed its stop');
  f.hold=false;
  void f.shell.startVoice();await clock.flush();assert.equal(f.renderChat().state,'starting','voice waits for the old stop');
  await clock.advance(5000);assert.equal(f.renderChat().state,'error');assert.equal(f.renderChat().lines[0].t,still);
  assert.equal(f.starts,1,'no new capture while the old one may be active');assert.equal(f.overlaps,0);calm(f);
  f.renderChat().recover();await clock.advance(5000);assert.equal(f.starts,1);assert.equal(f.renderChat().lines[0].t,still);calm(f);
  await f.answerAll();
  f.renderChat().recover();await clock.flush();
  assert.equal(f.renderChat().state,'listening');assert.equal(f.starts,2);assert.equal(f.overlaps,0);
  await clock.advance(300);assert.equal(f.activeRecording,'synthetic-clip-2');assert.equal(f.renderChat().state,'listening');
  assert.equal(f.uploads,0);assert.equal(f.sends,0);calm(f);
 }finally{f.hold=false;await f.answerAll();f.close();await clock.flush();}
});

for(const platform of platforms)test(platform.platform+': '+'a late successful answer from an old capture stop never ends the newer capture',async()=>{
 const f=batch(platform),{clock}=f;
 try{
  await f.shell.startVoice();await clock.flush();assert.equal(f.renderChat().state,'listening');
  f.hold=true;
  f.renderChat().stop();await clock.flush();
  await clock.advance(3000);assert.equal(f.renderChat(),null);assert.equal(f.forced,1);
  // In a browser the plugin's own stop ends the old capture at once; on the phone it queues behind the held stop.
  assert.equal(f.activeRecording,platform.native?'synthetic-clip-1':null);
  f.hold=false;
  void f.shell.startVoice();await clock.flush();
  await clock.advance(5000);assert.equal(f.starts,1,'the old stop is still running, so no capture starts yet');
  assert.equal(f.renderChat().lines[0].t,still);calm(f);
  // The old stops now answer, with success: they end whatever capture is active then.
  await f.answerAll();
  f.renderChat().recover();await clock.flush();
  assert.equal(f.renderChat().state,'listening');assert.equal(f.starts,2);
  await clock.advance(300);
  assert.equal(f.activeRecording,'synthetic-clip-2','a late answer never ends the newer capture');assert.equal(f.renderChat().state,'listening');
  assert.equal(f.overlaps,0);assert.equal(f.sends,0);calm(f);
 }finally{f.hold=false;await f.answerAll();f.close();await clock.flush();}
});

for(const platform of platforms)test(platform.platform+': '+'a failed capture stop and a refused forced stop keep voice blocked until the plugin confirms on the next start',async()=>{
 const f=batch(platform),{clock}=f;
 try{
  await f.shell.startVoice();await clock.flush();assert.equal(f.renderChat().state,'listening');
  f.cancelError=Error('The recorder stop failed.');f.force='reject';
  f.renderChat().stop();await clock.flush();assert.equal(f.renderChat()?.state,'stopping','a refused stop is not a confirmed one');assert.equal(f.forced,1);
  await clock.advance(3000);assert.equal(f.renderChat(),null,'a refused stop never latches chat');
  assert.equal(f.activeRecording,'synthetic-clip-1','the old capture is still active');
  void f.shell.startVoice();await clock.flush();
  await clock.advance(5000);assert.equal(f.renderChat().state,'error');assert.equal(f.renderChat().lines[0].t,still);
  assert.equal(f.starts,1);assert.equal(f.overlaps,0);calm(f);
  const tried=f.forced;await clock.advance(30000);assert.equal(f.forced,tried,'nothing retries on its own');
  f.cancelError=undefined;f.force='answer';
  f.renderChat().recover();await clock.flush();await clock.flush();
  assert.equal(f.forced,tried+1,'the next start asks the plugin once more');
  assert.equal(f.renderChat().state,'listening');assert.equal(f.starts,2);assert.equal(f.overlaps,0);
  await clock.advance(300);assert.equal(f.activeRecording,'synthetic-clip-2');calm(f);
 }finally{f.cancelError=undefined;f.force='answer';f.close();await clock.flush();}
});

for(const platform of platforms)test(platform.platform+': '+'an old capture whose start answers after a newer capture began never stops the newer one',async()=>{
 const f=batch(platform),{clock}=f;
 try{
  // Stop while the microphone is still being acquired (a permission prompt, say).
  f.holdStart=true;void f.shell.startVoice();await clock.flush();assert.equal(f.starts,1);
  const lateStart=f.releaseStart;
  f.renderChat().stop();await clock.flush();
  await clock.advance(3000);assert.equal(f.renderChat(),null);assert.equal(f.forced,1);
  f.holdStart=false;
  // The new start's own release waits for that acquisition, then is forced after its bound.
  void f.shell.startVoice();await clock.advance(3000);await clock.flush();
  assert.equal(f.renderChat().state,'listening');assert.equal(f.starts,2);assert.equal(f.forced,2);
  // The old acquisition now answers, cancelled as the plugin's own stop left it.
  f.startError=new DOMException('Recording cancelled','AbortError');lateStart({recordingId:'synthetic-clip-1',maxDurationMs:59000});await clock.flush();f.startError=undefined;
  await clock.advance(300);
  assert.equal(f.activeRecording,'synthetic-clip-2','the old capture issues no stop once a newer one owns the recorder');
  assert.equal(f.renderChat().state,'listening');assert.equal(f.sends,0);calm(f);
 }finally{f.holdStart=false;f.startError=undefined;f.close();await clock.flush();}
});

test('a realtime client whose own stop has not answered keeps new voice and relay blocked, while chat stays usable',async()=>{
 const clock=voiceFakeClock();let answer;
 const f=realtime({clock,stop:()=>new Promise(resolve=>answer=resolve)});
 try{
  await f.shell.startVoice();await clock.flush();assert.equal(f.renderChat().state,'listening');
  f.renderChat().stop();await clock.flush();assert.equal(f.renderChat().state,'stopping');
  await clock.advance(3000);assert.equal(f.renderChat(),null,'the stopping view settles');assert.equal(f.shell.renderVals().chatVoiceActive,false);
  void f.shell.startVoice();await clock.flush();assert.equal(f.renderChat().state,'starting');
  await clock.advance(5000);assert.equal(f.renderChat().state,'error');assert.equal(f.renderChat().lines[0].t,still);
  assert.equal(f.sdk.clients,1,'no new microphone or relay session while the old client may hold them');
  assert.equal(f.revokes().length,0,'ticket retirement waits for the local release');
  assert.deepEqual(f.shell.messages,[]);
  answer();await clock.flush();assert.equal(f.revokes().length,1,'then it runs once, in the background');
  f.renderChat().recover();await clock.flush();
  assert.equal(f.renderChat().state,'listening');assert.equal(f.sdk.clients,2);assert.equal(f.sends,0);assert.deepEqual(f.shell.messages,[]);
 }finally{answer?.();f.close();await clock.flush();}
});
