import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudVoiceViewFixture} from './fixtures/cloud-voice-view.mjs';
import {voiceFakeClock} from './fixtures/shared-batch-voice.mjs';

// The actual voice adapter with in-memory ports only: no microphone, socket, provider, Cloud or model request.
// The realtime session itself (health attestation, relay refusal codes, busy hold) is owned by
// development-cartesia-conversation.test.mjs; the agent's relay settings by cloud-resident-host.test.mjs.
function residentFixture({inference='cloud',...options}={}){
 const h=cloudVoiceViewFixture({cloudProfile:true,browserCloudResident:true,native:false,platform:'web',...options});
 const snapshot=h.box.connectionController.getSnapshot,agent={session:{ownerId:'synthetic-owner'}};
 h.inference=inference;h.batchLoops=0;h.progressCues=0;h.realtimeSessions=0;h.realtimeStops=0;
 h.box.connectionController.getSnapshot=()=>({...snapshot(),residentInference:h.inference,providerStatus:{voiceConfigured:h.inference==='direct'}});
 h.box.connectionController.getBrowserSpeechAgent=()=>agent;
 h.box.connectionController.voiceRendererMetadata=()=>({viewDelivery:'completed-action'});
 h.box.HTMLElement=class {};h.box.React={createElement:()=>null};h.box.VoiceActivity=()=>null;
 h.box.BatchVoiceConversation=class {constructor(){h.batchLoops++;}async start(){}async stop(){}recheck(){}};
 const cue=h.box.createBatchProgressAcknowledgment;h.box.createBatchProgressAcknowledgment=(...input)=>{h.progressCues++;return cue(...input);};
 h.box.developmentCartesiaConversation=async options=>{h.realtime=options;h.realtimeSessions++;let muted=false;
  return {async start(){options.assertCurrent();options.onState('listening');},async stop(){h.realtimeStops++;},recheck(){},resume:()=>false,
   get microphoneAutomaticallyMuted(){return false;},get microphoneMuted(){return muted;},setMicrophoneMuted(value){muted=value;},needsPlaybackUnlock:false,async unlockPlayback(){}};};
 return h;
}

test('Cloud mode conversation is the realtime session: no batch loop, recording upload or spoken progress cue',async()=>{
 const h=residentFixture();
 try{
  await h.shell.startVoice();
  assert.equal(h.realtimeSessions,1);assert.equal(h.realtime.binding.conversationId,h.conversation);
  assert.equal(h.batchLoops,0,'the batch Cloud conversation loop is retired for the Cloud resident');
  assert.equal(h.progressCues,0,'no extra spoken progress request');
  assert.equal(h.starts,0);assert.equal(h.uploads,0);assert.equal(h.cloudSpeech,0);assert.equal(h.sends,0);assert.equal(h.localFactories,0);
  const view=h.renderChat();assert.equal(view.state,'listening');assert.equal(view.canMute,true);assert.equal(view.muteLabel,'Mute microphone');
  assert.match(view.cloudDisclosureText,/streams what you say.*Eliza Cloud account while voice is open.*plan allowance.*Cartesia/);
  h.realtime.onTranscript('live words');assert.equal(h.shell.renderVals().voiceInterim,'live words','words appear while the user talks');
  await h.shell.stopVoiceConversation();assert.equal(h.realtimeStops,1);
  await h.shell.startVoice();assert.equal(h.realtimeSessions,2,'a stopped session releases media for the next start');assert.deepEqual(h.shell.messages,[]);
  await h.shell.stopVoiceConversation();
 }finally{h.close();await h.tick();}
});

for(const [code,copy] of [
 ['voice-relay-authorization',/^Eliza Cloud did not accept this sign-in for voice\. Sign in again in Settings, then try voice again\.$/],
 ['voice-relay-transport',/^Eliza Cloud voice is busy or unavailable right now\. Try voice again in a moment, or use the keyboard\.$/],
 ['voice-relay-insufficient_credits',/^Eliza Cloud declined cloud voice for your account's billing\. Check your account in Settings, then retry\.$/],
 ['voice-relay-unexpected_code',/^Voice stopped\. Try voice again, or use the keyboard\.$/],
])test(`Cloud relay refusal ${code.replace('voice-relay-','')} ends voice calmly and honestly, without an automatic paid retry`,async()=>{
 const clock=voiceFakeClock(),h=residentFixture({clock});
 try{
  await h.shell.startVoice();await clock.flush();
  h.realtime.onError(Object.assign(Error('voice session lost: server_error',{cause:Error('PRIVATE_RELAY_DETAIL')}),{code}));
  const view=h.renderChat();assert.equal(view.state,'error');assert.match(view.lines[0].t,copy);
  assert.doesNotMatch(JSON.stringify(view),/server_error|voice-relay|PRIVATE_RELAY_DETAIL|HTTP|403|429/);
  assert.equal(view.recoveryLabel,'Try voice again');
  await clock.advance(120_000);
  assert.equal(h.realtimeSessions,1,'no automatic re-mint of a paid relay session');assert.equal(h.batchLoops,0,'no batch fallback');
  assert.deepEqual(h.shell.messages,[]);
 }finally{h.close();await h.tick();}
});

// Every other realtime ending in Cloud mode (from the pinned SDK client or this app's session
// adapter) is shown calmly: a microphone refusal keeps its browser recovery, nothing raw is shown.
const micError=(code,name)=>Object.assign(Error(code==='no_device'?'no microphone device':'microphone permission denied',{cause:Object.assign(Error('PRIVATE_DEVICE_DETAIL'),{name})}),{name:'VoiceMicCaptureError',code});
for(const [label,failure,copy] of [
 ['a closed relay socket',Error('voice session lost: ws_close'),/^Voice stopped\. Try voice again, or use the keyboard\.$/],
 ['a failed re-mint',Error('voice session lost: remint_failed',{cause:Error('PRIVATE_MINT_DETAIL')}),/^Voice stopped\. Try voice again, or use the keyboard\.$/],
 ['a mint transport failure',Object.assign(Error('voice session mint transport failed'),{name:'VoiceSessionMintError',status:-1}),/^Voice stopped\. Try voice again, or use the keyboard\.$/],
 ['an unconfirmed retirement',Error('Developer voice retirement was not confirmed.'),/^Voice stopped\. Try voice again, or use the keyboard\.$/],
 ['voice open in another tab',Object.assign(Error('Voice is already active in another tab. Stop it there first.'),{code:'VOICE_SESSION_BUSY'}),/^Voice is already on in another tab\. Stop it there, then try voice again\.$/],
 ['a denied microphone',micError('permission_denied','NotAllowedError'),/^Microphone access is blocked\. Allow the microphone for this site in your browser’s site settings/],
 ['a missing microphone',micError('no_device','NotFoundError'),/^No usable microphone was found\./],
])test(`Cloud mode shows ${label} calmly, without raw session text or an automatic paid retry`,async()=>{
 const clock=voiceFakeClock(),h=residentFixture({clock});
 try{
  await h.shell.startVoice();await clock.flush();
  h.realtime.onError(failure);
  const view=h.renderChat();assert.equal(view.state,'error');assert.match(view.lines[0].t,copy);
  assert.doesNotMatch(JSON.stringify(view),/ws_close|remint_failed|mint transport|PRIVATE_|Developer|VOICE_SESSION_BUSY|permission denied|microphone device/);
  assert.equal(view.recoveryLabel,'Try voice again');
  await clock.advance(120_000);
  assert.equal(h.realtimeSessions,1,'no automatic re-mint of a paid relay session');assert.equal(h.batchLoops,0,'no batch fallback');
  assert.deepEqual(h.shell.messages,[]);
 }finally{h.close();await h.tick();}
});

test('Cloud mode dictation and read-aloud stay batch Cloud speech',async()=>{
 const h=residentFixture();
 try{
  h.driver.transcribeDevelopmentCloudRecording=async input=>{h.dictations=(h.dictations||[]);h.dictations.push(input);return {text:'Dictated words',local:false};};
  h.shell.startTranscription();await h.tick();
  assert.equal(h.realtimeSessions,0);
  h.renderChat().stop();for(let i=0;i<10;i++)await h.tick();assert.equal(h.starts,1,'one batch recording');
  h.renderChat().stop();for(let i=0;i<20;i++)await h.tick();
  assert.equal(h.dictations?.length,1,'the recording is transcribed by batch Cloud speech');assert.equal(h.realtimeSessions,0);
  h.renderChat().discard();for(let i=0;i<10;i++)await h.tick();
  h.driver.synthesizeDevelopmentCloud=async input=>{(h.readAloud??=[]).push(input.text);return {playbackId:'read-'+input.requestId};};
  assert.equal(await h.box.speakNote('Read this note aloud.'),'finished');
  assert.deepEqual(h.readAloud,['Read this note aloud.'],'read-aloud is one batch Cloud synthesis');assert.equal(h.realtimeSessions,0);
 }finally{h.close();await h.tick();}
});

test('own keys in the Cloud resident keep the direct realtime route, and native Cloud keeps its route',async()=>{
 const own=residentFixture({inference:'direct'});
 try{
  await own.shell.startVoice();
  assert.equal(own.realtimeSessions,1);assert.equal(own.batchLoops,0);
  assert.match(own.renderChat().cloudDisclosureText,/Cartesia.*direct Cerebras/);assert.doesNotMatch(own.renderChat().cloudDisclosureText,/plan allowance/);
  own.realtime.onError(Error('voice session lost: ws_close'));
  assert.equal(own.renderChat().lines[0].t,'voice session lost: ws_close','own-keys direct keeps its existing error text');
  await own.shell.stopVoiceConversation();
 }finally{own.close();await own.tick();}
 const native=cloudVoiceViewFixture({cloudProfile:true});
 try{
  native.box.React={createElement:()=>null};native.box.VoiceActivity=()=>null;let realtime=0;native.box.developmentCartesiaConversation=async()=>{realtime++;throw Error('Native Cloud must not use the browser realtime route');};
  await native.shell.startVoice();
  assert.equal(realtime,0);assert.equal(native.renderChat().state,'listening');assert.equal(native.starts,1,'native Cloud keeps its own capture route');
  assert.match(native.renderChat().cloudDisclosureText,/uploads recordings.*plan allowance/);
  await native.shell.stopVoiceConversation();
 }finally{native.close();await native.tick();}
});
