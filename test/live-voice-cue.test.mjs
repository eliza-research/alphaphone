import test from 'node:test';
import assert from 'node:assert/strict';
import {tsImport} from 'tsx/esm/api';
const {createLiveCueGate,CUE_TAIL_MS}=await tsImport(new URL('../apps/app/src/runtime/live-voice-cue.ts',import.meta.url).href,{parentURL:import.meta.url});
const {shouldRespondToVoiceTurn,ECHO_WINDOW_MS}=await tsImport(new URL('../.eliza/client-features/packages/voice/src/respond-gate.ts',import.meta.url).href,{parentURL:import.meta.url});

const CUE='Checking your calendar now.';
async function open(t,{fullDuplex=true}={}){
 t.mock.timers.enable({apis:['Date'],now:0});
 const gate=createLiveCueGate(shouldRespondToVoiceTurn),seen=[];let capture;
 const listen=gate.listen(async handlers=>{capture=handlers;return {fullDuplex,close:async()=>{},cancel:async()=>{}};});
 await listen({signal:new AbortController().signal,onSpeechStart:at=>seen.push(['start',at]),onSpeechEnd:at=>seen.push(['end',at]),onSegment:text=>seen.push(['segment',text]),onEnd:()=>seen.push(['ended']),onLevel:peak=>seen.push(['level',peak])});
 let finish,audio;
 // `playing()` starts the cue's audio at once; `requested()` leaves it waiting for its first audio.
 const play=audible=>gate.play(CUE,started=>{audio=started;if(audible)started();return new Promise(resolve=>finish=resolve);});
 return {gate,seen,capture:()=>capture,playing:()=>play(true),requested:()=>play(false),audio:()=>audio(),finish:()=>finish(),tick:ms=>t.mock.timers.tick(ms)};
}

test('without a cue every capture event reaches the session at once and in order',async t=>{
 const g=await open(t),c=g.capture();
 c.onSpeechStart(1);c.onSpeechEnd(2);c.onSpeechStart(3);c.onLevel(.5);c.onSegment('first words');c.onSpeechEnd(4);c.onSegment(null);c.onEnd();
 assert.deepEqual(g.seen,[['start',1],['end',2],['start',3],['level',.5],['segment','first words'],['end',4],['segment',null],['ended']]);
});

test('echo-cancelled capture: speech in the cue is held until its transcript; echo of the cue is dropped',async t=>{
 const g=await open(t),c=g.capture();const cue=g.playing();
 c.onSpeechStart(1);c.onSpeechEnd(2);assert.deepEqual(g.seen,[],'held speech is not reported, so it cannot interrupt by time');
 c.onSegment('checking your calendar now');assert.deepEqual(g.seen,[]);
 c.onSpeechStart(3);c.onSpeechEnd(4);c.onSegment('Actually make it Friday.');
 assert.deepEqual(g.seen,[['start',3],['end',4],['segment','Actually make it Friday.']],'real speech reaches the session by its transcript');
 g.finish();await cue;
});

test('echo-cancelled capture: later speech waits behind a held segment so the session keeps capture order',async t=>{
 const g=await open(t),c=g.capture();const cue=g.playing();
 c.onSpeechStart(1);c.onSpeechEnd(2);g.finish();await cue;
 g.tick(CUE_TAIL_MS+1);c.onSpeechStart(3);assert.deepEqual(g.seen,[],'behind the held segment');
 c.onSegment('Move it to noon.');
 assert.deepEqual(g.seen,[['start',1],['end',2],['segment','Move it to noon.'],['start',3]]);
 c.onSpeechEnd(4);c.onSegment(null);assert.deepEqual(g.seen.slice(4),[['end',4],['segment',null]]);
});

test('capture without echo cancellation: speech in the cue audio is ignored and never blocks later speech',async t=>{
 const g=await open(t,{fullDuplex:false}),c=g.capture();const cue=g.playing();
 c.onSpeechStart(1);c.onSpeechEnd(2);g.finish();await cue;g.tick(CUE_TAIL_MS+1);
 c.onSpeechStart(3);c.onSpeechEnd(4);assert.deepEqual(g.seen,[['start',3],['end',4]]);
 c.onSegment('Actually make it Friday.');c.onSegment('Move it to noon.');
 assert.deepEqual(g.seen,[['start',3],['end',4],['segment','Move it to noon.']]);
});

for(const fullDuplex of [false,true])test(`${fullDuplex?'echo-cancelled capture':'capture without echo cancellation'}: speech that starts before the cue audio reaches the session at once, as without a cue`,async t=>{
 const g=await open(t,{fullDuplex}),c=g.capture();const cue=g.requested();
 c.onSpeechStart(1);assert.deepEqual(g.seen,[['start',1]],'the session holds it by its own rules');
 g.audio();c.onSpeechEnd(2);c.onSegment('Actually make it Friday.');
 assert.deepEqual(g.seen,[['start',1],['end',2],['segment','Actually make it Friday.']]);
 c.onSpeechStart(3);c.onSpeechEnd(4);c.onSegment('checking your calendar now');
 assert.equal(g.seen.length,3,'once its audio plays, speech in the cue is held (its echo dropped) or ignored');
 g.finish();await cue;
});

test('speech that starts before the cue audio is still checked against the cue: its echo carries no transcript',async t=>{
 const g=await open(t),c=g.capture();const cue=g.requested();
 c.onSpeechStart(1);g.audio();c.onSpeechEnd(2);c.onSegment('your calendar now');
 assert.deepEqual(g.seen,[['start',1],['end',2],['segment',null]]);
 g.finish();await cue;
});

test('the echo tail: speech that starts just after the cue settles is held, and its echo dropped',async t=>{
 const g=await open(t),c=g.capture();const cue=g.playing();g.finish();await cue;
 g.tick(CUE_TAIL_MS);c.onSpeechStart(1);c.onSpeechEnd(2);assert.deepEqual(g.seen,[],'held: the tail cannot interrupt by time');
 c.onSegment('your calendar now');assert.deepEqual(g.seen,[],'the echo of the cue is never sent');
 c.onSpeechStart(3);c.onSpeechEnd(4);c.onSegment('Actually make it Friday.');
 assert.deepEqual(g.seen,[['start',3],['end',4],['segment','Actually make it Friday.']],'real speech in the tail still reaches the session');
});

test('capture without echo cancellation: speech after the cue passes at once and its echo carries no transcript',async t=>{
 const g=await open(t,{fullDuplex:false}),c=g.capture();const cue=g.playing();g.finish();await cue;
 c.onSpeechStart(1);assert.deepEqual(g.seen,[['start',1]]);
 c.onSpeechEnd(2);c.onSegment('your calendar now');
 assert.deepEqual(g.seen,[['start',1],['end',2],['segment',null]]);
});

test('after the tail, speech passes at once; the cue stays its echo reference for the session echo window',async t=>{
 const g=await open(t,{fullDuplex:false}),c=g.capture();const cue=g.playing();g.finish();await cue;
 g.tick(CUE_TAIL_MS+1);c.onSpeechStart(1);assert.deepEqual(g.seen,[['start',1]]);
 c.onSpeechEnd(2);c.onSegment('your calendar now');c.onSpeechStart(3);c.onSpeechEnd(4);c.onSegment('Move it to noon.');
 assert.deepEqual(g.seen,[['start',1],['end',2],['segment',null],['start',3],['end',4],['segment','Move it to noon.']],'echo of the cue carries no transcript');
 g.tick(ECHO_WINDOW_MS);c.onSpeechStart(5);c.onSpeechEnd(6);c.onSegment('your calendar now');
 assert.deepEqual(g.seen.slice(6),[['start',5],['end',6],['segment','your calendar now']],'past the window the words are the user\'s');
});

test('a cue with no audio leaves no window: cancelled before its first audio',async t=>{
 const g=await open(t),c=g.capture();
 await assert.rejects(g.gate.play(CUE,async()=>{throw new DOMException('cancelled','AbortError');}),{name:'AbortError'});
 c.onSpeechStart(1);assert.deepEqual(g.seen,[['start',1]],'not held');
 c.onSpeechEnd(2);c.onSegment('your calendar now');
 assert.deepEqual(g.seen,[['start',1],['end',2],['segment','your calendar now']],'and nothing was heard to echo');
});

test('a cue never starts over the user or over another cue: it is dropped (silence)',async t=>{
 const g=await open(t),c=g.capture();let spoken=0;
 c.onSpeechStart(1);await g.gate.play(CUE,async()=>{spoken++;});assert.equal(spoken,0);
 c.onSpeechEnd(2);const cue=g.playing();await g.gate.play(CUE,async()=>{spoken++;});assert.equal(spoken,0);
 g.finish();await cue;await g.gate.play(CUE,async()=>{spoken++;});assert.equal(spoken,1);
});

test('a reopened capture (Unmute) starts with no held speech from the closed one',async t=>{
 const g=await open(t),c=g.capture();const cue=g.playing();c.onSpeechStart(1);g.finish();await cue;g.tick(CUE_TAIL_MS+1);
 const seen=[];let next;
 await g.gate.listen(async handlers=>{next=handlers;return {fullDuplex:true,close:async()=>{},cancel:async()=>{}};})({signal:new AbortController().signal,onSpeechStart:at=>seen.push(['start',at]),onSpeechEnd:()=>{},onSegment:()=>{},onEnd:()=>{}});
 let spoken=0;await g.gate.play(CUE,async()=>{spoken++;});assert.equal(spoken,1,'the closed capture no longer counts as speaking');
 next.onSpeechStart(5);assert.deepEqual(seen,[['start',5]]);
});
