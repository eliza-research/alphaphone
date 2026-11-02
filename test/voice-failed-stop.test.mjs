import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudVoiceViewFixture,load} from './fixtures/cloud-voice-view.mjs';
import {voiceFakeClock} from './fixtures/shared-batch-voice.mjs';

// The actual voice adapter with a synthetic session whose stop can be refused, then the actual
// realtime conversation module with a synthetic relay. No microphone, provider or account is used.
const settle=async f=>{for(let count=0;count<20;count++)await f.tick();};
const platforms=[{native:true,platform:'android'},{native:false,platform:'web'}];
const forcedStops=f=>f.native?(f.stopPlaybackInputs||[]).filter(input=>input===undefined).length:f.pluginCancels||0;
function session(options){
 const f=cloudVoiceViewFixture({cloudProfile:true,sessions:0,...options});
 f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;f.box.nativeLiveVoiceReady=async()=>false;
 f.box.BatchVoiceConversation=class {
  constructor(input){f.sessions++;f.batchOptions=input;}
  async start(){f.batchOptions.onState({phase:'listening'});}
  async stop(){await f.stopGate;if(f.stopError)throw f.stopError;}
  recheck(){}
 };
 return f;
}

for(const platform of platforms){
 test(`${platform.platform}: a refused session stop keeps the quiet panel until its recorder confirms, and only then Talk starts`,async()=>{
  const f=session(platform);
  try{
   await f.shell.startVoice();assert.equal(f.renderChat().state,'listening');
   f.stopError=Error('Session stop refused');f.renderChat().stop();await settle(f);
   assert.equal(f.renderChat().state,'stopping','unconfirmed: the panel stays');assert.equal(f.renderChat().problem,false);assert.deepEqual(f.shell.messages,[]);
   assert.equal(forcedStops(f),0,'no other stop stands in for the owner');assert.equal(f.sessions,1,'nothing starts by itself');
   await f.shell.startVoice();await settle(f);assert.equal(f.sessions,1,'no Talk over it');
   f.renderChat().stop();await settle(f);
   assert.equal(f.renderChat(),null,'its recorder confirmed: the composer is back');assert.equal(f.shell.state.chat,'sheet');assert.deepEqual(f.shell.messages,[]);
   assert.equal(forcedStops(f),0);assert.equal(f.sessions,1,'nothing starts by itself');
   f.stopError=undefined;await f.shell.startVoice();assert.equal(f.renderChat().state,'listening');assert.equal(f.sessions,2);
   f.renderChat().stop();await settle(f);assert.equal(f.renderChat(),null);assert.equal(forcedStops(f),0,'a confirmed stop forces nothing');
  }finally{f.close();await settle(f);}
 });

 test(`${platform.platform}: while the recorder refuses too, Stop keeps the panel and Talk starts nothing; its answer ends both`,async()=>{
  const f=session(platform);
  try{
   await f.shell.startVoice();
   f.stopError=Error('Session stop refused');f.captureCancelError=Error('Recorder stop refused');f.renderChat().stop();await settle(f);
   assert.equal(f.renderChat().state,'stopping');assert.deepEqual(f.shell.messages,[]);const asked=f.recordingCancels.length;
   f.renderChat().stop();await settle(f);
   assert.ok(f.recordingCancels.length>asked,'Stop asked the recorder again');assert.equal(f.renderChat().state,'stopping','a refusal keeps it');assert.deepEqual(f.shell.messages,[]);
   await f.shell.startVoice();await settle(f);assert.equal(f.sessions,1,'an unanswered stop is no permission for new media');
   f.stopError=f.captureCancelError=undefined;
   f.renderChat().stop();await settle(f);assert.equal(f.renderChat(),null);
   await f.shell.startVoice();await settle(f);assert.equal(f.sessions,2);assert.equal(f.renderChat().state,'listening');
  }finally{f.stopError=f.captureCancelError=undefined;f.close();await settle(f);}
 });
}

test('new media waits for the recorder to answer a failed stop',async()=>{
 const f=session({native:true,platform:'android'});
 try{
  await f.shell.startVoice();
  f.stopError=Error('Session stop refused');f.renderChat().stop();await settle(f);
  f.holdCaptureCancel=true;f.renderChat().stop();await settle(f);
  assert.equal(f.renderChat().state,'stopping','still stopping: the owner has not answered');
  await f.shell.startVoice();await settle(f);assert.equal(f.sessions,1,'no second session over an unanswered stop');
  f.holdCaptureCancel=false;f.releaseCaptureCancel();await settle(f);assert.equal(f.renderChat(),null);
  f.stopError=undefined;await f.shell.startVoice();assert.equal(f.renderChat().state,'listening');assert.equal(f.sessions,2);
 }finally{f.stopError=undefined;f.close();await settle(f);}
});

test('the actual clip loop keeps its capture held past a refused recorder, and only that recorder ends it',async()=>{
 const f=cloudVoiceViewFixture({cloudProfile:true,native:true,platform:'android',peak:.5});
 f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;f.box.nativeLiveVoiceReady=async()=>false;
 try{
  await f.shell.startVoice();await settle(f);assert.equal(f.renderChat().state,'listening');
  const owned=f.activeRecording;assert.ok(owned);
  f.captureCancelError=Error('Recorder stop refused');f.renderChat().stop();await settle(f);
  assert.equal(f.activeRecording,owned,'the fixture capture is still open');assert.equal(f.renderChat().state,'stopping');assert.deepEqual(f.shell.messages,[]);
  await f.shell.startVoice();await settle(f);assert.equal(f.starts,1,'no capture over an open one');
  f.captureCancelError=undefined;f.renderChat().stop();await settle(f);
  assert.equal(f.activeRecording,null,'the recorder closed it');assert.equal(f.renderChat(),null);
  await f.shell.startVoice();await settle(f);assert.equal(f.starts,2);assert.equal(f.renderChat().state,'listening');
 }finally{f.captureCancelError=undefined;f.close();await settle(f);}
});

test('DevelopmentAgent: its refused stop is asked of DevelopmentAgent, and AlphaVoiceCloud is not asked for it',async()=>{
 let refused=true,agentCancels=0,alphaCancels=0;const owned=driver=>({...driver,cancelRecording:async()=>{agentCancels++;if(refused)throw Error('Agent stop refused');await driver.cancelRecording();}});
 const alpha=driver=>({...driver,cancelRecording:async()=>{alphaCancels++;await driver.cancelRecording();}});
 const f=cloudVoiceViewFixture({cloudProfile:false,plugins:{DevelopmentAgent:owned,AlphaVoiceCloud:alpha}}),rec=()=>f.render().rec;
 // The developer realtime profile is the one that records through DevelopmentAgent.
 Object.assign(f.box,{React:{createElement:()=>null},VoiceActivity:()=>null,testMocksEnabled:true,developmentCloudRealtimeVoiceEnabled:true});
 try{
  f.render().record();await settle(f);rec().stop();await settle(f);
  assert.equal(rec().state,'recording');assert.equal(f.starts,1);
  rec().discard();await settle(f);
  assert.equal(agentCancels,2,'the stop, then its own repeat');assert.equal(alphaCancels,0,'no other plugin stands in for it');
  f.render().record();await settle(f);assert.equal(rec().state,'stopping','Record cannot start under its held recorder');
  rec().stop();await settle(f);
  assert.equal(f.starts,1,'no capture while DevelopmentAgent refuses');assert.equal(alphaCancels,0);
  refused=false;rec().stop();await settle(f);assert.equal(rec().state,'ready');
  rec().stop();await settle(f);assert.equal(rec().state,'recording');assert.equal(f.starts,2);
 }finally{refused=false;f.close();await settle(f);}
});

test('ordinary dictation: Stop on the held panel asks the same recorder again, and only its answer ends the panel',async()=>{
 const f=cloudVoiceViewFixture({cloudProfile:true});
 f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;f.box.HTMLElement=class {};f.box.nativeLiveVoiceReady=async()=>false;
 try{
  f.shell.startTranscription();await settle(f);f.renderChat().stop();await settle(f);
  const owned=f.activeRecording;assert.ok(owned);f.captureCancelError=Error('Owned capture did not stop');
  await assert.rejects(f.shell.stopVoiceConversation(),/Owned capture did not stop/);await settle(f);
  assert.deepEqual(f.recordingCancels,[owned]);assert.equal(f.renderChat().state,'stopping');
  f.renderChat().stop();await settle(f);
  assert.deepEqual(f.recordingCancels,[owned,owned]);assert.equal(f.renderChat().state,'stopping','a refusal keeps it');
  f.captureCancelError=undefined;f.renderChat().stop();await settle(f);
  assert.equal(f.activeRecording,null);assert.equal(f.renderChat(),null);assert.equal(f.sends,0);
 }finally{f.captureCancelError=undefined;f.close();await settle(f);}
});

/** A Notes recording, open, on a fixture whose time the test can move. */
async function notesRecording(options={}){
 const clock=voiceFakeClock(),f=cloudVoiceViewFixture({cloudProfile:true,clock,...options});
 Object.assign(f.box,{React:{createElement:()=>null},VoiceActivity:()=>null,nativeLiveVoiceReady:async()=>false});
 f.render().record();await clock.flush();
 return Object.assign(f,{clock,rec:()=>f.render().rec});
}
test('Notes: a refused recorder keeps its quiet stopping line, Stop asks again, and only its answer closes it',async()=>{
 const f=await notesRecording();
 try{
  f.rec().stop();await f.clock.flush();assert.equal(f.rec().state,'recording');const owned=f.activeRecording;
  f.captureCancelError=Error('Recorder stop refused');f.rec().discard();await f.clock.flush();
  assert.equal(f.activeRecording,owned,'the capture is still open');assert.equal(f.rec().state,'stopping');assert.equal(f.rec().failed,false);
  assert.match(f.rec().lines[0].t,/^Stopping the microphone/);assert.deepEqual(f.shell.messages,[]);
  const asked=f.recordingCancels.length;f.rec().stop();await f.clock.flush();
  assert.equal(f.recordingCancels.length,asked+1,'Stop asked the recorder again');assert.equal(f.rec().state,'stopping','a refusal keeps it');
  await f.shell.startVoice();await f.clock.flush();assert.equal(f.starts,1,'no Talk over it');assert.equal(f.renderChat(),null);
  f.shell.startTranscription();await f.clock.flush();assert.equal(f.starts,1,'no dictation over it');assert.equal(f.renderChat(),null);
  f.captureCancelError=undefined;f.rec().discard();await f.clock.flush();
  assert.equal(f.activeRecording,null);assert.equal(f.rec(),undefined);
  f.render().record();await f.clock.flush();f.rec().stop();await f.clock.flush();assert.equal(f.rec().state,'recording');assert.equal(f.starts,2);
 }finally{f.captureCancelError=undefined;f.close();await f.clock.advance(3000);}
});
test('Notes: a held recorder is asked again on a timer, and nothing paid or new runs for it',async()=>{
 const f=await notesRecording();
 try{
  f.rec().stop();await f.clock.flush();
  f.captureCancelError=Error('Recorder stop refused');f.rec().discard();await f.clock.flush();
  const asked=f.recordingCancels.length;await f.clock.advance(3000);assert.equal(f.recordingCancels.length,asked+1);
  await f.clock.advance(3000);assert.equal(f.recordingCancels.length,asked+2);assert.equal(f.rec().state,'stopping');
  const painted=f.shell.notes.nativeVoiceRevision;f.captureCancelError=undefined;await f.clock.advance(3000);
  assert.notEqual(f.shell.notes.nativeVoiceRevision,painted,'Notes repaints without the line');
  assert.equal(f.activeRecording,null,'its answer closed it');assert.equal(f.rec(),undefined);
  const done=f.recordingCancels.length;await f.clock.advance(20000);assert.equal(f.recordingCancels.length,done,'a confirmed owner is asked nothing more');
  assert.equal(f.starts,1);assert.equal(f.uploads,0);assert.equal(f.cloudSpeech,0);assert.equal(f.sends,0);
 }finally{f.captureCancelError=undefined;f.close();await f.clock.advance(3000);}
});
test('Notes: a normal Cancel shows no stopping line and asks the recorder once',async()=>{
 const f=await notesRecording();
 try{
  f.rec().stop();await f.clock.flush();f.rec().discard();assert.equal(f.rec(),undefined);await f.clock.flush();
  assert.equal(f.activeRecording,null);assert.equal(f.rec(),undefined);assert.equal(f.recordingCancels.length,1);
  await f.clock.advance(20000);assert.equal(f.recordingCancels.length,1);
  f.render().record();await f.clock.flush();f.rec().stop();await f.clock.flush();assert.equal(f.rec().state,'recording');assert.equal(f.starts,2);
 }finally{f.close();await f.clock.advance(3000);}
});
test('a capture still starting holds no false proof: its cancel waits for it, past the deadline, and stops it when it arrives',async()=>{
 const f=await notesRecording({holdStart:true});
 try{
  f.rec().stop();await f.clock.flush();assert.equal(f.starts,1);
  f.rec().discard();await f.clock.advance(8000);
  assert.equal(f.recordingCancels.length,0,'nothing answers for a capture still starting');assert.equal(f.rec().state,'stopping');
  await f.shell.startVoice();await f.clock.flush();assert.equal(f.starts,1);
  f.holdStart=false;f.releaseStart({recordingId:'late-clip',maxDurationMs:59000});await f.clock.flush();
  assert.equal(f.recordingCancels[0],'late-clip','the waiting ask found it open and stopped it');assert.equal(f.activeRecording,null);
  await f.clock.advance(3000);assert.equal(f.rec(),undefined,'a fresh answer ends the hold');
 }finally{f.close();await f.clock.advance(3000);}
});
test('stopping saved audio still starting waits for that start, so it cannot play on past the stop',async()=>{
 const clock=voiceFakeClock(),f=cloudVoiceViewFixture({cloudProfile:true,clock,holdSavedStart:true});
 Object.assign(f.box,{React:{createElement:()=>null},VoiceActivity:()=>null});
 Object.assign(f.shell.notes,{list:[{id:'note',title:'Saved',audio:{audioId:'saved-audio'}}],open:'note'});
 try{
  f.render().vo.play();await clock.flush();assert.equal(f.savedAudioStarts,1);
  f.render().vo.play();await clock.flush();assert.equal(f.savedAudioStops||0,0,'nothing answers for audio still starting');
  f.releaseSavedStart();await clock.flush();assert.equal(f.savedAudioStops,1);assert.equal(f.activeSavedAudio,null);
 }finally{f.close();await clock.advance(11000);}
});
test('a held panel is asked again on a timer, and only a confirmation ends it',async()=>{
 const clock=voiceFakeClock(),f=session({native:true,platform:'android',clock});
 try{
  await f.shell.startVoice();
  f.stopError=Error('Session stop refused');f.captureCancelError=Error('Recorder stop refused');f.renderChat().stop();await clock.flush();
  const asked=f.recordingCancels.length;await clock.advance(3000);assert.equal(f.recordingCancels.length,asked+1);assert.equal(f.renderChat().state,'stopping');
  f.stopError=f.captureCancelError=undefined;await clock.advance(3000);assert.equal(f.renderChat(),null);assert.equal(f.sessions,1,'nothing starts by itself');
  const done=f.recordingCancels.length;await clock.advance(20000);assert.equal(f.recordingCancels.length,done);
 }finally{f.stopError=f.captureCancelError=undefined;f.close();await clock.advance(3000);}
});
test('a stop that never answers becomes a held refusal: Stop asks again, Talk stays blocked, and a typed send does not wait forever',async()=>{
 const clock=voiceFakeClock(),f=cloudVoiceViewFixture({cloudProfile:true,platform:'web',native:false,clock});
 Object.assign(f.box,{React:{createElement:()=>null},VoiceActivity:()=>null});
 const snapshot=f.box.connectionController.getSnapshot;f.box.connectionController.getSnapshot=()=>({...snapshot(),residentInference:'direct',providerStatus:{voiceConfigured:true}});
 let conversations=0,stops=0,answers=false;
 f.box.developmentCartesiaConversation=async input=>{conversations++;return {async start(){input.onState('listening');},stop(){stops++;return answers?Promise.resolve():new Promise(()=>{});},recheck(){},resume(){return false;},microphoneMuted:false,setMicrophoneMuted(){},needsPlaybackUnlock:false};};
 try{
  await f.shell.startVoice();await clock.flush();assert.equal(f.renderChat().state,'listening');
  f.renderChat().stop();await clock.flush();assert.equal(stops,1);assert.equal(f.renderChat().state,'stopping');
  f.renderChat().stop();await clock.flush();assert.equal(stops,1,'within the deadline Stop waits for the answer');
  let waited='pending';void f.shell.stopVoiceConversation().then(()=>{waited='settled';},()=>{waited='settled';});
  await clock.advance(24000);assert.equal(waited,'settled');
  const asked=stops;assert.ok(asked>1,'past the deadline the owner is asked again');assert.equal(f.renderChat().state,'stopping');assert.equal(f.renderChat().problem,false);
  f.renderChat().stop();await clock.advance(8000);assert.ok(stops>asked,'Stop asks it again');
  await f.shell.startVoice();await clock.flush();assert.equal(conversations,1,'no session over it');assert.equal(f.renderChat().state,'stopping');
  const again=stops;await clock.advance(11000);assert.ok(stops>again,'the timer asks it too');
  answers=true;await clock.advance(11000);
  assert.equal(f.renderChat(),null,'its own answer ends the panel');await f.shell.startVoice();await clock.flush();assert.equal(conversations,2);
 }finally{f.close();await clock.advance(11000);}
});
test('a clip capture that failed to start and refused its cancel stays held for that recorder',async()=>{
 const f=cloudVoiceViewFixture({cloudProfile:true,native:true,platform:'android',peak:.5});
 Object.assign(f.box,{React:{createElement:()=>null},VoiceActivity:()=>null,nativeLiveVoiceReady:async()=>false});
 try{
  f.startError=Error('Capture start failed');f.captureCancelError=Error('Recorder stop refused');
  await f.shell.startVoice();await settle(f);
  assert.equal(f.renderChat().state,'stopping','unconfirmed: the panel stays');assert.deepEqual(f.shell.messages,[]);
  f.startError=f.captureCancelError=undefined;f.renderChat().stop();await settle(f);assert.equal(f.renderChat(),null);
 }finally{f.startError=f.captureCancelError=undefined;f.close();await settle(f);}
});
test('one owner that refuses skips no later owner in the same stop',async()=>{
 const f=cloudVoiceViewFixture({cloudProfile:true,native:true,platform:'android',peak:.5});
 Object.assign(f.box,{React:{createElement:()=>null},VoiceActivity:()=>null,nativeLiveVoiceReady:async()=>false,
  BatchVoiceConversation:class {constructor(input){this.input=input;}async start(){await this.input.capture({signal:new AbortController().signal,onActivity(){},onEnd(){}});this.input.onState({phase:'listening'});}async stop(){if(f.stopError)throw f.stopError;}recheck(){}}});
 try{
  await f.shell.startVoice();await settle(f);const owned=f.activeRecording;assert.ok(owned);
  f.stopError=Error('Session stop refused');f.renderChat().stop();await settle(f);
  assert.equal(f.activeRecording,null,'the recorder was stopped all the same');assert.ok(f.recordingCancels.includes(owned));assert.equal(f.renderChat().state,'stopping','the refused owner still holds the panel');
  f.stopError=undefined;f.renderChat().stop();await settle(f);assert.equal(f.renderChat(),null);
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
function realtime(revoke,options){
 const f=cloudVoiceViewFixture({native:false,platform:'web',account:null,...options});
 const sdk={clients:0,starts:0,stops:0},calls=[];
 const agent={async request(path){calls.push(path);
  if(path.includes('/health'))return {ready:true,conversationId:f.conversation,agentId:'synthetic-agent',speechRoute:'cloud',speechProvider:'cartesia',providerAdmission:'at-session-start'};
  if(path==='/api/views/voice-channel')return {wsUrl:'ws://localhost/__alpha-local-renderer/ws?sessionId=synthetic',expiresAt:Date.now()+120000};
  if(path.includes('/revoke'))return revoke();
  return {};}};
 Object.assign(f.box.connectionController,{getBrowserSpeechAgent:()=>agent,voiceRendererClientId:()=>'11111111-1111-4111-8111-111111111111',voiceConversationCurrent:()=>true,voiceRendererMetadata:()=>({viewDelivery:'completed-action'}),async refreshDeveloperVoiceHistory(){}});
 Object.assign(f.box,{testMocksEnabled:true,developmentCloudRealtimeVoiceEnabled:true,HTMLElement:class {},React:{createElement:()=>null},VoiceActivity:()=>null,console:{warn(){}},
  validateUuid:()=>true,readDevicePreferences:async()=>({askBeforeAgentActions:true}),location:{host:'localhost'},URL,Response,
  WebSocket:class {constructor(){f.socket=this;queueMicrotask(()=>this.onopen?.());}close(){}},
  loadClient:async()=>({createVoiceSessionClient:options=>{const client=++sdk.clients;sdk.options=options;return {
   async start(){sdk.starts++;options.onMinted({sessionId:'session-'+client});options.onState({phase:'listening',traceId:null,finalTranscript:''});},
   async stop(){sdk.stops++;await sdk.hang;if(sdk.stopError)throw sdk.stopError;},microphoneMuted:false,setMicrophoneMuted(){},needsPlaybackUnlock:false,async unlockPlayback(){}};}})});
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

for(const [name,cancelRecording] of [['refuses',async()=>{throw Error('DevelopmentAgent is not implemented on web');}],['answers',async()=>{}]])
test(`realtime voice: a normal Stop asks no generic recorder that ${name}, and forces no plugin stop`,async()=>{
 const f=realtime(()=>({revoked:true}));
 try{
  await f.shell.startVoice();let asked=0;f.driver.cancelRecording=()=>{asked++;return cancelRecording();};
  f.renderChat().stop();await settle(f);
  assert.equal(f.sdk.stops,1,'its own client stopped');assert.equal(asked,0,'it owns no recorder capture');assert.equal(f.pluginCancels||0,0);assert.equal(f.renderChat(),null);
 }finally{f.close();await settle(f);}
});

test('realtime voice: a client stop that rejects keeps the quiet panel, only that client can end it, and only an explicit Talk opens the next session',async()=>{
 const f=realtime(()=>({revoked:true}));
 try{
  await f.shell.startVoice();
  f.sdk.stopError=Error('Client stop rejected');f.renderChat().stop();await settle(f);
  assert.equal(f.renderChat().state,'stopping');assert.equal(f.renderChat().problem,false);assert.deepEqual(f.shell.messages,[]);
  assert.equal(f.pluginCancels||0,0,'AlphaVoiceCloud does not own these tracks');assert.equal(f.recordingCancels.length,0);assert.equal(f.sdk.stops,1);
  await f.shell.startVoice();await settle(f);assert.equal(f.sdk.clients,1,'no Talk over an unconfirmed microphone');
  f.renderChat().stop();await settle(f);assert.equal(f.sdk.stops,2,'Stop asked the client again');assert.equal(f.renderChat().state,'stopping','a refusal keeps it');
  f.sdk.stopError=undefined;f.renderChat().stop();await settle(f);assert.equal(f.sdk.stops,3);
  assert.equal(f.renderChat(),null);assert.deepEqual(f.shell.messages,[]);assert.equal(f.sdk.clients,1,'no second paid session by itself');assert.equal(f.revokes().length,1,'its ticket is revoked once');
  await f.shell.startVoice();assert.equal(f.renderChat().state,'listening');assert.equal(f.sdk.clients,2);
 }finally{f.sdk.stopError=undefined;f.close();await settle(f);}
});

test('realtime voice: a relay that refuses the ticket does not hold voice once the client confirmed release, and a client refusal is not excused by a confirmed ticket',async()=>{
 const f=realtime(()=>{throw Object.assign(Error('Relay unavailable'),{status:503});});
 try{
  await f.shell.startVoice();f.renderChat().stop();await settle(f);assert.equal(f.renderChat(),null,'revocation failed, local release confirmed: quiet');
  const held=realtime(()=>({revoked:true}));
  try{
   await held.shell.startVoice();held.sdk.stopError=Error('Client stop rejected');held.renderChat().stop();await settle(held);
   assert.equal(held.revokes().length,1,'the ticket is retired whichever way the client answered');assert.equal(held.renderChat().state,'stopping','that says nothing for the microphone');
  }finally{held.sdk.stopError=undefined;held.close();await settle(held);}
 }finally{f.close();await settle(f);}
});

test('a quiet Cloud wait whose stop is refused keeps the quiet panel and opens no session',async()=>{
 const f=session({native:true,platform:'android'});
 try{
  await f.shell.startVoice();f.stopError=Error('Session stop refused');f.captureCancelError=Error('Recorder stop refused');
  f.batchOptions.onState({phase:'error',error:Object.assign(Error('Warming'),{code:'voice-http-503'})});await settle(f);
  await new Promise(resolve=>setTimeout(resolve,2100));await settle(f);
  assert.equal(f.renderChat().state,'stopping','the composer does not return over an unconfirmed stop');assert.equal(f.sessions,1,'no second session');assert.deepEqual(f.shell.messages,[]);
  f.stopError=f.captureCancelError=undefined;f.renderChat().stop();await settle(f);assert.equal(f.renderChat(),null);assert.equal(f.sessions,1);
 }finally{f.stopError=f.captureCancelError=undefined;f.close();await settle(f);}
});

test('a later stop with nothing to do clears no held owner',async()=>{
 const f=realtime(()=>({revoked:true}));
 try{
  await f.shell.startVoice();f.sdk.stopError=Error('Client stop rejected');f.renderChat().stop();await settle(f);
  f.render().record();await settle(f);f.render().rec?.discard();await settle(f);
  assert.equal(f.renderChat().state,'stopping');await assert.rejects(f.shell.stopVoiceConversation(),/Client stop rejected/);
 }finally{f.sdk.stopError=undefined;f.close();await settle(f);}
});

test('a client stop that never answers is joined within the deadline, and asked again past it through the wrapper',async()=>{
 const clock=voiceFakeClock(),f=realtime(()=>({revoked:true}),{clock:{...clock,Date}});
 try{
  await f.shell.startVoice();await clock.flush();
  f.sdk.hang=new Promise(()=>{});f.renderChat().stop();await clock.flush();assert.equal(f.sdk.stops,1);
  void f.shell.stopVoiceConversation();await clock.flush();assert.equal(f.sdk.stops,1,'within the deadline a repeat joins the stop under way');
  f.sdk.hang=undefined;await clock.advance(8000);
  assert.equal(f.sdk.stops,2,'past it the client itself is asked again');assert.equal(f.renderChat(),null);assert.equal(f.sdk.clients,1);
 }finally{f.sdk.hang=undefined;f.close();await clock.advance(11000);}
});

test('a held panel left on a closed shell moves to the next shell, which starts no media until its owner confirms',async()=>{
 const f=realtime(()=>({revoked:true}));
 try{
  await f.shell.startVoice();f.sdk.stopError=Error('Client stop rejected');f.renderChat().stop();await settle(f);
  f.shell.live=false;const next=new f.shell.constructor();next.state={...f.shell.state};
  await next.startVoice();await settle(f);assert.equal(f.sdk.clients,1,'its owner still refuses');assert.equal(next.renderVals().chatRecorder.state,'stopping');
  f.sdk.stopError=undefined;next.renderVals().chatRecorder.stop();await settle(f);assert.equal(next.renderVals().chatRecorder,null);
  await next.startVoice();await settle(f);assert.equal(f.sdk.clients,2);
 }finally{f.sdk.stopError=undefined;f.close();await settle(f);}
});

// One accepted turn: the SDK reducer's state, then the raw final that commits it.
const acceptedTurn=f=>{f.sdk.options.onState({phase:'thinking',traceId:'turn',finalTranscript:'open notes'});f.sdk.options.onServerEvent({t:'stt_final',traceId:'turn',text:'open notes'});};
for(const [name,arrange,fail] of [
 ['a history refresh',f=>{f.box.connectionController.refreshDeveloperVoiceHistory=async()=>{throw Error('PRIVATE_FAILURE');};},f=>f.sdk.options.onServerEvent({t:'ready',traceId:'turn'})],
 ['a renderer frame',()=>{},f=>f.socket.onmessage({data:'not json'})],
 ['a navigation follow-up',f=>{f.shell.applyRealtimeVoiceNavigation=async()=>{throw Error('PRIVATE_FAILURE');};},f=>{acceptedTurn(f);f.sdk.options.onServerEvent({t:'navigate_view',traceId:'turn',viewId:'notes'});}],
 ['an action verification',f=>{f.box.readDevicePreferences=async()=>({askBeforeAgentActions:false});f.box.connectionController.performVoiceRequestedActions=async()=>{throw Error('PRIVATE_FAILURE');};},f=>{acceptedTurn(f);f.sdk.options.onServerEvent({t:'reply_complete',traceId:'turn',userMessageId:'message'});}],
])test(`realtime voice: ${name} that fails leaves a healthy session running`,async()=>{
 const f=realtime(()=>({revoked:true})),logged=[];arrange(f);
 f.box.devSurfacesEnabled=true;f.box.console={warn:(...line)=>logged.push(line)};
 try{
  await f.shell.startVoice();fail(f);await settle(f);
  assert.equal(f.sdk.stops,0,'the session is not stopped');assert.ok(f.renderChat(),'the panel stays');assert.deepEqual(f.shell.messages,[]);
  assert.deepEqual(logged.map(line=>line[0]),['[Alpha voice]'],'the dev log keeps it');
  f.sdk.options.onState({phase:'listening',traceId:null,finalTranscript:''});await settle(f);assert.equal(f.renderChat().state,'listening');
  f.renderChat().stop();await settle(f);assert.equal(f.renderChat(),null);assert.equal(f.sdk.stops,1);
 }finally{f.close();await settle(f);}
});

test('realtime voice: losing the renderer still ends voice quietly, once, and opens no session',async()=>{
 const f=realtime(()=>({revoked:true}));
 try{
  await f.shell.startVoice();f.socket.onclose();await settle(f);
  assert.equal(f.renderChat(),null);assert.deepEqual(f.shell.messages,[]);assert.equal(f.sdk.stops,1);assert.equal(f.sdk.clients,1);
 }finally{f.close();await settle(f);}
});

/** A session Stop and the plugin both refused, so the next media must ask again. */
async function refused(options){
 const f=session({native:true,platform:'android',...options});
 await f.shell.startVoice();
 f.stopError=Error('Session stop refused');f.captureCancelError=Error('Plugin stop refused');f.renderChat().stop();await settle(f);
 f.stopError=undefined;
 assert.equal(f.renderChat().state,'stopping');
 return f;
}
const healthy=f=>{f.captureCancelError=undefined;};
test('Notes Start asks the plugin again and records once it answers; while it refuses Start stays quiet',async()=>{
 const f=await refused(),rec=()=>f.render().rec;
 try{
  f.render().record();await settle(f);const asked=f.recordingCancels.length;
  rec().stop();await settle(f);
  assert.equal(rec().state,'ready');assert.equal(rec().failed,false);assert.equal(f.starts,0,'no capture over a refused stop');assert.ok(f.recordingCancels.length>asked,'Start asked again');assert.deepEqual(f.shell.messages,[]);
  healthy(f);rec().stop();await settle(f);assert.equal(rec().state,'recording');assert.equal(f.starts,1);
 }finally{healthy(f);f.close();await settle(f);}
});
test('Notes Start after a plain Stop asks the plugin nothing',async()=>{
 const f=session({native:true,platform:'android'}),rec=()=>f.render().rec;
 try{
  await f.shell.startVoice();f.renderChat().stop();await settle(f);
  f.render().record();await settle(f);rec().stop();await settle(f);
  assert.equal(rec().state,'recording');assert.equal(forcedStops(f),0);
 }finally{f.close();await settle(f);}
});
test('a device read review asks the plugin again, and goes on once it answers',async()=>{
 const f=await refused(),review=()=>f.shell.prepareDeviceReadReview('proposal','digest',new AbortController().signal);
 try{
  await assert.rejects(review(),/Plugin stop refused/);
  healthy(f);await review();
 }finally{healthy(f);f.close();await settle(f);}
});
test('Play recording asks the plugin again on its first tap once it answers',async()=>{
 const f=await refused();Object.assign(f.shell.notes,{list:[{id:'note',kind:'voice',title:'Memo',body:'Hello',audio:{audioId:'saved'}}],open:'note'});
 try{
  healthy(f);f.render().vo.play();await settle(f);
  assert.equal(f.savedAudioStarts,1);assert.equal(f.activeSavedAudio,'saved');
 }finally{healthy(f);f.close();await settle(f);}
});
test('on-device preparation asks the plugin again before it gives up',async()=>{
 const f=await refused({cloudProfile:false}),rec=()=>f.render().rec,cancel=f.driver.cancelRecording;
 let refusals=1;f.driver.cancelRecording=async()=>{if(refusals-->0)throw Error('Plugin stop refused');healthy(f);return cancel();};
 try{
  f.render().record();await settle(f);
  assert.equal(rec().primaryDisabled,false,'preparation finished');assert.match(rec().lines[0].t,/on this phone/);
  rec().stop();await settle(f);assert.equal(rec().state,'recording');
 }finally{healthy(f);f.close();await settle(f);}
});

/** The live assistant's heard outcome through the actual adapter; the session itself is a stub. */
function heardSession(){
 const f=cloudVoiceViewFixture({cloudProfile:false,native:true,platform:'android'}),reported=[];
 Object.assign(f.box,{React:{createElement:()=>null},VoiceActivity:()=>null,nativeLiveVoiceReady:async()=>true,nativeAssistantListener:()=>async()=>({}),createEndpointChain:()=>async()=>'unavailable',residentEndpoint:()=>undefined,clefEndpointStage:()=>undefined,recordHeardVoiceTiming(){},activeVoiceTurn:()=>undefined,
  createHeardReporter:()=>({report:async value=>{reported.push(value);return 'recorded';}}),
  VoiceAssistantSession:class {constructor(ports){f.assistant=ports;}async start(){f.assistant.onState({phase:'listening'});}async stop(){}recheck(){}}});
 f.box.connectionController.voiceConversationCurrent=()=>true;
 return Object.assign(f,{reported});
}
const REPLY='First sentence. Second sentence.',heard={interrupted:true,turnId:'turn',replyId:'message',heard:'First sentence.',unheard:'Second sentence.'};
test('a playback failure after the first sentence reports what was heard and leaves the reply as it is',async()=>{
 const f=heardSession();f.shell.state.msgs=[{id:'message',from:'agent',text:REPLY}];
 try{
  await f.shell.startVoice();f.assistant.onHeard({...heard,playbackFailed:true});await settle(f);
  assert.equal(f.shell.state.msgs[0].text,REPLY);assert.equal(f.shell.state.msgs[0].interrupted,undefined);
  assert.equal(f.reported.length,1);assert.equal(f.reported[0].heard,'First sentence.');assert.equal(f.reported[0].playbackFailed,true);
 }finally{f.close();await settle(f);}
});
test('a real barge-in still keeps only what was played, with its note',async()=>{
 const f=heardSession();f.shell.state.msgs=[{id:'message',from:'agent',text:REPLY}];
 try{
  await f.shell.startVoice();f.assistant.onHeard(heard);await settle(f);
  assert.match(f.shell.state.msgs[0].text,/^First sentence\.\n\n\(Interrupted\. The rest of this reply was not played\.\)$/);assert.equal(f.shell.state.msgs[0].interrupted,true);
  assert.equal(f.reported[0].playbackFailed,undefined);
 }finally{f.close();await settle(f);}
});
