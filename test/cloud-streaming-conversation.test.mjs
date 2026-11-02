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
  async stopCloudSpeech(){bridge.stops++;await stop();},async setCloudSpeechMuted(){},async speakCloudSpeech(){},async cancelCloudSpeech(){}};
 f.box.createCloudStreamingSpeech=input=>create(input,port);
 return bridge;
}
test('streaming speech that cannot confirm its cleanup is held for the real stream, a refusal is asked again, and AlphaVoiceCloud is not asked for it',async()=>{
 const f=fixture();let refused=1;const bridge=realStream(f,async()=>{if(refused-->0)throw Error('Stream stop refused');});
 const create=f.box.createCloudStreamingSpeech;let handlers;
 f.box.createCloudStreamingSpeech=input=>{const stream=create(input);return {...stream,async listen(input){handlers=input;return stream.listen(input);},async speak(){throw Object.assign(Error('Cloud speech cleanup was not confirmed.'),{code:'speech-cleanup-unconfirmed'});}};};
 const plugin=()=>(f.stopPlaybackInputs||[]).filter(input=>input===undefined).length+(f.pluginCancels||0);
 try{
  await f.shell.startVoice();await f.clock.flush();
  handlers.onSpeechStart(0);handlers.onSpeechEnd(20);handlers.onSegment('A completed Cloud utterance.');await f.clock.advance(0);await f.clock.flush();
  assert.equal(f.renderChat().state,'stopping','unconfirmed: the panel stays');assert.deepEqual(f.shell.messages,[]);
  assert.equal(bridge.stops,1,'one refusal so far');assert.equal(plugin(),0,'no other plugin stands in for it');
  f.renderChat().stop();await f.clock.flush();assert.equal(bridge.stops,2,'Stop reached the bridge again, past the refusal');
  assert.equal(f.renderChat(),null,'its answer ended the panel');assert.equal(plugin(),0);
  f.renderChat()?.stop();await f.clock.flush();assert.equal(bridge.stops,2,'a confirmed stop stays answered');
 }finally{refused=0;f.close();await f.clock.flush();}
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
