import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudVoiceViewFixture} from './fixtures/cloud-voice-view.mjs';

// The actual Notes recorder view with closed ports only: a failed recording or transcription leaves
// the recorder on its normal line with the clip kept; Notes storage conflicts keep their line.
const NORMAL={ready:/^Record up to 59 seconds/,recorded:/^Microphone is off\./};
const FAILURE=/unavailable|could not|was found|blocked|heard no speech|retained|kept|Sign in|PRIVATE|\(\d{3}\)/i;
async function opened(options={}){
 const f=cloudVoiceViewFixture({cloudProfile:true,...options});
 f.render().record();await f.tick();
 return f;
}
const rec=f=>f.render().rec;
async function tap(f){rec(f).stop();for(let count=0;count<10;count++)await f.tick();}
const quiet=(f,stage)=>{const view=rec(f);assert.match(view.lines[0].t,NORMAL[stage]);assert.doesNotMatch(view.lines[0].t,FAILURE);assert.deepEqual(f.shell.messages,[]);};

for(const [name,error] of [['a provider refusal',Object.assign(Error('PRIVATE_PROVIDER_BODY'),{code:'voice-http-503'})],['a billing limit',Object.assign(Error('PRIVATE_PROVIDER_BODY'),{code:'voice-http-402'})],['an empty transcript',Object.assign(Error('PRIVATE_PROVIDER_BODY'),{code:'no-speech'})],['an unknown failure',Error('PRIVATE_PROVIDER_BODY')]])
test(`Notes: ${name} while transcribing keeps the clip on the normal line, and Transcribe works again`,async()=>{
 const f=await opened();
 try{
  await tap(f);assert.equal(rec(f).state,'recording');await tap(f);quiet(f,'recorded');
  f.error=error;await tap(f);quiet(f,'recorded');assert.equal(f.uploads,1);
  f.error=null;await tap(f);assert.equal(rec(f).state,'review');assert.equal(rec(f).transcript,'Synthetic Cloud transcript');assert.equal(f.uploads,2);
 }finally{f.close();await f.tick();}
});

test('Notes: a refused microphone keeps its Open app settings control and no failure line',async()=>{
 const f=await opened({startError:Object.assign(Error('denied'),{code:'permission-denied'})});
 try{
  await tap(f);quiet(f,'ready');assert.equal(rec(f).routeChoice,true);assert.equal(rec(f).routeLabel,'Open app settings');
  f.startError=null;await tap(f);assert.equal(rec(f).state,'recording');
 }finally{f.close();await f.tick();}
});

test('Notes: signed out shows Connect, with no failure line; only that tap opens sign-in',async()=>{
 const f=await opened({account:null});
 try{
  assert.doesNotMatch(rec(f).lines[0].t,FAILURE);assert.equal(rec(f).primaryLabel,'Connect Eliza Cloud');assert.equal(f.accountOpens,0);
  rec(f).stop();assert.equal(f.accountOpens,1);
 }finally{f.close();await f.tick();}
});

test('Notes: a recording that ends without usable audio returns to ready quietly',async()=>{
 const f=await opened();
 try{
  await tap(f);assert.equal(rec(f).state,'recording');
  for(const callback of f.events.get('recordingStopped')||[])callback({recordingId:'synthetic-clip-1'});
  await f.tick();quiet(f,'ready');
 }finally{f.close();await f.tick();}
});

test('Notes: a storage conflict keeps its line: it is about the note, not voice',async()=>{
 const f=await opened();
 try{
  await tap(f);await tap(f);await tap(f);assert.equal(rec(f).state,'review');
  f.storageReady=false;await tap(f);assert.match(rec(f).lines[0].t,/pending or unconfirmed save/);
 }finally{f.close();await f.tick();}
});

const settle=async f=>{for(let count=0;count<20;count++)await f.tick();};
async function toReview(f){await tap(f);await tap(f);await tap(f);assert.equal(rec(f).state,'review');}
const unconfirmed=()=>Object.assign(Error('PRIVATE_PLUGIN_TEXT'),{code:'speech-cleanup-unconfirmed'});
function failingListen(f,failure){const real=f.box.createCloudVoice;f.box.createCloudVoice=(...input)=>({...real(...input),speak:async()=>{throw failure;}});}
function saved(f){assert.equal(f.render().rec,undefined,'the recorder closed');assert.equal(f.shell.notes.list.length,1);assert.equal(f.shell.notes.list[0].kind,'voice');assert.equal(f.shell.notes.list[0].body,'Synthetic Cloud transcript');assert.deepEqual(f.shell.messages,[]);}

for(const platform of [{native:true,platform:'android'},{native:false,platform:'web'}]){
 test(`Notes ${platform.platform}: Listen with an unconfirmed cleanup stops playback only, and Save still saves the kept recording`,async()=>{
  const f=cloudVoiceViewFixture({cloudProfile:true,...platform});failingListen(f,unconfirmed());
  try{
   f.render().record();await f.tick();await toReview(f);const asked=f.recordingCancels.length;
   rec(f).toggle();await settle(f);
   assert.equal(f.recordingCancels.length,asked,'cancelRecording deletes the kept file on Android');
   assert.equal(f.native?f.stopPlaybackInputs.filter(input=>input===undefined).length:f.pluginCancels,1,'the plugin was asked to stop playback');
   assert.equal(rec(f).state,'review');assert.equal(rec(f).failed,false);assert.deepEqual(f.shell.messages,[]);
   await tap(f);assert.equal(f.audioSaves,1);saved(f);
  }finally{f.close();await f.tick();}
 });
}

test('Notes: Listen that plays normally forces no plugin stop, and Save saves',async()=>{
 const f=await opened();
 try{
  await toReview(f);const asked=f.recordingCancels.length;
  rec(f).toggle();await settle(f);assert.equal(f.cloudSpeech,1);assert.equal(f.recordingCancels.length,asked);assert.equal((f.stopPlaybackInputs||[]).filter(input=>input===undefined).length,0);
  await tap(f);saved(f);
 }finally{f.close();await f.tick();}
});

test('Notes: a provider refusal during Listen forces no plugin stop and keeps the review',async()=>{
 const f=cloudVoiceViewFixture({cloudProfile:true});failingListen(f,Object.assign(Error('PRIVATE_PROVIDER_BODY'),{code:'voice-http-503'}));
 try{
  f.render().record();await f.tick();await toReview(f);
  rec(f).toggle();await settle(f);assert.equal(rec(f).state,'review');assert.equal((f.stopPlaybackInputs||[]).filter(input=>input===undefined).length,0);assert.deepEqual(f.shell.messages,[]);
 }finally{f.close();await f.tick();}
});

test('Notes: a live recording whose stop fails still gets the forced stop; Record again still discards a kept one',async()=>{
 const f=await opened();
 try{
  await tap(f);assert.equal(rec(f).state,'recording');f.captureCancelError=Error('Plugin stop refused');const before=f.recordingCancels.length;
  rec(f).discard();await settle(f);assert.equal(f.recordingCancels.length,before+2,'the stop, then the forced stop');
  f.captureCancelError=null;f.render().record();await settle(f);await toReview(f);const kept=f.recordingCancels.length;
  rec(f).discard();await settle(f);assert.equal(f.recordingCancels.length,kept+1,'an explicit discard deletes it');
 }finally{f.close();await f.tick();}
});

const RETAINED=/^The note save is unconfirmed\. The recording and transcript are retained; inspect saved Notes before saving again\.$/;
for(const [name,arrange] of [
 ['the recording store refuses',f=>{const save=f.driver.saveRecording;f.driver.saveRecording=async()=>{throw Error('PRIVATE_PLUGIN_TEXT');};return ()=>{f.driver.saveRecording=save;};}],
 ['the note store rejects',f=>{const save=f.shell.vset;f.shell.vset=async()=>{throw Error('PRIVATE_PLUGIN_TEXT');};return ()=>{f.shell.vset=save;};}],
 ['the note store does not confirm',f=>{f.shell.failPersistence=true;return ()=>{f.shell.failPersistence=false;};}],
 ['Notes storage goes unconfirmed during the save',f=>{const save=f.driver.saveRecording;f.driver.saveRecording=async input=>{f.storageReady=false;return save(input);};return ()=>{f.driver.saveRecording=save;f.storageReady=true;};}],
 ['the note changes during the save',f=>{const save=f.driver.saveRecording;f.driver.saveRecording=async input=>{f.shell.notes.list=[{id:input.noteId}];return save(input);};return ()=>{f.driver.saveRecording=save;f.shell.notes.list=[];};}],
])test(`Notes: when ${name} Save keeps the review with its line, and Save works again`,async()=>{
 const f=await opened();
 try{
  await toReview(f);const undo=arrange(f);
  await tap(f);const view=rec(f);
  assert.equal(view.state,'review');assert.equal(view.failed,true);assert.equal(view.transcript,'Synthetic Cloud transcript');assert.match(view.lines[0].t,RETAINED);assert.deepEqual(f.shell.messages,[]);
  undo();await tap(f);saved(f);
 }finally{f.close();await f.tick();}
});

test('Notes: a dictation into a note keeps its own line when the save fails, and applies once it works',async()=>{
 const f=cloudVoiceViewFixture({cloudProfile:true});Object.assign(f.shell.notes,{list:[{id:'note',kind:'text',title:'Plan',body:'Milk'}],open:'note'});
 try{
  f.render().ed.dictate();await f.tick();await toReview(f);
  f.shell.failPersistence=true;await tap(f);assert.equal(rec(f).state,'review');assert.match(rec(f).lines[0].t,/^The note save is unconfirmed\. Your transcript is retained; inspect saved Notes before applying again\.$/);
  f.shell.failPersistence=false;await tap(f);assert.equal(f.render().rec,undefined);assert.equal(f.shell.notes.list[0].body,'MilkSynthetic Cloud transcript');assert.deepEqual(f.shell.messages,[]);
 }finally{f.close();await f.tick();}
});

for(const [surface,name] of [['vo','voice note'],['ed','text note']])
test(`Notes: reading a ${name} aloud that fails ends quietly, and Read aloud plays next`,async()=>{
 const f=cloudVoiceViewFixture({cloudProfile:true});Object.assign(f.shell.notes,{list:[{id:'note',kind:surface==='vo'?'voice':'text',title:'Memo',body:'Hello there',...(surface==='vo'?{audio:{audioId:'saved'}}:{})}],open:'note'});
 try{
  f.error=Object.assign(Error('PRIVATE_PROVIDER_BODY'),{code:'voice-http-503'});
  f.render()[surface].readAloud();await settle(f);
  assert.equal(f.cloudSpeech,1);assert.equal(f.box.currentNoteReading(),null);assert.deepEqual(f.shell.messages,[]);
  f.error=null;f.render()[surface].readAloud();await settle(f);
  assert.equal(f.cloudSpeech,2);assert.equal(f.speechInputs.at(-1).text,'Memo. Hello there');assert.equal(f.box.currentNoteReading(),null);assert.deepEqual(f.shell.messages,[]);
 }finally{f.close();await f.tick();}
});

test('Notes: leaving the foreground while recording returns to the normal line, and recording starts again',async()=>{
 const f=await opened();
 try{
  await tap(f);assert.equal(rec(f).state,'recording');
  f.setHidden(true);await settle(f);f.setHidden(false);await settle(f);
  assert.equal(rec(f).state,'ready');quiet(f,'ready');
  await tap(f);assert.equal(rec(f).state,'recording');
 }finally{f.close();await f.tick();}
});

test('Notes: leaving the foreground during transcription keeps the recording, and Transcribe works on return',async()=>{
 const f=await opened(),cancels=[],cancel=f.driver.cancel;f.driver.cancel=input=>{cancels.push(input);return cancel(input);};
 try{
  await tap(f);await tap(f);quiet(f,'recorded');const kept=f.recordingCancels.length;
  f.holdTranscript=true;rec(f).stop();await settle(f);assert.equal(rec(f).state,'transcribing');const request=f.transcribeInput.requestId;
  f.setHidden(true);await settle(f);f.setHidden(false);await settle(f);
  quiet(f,'recorded');assert.equal(rec(f).state,'recorded');assert.equal(f.recordingCancels.length,kept,'cancelRecording would delete the finished file');
  assert.deepEqual(cancels.map(input=>input?.requestId),[request],'the abandoned upload is cancelled');
  f.holdTranscript=false;f.releaseTranscript({text:'Late words',local:false});await settle(f);assert.equal(rec(f).state,'recorded','late words are not this attempt');
  await tap(f);assert.equal(rec(f).state,'review');assert.equal(rec(f).transcript,'Synthetic Cloud transcript');assert.equal(f.uploads,2,'only the tap uploads again');
  await tap(f);assert.equal(f.audioSaves,1);saved(f);
 }finally{f.close();await f.tick();}
});

test('Notes: a kept recording waits through a trip to the background with nothing else changing',async()=>{
 const f=await opened();
 try{
  await tap(f);await tap(f);const kept=f.recordingCancels.length;
  f.setHidden(true);await settle(f);f.setHidden(false);await settle(f);
  quiet(f,'recorded');assert.equal(f.recordingCancels.length,kept);assert.equal(f.uploads,0);
 }finally{f.close();await f.tick();}
});

function dictation(createOnDeviceVoice,options={}){
 const f=cloudVoiceViewFixture(options);f.box.HTMLElement=class {};f.box.nativeLiveVoiceReady=async()=>false;f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;
 if(createOnDeviceVoice)f.box.createOnDeviceVoice=createOnDeviceVoice;
 return f;
}
for(const [name,voice] of [['no engine',()=>null],['an engine that is not ready',()=>({ready:async()=>false})],['an engine check that fails',()=>({ready:async()=>{throw Error('PRIVATE_ENGINE_TEXT');}})]])
test(`chat dictation with ${name} ends quietly at the keyboard and starts no capture`,async()=>{
 const f=dictation(voice);
 try{
  f.shell.startTranscription();await settle(f);
  assert.equal(f.renderChat(),null);assert.equal(f.shell.state.chat,'input');assert.equal(f.starts,0);assert.deepEqual(f.shell.messages,[]);
 }finally{f.close();await f.tick();}
});
test('chat dictation with a ready engine starts recording by itself',async()=>{
 const f=dictation();
 try{
  f.shell.startTranscription();await settle(f);
  assert.equal(f.renderChat().state,'recording');assert.equal(f.starts,1);
 }finally{f.close();await f.tick();}
});
test('Cloud chat dictation keeps its panel and waits for its Start tap: it has no on-device engine to miss',async()=>{
 const f=dictation(undefined,{cloudProfile:true});
 try{
  f.shell.startTranscription();await settle(f);
  assert.equal(f.renderChat().state,'ready');assert.equal(f.renderChat().primaryDisabled,false);assert.equal(f.starts,0);
  f.renderChat().stop();await settle(f);assert.equal(f.renderChat().state,'recording');
 }finally{f.close();await f.tick();}
});
