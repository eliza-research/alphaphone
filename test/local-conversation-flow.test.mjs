import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudVoiceViewFixture} from './fixtures/cloud-voice-view.mjs';
import {voiceFakeClock} from './fixtures/shared-batch-voice.mjs';
async function fixture(run,options={}){
 const clock=voiceFakeClock(),f=cloudVoiceViewFixture({clock,...options});
 try{await run(f,clock);}finally{f.holdPlaybackCleanup=false;f.releasePlaybackCleanup?.();f.holdTranscript=false;f.releaseTranscript?.();f.close();await clock.flush();}
}
async function utterance(f,clock){f.peak=.3;await clock.advance(1000);f.peak=0;await clock.advance(3500);for(let i=0;i<5;i++)await clock.flush();}
test('explicit conversation start automatically sends a local transcript and plays the matching reply locally',()=>fixture(async(f,clock)=>{
 assert.equal(f.starts,0);await f.shell.startVoice();await clock.flush();
 assert.equal(f.recordingOptions.maxDurationMs,29000);assert.equal(f.renderChat().state,'listening');
 await utterance(f,clock);
 assert.equal(f.localTranscripts,1);assert.equal(f.uploads,0);assert.equal(f.sends,1);
 assert.equal(f.sendInputs[0].text,'Synthetic local transcript');assert.equal(f.localSpeech,1);assert.equal(f.cloudSpeech,0);
 await clock.advance(1000);assert.equal(f.starts,2);assert.equal(f.renderChat().state,'listening');
},{account:null}));
test('missing local models stop before recording, sending or Cloud speech fallback',()=>fixture(async(f,clock)=>{
 await f.shell.startVoice();await clock.flush();assert.equal(f.renderChat().state,'error');
 assert.equal(f.starts,0);assert.equal(f.sends,0);assert.equal(f.uploads,0);assert.equal(f.cloudSpeech,0);
},{localReady:false}));
test('stop during local transcription cannot send a late transcript',()=>fixture(async(f,clock)=>{
 await f.shell.startVoice();await utterance(f,clock);assert.equal(f.localTranscripts,1);assert.equal(f.sends,0);
 f.renderChat().discard();await clock.flush();f.releaseTranscript();await clock.flush();
 assert.equal(f.sends,0);assert.equal(f.localSpeech,0);assert.equal(f.starts,1);
},{holdTranscript:true}));
test('speaker cleanup must complete before conversation captures another turn',()=>fixture(async(f,clock)=>{
 await f.shell.startVoice();await utterance(f,clock);assert.equal(f.localSpeech,1);assert.equal(f.starts,1);
 f.holdPlaybackCleanup=true;f.finishPlayback();await clock.advance(650);assert.equal(f.starts,1);
 f.holdPlaybackCleanup=false;f.releasePlaybackCleanup();for(let i=0;i<5;i++)await clock.flush();await clock.advance(1000);assert.equal(f.starts,2);
},{holdPlayback:true}));
test('owner change during transcription retires the turn without sending',()=>fixture(async(f,clock)=>{
 await f.shell.startVoice();await utterance(f,clock);assert.equal(f.localTranscripts,1);
 f.account='replacement-account';f.changed();await clock.flush();f.releaseTranscript();await clock.flush();
 assert.equal(f.sends,0);assert.equal(f.localSpeech,0);assert.equal(f.starts,1);
},{holdTranscript:true}));
test('unverified native recording metrics stop capture without transcription or sending',()=>fixture(async(f,clock)=>{
 await f.shell.startVoice();f.peak=2;await clock.advance(100);
 assert.equal(f.renderChat().state,'error');assert.equal(f.localTranscripts||0,0);assert.equal(f.sends,0);
 assert.equal(f.activeRecording,null);
}));
