import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudVoiceViewFixture,load} from './fixtures/cloud-voice-view.mjs';

// The actual voice adapter with a synthetic session whose stop can be refused, then the actual
// realtime conversation module with a synthetic relay. No microphone, provider or account is used.
const settle=async f=>{for(let count=0;count<20;count++)await f.tick();};
const platforms=[{native:true,platform:'android'},{native:false,platform:'web'}];
const forcedStops=f=>f.native?(f.stopPlaybackInputs||[]).filter(input=>input===undefined).length:f.pluginCancels||0;
function session(options){
 const f=cloudVoiceViewFixture({cloudProfile:true,sessions:0,...options});
 f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;
 f.box.BatchVoiceConversation=class {
  constructor(input){f.sessions++;f.batchOptions=input;}
  async start(){f.batchOptions.onState({phase:'listening'});}
  async stop(){await f.stopGate;if(f.stopError)throw f.stopError;}
  recheck(){}
 };
 return f;
}

for(const platform of platforms){
 test(`${platform.platform}: a refused session stop ends voice quietly and Talk starts again`,async()=>{
  const f=session(platform);
  try{
   await f.shell.startVoice();assert.equal(f.renderChat().state,'listening');
   f.stopError=Error('Session stop refused');f.renderChat().stop();await settle(f);
   assert.equal(f.renderChat(),null,'no held panel: the composer is back');assert.deepEqual(f.shell.messages,[]);
   assert.equal(f.shell.state.chat,'sheet');assert.equal(forcedStops(f),1,'the plugin confirmed the release');
   assert.equal(f.sessions,1,'nothing starts by itself');
   f.stopError=undefined;await f.shell.startVoice();assert.equal(f.renderChat().state,'listening');assert.equal(f.sessions,2);
   f.renderChat().stop();await settle(f);assert.equal(f.renderChat(),null);assert.equal(forcedStops(f),1,'a confirmed stop forces nothing');
  }finally{f.close();await settle(f);}
 });

 test(`${platform.platform}: while the plugin refuses too, Talk stays quiet and starts nothing; its next answer lets Talk start`,async()=>{
  const f=session(platform);
  try{
   await f.shell.startVoice();
   f.stopError=Error('Session stop refused');f.captureCancelError=Error('Plugin stop refused');f.renderChat().stop();await settle(f);
   assert.equal(f.renderChat(),null);assert.deepEqual(f.shell.messages,[]);const asked=f.recordingCancels.length;
   await f.shell.startVoice();await settle(f);
   assert.equal(f.sessions,1,'an unanswered stop is no permission for new media');assert.equal(f.renderChat(),null);assert.deepEqual(f.shell.messages,[]);
   if(f.native)assert.ok(f.recordingCancels.length>asked,'Talk asked the plugin again');
   f.stopError=f.captureCancelError=undefined;
   await f.shell.startVoice();await settle(f);assert.equal(f.sessions,2);assert.equal(f.renderChat().state,'listening');
  }finally{f.stopError=f.captureCancelError=undefined;f.close();await settle(f);}
 });
}

test('new media waits for the plugin to answer a failed stop',async()=>{
 const f=session({native:true,platform:'android'});
 try{
  await f.shell.startVoice();
  f.stopError=Error('Session stop refused');f.holdPlaybackCleanup=true;f.renderChat().stop();await settle(f);
  assert.equal(f.renderChat().state,'stopping','still stopping: the forced stop has not answered');
  await f.shell.startVoice();await settle(f);assert.equal(f.sessions,1,'no second session over an unanswered stop');
  f.holdPlaybackCleanup=false;f.releasePlaybackCleanup();await settle(f);assert.equal(f.renderChat(),null);
  f.stopError=undefined;await f.shell.startVoice();assert.equal(f.renderChat().state,'listening');assert.equal(f.sessions,2);
 }finally{f.stopError=undefined;f.close();await settle(f);}
});

test('a normal Stop holds the panel until release and forces no plugin stop',async()=>{
 const f=session({native:true,platform:'android'});
 try{
  await f.shell.startVoice();
  let release;f.stopGate=new Promise(resolve=>release=resolve);f.renderChat().stop();await settle(f);
  assert.equal(f.renderChat().state,'stopping');await f.shell.startVoice();await settle(f);assert.equal(f.sessions,1);
  release();await settle(f);assert.equal(f.renderChat(),null);assert.equal(forcedStops(f),0);assert.deepEqual(f.shell.messages,[]);
  await f.shell.startVoice();assert.equal(f.renderChat().state,'listening');assert.equal(f.sessions,2);
 }finally{f.close();await settle(f);}
});

test('Read aloud waits for a repeat of the refused stop, then goes on once the plugin answers',async()=>{
 const f=session({native:true,platform:'android'});
 try{
  await f.shell.startVoice();
  f.stopError=Error('Session stop refused');f.captureCancelError=Error('Plugin stop refused');f.renderChat().stop();await settle(f);
  await assert.rejects(f.shell.stopVoiceConversation(),/Plugin stop refused/);
  f.stopError=f.captureCancelError=undefined;
  await f.shell.stopVoiceConversation();assert.equal(f.shell.stopVoiceConversation(),undefined,'nothing is left to wait for');
 }finally{f.stopError=f.captureCancelError=undefined;f.close();await settle(f);}
});

test('Talk after an unconfirmed Read aloud cleanup asks the plugin once, then listens',async()=>{
 const f=session({native:true,platform:'android'});
 try{
  let unconfirmed=Object.assign(Error('Read aloud cleanup unconfirmed'),{code:'speech-cleanup-unconfirmed'});
  f.box.stopLocalSpeechPlayback=()=>{const failure=unconfirmed;unconfirmed=undefined;return failure&&Promise.reject(failure);};
  await f.shell.startVoice();await settle(f);
  assert.equal(f.renderChat().state,'listening');assert.equal(f.sessions,1);assert.equal(forcedStops(f),1);assert.deepEqual(f.shell.messages,[]);
 }finally{f.close();await settle(f);}
});

test('a Notes recording after an unconfirmed Read aloud cleanup asks the plugin first, then records',async()=>{
 const f=session({native:true,platform:'android'}),rec=()=>f.render().rec;
 try{
  let unconfirmed=Object.assign(Error('Read aloud cleanup unconfirmed'),{code:'speech-cleanup-unconfirmed'});
  f.box.stopLocalSpeechPlayback=()=>{const failure=unconfirmed;unconfirmed=undefined;return failure&&Promise.reject(failure);};
  f.render().record();await settle(f);rec().stop();await settle(f);
  assert.equal(rec().state,'recording');assert.equal(f.starts,1);assert.equal(forcedStops(f),1);assert.deepEqual(f.shell.messages,[]);
 }finally{f.close();await settle(f);}
});

function pendingReview(f){
 const approval=new AbortController(),cancels=[];
 f.shell.pendingActionApproval=approval;f.shell.pendingActionApprovalProposalId='proposal';f.shell.cancelReadReplyCompletions=id=>cancels.push(id??'all');
 return {approval,cancels};
}
for(const [name,failure] of [['a lost session',Error('Cloud socket lost')],['a rate limit too long to wait out',Object.assign(Error('Limited'),{code:'voice-http-429',data:{retryAfterSeconds:600,limitCode:'rate_limited'}})]])
test(`${name} ends voice quietly and leaves a pending review to the owner`,async()=>{
 const f=session({native:true,platform:'android'});
 try{
  await f.shell.startVoice();const {approval,cancels}=pendingReview(f);
  f.batchOptions.onState({phase:'error',error:failure});await settle(f);
  assert.equal(f.renderChat(),null);assert.deepEqual(f.shell.messages,[]);
  assert.equal(approval.signal.aborted,false,'a transport failure is not the owner saying no');assert.deepEqual(cancels,[]);
 }finally{f.close();await settle(f);}
});

test('Stop on the panel a failure left holding still cancels the pending review',async()=>{
 const f=session({native:true,platform:'android'});
 try{
  await f.shell.startVoice();const {approval,cancels}=pendingReview(f);
  let release;f.stopGate=new Promise(resolve=>release=resolve);
  f.batchOptions.onState({phase:'error',error:Error('Cloud socket lost')});await settle(f);
  assert.equal(f.renderChat().state,'stopping');assert.equal(approval.signal.aborted,false);
  f.renderChat().stop();assert.equal(approval.signal.aborted,true);assert.deepEqual(cancels,['proposal']);
  release();await settle(f);assert.equal(f.renderChat(),null);
 }finally{f.close();await settle(f);}
});

test('an explicit Stop cancels a pending review; leaving for the keyboard does not',async()=>{
 for(const [control,cancelled] of [['stop',true],['keyboard',false]]){
  const f=session({native:true,platform:'android'});
  try{
   await f.shell.startVoice();const {approval,cancels}=pendingReview(f);
   f.renderChat()[control]();await settle(f);
   assert.equal(approval.signal.aborted,cancelled,control);assert.deepEqual(cancels,cancelled?['all']:[],control);
  }finally{f.close();await settle(f);}
 }
});

/** Realtime Cloud voice through the developer agent; `revoke` answers a ticket retirement through the relay. */
function realtime(revoke){
 const f=cloudVoiceViewFixture({native:false,platform:'web',account:null});
 const sdk={clients:0,starts:0,stops:0},calls=[];
 const agent={async request(path){calls.push(path);
  if(path.includes('/health'))return {ready:true,conversationId:f.conversation,agentId:'synthetic-agent',speechRoute:'cloud',speechProvider:'cartesia',providerAdmission:'at-session-start'};
  if(path==='/api/views/voice-channel')return {wsUrl:'ws://localhost/__alpha-local-renderer/ws?sessionId=synthetic',expiresAt:Date.now()+120000};
  if(path.includes('/revoke'))return revoke();
  return {};}};
 Object.assign(f.box.connectionController,{getBrowserSpeechAgent:()=>agent,voiceRendererClientId:()=>'11111111-1111-4111-8111-111111111111',voiceConversationCurrent:()=>true,voiceRendererMetadata:()=>({viewDelivery:'completed-action'}),async refreshDeveloperVoiceHistory(){}});
 Object.assign(f.box,{testMocksEnabled:true,developmentCloudRealtimeVoiceEnabled:true,HTMLElement:class {},React:{createElement:()=>null},VoiceActivity:()=>null,console:{warn(){}},
  validateUuid:()=>true,readDevicePreferences:async()=>({askBeforeAgentActions:true}),location:{host:'localhost'},URL,Response,
  WebSocket:class {constructor(){queueMicrotask(()=>this.onopen?.());}close(){}},
  loadClient:async()=>({createVoiceSessionClient:options=>{const client=++sdk.clients;sdk.options=options;return {
   async start(){sdk.starts++;options.onMinted({sessionId:'session-'+client});options.onState({phase:'listening',traceId:null,finalTranscript:''});},
   async stop(){sdk.stops++;},microphoneMuted:false,setMicrophoneMuted(){},needsPlaybackUnlock:false,async unlockPlayback(){}};}})});
 load('runtime/development-cartesia-conversation.ts',f.box,['developmentCartesiaConversation'],source=>source.replace(/^export \{.*\} from .*;\n/gm,'').replace("await import('@elizaos/ui/voice/voice-session-client')",'await loadClient()'));
 return Object.assign(f,{sdk,revokes:()=>calls.filter(path=>path.includes('/revoke'))});
}
for(const [name,revoke] of [['refuses',()=>{throw Object.assign(Error('Relay unavailable'),{status:503});}],['never answers',()=>new Promise(()=>{})],['confirms',()=>({revoked:true})]])
test(`realtime voice: when the relay ${name} the ticket retirement, Stop settles and only an explicit Talk opens a new session`,async()=>{
 const f=realtime(revoke);
 try{
  await f.shell.startVoice();assert.equal(f.renderChat().state,'listening');
  f.renderChat().stop();await settle(f);
  assert.equal(f.renderChat(),null);assert.deepEqual(f.shell.messages,[]);assert.equal(f.sdk.stops,1);assert.equal(f.revokes().length,1);
  assert.equal(f.sdk.clients,1,'no second paid session by itself');
  await f.shell.startVoice();assert.equal(f.renderChat().state,'listening');assert.equal(f.sdk.clients,2);assert.equal(f.revokes().length,1);
 }finally{f.close();await settle(f);}
});

for(const failure of [Error('voice session lost: server_error'),Object.assign(Error('Relay refused'),{code:'voice-http-503'})])
test(`a lost realtime session (${failure.code||failure.message}) ends voice quietly, once, and opens no session by itself`,async()=>{
 const f=realtime(()=>{throw Object.assign(Error('Relay unavailable'),{status:503});});
 try{
  await f.shell.startVoice();
  f.sdk.options.onError(failure);await settle(f);await new Promise(resolve=>setTimeout(resolve,2100));await settle(f);
  assert.equal(f.renderChat(),null);assert.deepEqual(f.shell.messages,[]);assert.equal(f.sdk.clients,1,'no second paid session');assert.equal(f.revokes().length,1);
  await f.shell.startVoice();assert.equal(f.renderChat().state,'listening');assert.equal(f.sdk.clients,2);
 }finally{f.close();await settle(f);}
});
