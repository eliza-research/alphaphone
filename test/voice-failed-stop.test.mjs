import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
/** The one repaint before a recorder's usual answer: nothing written on it shows yet. */
const unseen=view=>{assert.equal(view.state,'stopping');assert.match(view.clockCss,/\.3s/,'the clock fades in only after the usual answer');assert.match(view.lines[0].css,/\.3s/,'so does the line');assert.match(view.lines[0].chip,/\.3s/);};
const noPill=f=>f.views.notes.immersive({},{})?.noPill;
test('Notes: a normal Cancel stays open one bridge hop with its clock and line still hidden and no pill, closes on the answer, and asks the recorder once',async()=>{
 const f=await notesRecording();
 try{
  f.rec().stop();await f.clock.flush();f.rec().discard();
  unseen(f.rec());assert.equal(noPill(f),true,'the pill stays away while the panel is up');
  await f.clock.flush();
  assert.equal(f.activeRecording,null);assert.equal(f.rec(),undefined);assert.equal(f.recordingCancels.length,1);assert.equal(noPill(f),undefined,'closed, the pill is back');
  await f.clock.advance(20000);assert.equal(f.recordingCancels.length,1);
  f.render().record();await f.clock.flush();f.rec().stop();await f.clock.flush();assert.equal(f.rec().state,'recording');assert.equal(f.starts,2);
 }finally{f.close();await f.clock.advance(3000);}
});
test('Notes: a Cancel left unanswered is stopping from the tap, past the deadline, and only its answer closes it',async()=>{
 const f=await notesRecording();
 try{
  f.rec().stop();await f.clock.flush();const owned=f.activeRecording;
  f.holdCaptureCancel=true;f.rec().discard();assert.equal(f.rec().state,'stopping','from the tap, with nothing painted closed');await f.clock.flush();
  assert.equal(f.rec().state,'stopping');assert.equal(f.activeRecording,owned);
  await f.shell.startVoice();await f.clock.flush();assert.equal(f.renderChat(),null,'no Talk over it');
  await f.clock.advance(7999);assert.equal(f.rec().state,'stopping');
  await f.clock.advance(2);assert.equal(f.rec().state,'stopping','past the deadline it is a held refusal');
  f.holdCaptureCancel=false;f.releaseCaptureCancel();await f.clock.advance(3000);
  assert.equal(f.activeRecording,null);assert.equal(f.rec(),undefined);assert.equal(f.starts,1);
 }finally{f.holdCaptureCancel=false;f.releaseCaptureCancel?.();f.close();await f.clock.advance(11000);}
});
test('Notes: an earlier stop that settles first clears no recorder still unanswered',async()=>{
 const f=await notesRecording();Object.assign(f.shell.notes,{list:[{id:'note',title:'Saved',audio:{audioId:'saved-audio'}}],open:'note'});
 try{
  f.rec().stop();await f.clock.flush();f.render().vo.play();await f.clock.flush();assert.equal(f.activeSavedAudio,'saved-audio');
  f.holdSavedStop=true;f.holdCaptureCancel=true;f.rec().discard();await f.clock.flush();assert.equal(f.recordingCancels.length,0,'the earlier stop is still under way');
  f.releaseSavedStop();await f.clock.flush();assert.equal(f.recordingCancels.length,1);assert.equal(f.rec().state,'stopping','only the recorder answers for itself');
  f.holdCaptureCancel=false;f.releaseCaptureCancel();await f.clock.flush();assert.equal(f.rec(),undefined);
 }finally{f.holdSavedStop=f.holdCaptureCancel=false;f.releaseSavedStop?.();f.releaseCaptureCancel?.();f.close();await f.clock.advance(11000);}
});
test('a kept clip has its microphone off: discarding it closes at once, with nothing held',async()=>{
 const f=await notesRecording();
 try{
  f.rec().stop();await f.clock.flush();f.rec().stop();await f.clock.flush();assert.equal(f.rec().state,'recorded');
  f.rec().discard();assert.equal(f.rec(),undefined,'no stopping panel over a finished recording');assert.equal(noPill(f),undefined);await f.clock.flush();assert.equal(f.rec(),undefined);
 }finally{f.close();await f.clock.advance(3000);}
});
test('a kept clip whose cancel is refused closes all the same, and new media still waits for its recorder',async()=>{
 const f=await notesRecording();
 try{
  f.rec().stop();await f.clock.flush();f.rec().stop();await f.clock.flush();assert.equal(f.rec().state,'recorded');
  f.captureCancelError=Error('Recorder stop refused');f.rec().discard();await f.clock.flush();assert.equal(f.rec(),undefined,'its microphone is off: no stopping line');
  const asked=f.recordingCancels.length;f.render().record();await f.clock.flush();f.rec().stop();await f.clock.flush();
  assert.ok(f.recordingCancels.length>asked,'the recorder was asked first');assert.equal(f.starts,1,'no capture over its refusal');
  f.captureCancelError=undefined;f.rec().stop();await f.clock.flush();assert.equal(f.rec().state,'recording');assert.equal(f.starts,2);
 }finally{f.captureCancelError=undefined;f.close();await f.clock.advance(3000);}
});
test('Record again asks the recorder that made the clip, not the driver enter picks next',async()=>{
 let agentCancels=0,alphaCancels=0;const counted=count=>driver=>({...driver,cancelRecording:async()=>{count();await driver.cancelRecording();}});
 const f=cloudVoiceViewFixture({cloudProfile:false,plugins:{DevelopmentAgent:counted(()=>agentCancels++),AlphaVoiceCloud:counted(()=>alphaCancels++)}}),rec=()=>f.render().rec;
 Object.assign(f.box,{React:{createElement:()=>null},VoiceActivity:()=>null,testMocksEnabled:true,developmentCloudRealtimeVoiceEnabled:true});
 try{
  f.render().record();await settle(f);rec().stop();await settle(f);rec().stop();await settle(f);assert.equal(rec().state,'recorded');
  f.box.developmentCloudRealtimeVoiceEnabled=false;rec().toggle();await settle(f);
  assert.equal(agentCancels,1,'the clip is DevelopmentAgent\'s');assert.equal(alphaCancels,0,'the next driver answers for nothing of its');
 }finally{f.close();await settle(f);}
});

// A capture that ended without its clip: only that recorder can say it is off.
const recorderRefusal=()=>Error('Recorder stop refused');
const refuseStop=f=>{f.driver.stopRecording=async()=>{throw Error('Stop failed');};};
const lose=(f,recordingId)=>{for(const callback of f.events.get('recordingStopped')||[])callback({recordingId});};
const quietLine=f=>{assert.equal(f.rec().state,'stopping');assert.equal(f.rec().failed,false);assert.match(f.rec().lines[0].t,/^Stopping the microphone/);assert.notEqual(f.rec().primaryLabel,'Start recording');assert.deepEqual(f.shell.messages,[]);};
const startsNothing=async f=>{const starts=f.starts;await f.shell.startVoice();await f.clock.flush();f.shell.startTranscription();await f.clock.flush();assert.equal(f.starts,starts);assert.equal(f.renderChat(),null);};
for(const [name,end] of [
 ['a failed Stop',async f=>{const stop=f.driver.stopRecording;refuseStop(f);f.rec().stop();await f.clock.flush();f.driver.stopRecording=stop;}],
 ['a Stop answered with no usable clip',async f=>{const stop=f.driver.stopRecording;f.driver.stopRecording=async()=>({recordingId:'',durationMs:Number.NaN});f.rec().stop();await f.clock.flush();f.driver.stopRecording=stop;}],
 ['a lost capture',async f=>{lose(f,f.activeRecording);await f.clock.flush();}],
])test(`Notes: ${name} that its recorder refuses stays on the quiet line, every control asks again, and only its answer returns to ready`,async()=>{
 const f=await notesRecording();
 try{
  f.rec().stop();await f.clock.flush();assert.equal(f.rec().state,'recording');const owned=f.activeRecording,asked=f.recordingCancels.length;
  f.captureCancelError=recorderRefusal();await end(f);
  assert.equal(f.recordingCancels.length,asked+1,'that recorder was asked');assert.equal(f.activeRecording,owned,'the capture is still open');quietLine(f);
  await startsNothing(f);
  f.rec().stop();await f.clock.flush();assert.equal(f.recordingCancels.length,asked+2,'Stop asked again');quietLine(f);
  f.rec().discard();await f.clock.flush();assert.equal(f.recordingCancels.length,asked+3,'Cancel asked again');quietLine(f);
  await f.clock.advance(3000);assert.equal(f.recordingCancels.length,asked+4,'the timer asked again');quietLine(f);
  f.captureCancelError=undefined;await f.clock.advance(3000);
  assert.equal(f.activeRecording,null);assert.equal(f.rec().state,'ready');assert.equal(f.rec().primaryLabel,'Start recording');assert.equal(f.rec().failed,false);
  const done=f.recordingCancels.length;await f.clock.advance(20000);assert.equal(f.recordingCancels.length,done,'a confirmed recorder is asked nothing more');
  f.rec().stop();await f.clock.flush();assert.equal(f.rec().state,'recording');assert.equal(f.starts,2);
 }finally{f.captureCancelError=undefined;f.close();await f.clock.advance(3000);}
});
test('Notes: a failed Stop whose recorder never answers is stopping from then on, not ready',async()=>{
 const f=await notesRecording();
 try{
  f.rec().stop();await f.clock.flush();refuseStop(f);f.holdCaptureCancel=true;f.rec().stop();await f.clock.flush();quietLine(f);
  await f.clock.advance(8001);quietLine(f);
  f.holdCaptureCancel=false;f.releaseCaptureCancel();await f.clock.advance(3000);assert.equal(f.rec().state,'ready');
 }finally{f.holdCaptureCancel=false;f.releaseCaptureCancel?.();f.close();await f.clock.advance(11000);}
});
test('Notes: a too-short Stop that its recorder confirms returns to ready with no line, asked once, and records again',async()=>{
 const f=await notesRecording();
 try{
  f.rec().stop();await f.clock.flush();refuseStop(f);f.rec().stop();await f.clock.flush();
  assert.equal(f.rec().state,'ready');assert.equal(f.rec().failed,false);assert.match(f.rec().lines[0].t,/^Record up to 59 seconds/);assert.equal(f.recordingCancels.length,1);assert.deepEqual(f.shell.messages,[]);
  await f.clock.advance(20000);assert.equal(f.recordingCancels.length,1);
 }finally{f.close();await f.clock.advance(3000);}
});
test('Notes: a lost capture that its recorder confirms returns to ready, asked once, and Discard asks nothing more',async()=>{
 const f=await notesRecording();
 try{
  f.rec().stop();await f.clock.flush();lose(f,f.activeRecording);await f.clock.flush();
  assert.equal(f.rec().state,'ready');assert.equal(f.recordingCancels.length,1);assert.equal(f.activeRecording,null);
  f.rec().discard();await f.clock.flush();assert.equal(f.recordingCancels.length,1);assert.equal(f.rec(),undefined);
 }finally{f.close();await f.clock.advance(3000);}
});
test('Notes: a capture lost while it starts is cancelled once that start settles, and ready does not turn into recording',async()=>{
 const f=await notesRecording({holdStart:true});
 try{
  f.rec().stop();await f.clock.flush();assert.equal(f.starts,1);lose(f,'');await f.clock.flush();
  assert.equal(f.recordingCancels.length,0,'nothing answers for a capture still starting');quietLine(f);
  f.holdStart=false;f.releaseStart({recordingId:'late-clip',maxDurationMs:59000});await f.clock.flush();
  assert.deepEqual(f.recordingCancels,['late-clip']);assert.equal(f.activeRecording,null);assert.equal(f.rec().state,'ready');
 }finally{f.close();await f.clock.advance(3000);}
});
test('Notes: a start that fails with its recorder refusing stays on the quiet line, and only its answer returns to ready',async()=>{
 const f=await notesRecording();
 try{
  f.startError=Error('Capture start failed');f.captureCancelError=recorderRefusal();f.rec().stop();await f.clock.flush();
  assert.equal(f.recordingCancels.length,1);quietLine(f);await startsNothing(f);assert.equal(f.starts,1);
  f.rec().discard();await f.clock.flush();assert.equal(f.recordingCancels.length,2,'Cancel asked again');quietLine(f);
  f.startError=f.captureCancelError=undefined;f.rec().stop();await f.clock.flush();assert.equal(f.rec().state,'ready');
  f.rec().stop();await f.clock.flush();assert.equal(f.rec().state,'recording');assert.equal(f.starts,2);
 }finally{f.startError=f.captureCancelError=undefined;f.close();await f.clock.advance(3000);}
});
test('Notes: a plain denied start asks its recorder once, holds nothing, and keeps Open app settings',async()=>{
 const f=await notesRecording({startError:Object.assign(Error('denied'),{code:'permission-denied'})});
 try{
  f.rec().stop();await f.clock.flush();
  assert.equal(f.recordingCancels.length,1);assert.equal(f.rec().routeLabel,'Open app settings');assert.match(f.rec().lines[0].t,/^Record up to 59 seconds/);
  await f.clock.advance(20000);assert.equal(f.recordingCancels.length,1);
  f.startError=undefined;f.rec().stop();await f.clock.flush();assert.equal(f.rec().state,'recording');
 }finally{f.startError=undefined;f.close();await f.clock.advance(3000);}
});
test('Notes: while a plain denied start or a too-short Stop waits for its recorder, nothing written shows and no pill returns',async()=>{
 const f=await notesRecording({startError:Object.assign(Error('denied'),{code:'permission-denied'})});
 try{
  f.holdCaptureCancel=true;f.rec().stop();await f.clock.flush();unseen(f.rec());assert.equal(noPill(f),true);
  f.holdCaptureCancel=false;f.releaseCaptureCancel();await f.clock.flush();assert.equal(f.rec().routeLabel,'Open app settings');assert.equal(f.rec().clockCss,'');
  f.startError=undefined;f.rec().stop();await f.clock.flush();assert.equal(f.rec().state,'recording');
  refuseStop(f);f.holdCaptureCancel=true;f.rec().stop();await f.clock.flush();unseen(f.rec());
  f.holdCaptureCancel=false;f.releaseCaptureCancel();await f.clock.flush();assert.equal(f.rec().state,'ready');assert.equal(f.rec().clockCss,'');
 }finally{f.holdCaptureCancel=false;f.releaseCaptureCancel?.();f.close();await f.clock.advance(11000);}
});
test('Notes: a start that fails after Cancel is that Cancel\'s to finish: its recorder is asked once and holds no later panel',async()=>{
 const f=await notesRecording({holdStart:true});
 try{
  f.rec().stop();await f.clock.flush();assert.equal(f.starts,1);f.rec().discard();await f.clock.flush();assert.equal(f.rec().state,'stopping');
  f.startError=Error('Capture start failed');f.holdStart=false;f.releaseStart({recordingId:'late-clip',maxDurationMs:59000});await f.clock.flush();
  assert.equal(f.recordingCancels.length,1,'the late failure asks nothing of its own');assert.equal(f.rec(),undefined);assert.deepEqual(f.shell.messages,[]);
  f.startError=undefined;f.render().record();await f.clock.flush();f.rec().stop();await f.clock.flush();assert.equal(f.rec().state,'recording');assert.equal(f.recordingCancels.length,1);
 }finally{f.startError=undefined;f.close();await f.clock.advance(3000);}
});
test('Notes: a Stop that fails after Cancel leaves the next recording alone',async()=>{
 const f=await notesRecording();
 try{
  f.rec().stop();await f.clock.flush();assert.equal(f.rec().state,'recording');
  let refuse;const stop=f.driver.stopRecording;f.driver.stopRecording=()=>new Promise((_,reject)=>refuse=reject);
  f.rec().stop();await f.clock.flush();f.rec().discard();await f.clock.flush();assert.equal(f.rec(),undefined);
  f.driver.stopRecording=stop;f.render().record();await f.clock.flush();f.rec().stop();await f.clock.flush();assert.equal(f.rec().state,'recording');const owned=f.activeRecording,asked=f.recordingCancels.length;
  refuse(Error('Stop failed'));await f.clock.flush();
  assert.equal(f.rec().state,'recording');assert.equal(f.activeRecording,owned,'its capture is still open');assert.equal(f.recordingCancels.length,asked,'nothing was asked of it');
 }finally{f.close();await f.clock.advance(3000);}
});
function dictating(){
 const clock=voiceFakeClock(),f=cloudVoiceViewFixture({cloudProfile:true,clock});
 Object.assign(f.box,{React:{createElement:()=>null},VoiceActivity:()=>null,HTMLElement:class {},nativeLiveVoiceReady:async()=>false});
 return Object.assign(f,{clock,panel:()=>f.renderChat()});
}
test('dictation: a failed Stop that its recorder refuses stays on the quiet panel, Discard and Transcribe open nothing, and only its answer returns to ready',async()=>{
 const f=dictating();
 try{
  f.shell.startTranscription();await f.clock.flush();f.panel().stop();await f.clock.flush();assert.equal(f.panel().state,'recording');const asked=f.recordingCancels.length;
  refuseStop(f);f.captureCancelError=recorderRefusal();f.panel().stop();await f.clock.flush();
  assert.equal(f.panel().state,'stopping');assert.equal(f.panel().primaryLabel,'Stop recording');assert.equal(f.recordingCancels.length,asked+1);assert.deepEqual(f.shell.messages,[]);
  f.panel().discard();await f.clock.flush();assert.equal(f.panel().state,'stopping','Discard holds');assert.equal(f.recordingCancels.length,asked+2);
  f.panel().keyboard();await f.clock.flush();assert.equal(f.panel().state,'stopping','the keyboard holds too');assert.equal(f.recordingCancels.length,asked+3);
  f.shell.startTranscription();await f.clock.flush();assert.equal(f.starts,1,'no capture over it');
  f.captureCancelError=undefined;f.panel().discard();await f.clock.flush();
  assert.equal(f.activeRecording,null);assert.equal(f.panel().state,'ready');assert.equal(f.panel().primaryLabel,'Start recording');
  f.panel().discard();await f.clock.flush();assert.equal(f.panel(),null);assert.equal(f.shell.state.chat,'sheet');
 }finally{f.captureCancelError=undefined;f.close();await f.clock.advance(3000);}
});
for(const [name,end] of [
 ['a plain denied start',async f=>{f.startError=Object.assign(Error('denied'),{code:'permission-denied'});f.panel().stop();await f.clock.flush();}],
 ['a too-short Stop',async f=>{f.panel().stop();await f.clock.flush();const stop=f.driver.stopRecording;refuseStop(f);f.panel().stop();await f.clock.flush();f.driver.stopRecording=stop;}],
])test(`dictation: while ${name} waits for its recorder nothing written shows, and its answer returns to ready`,async()=>{
 const f=dictating();
 try{
  f.shell.startTranscription();await f.clock.flush();f.holdCaptureCancel=true;await end(f);
  unseen(f.panel());assert.equal(f.panel().statusLines[0].css,f.panel().lines[0].css,'the status line carries the delay');
  f.holdCaptureCancel=false;f.releaseCaptureCancel();await f.clock.flush();assert.notEqual(f.panel().state,'stopping');assert.equal(f.panel().primaryLabel,'Start recording');assert.equal(f.panel().clockCss,'');assert.equal(f.panel().lines[0].css,'');
 }finally{f.startError=undefined;f.holdCaptureCancel=false;f.releaseCaptureCancel?.();f.close();await f.clock.advance(11000);}
});
test('the chat recorder paints the clock and line styles that keep them hidden',()=>{
 const template=fs.readFileSync('apps/app/src/prototype/template.html','utf8');
 assert.match(template,/style="[^"]*\{\{chatRecorder\.clockCss\}\}">\{\{chatRecorder\.clock\}\}/);
 assert.match(template,/<p style="[^"]*\{\{line\.css\}\}">\{\{line\.t\}\}<\/p>/);
 assert.match(template,/<span style="\{\{chatRecorder\.clockCss\}\}">\{\{chatRecorder\.primaryLabel\}\}<\/span>/);
});
test('Notes: the time limit landing while Stop is in flight keeps the clip its failed Stop would otherwise delete',async()=>{
 const f=await notesRecording();
 try{
  f.rec().stop();await f.clock.flush();const id=f.activeRecording;
  let refuse;f.driver.stopRecording=()=>new Promise((_,reject)=>refuse=reject);
  f.rec().stop();await f.clock.flush();
  for(const callback of f.events.get('recordingStopped')||[])callback({recordingId:id,durationMs:59000});
  await f.clock.flush();refuse(Error('Recording could not be saved'));await f.clock.flush();
  assert.equal(f.rec().state,'recorded','the clip is kept');
  assert.deepEqual(f.recordingCancels,[],'cancelRecording deletes the kept file natively');
 }finally{f.close();await f.clock.advance(3000);}
});
test('a chat Stop with its capture unanswered paints no Notes recorder',async()=>{
 const f=cloudVoiceViewFixture({cloudProfile:true,native:true,platform:'android',peak:.5});
 f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;f.box.nativeLiveVoiceReady=async()=>false;
 try{
  await f.shell.startVoice();await settle(f);assert.equal(f.renderChat().state,'listening');
  f.holdCaptureCancel=true;f.renderChat().stop();await settle(f);
  assert.equal(f.render().rec,undefined);
 }finally{f.holdCaptureCancel=false;f.releaseCaptureCancel?.();f.close();await settle(f);}
});
test('dictation: leaving a held panel for another surface keeps the quiet panel, and the recorder ends it',async()=>{
 const f=dictating();
 try{
  f.shell.startTranscription();await f.clock.flush();f.panel().stop();await f.clock.flush();
  refuseStop(f);f.holdCaptureCancel=true;f.panel().stop();await f.clock.flush();assert.equal(f.panel().state,'stopping');const owned=f.activeRecording;
  f.shell.renderVals().closeChat();await f.clock.flush();
  assert.equal(f.panel().state,'stopping','unanswered: the panel survives leaving');assert.equal(f.activeRecording,owned);
  f.holdCaptureCancel=false;f.releaseCaptureCancel();await f.clock.flush();assert.equal(f.activeRecording,null);assert.equal(f.panel(),null);
 }finally{f.holdCaptureCancel=false;f.releaseCaptureCancel?.();f.close();await f.clock.advance(11000);}
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
