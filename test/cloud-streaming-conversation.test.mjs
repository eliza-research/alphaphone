import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudVoiceViewFixture,load} from './fixtures/cloud-voice-view.mjs';
import {voiceFakeClock} from './fixtures/shared-batch-voice.mjs';

function fixture(streamError){
 const clock=voiceFakeClock(),f=cloudVoiceViewFixture({cloudProfile:true,clock});
 f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;f.box.randomId=()=>crypto.randomUUID();
 load('../../../.eliza/client-features/packages/voice/src/voice-assistant-session.ts',f.box,['VoiceAssistantSession']);
 f.box.createHeardReporter=()=>({report:async()=> 'not-needed'});
 f.box.recordEndpointVoiceTiming=()=>{};f.box.activeVoiceTurn=()=>undefined;f.box.recordHeardVoiceTiming=()=>{};
 f.box.shouldRespondToVoiceTurn=()=>true;f.box.buildVoiceTurnSignal=()=>({});f.box.toSpeakableText=t=>t;
 f.box.nativeCloudStreamingAvailable=()=>true;
 let handlers,stopped=0;const spoken=[];
 f.box.createCloudStreamingSpeech=()=>({
  async listen(input){if(streamError)throw Object.assign(Error('Cloud streaming request failed'),{code:streamError});handlers=input;input.signal.addEventListener('abort',()=>stopped++,{once:true});return {fullDuplex:true,close:async()=>{},cancel:async()=>stopped++};},
  async speak(text,signal,onStarted){signal.throwIfAborted();spoken.push(text);onStarted();},
  async stop(){stopped++;},
 });
 return Object.assign(f,{clock,spoken,getHandlers:()=>handlers,stopped:()=>stopped});
}

test('Cloud Talk streams endpointed speech into the resident without batch STT or progress TTS',async()=>{
 const f=fixture();
 try{
  await f.shell.startVoice();await f.clock.flush();const h=f.getHandlers();assert.ok(h);
  assert.equal(f.starts,0);assert.equal(f.uploads,0);
  h.onSpeechStart(0);h.onSpeechEnd(20);h.onSegment('A completed Cloud utterance.');
  await f.clock.advance(0);await f.clock.flush();
  assert.equal(f.sends,1);assert.equal(f.uploads,0);assert.equal(f.cloudSpeech,0);
  assert.deepEqual(f.spoken,['Synthetic matching reply.']);
  assert.equal(f.localFactories,0);
 }finally{f.close();await f.clock.flush();}
});

test('only an absent streaming route retains compatibility recording; auth and provider failures do not replay',async()=>{
 for(const code of ['cloud-http-404','cloud-http-401','cloud-http-503']){
  const f=fixture(code);
  try{
   await f.shell.startVoice();await f.clock.flush();
   assert.equal(f.starts,code==='cloud-http-404'?1:0,code);
   assert.equal(f.uploads,0);assert.equal(f.sends,0);assert.deepEqual(f.shell.messages,[]);
   // The fallback keeps listening with no leftover failure line; any other refusal ends voice.
   if(code==='cloud-http-404'){const view=f.renderChat();assert.equal(view.state,'listening');assert.equal(view.lines[0].t,'Listening…');assert.doesNotMatch(JSON.stringify(view),/Voice stopped|connection|history/i);}
   else assert.equal(f.renderChat(),null,code);
  }finally{f.close();await f.clock.flush();}
 }
});

test('a streaming route lost after it opened ends voice quietly and opens no recording',async()=>{
 const f=fixture();
 try{
  await f.shell.startVoice();await f.clock.flush();assert.equal(f.renderChat().state,'listening');
  f.getHandlers().onEnd(Object.assign(Error('Cloud streaming request failed'),{code:'cloud-http-404'}));await f.clock.flush();
  assert.equal(f.renderChat(),null);assert.deepEqual(f.shell.messages,[]);assert.equal(f.starts,0);
 }finally{f.close();await f.clock.flush();}
});

/** The real Cloud stream over a synthetic bridge, whose stop answers `stop()` each time it is asked. */
function realStream(f,stop=async()=>{}){
 load('../../../.eliza/client-features/packages/voice/src/native-cloud-speech.ts',f.box,['createCloudStreamingSpeech']);
 const create=f.box.createCloudStreamingSpeech,bridge={stops:0,opened:0,emit(){}};
 const port={async addListener(_event,callback){bridge.emit=callback;return {remove:async()=>{}};},async startCloudSpeech({sessionId}){bridge.opened++;bridge.sessionId=sessionId;return bridge.start?.(sessionId)??{sessionId,sampleRate:16000,echoCancelled:true};},
  async stopCloudSpeech(){bridge.stops++;await stop();},async setCloudSpeechMuted(){},async speakCloudSpeech({utteranceId}){bridge.utteranceId=utteranceId;},async cancelCloudSpeech(){}};
 f.box.createCloudStreamingSpeech=input=>create(input,port);
 return bridge;
}
test('streaming speech that cannot confirm its cleanup is held for the real stream, a refusal is asked again, and AlphaVoiceCloud is not asked for it',async()=>{
 const f=fixture();let refused=true;const bridge=realStream(f,async()=>{if(refused)throw Error('Stream stop refused');});
 const create=f.box.createCloudStreamingSpeech;let handlers;
 f.box.createCloudStreamingSpeech=input=>{const stream=create(input);return {...stream,async listen(input){handlers=input;return stream.listen(input);},async speak(){throw Object.assign(Error('Cloud speech cleanup was not confirmed.'),{code:'speech-cleanup-unconfirmed'});}};};
 const plugin=()=>(f.stopPlaybackInputs||[]).filter(input=>input===undefined).length+(f.pluginCancels||0);
 try{
  await f.shell.startVoice();await f.clock.flush();
  handlers.onSpeechStart(0);handlers.onSpeechEnd(20);handlers.onSegment('A completed Cloud utterance.');await f.clock.advance(0);await f.clock.flush();
  assert.equal(f.renderChat().state,'stopping','unconfirmed: the panel stays');assert.deepEqual(f.shell.messages,[]);
  const asked=bridge.stops;assert.ok(asked>=1,'refused so far');assert.equal(plugin(),0,'no other plugin stands in for it');
  refused=false;f.renderChat().stop();await f.clock.flush();assert.equal(bridge.stops,asked+1,'Stop reached the bridge again, past the refusal');
  assert.equal(f.renderChat(),null,'its answer ended the panel');assert.equal(plugin(),0);
  f.renderChat()?.stop();await f.clock.flush();assert.equal(bridge.stops,asked+1,'a confirmed stop stays answered');
 }finally{refused=false;f.close();await f.clock.flush();}
});

/** Talk open on the real stream, then one turn in the phase a Stop is tested in. The bridge answers `gate.stop` each time it is asked. */
async function streamIn(phase,gate){
 const f=fixture(),bridge=realStream(f,()=>gate.stop?.());
 await f.shell.startVoice();await f.clock.flush();assert.equal(f.renderChat().state,'listening');
 const turn=()=>{bridge.emit({sessionId:bridge.sessionId,type:'speech-start'});bridge.emit({sessionId:bridge.sessionId,type:'speech-end',text:'A completed Cloud utterance.'});};
 if(phase==='thinking'){f.holdReply=true;turn();await f.clock.advance(100);assert.equal(f.renderChat().state,'thinking');}
 if(phase==='speaking'){turn();await f.clock.advance(100);bridge.emit({sessionId:bridge.sessionId,type:'audio-start',utteranceId:bridge.utteranceId});await f.clock.advance(100);assert.equal(f.renderChat().state,'speaking');}
 if(phase==='muted'){f.renderChat().toggleMute();await f.clock.flush();assert.match(f.renderChat().lines[0].t,/Microphone off/);}
 return {f,bridge};
}
const leave=async f=>{f.releaseReply?.();f.close();await f.clock.advance(11000);};
const settled=async f=>{for(let count=0;count<6;count++)await f.clock.flush();};
for(const phase of ['thinking','speaking','muted']){
 test(`Cloud stream: Stop while ${phase} with the bridge refusing holds the quiet panel, Talk opens no second session, and only its answer ends it`,async()=>{
  const gate={},{f,bridge}=await streamIn(phase,gate);
  try{
   gate.stop=()=>{throw Error('Stream stop refused');};f.renderChat().stop();await f.clock.flush();
   assert.equal(f.renderChat().state,'stopping');assert.equal(f.renderChat().problem,false);assert.deepEqual(f.shell.messages,[]);
   await f.shell.startVoice();await f.clock.flush();assert.equal(bridge.opened,1,'no second paid session');
   const asked=bridge.stops;f.renderChat().stop();await f.clock.flush();assert.ok(bridge.stops>asked,'Stop reached the bridge');assert.equal(f.renderChat().state,'stopping');
   await f.clock.advance(3000);const repeated=bridge.stops;assert.ok(repeated>asked+1,'the timer asks too');assert.equal(f.starts,0);
   gate.stop=undefined;await f.clock.advance(3000);assert.equal(f.renderChat(),null);
   const done=bridge.stops;await f.clock.advance(20000);assert.equal(bridge.stops,done,'a confirmed stop is asked nothing more');
  }finally{gate.stop=undefined;await leave(f);}
 });
 test(`Cloud stream: Stop while ${phase} with the bridge never answering holds the quiet panel past the deadline`,async()=>{
  let answer;const gate={},{f,bridge}=await streamIn(phase,gate);
  try{
   gate.stop=()=>new Promise(resolve=>answer=resolve);f.renderChat().stop();await f.clock.flush();
   assert.equal(f.renderChat().state,'stopping');assert.equal(bridge.stops,1,'within the deadline nothing asks again');
   await f.clock.advance(20000);assert.equal(f.renderChat().state,'stopping');
   await f.shell.startVoice();await f.clock.flush();assert.equal(bridge.opened,1,'no second paid session');
   gate.stop=undefined;answer();await f.clock.advance(3000);assert.equal(f.renderChat(),null,'its answer ends the panel');
  }finally{gate.stop=undefined;answer?.();await leave(f);}
 });
 test(`Cloud stream: a normal Stop while ${phase} asks the bridge once and returns quietly to Talk`,async()=>{
  const {f,bridge}=await streamIn(phase,{});
  try{
   f.renderChat().stop();await f.clock.flush();assert.equal(bridge.stops,1);assert.equal(f.renderChat(),null);assert.deepEqual(f.shell.messages,[]);
   await f.clock.advance(20000);assert.equal(bridge.stops,1);
   await f.shell.startVoice();await f.clock.flush();assert.equal(bridge.opened,2);assert.equal(f.renderChat().state,'listening');
  }finally{await leave(f);}
 });
}
test('Cloud stream: a stale stream stop only joins its memo: a Notes Cancel after Talk asks the bridge nothing',async()=>{
 const {f,bridge}=await streamIn('listening',{});
 try{
  f.renderChat().stop();await f.clock.flush();assert.equal(bridge.stops,1);
  f.render().record();await f.clock.flush();f.render().rec.stop();await f.clock.flush();f.render().rec.discard();await f.clock.flush();
  assert.equal(bridge.stops,1);assert.equal(f.render().rec,undefined);
 }finally{await leave(f);}
});
test('a failed streaming start holds the panel while the stop it asks last is unanswered, then for its refusal',async()=>{
 const f=fixture();let count=0,answer;
 const bridge=realStream(f,()=>{if(++count<3)throw Error('Stream stop refused');return new Promise((_,refuse)=>{answer=()=>refuse(Error('Stream stop refused'));});});
 bridge.start=()=>{throw Object.assign(Error('Cloud streaming request failed'),{code:'cloud-http-500'});};
 try{
  void f.shell.startVoice();await settled(f);
  assert.equal(count,3);assert.equal(f.renderChat().state,'stopping','unanswered: the panel stays');
  answer();await settled(f);assert.equal(f.renderChat().state,'stopping','refused: the panel stays');assert.equal(bridge.opened,1);assert.equal(f.starts,0);
 }finally{count=-9;answer?.();await leave(f);}
});
test('a quiet Cloud wait waits for the failed start\'s stop too: the next start opens nothing until that stream answers',async()=>{
 const f=fixture();let count=0,answer;
 const bridge=realStream(f,()=>{if(++count<3)throw Error('Stream stop refused');if(count===3)return new Promise(resolve=>{answer=resolve;});});
 bridge.start=sessionId=>{if(bridge.opened===1)throw Object.assign(Error('Warming'),{code:'voice-http-503'});return {sessionId,sampleRate:16000,echoCancelled:true};};
 try{
  void f.shell.startVoice();await settled(f);assert.equal(count,3);
  await f.clock.advance(2100);assert.equal(bridge.opened,1,'the retry waits for the stop under way');
  answer();await settled(f);assert.equal(bridge.opened,2,'its answer lets the wait go on');assert.equal(f.renderChat().state,'listening');
 }finally{answer?.();await leave(f);}
});

test('a streaming start that fails with its stop refused stays held for that stream, and no clip recording opens',async()=>{
 const f=fixture();let refused=true;const bridge=realStream(f,async()=>{if(refused)throw Error('Stream stop refused');});
 bridge.start=()=>{throw Object.assign(Error('Cloud streaming request failed'),{code:'cloud-http-401'});};
 try{
  await f.shell.startVoice();await f.clock.flush();
  assert.equal(f.renderChat().state,'stopping','unconfirmed: the panel stays');assert.equal(f.starts,0);assert.deepEqual(f.shell.messages,[]);
  await f.shell.startVoice();await f.clock.flush();assert.equal(bridge.opened,1,'no second session over it');
  refused=false;f.renderChat().stop();await f.clock.flush();assert.equal(f.renderChat(),null);
 }finally{refused=false;f.close();await f.clock.flush();}
});

test('a streaming route that is absent falls back to one clip recording only once the stream is confirmed stopped',async()=>{
 for(const held of [false,true]){
  const f=fixture();let refused=held;const bridge=realStream(f,async()=>{if(refused)throw Error('Stream stop refused');});
  bridge.start=()=>{throw Object.assign(Error('Cloud streaming request failed'),{code:'cloud-http-404'});};
  try{
   await f.shell.startVoice();await f.clock.flush();
   assert.equal(f.starts,held?0:1,'no capture over an unconfirmed stream');assert.equal(f.renderChat().state,held?'stopping':'listening');
  }finally{refused=false;f.close();await f.clock.advance(3000);}
 }
});

test('stopping streaming Talk retires capture and never falls back to batch recording',async()=>{
 const f=fixture();
 try{
  await f.shell.startVoice();await f.clock.flush();
  const stopping=f.shell.stopVoiceConversation();await f.clock.flush();await stopping;
  assert.ok(f.stopped()>0);assert.equal(f.starts,0);assert.equal(f.uploads,0);assert.equal(f.sends,0);
 }finally{f.close();await f.clock.flush();}
});
