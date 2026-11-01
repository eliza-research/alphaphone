import test from 'node:test';
import assert from 'node:assert/strict';
import {tsImport} from 'tsx/esm/api';
const {createLiveCueGate}=await tsImport(new URL('../apps/app/src/runtime/live-voice-cue.ts',import.meta.url).href,{parentURL:import.meta.url});
const {shouldRespondToVoiceTurn}=await tsImport(new URL('../.eliza/client-features/packages/voice/src/respond-gate.ts',import.meta.url).href,{parentURL:import.meta.url});

const CUE='Checking your calendar now.';
async function open({fullDuplex=true}={}){
 const gate=createLiveCueGate(shouldRespondToVoiceTurn),seen=[];let capture;
 const listen=gate.listen(async handlers=>{capture=handlers;return {fullDuplex,close:async()=>{},cancel:async()=>{}};});
 await listen({signal:new AbortController().signal,onSpeechStart:at=>seen.push(['start',at]),onSpeechEnd:at=>seen.push(['end',at]),onSegment:text=>seen.push(['segment',text]),onEnd:()=>seen.push(['ended']),onLevel:peak=>seen.push(['level',peak])});
 let finish;const playing=()=>gate.play(CUE,()=>new Promise(resolve=>finish=resolve));
 return {gate,seen,capture:()=>capture,playing,finish:()=>finish()};
}

test('without a cue every capture event reaches the session at once and in order',async()=>{
 const g=await open(),c=g.capture();
 c.onSpeechStart(1);c.onSpeechEnd(2);c.onSpeechStart(3);c.onLevel(.5);c.onSegment('first words');c.onSpeechEnd(4);c.onSegment(null);c.onEnd();
 assert.deepEqual(g.seen,[['start',1],['end',2],['start',3],['level',.5],['segment','first words'],['end',4],['segment',null],['ended']]);
});

test('echo-cancelled capture: speech in the cue is held until its transcript; echo of the cue is dropped',async()=>{
 const g=await open(),c=g.capture();const cue=g.playing();
 c.onSpeechStart(1);c.onSpeechEnd(2);assert.deepEqual(g.seen,[],'held speech is not reported, so it cannot interrupt by time');
 c.onSegment('checking your calendar now');assert.deepEqual(g.seen,[]);
 c.onSpeechStart(3);c.onSpeechEnd(4);c.onSegment('Actually make it Friday.');
 assert.deepEqual(g.seen,[['start',3],['end',4],['segment','Actually make it Friday.']],'real speech reaches the session by its transcript');
 g.finish();await cue;
});

test('echo-cancelled capture: later speech waits behind a held segment so the session keeps capture order',async()=>{
 const g=await open(),c=g.capture();const cue=g.playing();
 c.onSpeechStart(1);c.onSpeechEnd(2);g.finish();await cue;
 c.onSpeechStart(3);assert.deepEqual(g.seen,[],'behind the held segment');
 c.onSegment('Move it to noon.');
 assert.deepEqual(g.seen,[['start',1],['end',2],['segment','Move it to noon.'],['start',3]]);
 c.onSpeechEnd(4);c.onSegment(null);assert.deepEqual(g.seen.slice(4),[['end',4],['segment',null]]);
});

test('capture without echo cancellation: speech in the cue is ignored and never blocks later speech',async()=>{
 const g=await open({fullDuplex:false}),c=g.capture();const cue=g.playing();
 c.onSpeechStart(1);c.onSpeechEnd(2);g.finish();await cue;
 c.onSpeechStart(3);c.onSpeechEnd(4);assert.deepEqual(g.seen,[['start',3],['end',4]]);
 c.onSegment('Actually make it Friday.');c.onSegment('Move it to noon.');
 assert.deepEqual(g.seen,[['start',3],['end',4],['segment','Move it to noon.']]);
});

test('a cue never starts over the user: it is dropped (silence) while speech is open',async()=>{
 const g=await open(),c=g.capture();let spoken=0;
 c.onSpeechStart(1);await g.gate.play(CUE,async()=>{spoken++;});assert.equal(spoken,0);
 c.onSpeechEnd(2);await g.gate.play(CUE,async()=>{spoken++;});assert.equal(spoken,1);
});

test('the cue window closes when its playback settles, also on cancellation',async()=>{
 const g=await open(),c=g.capture();
 await assert.rejects(g.gate.play(CUE,async()=>{throw new DOMException('cancelled','AbortError');}),{name:'AbortError'});
 c.onSpeechStart(1);assert.deepEqual(g.seen,[['start',1]]);
});

test('a reopened capture (Unmute) starts with no held speech from the closed one',async()=>{
 const g=await open(),c=g.capture();const cue=g.playing();c.onSpeechStart(1);g.finish();await cue;
 const seen=[];let next;
 await g.gate.listen(async handlers=>{next=handlers;return {fullDuplex:true,close:async()=>{},cancel:async()=>{}};})({signal:new AbortController().signal,onSpeechStart:at=>seen.push(['start',at]),onSpeechEnd:()=>{},onSegment:()=>{},onEnd:()=>{}});
 let spoken=0;await g.gate.play(CUE,async()=>{spoken++;});assert.equal(spoken,1,'the closed capture no longer counts as speaking');
 next.onSpeechStart(5);assert.deepEqual(seen,[['start',5]]);
});
