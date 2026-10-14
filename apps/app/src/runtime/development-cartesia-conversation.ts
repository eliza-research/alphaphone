import {Capacitor} from '@capacitor/core';
import {devSurfacesEnabled} from '../build-flags';
import {connectionController} from './connection-ui';
import type {VoiceConversationBinding} from './alpha-client';
export const developmentCartesiaVoiceEnabled=import.meta.env.DEV===true&&devSurfacesEnabled&&!Capacitor.isNativePlatform()&&import.meta.env.VITE_ALPHA_DEV_CARTESIA==='1';
/** Canonical self-hosted voice owns the runtime turn; this adapter never sends its transcript twice. */
export async function developmentCartesiaConversation(input:{binding:VoiceConversationBinding;assertCurrent:()=>void;onState:(phase:string)=>void;onTranscript:(text:string)=>void;onError:(error:Error)=>void;onPlaybackUnlockChange?:()=>void}){
 if(!developmentCartesiaVoiceEnabled)throw Error('Direct developer speech is disabled.');
 const agent=connectionController.getBrowserSpeechAgent();if(!agent)throw Error('Connect the local developer agent first.');
 const lifecycle=new AbortController(),minted=new Set<string>();let stopped=false,stopPromise:Promise<void>|undefined;
 const current=()=>{lifecycle.signal.throwIfAborted();input.assertCurrent();if(agent!==connectionController.getBrowserSpeechAgent()||!connectionController.voiceConversationCurrent(input.binding))throw new DOMException('Developer voice connection changed','AbortError');};
 const request=async(path:string,body?:unknown,signal:AbortSignal=lifecycle.signal)=>{current();const result=await agent.request(path,body,signal);current();return result;};
 const health=await request('/api/v1/voice/session/health?conversationId='+encodeURIComponent(input.binding.conversationId));if(health.ready!==true||health.conversationId!==input.binding.conversationId||health.agentId!==input.binding.session.agentId)throw Error('The selected developer speech service is unavailable.');
 const {createVoiceSessionClient}=await import('@elizaos/ui/voice/voice-session-client');current();
 const client=createVoiceSessionClient({agentId:input.binding.session.agentId,conversationId:input.binding.conversationId,maxReconnects:0,preLiveMaxAttempts:1,
  getConsentNonce:async()=>{const result=await request('/api/v1/voice/session/consent',{});return typeof result.consentNonce==='string'?result.consentNonce:null;},
  fetch:async(path,init={})=>{if(path!=='/api/v1/voice/session'||init.method!=='POST'||typeof init.body!=='string')throw Error('Unsupported developer voice request');const body=JSON.parse(init.body);if(body.agentId!==input.binding.session.agentId||body.conversationId!==input.binding.conversationId||body.transport!=='websocket')throw Error('Developer voice binding changed');return Response.json(await request(path,body,init.signal??lifecycle.signal));},
  onMinted:result=>{minted.add(result.sessionId);try{current();}catch{void stop().catch(error=>input.onError(error instanceof Error?error:Error('Developer voice retirement was not confirmed.')));}},
  onState:state=>{if(!stopped){current();input.onState(state.phase);}},
  onServerEvent:event=>{if(stopped)return;current();if(event.t==='stt_partial'||event.t==='stt_final')input.onTranscript(event.text);if(event.t==='reply_complete')void connectionController.refreshDeveloperVoiceHistory(input.binding,lifecycle.signal).catch(error=>{if(!stopped)input.onError(error instanceof Error?error:Error('Voice history could not be verified.'));});},
  onPlaybackUnlockChange:()=>{if(!stopped)input.onPlaybackUnlockChange?.();},
  onError:error=>{if(!stopped)input.onError(error);},
 });
 const stop=()=>{if(stopPromise)return stopPromise;stopped=true;lifecycle.abort();stopPromise=(async()=>{await client.stop();for(const id of minted){if(agent!==connectionController.getBrowserSpeechAgent())throw Error('Developer voice retirement could not be confirmed after connection change.');try{const result=await agent.request(`/api/v1/voice/session/${id}/revoke`,{},new AbortController().signal);if(result.revoked!==true)throw Error('Developer voice retirement was not confirmed.');}catch(error){const failure=error as {status?:number;data?:{code?:string}};if(failure.status!==404||failure.data?.code!=='voice_session_not_found')throw error;}}})();return stopPromise;};
 return {start:async()=>{current();await client.start();current();},recheck:()=>{try{current();}catch{void stop().catch(error=>input.onError(error instanceof Error?error:Error('Developer voice retirement was not confirmed.')));}},resume:()=>false,
  get microphoneMuted(){return client.microphoneMuted;},setMicrophoneMuted:(muted:boolean)=>{current();client.setMicrophoneMuted(muted);},
  get needsPlaybackUnlock(){return client.needsPlaybackUnlock;},unlockPlayback:async()=>{current();await client.unlockPlayback();current();},
  stop,
 };
}
