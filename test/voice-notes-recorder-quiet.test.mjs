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
