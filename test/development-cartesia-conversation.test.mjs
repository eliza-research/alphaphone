import {validateUuid} from '../vendor/eliza/packages/core/src/utils/uuid.ts';
import test from 'node:test';import assert from 'node:assert/strict';import {buildSync} from 'esbuild';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';import vm from 'node:vm';
import {applyServerEvent,loopToListening,INITIAL_VOICE_SESSION_STATE} from '../vendor/eliza/packages/ui/src/voice/voice-session-state.ts';
// Like the pinned SDK client, reduce each frame into accepted state before the raw callback.
const sdkOptions=options=>{let state={...INITIAL_VOICE_SESSION_STATE,phase:'listening'};return options&&{...options,
 // Mirror existing SDK local drain: raw generation-end is deliberately not reduced.
 drainPlayback(traceId){if(state.phase==='speaking'&&state.traceId===traceId){state=loopToListening(applyServerEvent(state,{t:'speaking_end',traceId}));options.onState(state);}},
 onServerEvent(event){if(event.t!=='speaking_end'){state=applyServerEvent(state,event);options.onState(state);}options.onServerEvent(event);}};};
const source=stripTypeScriptTypes((readFileSync('apps/app/src/runtime/development-cartesia-flag.ts','utf8')+readFileSync('apps/app/src/runtime/development-cartesia-conversation.ts','utf8')).replace(/^import .*;\n/gm,'').replace(/^export \{.*\} from .*;\n/gm,'').replace("await import('@elizaos/ui/voice/voice-session-client')","await loadClient()").replace(/^export /gm,''),{mode:'transform'});
const binding={conversationId:'conversation',session:{agentId:'agent'}};
async function setup({revoked=true,alreadyRetired=false,cloudRealtime=false,cloudResident=false,snapshot={residentInference:'cloud'},attestation={},askBefore=true}={}){
 let current=true,options,sdk,stops=0,history=0,manualMuted=false;const calls=[],errors=[],performed=[];const preferenceWindow=new EventTarget();
 const agent={async request(path,body){calls.push({path,body});if(path.includes('/health'))return {ready:true,conversationId:'conversation',agentId:'agent',...attestation};if(path==='/api/views/voice-channel')return {wsUrl:'ws://localhost/__alpha-local-renderer/ws?sessionId=fixture',expiresAt:Date.now()+120000};if(path.includes('/revoke')){if(alreadyRetired)throw Object.assign(Error('Retired'),{status:404,data:{code:'voice_session_not_found'}});return {revoked};}return {};}};
 const context=vm.createContext({validateUuid,readDevicePreferences:async()=>({askBeforeAgentActions:askBefore}),window:preferenceWindow,AbortController,DOMException,Response,Error,URL,Date,setTimeout,clearTimeout,location:{host:'localhost'},WebSocket:class{constructor(){queueMicrotask(()=>this.onopen?.());}close(){}},Capacitor:{isNativePlatform:()=>false},developmentCloudRealtimeVoiceEnabled:cloudRealtime,browserCloudResidentEnabled:cloudResident,devSurfacesEnabled:true,connectionController:{getSnapshot:()=>snapshot,getBrowserSpeechAgent:()=>agent,voiceRendererClientId:()=>'11111111-1111-4111-8111-111111111111',voiceConversationCurrent:()=>current,async refreshDeveloperVoiceHistory(){history++;},async performVoiceRequestedActions(_binding,messageId){performed.push(messageId);return [{summary:"Note saved"}];}},loadClient:async()=>({createVoiceSessionClient:o=>{options=o;sdk=sdkOptions(o);return {async start(){o.onMinted({sessionId:'owned'});},async stop(){stops++;manualMuted=false;},get microphoneMuted(){return manualMuted;},setMicrophoneMuted(value){manualMuted=value;},needsPlaybackUnlock:false,async unlockPlayback(){}};}})});
 vm.runInContext(source.replace('import.meta.env.DEV','true').replace("import.meta.env.VITE_ALPHA_DEV_CARTESIA",cloudRealtime||cloudResident?"'0'":"'1'")+ ';globalThis.create=developmentCartesiaConversation;',context);
 const controller=await context.create({binding,assertCurrent(){if(!current)throw Error('Changed');},onState(){},onTranscript(){},getUiContext:()=>({viewDelivery:"completed-action",uiViewPath:"/chat"}),onError:e=>errors.push(e)});
 return {controller,calls,errors,performed,changePreference(value){askBefore=value;preferenceWindow.dispatchEvent(new Event("alpha:device-settings"));},setAcceptedState(state){options.onState(state);},get options(){return sdk;},get stops(){return stops;},get history(){return history;},change(){current=false;}};
}
test('canonical completion refreshes history without a second transcript/model dispatch',async()=>{const h=await setup();await h.controller.start();h.options.onServerEvent({t:'stt_final',text:'synthetic',traceId:'owned'});h.options.onServerEvent({t:'reply_complete',traceId:'owned'});await Promise.resolve();assert.equal(h.history,1);assert.ok(h.calls.every(c=>!c.path.includes('/messages')));await h.controller.stop();assert.equal(h.calls.filter(c=>c.path.includes('/revoke')).length,1);await h.controller.stop();assert.equal(h.stops,1);});
test('failed retirement remains failed on repeated Stop',async()=>{const h=await setup({revoked:false});await h.controller.start();await assert.rejects(h.controller.stop(),/not confirmed/);await assert.rejects(h.controller.stop(),/not confirmed/);assert.equal(h.stops,1);});
test('recheck retires the owned server ticket when its conversation changes',async()=>{const h=await setup();await h.controller.start();h.change();h.controller.recheck();for(let i=0;i<4;i++)await Promise.resolve();assert.equal(h.stops,1);assert.equal(h.calls.filter(c=>c.path.includes('/revoke')).length,1);});

test('canonical teardown or rotated tickets already retired are accepted only by exact authenticated status',async()=>{const h=await setup({alreadyRetired:true});await h.controller.start();await h.controller.stop();await h.controller.stop();assert.equal(h.stops,1);});

/** Fake renderer transport/clock; canonical audio client is a single owned fixture, never a microphone. */
async function lifecycleFixture(){
 let now=1_000_000,id=0,rendererId='11111111-1111-4111-8111-111111111111',current=true,swapped=false,holdFetch=false,holdOpen=false,resolveFetch,options,sdk,starts=0,stops=0,clients=0,muted=false;
 const timers=new Map(),calls=[],sockets=[],errors=[],navigation=[];
 const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
 class Clock extends Date {static now(){return now;}}
 const setTimer=(fn,delay)=>{const key=++id;timers.set(key,{fn,at:now+delay});return key;};
 const clearTimer=key=>timers.delete(key);
 class Socket {
  constructor(){sockets.push(this);if(!holdOpen)queueMicrotask(()=>this.open());}
  open(){this.onopen?.();}
  close(){this.closed=true;this.onclose?.();}
  message(frame){this.onmessage?.({data:JSON.stringify(frame)});}
 }
 const ticket=()=>({wsUrl:'ws://localhost/__alpha-local-renderer/ws?sessionId='+id,expiresAt:now+120000});
 const agent={async request(path,body,signal){calls.push({path,body,signal});if(path.includes('/health'))return {ready:true,conversationId:'conversation',agentId:'agent'};
  if(path==='/api/views/voice-channel'){if(holdFetch)return new Promise(resolve=>{resolveFetch=()=>resolve(ticket());});return ticket();}
  if(path.includes('/revoke'))return {revoked:true};return {};}};
 const context=vm.createContext({validateUuid,readDevicePreferences:async()=>({askBeforeAgentActions:true}),window:new EventTarget(),AbortController,DOMException,Response,Error,URL,Date:Clock,setTimeout:setTimer,clearTimeout:clearTimer,location:{host:'localhost'},WebSocket:Socket,Capacitor:{isNativePlatform:()=>false},developmentCloudRealtimeVoiceEnabled:false,browserCloudResidentEnabled:false,devSurfacesEnabled:true,
  connectionController:{getSnapshot:()=>({residentInference:"cloud"}),getBrowserSpeechAgent:()=>swapped?{}:agent,voiceRendererClientId:()=>rendererId,voiceConversationCurrent:()=>current,async refreshDeveloperVoiceHistory(){}},
  loadClient:async()=>({createVoiceSessionClient:o=>{clients++;options=o;sdk=sdkOptions(o);return {async start(){starts++;o.onMinted({sessionId:'owned-1'});},async stop(){stops++;},get microphoneMuted(){return muted;},setMicrophoneMuted(value){muted=value;},needsPlaybackUnlock:false,async unlockPlayback(){}};}})});
 vm.runInContext(source.replace('import.meta.env.DEV','true').replace("import.meta.env.VITE_ALPHA_DEV_CARTESIA","'1'")+';globalThis.create=developmentCartesiaConversation;',context);
 const controller=await context.create({binding,assertCurrent(){if(!current)throw Error('Changed');},onState(){},onTranscript(){},onError:error=>errors.push(error),onNavigate:async event=>navigation.push(event)});
 return {controller,calls,sockets,errors,navigation,timers,get options(){return sdk;},get starts(){return starts;},get stops(){return stops;},get clients(){return clients;},flush,
  async advance(ms){const target=now+ms;for(;;){const next=[...timers].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}now=target;await flush();},
  holdFetch(){holdFetch=true;},releaseFetch(){holdFetch=false;resolveFetch?.();},holdOpen(){holdOpen=true;},changeRenderer(){rendererId='22222222-2222-4222-8222-222222222222';},changeOwner(){swapped=true;},changeConversation(){current=false;}};
}
test('more than two renderer renewals retain one audio client, mute, history and navigation deduplication',async()=>{
 const h=await lifecycleFixture();await h.controller.start();
 assert.equal(h.options.maxReconnects,undefined,'canonical live reconnect default is retained');assert.equal(h.options.preLiveMaxReconnects,0);assert.equal(h.options.preLiveMaxAttempts,1);
 h.controller.setMicrophoneMuted(true);h.options.onServerEvent({t:'stt_final',text:'open notes',traceId:'turn-1'});await h.flush();
 const frame={type:'shell:navigate:view',source:'agent',viewType:'gui',viewId:'notes',completedActionHandoffId:'33333333-3333-4333-8333-333333333333'};
 h.sockets[0].message(frame);h.options.onServerEvent({t:'navigate_view',viewId:'notes',traceId:'turn-1'});await h.flush();
 assert.equal(h.navigation.length,1);
 await h.advance(330000);
 assert.equal(h.sockets.length,4);assert.equal(h.clients,1);assert.equal(h.starts,1);assert.equal(h.stops,0);assert.equal(h.controller.microphoneMuted,true);assert.equal(h.errors.length,0);
 assert.equal(h.calls.filter(c=>c.path==='/api/views/voice-channel').length,4);assert.ok(h.calls.filter(c=>c.path==='/api/views/voice-channel').every(c=>c.body.clientId==='11111111-1111-4111-8111-111111111111'));
 h.sockets[0].message({...frame,completedActionHandoffId:'44444444-4444-4444-8444-444444444444'});h.sockets.at(-1).message(frame);await h.flush();assert.equal(h.navigation.length,1,'old socket and duplicate delivery cannot replay navigation');
 h.options.onServerEvent({t:'interrupted',traceId:'turn-1'});h.sockets.at(-1).message({...frame,completedActionHandoffId:'55555555-5555-4555-8555-555555555555'});await h.flush();assert.equal(h.navigation.length,1);
 h.options.onMinted({sessionId:'owned-2'});await h.controller.stop();await h.controller.stop();assert.equal(h.stops,1);assert.deepEqual(h.calls.filter(c=>c.path.includes('/revoke')).map(c=>c.path),['/api/v1/voice/session/owned-1/revoke','/api/v1/voice/session/owned-2/revoke']);
 const count=h.sockets.length;await h.advance(240000);assert.equal(h.sockets.length,count);assert.equal(h.timers.size,0);
});
test('Stop during renewal ticket fetch fences a late ticket and never restarts renderer or capture',async()=>{
 const h=await lifecycleFixture();await h.controller.start();h.holdFetch();await h.advance(110000);assert.equal(h.calls.filter(c=>c.path==='/api/views/voice-channel').length,2);
 const pending=h.calls.at(-1);await h.controller.stop();assert.equal(pending.signal.aborted,true);h.releaseFetch();await h.flush();await h.advance(240000);
 assert.equal(h.sockets.length,1);assert.equal(h.starts,1);assert.equal(h.stops,1);assert.equal(h.timers.size,0);assert.equal(h.errors.length,0);
});
test('Stop during renewal socket open closes both sockets and fences a late open',async()=>{
 const h=await lifecycleFixture();await h.controller.start();h.holdOpen();await h.advance(110000);assert.equal(h.sockets.length,2);
 await h.controller.stop();h.sockets[1].open();await h.flush();await h.advance(240000);
 assert.ok(h.sockets.every(s=>s.closed));assert.equal(h.stops,1);assert.equal(h.timers.size,0);assert.equal(h.errors.length,0);
});
for(const change of ['changeRenderer','changeOwner','changeConversation'])test(`a ${change} while renewal waits refuses the replacement without replay`,async()=>{
 const h=await lifecycleFixture();await h.controller.start();h.holdFetch();await h.advance(110000);h[change]();h.releaseFetch();await h.flush();
 assert.equal(h.sockets.length,1);assert.equal(h.stops,1);assert.ok(h.sockets[0].closed);assert.equal(h.navigation.length,0);assert.equal(h.timers.size,0);assert.ok(h.errors.length>=1);if(change==='changeOwner')assert.equal(h.calls.filter(c=>c.path.includes('/revoke')).length,0,'Never retire a ticket through a replaced owner');
});
test('a replacement renderer socket opening after its bound renderer changes is retired, not adopted',async()=>{
 const h=await lifecycleFixture();await h.controller.start();h.holdOpen();await h.advance(110000);h.changeRenderer();h.sockets[1].open();await h.flush();
 assert.ok(h.sockets.every(s=>s.closed));assert.equal(h.stops,1);assert.equal(h.navigation.length,0);assert.equal(h.timers.size,0);
});

test('an unexpected active renderer disconnect still retires voice and does not silently reconnect',async()=>{
 const h=await lifecycleFixture();await h.controller.start();h.sockets[0].close();await h.flush();await h.advance(240000);
 assert.equal(h.stops,1);assert.equal(h.sockets.length,1);assert.equal(h.timers.size,0);assert.equal(h.errors.length,1);
});

test('Cloud realtime uses canonical client and renderer only after attested session-start admission',async()=>{const h=await setup({cloudRealtime:true,attestation:{speechRoute:'cloud',speechProvider:'cartesia',providerAdmission:'at-session-start'}});await h.controller.start();assert.equal(h.options.maxReconnects,1,'one renewal for the relay ticket boundary');assert(h.calls.some(c=>c.path==='/api/views/voice-channel'));h.options.onServerEvent({t:'stt_partial',text:'partial'});await h.controller.stop();assert.equal(h.stops,1);assert.equal(h.calls.filter(c=>c.path.includes('/revoke')).length,1);});
test('Cloud realtime refuses legacy, direct or deferred provider attestation',async()=>{for(const attestation of [{},{speechRoute:'direct',speechProvider:'cartesia',providerAdmission:'at-session-start'},{speechRoute:'cloud',speechProvider:'other',providerAdmission:'at-session-start'},{speechRoute:'cloud',speechProvider:'cartesia',providerAdmission:'deferred'}])await assert.rejects(setup({cloudRealtime:true,attestation}),/not attested/);});
const cloudRelay={speechRoute:'cloud',speechProvider:'cartesia',providerAdmission:'at-session-start'};
test('Cloud resident conversation is the canonical realtime client on the attested Cloud relay, with one renewal for the ticket boundary',async()=>{const h=await setup({cloudResident:true,attestation:cloudRelay});await h.controller.start();assert.equal(h.options.maxReconnects,1,'one renewal, refilled after 30 s live, for the 60 s relay ticket');assert.equal(h.options.preLiveMaxReconnects,0);assert(h.calls.some(c=>c.path==='/api/v1/voice/session/health?conversationId=conversation'));assert(h.calls.some(c=>c.path==='/api/views/voice-channel'));assert(!h.calls.some(c=>/\/api\/(asr|tts)\/cloud/.test(c.path)),'no batch speech request');await h.controller.stop();assert.equal(h.stops,1);assert.equal(h.calls.filter(c=>c.path.includes('/revoke')).length,1);});
test('Cloud resident refuses a direct, legacy or deferred speech attestation',async()=>{for(const attestation of [{},{...cloudRelay,speechRoute:'direct'},{...cloudRelay,speechProvider:'other'},{...cloudRelay,providerAdmission:'deferred'}])await assert.rejects(setup({cloudResident:true,attestation}),/not attested/);});
test('Cloud resident own keys keep the direct route and reconnect policy unchanged',async()=>{const snapshot={residentInference:'direct',providerStatus:{voiceConfigured:true}};const h=await setup({cloudResident:true,snapshot,attestation:{...cloudRelay,speechRoute:'direct'}});await h.controller.start();assert.equal(h.options.maxReconnects,undefined);await h.controller.stop();await assert.rejects(setup({cloudResident:true,snapshot,attestation:cloudRelay}),/Direct realtime speech route changed/);});
test('a Cloud relay refusal stops the client at once as one coded terminal error; the ticket expiry, retryable and direct errors do not',async()=>{
 for(const code of ['authorization','transport','insufficient_credits','quota_exhausted']){const h=await setup({cloudResident:true,attestation:cloudRelay});await h.controller.start();h.options.onServerEvent({t:'stt_final',text:'check notes',traceId:'turn'});
  h.options.onServerEvent({t:'error',code,retryable:false});assert.equal(h.stops,1,'stopped before the SDK could re-mint');assert.equal(h.controller.microphoneAutomaticallyMuted,false);
  h.options.onError(Error('voice session lost: server_error'));assert.equal(h.errors.length,1);assert.equal(h.errors[0].code,'voice-relay-'+code);assert.doesNotMatch(h.errors[0].message,/Add credits/);
  await h.controller.stop();assert.equal(h.stops,1);assert.equal(h.calls.filter(c=>c.path.includes('/revoke')).length,1);}
 {const h=await setup({cloudResident:true,attestation:cloudRelay});await h.controller.start();h.options.onServerEvent({t:'stt_final',text:'check notes',traceId:'turn'});h.options.onServerEvent({t:'error',code:'expired',retryable:false});assert.equal(h.stops,0,'the planned ticket expiry is renewed by the SDK');assert.equal(h.errors.length,0);assert.equal(h.controller.microphoneAutomaticallyMuted,false,'the interrupted turn releases its hold');await h.controller.stop();}
 {const h=await setup({cloudResident:true,attestation:cloudRelay});await h.controller.start();const failure=Error('Microphone stopped');h.options.onServerEvent({t:'error',code:'transport',retryable:true});h.options.onError(failure);assert.equal(h.errors[0],failure,'a retryable frame is not a refusal');await h.controller.stop();}
 {const h=await setup();await h.controller.start();const failure=Error('voice session lost: server_error');h.options.onServerEvent({t:'error',code:'authorization',retryable:false});h.options.onError(failure);assert.equal(h.errors[0],failure,'direct speech errors are unchanged');await h.controller.stop();}
});

const settleActions=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
test('voice emits direct-request mode only while the current preference allows it',async()=>{const h=await setup({askBefore:false});await h.controller.start();assert.equal(h.options.getUiContext().agentActionMode,'direct-request-v1');h.changePreference(true);assert.equal(h.options.getUiContext().agentActionMode,undefined);await settleActions();assert.equal(h.options.getUiContext().agentActionMode,undefined);await h.controller.stop();});
test('only the matching completed voice message can execute requested actions once',async(t)=>{const h=await setup({askBefore:false});t.after(()=>h.controller.stop());await h.controller.start();const userMessageId='1f6f565c-00c4-0952-bfa6-a8af23e74913';h.options.onServerEvent({t:'stt_final',text:'Save a note',traceId:'turn'});h.options.onServerEvent({t:'reply_complete',traceId:'foreign',userMessageId});h.options.onServerEvent({t:'reply_complete',traceId:'turn'});await settleActions();assert.equal(h.performed.length,0);h.options.onServerEvent({t:'reply_complete',traceId:'turn',userMessageId});h.options.onServerEvent({t:'reply_complete',traceId:'turn',userMessageId});await settleActions();assert.deepEqual(h.performed,[userMessageId]);await h.controller.stop();});
test('ask-first preference and stopped sessions cannot execute a completed voice action',async()=>{const h=await setup();await h.controller.start();h.options.onServerEvent({t:'stt_final',text:'Save a note',traceId:'turn'});h.options.onServerEvent({t:'reply_complete',traceId:'turn',userMessageId:'11111111-2222-4333-8444-555555555555'});await settleActions();await h.controller.stop();h.options.onServerEvent({t:'reply_complete',traceId:'turn',userMessageId:'11111111-2222-4333-8444-555555555555'});await settleActions();assert.equal(h.performed.length,0);});


test('automatic microphone pause starts only for accepted nonempty final and lasts through early speaking_end',async()=>{
 const h=await setup();try{await h.controller.start();assert.equal(h.controller.microphoneAutomaticallyMuted,false);
 h.options.onServerEvent({t:'stt_partial',text:'partial',traceId:'turn'});assert.equal(h.controller.microphoneAutomaticallyMuted,false);
 h.options.onServerEvent({t:'stt_final',text:'check notes',traceId:'turn'});assert.equal(h.controller.microphoneAutomaticallyMuted,true);assert.equal(h.controller.microphoneMuted,false);
 h.options.onServerEvent({t:'speaking_start',traceId:'turn'});h.options.onServerEvent({t:'speaking_end',traceId:'turn'});assert.equal(h.controller.microphoneAutomaticallyMuted,true);
 h.options.onServerEvent({t:'usage',traceId:'old',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,true);
 h.options.onServerEvent({t:'usage',traceId:'turn',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,true);h.options.drainPlayback('turn');assert.equal(h.controller.microphoneAutomaticallyMuted,false);
 }finally{await h.controller.stop();}
});
test('Cloud resident keeps the same automatic busy hold through relay playback drain',async()=>{
 const h=await setup({cloudResident:true,attestation:cloudRelay});try{await h.controller.start();
 h.options.onServerEvent({t:'stt_final',text:'check notes',traceId:'turn'});assert.equal(h.controller.microphoneAutomaticallyMuted,true);
 h.options.onServerEvent({t:'speaking_start',traceId:'turn'});h.options.onServerEvent({t:'speaking_end',traceId:'turn'});h.options.onServerEvent({t:'usage',traceId:'turn',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,true,'held until local playback drains');
 h.options.drainPlayback('turn');assert.equal(h.controller.microphoneAutomaticallyMuted,false);assert.equal(h.controller.microphoneMuted,false);
 }finally{await h.controller.stop();}
});
test('matching usage does not unpause playback that has not ended',async()=>{
 const h=await setup();try{await h.controller.start();h.options.onServerEvent({t:'stt_final',text:'check notes',traceId:'turn'});h.options.onServerEvent({t:'speaking_start',traceId:'turn'});
 h.options.onServerEvent({t:'usage',traceId:'turn',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,true);
 h.options.onServerEvent({t:'speaking_end',traceId:'turn'});assert.equal(h.controller.microphoneAutomaticallyMuted,true);h.options.drainPlayback('turn');assert.equal(h.controller.microphoneAutomaticallyMuted,false);
 }finally{await h.controller.stop();}
});
test('old usage and old interruption cannot clear a newer accepted turn',async()=>{
 const h=await setup();try{await h.controller.start();h.options.onServerEvent({t:'stt_final',text:'first',traceId:'first'});h.options.onServerEvent({t:'stt_final',text:'second',traceId:'second'});
 h.options.onServerEvent({t:'usage',traceId:'first',sttMs:0,ttsChars:0});h.options.onServerEvent({t:'interrupted',traceId:'first',reason:'explicit'});assert.equal(h.controller.microphoneAutomaticallyMuted,true);
 h.options.onServerEvent({t:'usage',traceId:'second',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,false);
 }finally{await h.controller.stop();}
});
for(const terminal of ['usage','error','interrupted'])test('silent turn releases automatic pause on matching '+terminal,async()=>{
 const h=await setup();try{await h.controller.start();h.options.onServerEvent({t:'stt_final',text:'silent request',traceId:'turn'});assert.equal(h.controller.microphoneAutomaticallyMuted,true);
 h.options.onServerEvent(terminal==='error'?{t:'error',traceId:'turn',code:'unavailable',retryable:false}:terminal==='interrupted'?{t:'interrupted',traceId:'turn',reason:'explicit'}:{t:'usage',traceId:'turn',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,false);
 }finally{await h.controller.stop();}
});
test('manual mute remains independent and Stop clears automatic pause despite late events',async()=>{
 const h=await setup();await h.controller.start();h.controller.setMicrophoneMuted(true);h.options.onServerEvent({t:'stt_final',text:'check notes',traceId:'turn'});assert.equal(h.controller.microphoneMuted,true);
 await h.controller.stop();assert.equal(h.controller.microphoneAutomaticallyMuted,false);assert.equal(h.controller.microphoneMuted,false,'SDK Stop resets manual mute');
 h.options.onServerEvent({t:'stt_final',text:'late',traceId:'late'});assert.equal(h.controller.microphoneAutomaticallyMuted,false);
});
test('empty final never invents processing and session transport error clears busy state',async()=>{
 const h=await setup();try{await h.controller.start();h.options.onServerEvent({t:'stt_final',text:' ',traceId:'empty'});assert.equal(h.controller.microphoneAutomaticallyMuted,false);
 h.options.onServerEvent({t:'stt_final',text:'check notes',traceId:'turn'});h.options.onError(Error('transport closed'));assert.equal(h.controller.microphoneAutomaticallyMuted,false);
 }finally{await h.controller.stop();}
});

test('local playback drain before usage keeps processing paused until its receipt',async()=>{
 const h=await setup();try{await h.controller.start();h.options.onServerEvent({t:'stt_final',text:'check',traceId:'turn'});h.options.onServerEvent({t:'speaking_start',traceId:'turn'});h.options.onServerEvent({t:'speaking_end',traceId:'turn'});h.options.drainPlayback('turn');assert.equal(h.controller.microphoneAutomaticallyMuted,true);h.options.onServerEvent({t:'usage',traceId:'turn',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,false);}finally{await h.controller.stop();}
});
test('opening greeting stays paused until local playback drains without a user turn',async()=>{
 const h=await setup();try{await h.controller.start();h.options.onServerEvent({t:'speaking_start',traceId:'greeting'});assert.equal(h.controller.microphoneAutomaticallyMuted,true);h.options.onServerEvent({t:'speaking_end',traceId:'greeting'});h.options.onServerEvent({t:'usage',traceId:'greeting',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,true);h.options.drainPlayback('greeting');assert.equal(h.controller.microphoneAutomaticallyMuted,false);}finally{await h.controller.stop();}
});
test('old greeting events and drain cannot clear a newer accepted request',async()=>{
 const h=await setup();try{await h.controller.start();h.options.onServerEvent({t:'speaking_start',traceId:'greeting'});h.options.onServerEvent({t:'speaking_end',traceId:'greeting'});h.options.drainPlayback('greeting');h.options.onServerEvent({t:'stt_final',text:'new request',traceId:'new'});
 h.options.onServerEvent({t:'speaking_start',traceId:'greeting'});h.options.onServerEvent({t:'speaking_end',traceId:'greeting'});h.options.onServerEvent({t:'usage',traceId:'greeting',sttMs:0,ttsChars:0});h.options.drainPlayback('greeting');assert.equal(h.controller.microphoneAutomaticallyMuted,true);
 h.options.onServerEvent({t:'usage',traceId:'new',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,false);}finally{await h.controller.stop();}
});

test('fresh server fallback playback after a completed request is paused until local drain',async()=>{
 const h=await setup();try{await h.controller.start();h.options.onServerEvent({t:'stt_final',text:'request',traceId:'request'});h.options.onServerEvent({t:'usage',traceId:'request',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,false);
 h.options.onServerEvent({t:'speaking_start',traceId:'fallback'});assert.equal(h.controller.microphoneAutomaticallyMuted,true);h.options.onServerEvent({t:'speaking_end',traceId:'fallback'});assert.equal(h.controller.microphoneAutomaticallyMuted,true);h.options.drainPlayback('fallback');assert.equal(h.controller.microphoneAutomaticallyMuted,false);
 h.options.onServerEvent({t:'speaking_start',traceId:'fallback'});assert.equal(h.controller.microphoneAutomaticallyMuted,false,'retired fallback cannot restart');
 }finally{await h.controller.stop();}
});

for(const code of ['stt_reconnecting','transport_error'])test('retryable unscoped '+code+' preserves busy processing until matching usage',async()=>{
 const h=await setup();try{await h.controller.start();h.options.onServerEvent({t:'stt_final',text:'active request',traceId:'active'});assert.equal(h.controller.microphoneAutomaticallyMuted,true);
 h.options.onServerEvent({t:'error',code,retryable:true});assert.equal(h.controller.microphoneAutomaticallyMuted,true);
 h.options.onServerEvent({t:'usage',traceId:'other',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,true);
 h.options.onServerEvent({t:'usage',traceId:'active',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,false);
 }finally{await h.controller.stop();}
});

test('accepted session reset retires busy traces and old frames cannot revive the projection',async()=>{
 const h=await setup();try{await h.controller.start();h.controller.setMicrophoneMuted(true);
 h.options.onServerEvent({t:'stt_final',text:'old request',traceId:'old'});h.options.onServerEvent({t:'speaking_start',traceId:'old'});assert.equal(h.controller.microphoneAutomaticallyMuted,true);
 h.setAcceptedState({phase:'connecting',traceId:null,finalTranscript:''});assert.equal(h.controller.microphoneAutomaticallyMuted,false);assert.equal(h.controller.microphoneMuted,true);
 h.setAcceptedState({phase:'ready',traceId:null,finalTranscript:''});h.setAcceptedState({phase:'listening',traceId:null,finalTranscript:''});
 h.options.onServerEvent({t:'stt_final',text:'late old request',traceId:'old'});h.options.onServerEvent({t:'speaking_start',traceId:'old'});h.options.onServerEvent({t:'speaking_end',traceId:'old'});h.options.onServerEvent({t:'usage',traceId:'old',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,false);
 h.options.onServerEvent({t:'stt_final',text:'fresh request',traceId:'new'});assert.equal(h.controller.microphoneAutomaticallyMuted,true);h.options.onServerEvent({t:'usage',traceId:'new',sttMs:0,ttsChars:0});assert.equal(h.controller.microphoneAutomaticallyMuted,false);
 }finally{await h.controller.stop();}
});

/** The pinned SDK client (bundled from the prepared client features) on the Cloud relay route: only
 * the agent, sockets, microphone graph and clocks are synthetic. The agent self-severs a session at
 * its 60 s ticket with {t:'error',code:'expired'} and a close (host voice/session.ts teardown("expired")). */
let pinnedClient;
function loadPinnedClient(){
 if(pinnedClient)return pinnedClient;
 const root=resolve('.eliza/client-features'),entry=resolve(root,'packages/ui/src/voice/voice-session-client-core.ts');
 const bundle=buildSync({entryPoints:[entry],bundle:true,write:false,platform:'browser',format:'cjs',target:'es2022',define:{'import.meta.url':JSON.stringify(pathToFileURL(entry).href)},alias:{'@elizaos/host/voice/ui-context':resolve(root,'packages/host/src/voice/ui-context.ts'),'@elizaos/core/view-interaction':resolve(root,'packages/core/src/view-interaction.ts'),'@elizaos/core/logging':resolve(root,'packages/core/src/logging.ts'),'@elizaos/voice/turn':resolve(root,'packages/voice/src/turn.ts'),'@elizaos/core/speech':resolve(root,'packages/core/src/speech.ts')}}).outputFiles[0].text;
 const module={exports:{}};new Function('module','exports',bundle)(module,module.exports);
 return pinnedClient=module.exports.createVoiceSessionClient;
}
async function relayFixture(){
 let now=0,mints=0,refuse,timerId=0;const sockets=[],errors=[],marks=[],calls=[],phases=[],timers=new Map();const epoch=()=>1_800_000_000_000+now;
 // One fake clock for the SDK (global timers) and this adapter (its realm), restored by release().
 const realTimers={setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
 const setTimer=(fn,delay=0,...args)=>{const id=++timerId;timers.set(id,{run:()=>fn(...args),at:now+Math.max(0,Number(delay)||0)});return id;},clearTimer=id=>{timers.delete(id);};
 globalThis.setTimeout=setTimer;globalThis.clearTimeout=clearTimer;
 // Whole event-loop turns (setImmediate is not mocked) drain every pending promise chain.
 const flush=async()=>{for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));};
 class Socket{
  readyState=0;binaryType='arraybuffer';listeners=new Map();
  constructor(){sockets.push(this);queueMicrotask(()=>{this.readyState=1;this.emit('open',{});});}
  addEventListener(type,listener){this.listeners.set(type,[...(this.listeners.get(type)||[]),listener]);}
  removeEventListener(type,listener){this.listeners.set(type,(this.listeners.get(type)||[]).filter(value=>value!==listener));}
  emit(type,event){for(const listener of this.listeners.get(type)||[])listener(event);}
  frame(value){this.emit('message',{data:JSON.stringify(value)});}
  send(data){if(typeof data!=='string'||JSON.parse(data).t!=='hello')return;const id=mints;queueMicrotask(()=>{if(refuse){this.frame({t:'error',code:refuse,retryable:false});this.close();}else this.frame({t:'ready',sessionId:'session-'+id,traceId:'ready-'+id,playbackCompletion:false,uiContext:false});});}
  close(){if(this.readyState!==3){this.readyState=3;this.emit('close',{});}}
 }
 const microphone=()=>{const track={enabled:true,readyState:'live',getSettings:()=>({}),addEventListener(){},removeEventListener(){},stop(){this.readyState='ended';}};return {getTracks:()=>[track],getAudioTracks:()=>[track]};};
 const graph=()=>{const node={connect(){return this;},disconnect(){}};return {sampleRate:16000,state:'running',destination:node,createMediaStreamSource:()=>node,createScriptProcessor:()=>({...node,onaudioprocess:null}),async resume(){},async suspend(){},async close(){this.state='closed';},addEventListener(){},removeEventListener(){}};};
 const agent={async request(path){calls.push(path);
  if(path.includes('/health'))return {ready:true,conversationId:'conversation',agentId:'agent',...cloudRelay};
  if(path==='/api/v1/voice/session/consent')return {consentNonce:'consent-'+calls.length};
  if(path==='/api/v1/voice/session'){mints++;return {sessionId:'session-'+mints,token:'one-use-'+mints,wsUrl:'ws://localhost/voice-'+mints,expiresAt:epoch()+60000,uplink:{codecs:['pcm16']},downlink:{codecs:['pcm16']}};}
  if(path==='/api/views/voice-channel')return {wsUrl:'ws://localhost/__alpha-local-renderer/ws?sessionId=relay',expiresAt:Date.now()+120000};
  if(path.includes('/revoke'))return {revoked:true};return {};}};
 const context=vm.createContext({validateUuid,readDevicePreferences:async()=>({askBeforeAgentActions:true}),window:new EventTarget(),AbortController,DOMException,Response,Error,URL,Date,setTimeout:setTimer,clearTimeout:clearTimer,location:{host:'localhost'},WebSocket:class{constructor(){queueMicrotask(()=>this.onopen?.());}close(){}},Capacitor:{isNativePlatform:()=>false},developmentCloudRealtimeVoiceEnabled:false,browserCloudResidentEnabled:true,devSurfacesEnabled:true,
  connectionController:{getSnapshot:()=>({residentInference:'cloud'}),getBrowserSpeechAgent:()=>agent,voiceRendererClientId:()=>'11111111-1111-4111-8111-111111111111',voiceConversationCurrent:()=>true,async refreshDeveloperVoiceHistory(){}},
  loadClient:async()=>({createVoiceSessionClient:options=>loadPinnedClient()({...options,webSocketFactory:()=>new Socket(),getUserMedia:async()=>microphone(),createMicAudioContext:graph,createPlaybackAudioContext:graph,now:()=>now,epochNow:epoch,onTraceMark:mark=>marks.push(mark.name)})})});
 vm.runInContext(source.replace('import.meta.env.DEV','true').replace("import.meta.env.VITE_ALPHA_DEV_CARTESIA","'0'")+';globalThis.create=developmentCartesiaConversation;',context);
 const controller=await context.create({binding,assertCurrent(){},onState:phase=>phases.push(phase),onTranscript(){},onError:error=>errors.push(error)});
 return {controller,sockets,errors,marks,calls,phases,flush,get mints(){return mints;},refuse(code){refuse=code;},
  release(){globalThis.setTimeout=realTimers.setTimeout;globalThis.clearTimeout=realTimers.clearTimeout;},
  async advance(ms){const target=now+ms;for(;;){const next=[...timers].filter(([,timer])=>timer.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].run();await flush();}now=target;await flush();}};
}
test('Cloud: a turn still busy when its 60 s relay ticket expires continues on a renewed session without user action',async()=>{
 const h=await relayFixture();
 try{
  await h.controller.start();await h.flush();assert.equal(h.phases.at(-1),'listening');
  const old=h.sockets[0];old.frame({t:'stt_final',text:'tell me about my week',traceId:'turn-1'});old.frame({t:'speaking_start',traceId:'turn-1'});
  assert.equal(h.controller.microphoneAutomaticallyMuted,true,'the turn holds the microphone');
  await h.advance(60000);assert.ok(h.marks.includes('token_rotation_deferred'),'the busy turn deferred idle rotation past the deadline');assert.equal(h.mints,1);
  old.frame({t:'error',code:'expired',retryable:false});old.close();await h.flush();await h.advance(3000);
  assert.deepEqual(h.errors.map(error=>error.message),[],'a ticket boundary is not an error');
  assert.equal(h.mints,2,'one renewed relay session');assert.equal(h.sockets.length,2);assert.equal(h.phases.at(-1),'listening');
  assert.equal(h.controller.microphoneAutomaticallyMuted,false,'the interrupted turn released its hold');assert.equal(h.calls.filter(path=>path.includes('/revoke')).length,0,'voice was not stopped');
  // The next ticket boundary, busy again, renews again: the budget refilled after 30 s live.
  h.sockets[1].frame({t:'stt_final',text:'and next week',traceId:'turn-2'});await h.advance(60000);
  h.sockets[1].frame({t:'error',code:'expired',retryable:false});h.sockets[1].close();await h.flush();await h.advance(3000);
  assert.equal(h.errors.length,0);assert.equal(h.mints,3);assert.equal(h.phases.at(-1),'listening');
 }finally{h.release();await h.controller.stop();}
});
test('Cloud: an idle session still rotates before its ticket without an error',async()=>{
 const h=await relayFixture();
 try{
  await h.controller.start();await h.flush();assert.equal(h.phases.at(-1),'listening');await h.advance(51000);
  assert.ok(h.marks.includes('token_rotation'));assert.equal(h.mints,2);assert.equal(h.errors.length,0);assert.equal(h.phases.at(-1),'listening');
 }finally{h.release();await h.controller.stop();}
});
for(const code of ['authorization','insufficient_credits'])test(`Cloud: a relay refusal (${code}) on a renewed session ends voice and never re-mints`,async()=>{
 const h=await relayFixture();
 try{
  await h.controller.start();await h.flush();assert.equal(h.phases.at(-1),'listening');h.refuse(code);await h.advance(51000);
  assert.equal(h.mints,2,'the idle rotation');assert.equal(h.errors.length,1);assert.equal(h.errors[0].code,'voice-relay-'+code);assert.doesNotMatch(h.errors[0].message,/Add credits/);
  await h.advance(130000);assert.equal(h.mints,2,'no paid re-mint after a refusal');assert.equal(h.errors.length,1);
  await h.controller.stop();assert.deepEqual(h.calls.filter(path=>path.includes('/revoke')),['/api/v1/voice/session/session-1/revoke','/api/v1/voice/session/session-2/revoke']);
 }finally{h.release();await h.controller.stop();}
});
