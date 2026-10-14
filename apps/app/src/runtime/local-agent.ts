import {automationsRouteAllowed, isAutomationsPath, type AutomationsMethod} from './automations-route-policy.ts';
import { registerPlugin } from '../platform-plugins';
import { Capacitor } from '@capacitor/core';
import type { VerifiedSession, ChatChannel } from './alpha-client';
import { conversationRoomId, messagePageQuery, turnAbortOutcome, turnAbortPath, type MessagePage, type RemoteChatReply, type RemoteConversation, type TurnAbortOutcome } from './remote-protocol';
import { readLocalAgentStream } from './local-agent-stream';
import { streamNativeAgent, type NativeStreamPort } from './local-agent-native-stream';

export interface LocalAgentBridge {
  start(input?:{requestId:string}): Promise<unknown>;
  cancelStart?(input:{requestId:string}):Promise<unknown>;
  stop?():Promise<unknown>;
  getStatus?():Promise<{packaged?:boolean;state?:string;serviceActive?:boolean;socketListening?:boolean}>;
  configureProvider?(input:{apiKey:string;model:string}):Promise<unknown>;
  providerStatus?():Promise<{provider?:unknown;configured?:unknown;model?:unknown}>;
  clearProvider?():Promise<{configured?:unknown}>;
  launchSurface?():Promise<{assistant?:unknown}>;
  /** Read-only native query; see residentAttachable. */
  residentAttachment?(input:{credentialId?:string}):Promise<{attachable?:unknown;reason?:unknown}>;
  configureCloudProvider?(input:{credentialId:string;model:string}):Promise<unknown>;
  request(input: { path: string; audioBase64?:string;requestId?:string;ownerId?:string; method: AutomationsMethod; headers: Record<string,string>; body?: string; timeoutMs: number }, signal?:AbortSignal): Promise<{status:number;body?:string}>;
  stream?(input:{path:string;ownerId:string;headers:Record<string,string>;body:string},signal:AbortSignal,onText:(text:string)=>void,onReplyReady?:(results:readonly unknown[]|undefined)=>void):Promise<RemoteChatReply>;
}
const native = registerPlugin<LocalAgentBridge & NativeStreamPort>('Agent');
// Capacitor proxies synthesize functions for unknown methods. Do not use that
// proxy to feature-detect streaming before the native IPC adapter implements it.
const nativeBridge:LocalAgentBridge={start:()=>native.start(),request:input=>native.request(input),stream:(input,signal,onText,onReplyReady)=>streamNativeAgent(native,input,signal,onText,onReplyReady)};
// The host bridge at /__alpha-local-agent exists only on the development server
// with ELIZA_DEV_ALLOW_TEST_MOCKS=1 (devSurfacesEnabled in build-flags.ts). This
// module is also imported by Node contract tests, where import.meta.env is absent.
const developmentBridgeAllowed: boolean = import.meta.env !== undefined && import.meta.env.DEV === true && import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS === '1';
export const browserLocalAgentEnabled: boolean = developmentBridgeAllowed && import.meta.env.VITE_LOCAL_AGENT === '1';
export const localAgentAvailable = () => Capacitor.isNativePlatform()
  ? Capacitor.isPluginAvailable('Agent') : browserLocalAgentEnabled;
/** Packaging availability only; it does not prove startup or inference readiness. */
export async function localAgentPackaged():Promise<boolean> {
  if(!localAgentAvailable())return false;
  if(!Capacitor.isNativePlatform())return browserLocalAgentEnabled;
  try{return (await native.getStatus?.())?.packaged===true;}catch{return false;}
}
const unavailableBridge: LocalAgentBridge = {
  async start() { throw new Error('On-device agent is unavailable here. Connect to an agent or use Eliza Cloud.'); },
  async request() { throw new Error('On-device agent is unavailable here. Connect to an agent or use Eliza Cloud.'); },
};
const browserBridge: LocalAgentBridge | null = developmentBridgeAllowed ? {
  async start() { return { state: 'host-managed' }; },
  async stream(input,signal,onText,onReplyReady){
    const bounded=AbortSignal.any([signal,AbortSignal.timeout(120000)]);
    const response=await fetch('/__alpha-local-agent',{method:'POST',headers:{'Content-Type':'application/json','X-Alpha-Local-Agent':'1'},
      body:JSON.stringify({...input,method:'POST',stream:true}),signal:bounded,redirect:'error'});
    return readLocalAgentStream(response,bounded,onText,onReplyReady);
  },
  async request(input, signal) {
    const response = await fetch('/__alpha-local-agent', {
      method:'POST', headers:{'Content-Type':'application/json','X-Alpha-Local-Agent':'1'},
      body:JSON.stringify(input), signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(input.timeoutMs)]) : AbortSignal.timeout(input.timeoutMs), redirect:'error',
    });
    if (!response.ok) throw new Error('Local agent development bridge unavailable. Check the development server.');
    return response.json();
  },
} : null;
function record(value:unknown):Record<string,any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid local agent response.');
  return value as Record<string,any>;
}
// Set when this surface attached to the running resident but the attach did not yield a verified
// owner session. The surface then stops asking to attach: its next resident admission takes the
// ordinary stop → bind → start path, so a listening but unusable runtime is still restarted by a
// retry. Cleared by the next verified connection.
let attachDistrusted=false;
function identifier(value:unknown):string {
  if (typeof value !== 'string' || !value || value.length>512) throw new Error('Invalid local agent identity.');
  return value;
}

/** Same app-host conversation API on both platforms. The native service or
 * development server injects credentials; no bearer token reaches the renderer. */
export class LocalAgentProtocol {
  readonly origin = Capacitor.isNativePlatform() ? 'https://device.alpha.invalid' : 'https://development.alpha.invalid';
  session: VerifiedSession | null = null;
  private generation = 0;
  private streams = new Set<AbortController>();
  deviceHeaders:Record<string,string>={};
  constructor(private bridge:LocalAgentBridge = Capacitor.isNativePlatform() ? nativeBridge : browserBridge ?? unavailableBridge) {}
  async request(path:string, body:unknown|undefined, signal:AbortSignal, headers:Record<string,string> = {}, method:AutomationsMethod = body===undefined?'GET':'POST'):Promise<any> {
    signal.throwIfAborted();
    if (isAutomationsPath(path) ? !automationsRouteAllowed(path,method) || !this.session : !['GET','POST'].includes(method)) throw Error('Invalid local automation request');
    if ((method==='GET'||method==='DELETE') && body!==undefined) throw Error('Invalid local request body');
    const generation=this.generation;
    let cancel:()=>void=()=>{};
    const cancelled=new Promise<never>((_,reject)=>{cancel=()=>reject(signal.reason||new DOMException('Cancelled','AbortError'));});
    signal.addEventListener('abort',cancel,{once:true});
    let response:{status:number;body?:string};
    try { response=await Promise.race([this.bridge.request({path,...(this.session?{ownerId:this.session.ownerId}:{}),method,headers:{Accept:'application/json',...this.deviceHeaders,...headers},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),timeoutMs:120000},signal),cancelled]); } finally { signal.removeEventListener('abort',cancel); }
    signal.throwIfAborted();
    if(generation!==this.generation)throw new Error('Local agent connection changed.');
    if(response.status<200||response.status>=300)throw Object.assign(new Error(`Local agent request failed (HTTP ${response.status}).`),{status:response.status,data:(()=>{try{return JSON.parse(response.body||'{}');}catch{return {};}})()});
    return JSON.parse(response.body || '{}');
  }
  async connect(signal:AbortSignal) {
    signal.throwIfAborted();
    const generation=this.generation,requestId=crypto.randomUUID();
    let cancel:()=>void=()=>{};
    let dispatched=false,cancellationSent=false,attached=false;
    const cancelOwned=()=>{if(dispatched&&!cancellationSent){cancellationSent=true;void this.bridge.cancelStart?.({requestId}).catch(()=>{});}};
    const cancelled=new Promise<never>((_,reject)=>{cancel=()=>{cancelOwned();reject(signal.reason||new DOMException('Cancelled','AbortError'));};});
    signal.addEventListener('abort',cancel,{once:true});
    try{
    dispatched=true;
    const started=this.bridge.start({requestId});
    if(signal.aborted)cancel();
    const startup=await Promise.race([started,cancelled]);
    // Native reports when it attached this surface to the already admitted running resident
    // instead of starting it: no epoch change, no new enrollment, other surfaces' work untouched.
    attached=Boolean(startup)&&typeof startup==='object'&&(startup as {attached?:unknown}).attached===true;
    signal.throwIfAborted();
    if(generation!==this.generation)throw Error('Local agent connection changed.');
    const who=record(await this.request('/api/auth/me',undefined,signal));
    signal.throwIfAborted();
    const identity=record(who.identity),access=record(who.access);
    // Only the explicitly selected native/host bridge may establish local trust.
    if(identity.kind!=='owner'||access.role!=='OWNER'||!['local','session'].includes(access.mode))throw new Error('The local runtime did not verify local owner access.');
    const result=record(await this.request('/api/agents',undefined,signal));
    signal.throwIfAborted();
    if(!Array.isArray(result.agents)||result.agents.length!==1)throw new Error('The local runtime must expose exactly one agent.');
    const agent=record(result.agents[0]);
    if(agent.status!=='running')throw Error('The local agent is still starting. Try again when it is ready.');
    if(generation!==this.generation)throw Error('Local agent connection changed.');
    this.session={ownerId:identifier(identity.id),agentId:identifier(agent.id),sessionId:crypto.randomUUID(),origin:this.origin};
    attachDistrusted=false;
    return {session:this.session,name:typeof agent.name==='string'?agent.name:'Local agent',attached};
    }catch(error){
      // The runtime answered the attach but not as a usable owner session. A cancelled or
      // superseded connect says nothing about the runtime and changes nothing; neither does a
      // lifecycle change made by another surface, which native reports on the next attach query.
      if(attached&&!signal.aborted&&generation===this.generation&&(error as {code?:unknown}|null)?.code!=='LOCAL_AGENT_EPOCH_CHANGED')attachDistrusted=true;
      cancelOwned();throw error;
    }
    finally{signal.removeEventListener('abort',cancel);}
  }
  get browserSpeechAvailable(){return browserLocalAgentEnabled&&browserBridge!==null&&this.bridge===browserBridge;}
  async speechRequest(audio:Uint8Array|undefined,signal:AbortSignal){
    if(!this.browserSpeechAvailable||!this.session)throw Error('Connect the local agent first.');
    const session=this.session,generation=this.generation,controller=new AbortController();
    this.streams.add(controller);
    const bounded=AbortSignal.any([signal,controller.signal]);
    try{
      bounded.throwIfAborted();
      let audioBase64:string|undefined;
      if(audio){
        if(!audio.byteLength||audio.byteLength>2*1024*1024)throw Error('Recording is too large.');
        let binary='';for(let i=0;i<audio.length;i+=8192)binary+=String.fromCharCode(...audio.subarray(i,i+8192));
        audioBase64=btoa(binary);
      }
      const requestId=audio?crypto.randomUUID():undefined;
      const response=await this.bridge.request({path:'/api/asr/whisper'+(audio?'':'/status'),method:audio?'POST':'GET',ownerId:session.ownerId,
        headers:{},timeoutMs:120000,...(audio?{audioBase64,requestId}:{})},bounded);
      bounded.throwIfAborted();
      if(session!==this.session||generation!==this.generation)throw new DOMException('Voice selection changed','AbortError');
      if(response.status!==200)throw Error(`Local speech failed (HTTP ${response.status}).`);
      const result=JSON.parse(response.body||'{}');
      if(result.provider!=='standalone-whisper.cpp'||(audio&&(result.local!==true||result.requestId!==requestId||typeof result.text!=='string'||!result.text.trim()||result.text.length>16000)))throw Error('Invalid local speech response.');
      return result;
    }finally{this.streams.delete(controller);}
  }
  async synthesizeSpeech(text:string,signal:AbortSignal):Promise<Blob>{
    if(!this.browserSpeechAvailable||!this.session)throw Error('Connect the local agent first.');
    if(typeof text!=='string'||!text.trim()||text.length>500)throw Error('Local agent speech accepts up to 500 characters per phrase.');
    const session=this.session,generation=this.generation,controller=new AbortController(),requestId=crypto.randomUUID();
    this.streams.add(controller);const bounded=AbortSignal.any([signal,controller.signal]);
    try{
      bounded.throwIfAborted();
      const response=await this.bridge.request({path:'/api/tts/kokoro',ownerId:session.ownerId,method:'POST',headers:{},requestId,body:JSON.stringify({text}),timeoutMs:45000},bounded);
      bounded.throwIfAborted();if(session!==this.session||generation!==this.generation)throw new DOMException('Voice selection changed','AbortError');
      if(response.status!==200)throw Error(`Local agent speech unavailable (HTTP ${response.status}).`);
      const result=JSON.parse(response.body||'{}');
      if(result.requestId!==requestId||result.provider!=='standalone-kokoro'||result.contentType!=='audio/wav'||typeof result.audioBase64!=='string'||result.audioBase64.length>1920060)throw Error('Invalid local speech response.');
      const bytes=Uint8Array.from(atob(result.audioBase64),c=>c.charCodeAt(0));
      if(bytes.length<44||String.fromCharCode(...bytes.subarray(0,4))!=='RIFF'||String.fromCharCode(...bytes.subarray(8,12))!=='WAVE'||new DataView(bytes.buffer).getUint32(4,true)+8!==bytes.length)throw Error('Invalid local speech audio.');
      return new Blob([bytes],{type:'audio/wav'});
    }finally{this.streams.delete(controller);}
  }
  async disconnect() { this.generation++; this.session=null; for(const controller of this.streams)controller.abort();this.streams.clear(); }
  private async json(path:string,body:unknown|undefined,signal?:AbortSignal) {
    if(!this.session)throw new Error('Start the local agent first.');
    return record(await this.request(path,body,signal||new AbortController().signal));
  }
  async listConversations(signal?:AbortSignal):Promise<RemoteConversation[]> {
    const value=await this.json('/api/conversations',undefined,signal);
    if(!Array.isArray(value.conversations))throw new Error('Invalid local conversation list.');
    return value.conversations.map((item:unknown)=>{const row=record(item);return {...row,id:identifier(row.id)};});
  }
  async createConversation(title:string,signal?:AbortSignal):Promise<RemoteConversation> {
    const value=record((await this.json('/api/conversations',{title},signal)).conversation);
    return {...value,id:identifier(value.id)};
  }
  async truncateMessages(id:string,messageId:string,signal:AbortSignal):Promise<void> {
    const value=await this.json(`/api/conversations/${encodeURIComponent(identifier(id))}/messages/truncate`,{messageId,inclusive:true},signal);
    if(value.ok!==true||!Number.isSafeInteger(value.deletedCount)||Number(value.deletedCount)<1)throw Error('Message replacement was not confirmed. Reload conversation history before trying again.');
  }
  async messages(id:string,signal?:AbortSignal,page?:MessagePage):Promise<{messages:Record<string,unknown>[];hasMore?:boolean}> {
    const value=await this.json(`/api/conversations/${encodeURIComponent(identifier(id))}/messages${messagePageQuery(page)}`,undefined,signal);
    if(!Array.isArray(value.messages))throw new Error('Invalid local conversation history.');
    return {messages:value.messages.map(record),...(typeof value.hasMore==='boolean'?{hasMore:value.hasMore}:{})};
  }
  /** Streams render progress. If the stream drops before its terminal frame, the same request is
   * repeated once without streaming under the same clientMessageId: the agent returns the durable
   * outcome recorded for that key (or waits for the in-flight turn) and never runs a second turn.
   * Stop and connection changes are never retried. */
  async send(id:string,text:string,options:{metadata?:Record<string,unknown>;clientMessageId?:string;channelType?:ChatChannel;onReplyReady?:(results:readonly unknown[]|undefined)=>void;signal?:AbortSignal;onText?:(text:string)=>void}={}):Promise<RemoteChatReply> {
    const path=`/api/conversations/${encodeURIComponent(identifier(id))}/messages`;
    const body={text,channelType:options.channelType??'DM',metadata:options.metadata,clientMessageId:options.clientMessageId};
    if(this.bridge.stream&&options.onText){
      if(!this.session)throw Error('Start the local agent first.');
      const controller=new AbortController();this.streams.add(controller);
      const generation=this.generation,session=this.session,signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
      const valid=()=>{signal.throwIfAborted();if(generation!==this.generation||session!==this.session)throw Error('Local agent connection changed.');};
      try{
        valid();
        const result=await this.bridge.stream({path:`${path}/stream`,ownerId:session.ownerId,headers:this.deviceHeaders,
          body:JSON.stringify({...body,streamProtocol:'delta-v2'})},signal,value=>{valid();options.onText!(value);},results=>{valid();options.onReplyReady?.(results);});
        valid();return result;
      }catch(error){
        valid();
        if(!options.clientMessageId||(error&&typeof error==='object'&&'status' in error&&typeof error.status==='number'&&error.status<500))throw error;
        this.recoveries++;
        const recovered=await this.json(path,body,signal);valid();
        if(typeof recovered.text!=='string'||typeof recovered.agentName!=='string')throw new Error('Invalid local agent reply.');
        return recovered as RemoteChatReply;
      }finally{this.streams.delete(controller);}
    }
    const value=await this.json(path,body,options.signal);
    if(typeof value.text!=='string'||typeof value.agentName!=='string')throw new Error('Invalid local agent reply.');
    return value as RemoteChatReply;
  }
  /** Explicit Stop through upstream's `POST /api/turns/:roomId/abort`. The room comes from the
   * agent's conversation list. Any refusal reports `unsupported`; it is never retried. */
  async abortTurn(conversationId:string,signal:AbortSignal=new AbortController().signal):Promise<TurnAbortOutcome>{
    if(!this.session)return 'unsupported';
    const generation=this.generation;
    try{
      const room=conversationRoomId(await this.listConversations(signal),conversationId);
      if(!room)return 'unsupported';
      const outcome=turnAbortOutcome(await this.request(turnAbortPath(room),{reason:'client-stop'},signal));
      if(generation!==this.generation)throw Error('Local agent connection changed.');
      return outcome;
    }catch(error){signal.throwIfAborted();if(generation!==this.generation)throw error;return 'unsupported';}
  }
  /** Persisted-reply reads after dropped streams; exposed for contract tests and diagnostics. */
  recoveries=0;
}

/** Hosted inference stays on Qwen through Cerebras; the model is not user-selectable. */
export const LOCAL_PROVIDER_MODEL='qwen-3.8-27b';
export interface LocalProviderStatus { configured:boolean; provider:'cerebras'|'elizacloud'; model?:string }
export function providerStatusLabel(status:LocalProviderStatus|null|undefined):string {
  if(!status)return 'Provider status unavailable';
  if(!status.configured)return status.provider==='elizacloud'?'Not configured · Eliza Cloud sign-in required':'Not configured';
  return `Configured · ${status.provider==='elizacloud'?'Eliza Cloud':'cerebras'} · ${status.model||LOCAL_PROVIDER_MODEL}`;
}
function parseProviderStatus(value:unknown):LocalProviderStatus {
  const row=record(value);
  const provider=row.provider==='elizacloud'?'elizacloud':row.provider==='cerebras'?'cerebras':null;
  if(!provider||typeof row.configured!=='boolean'||(row.model!==undefined&&typeof row.model!=='string'))throw Error('Invalid provider status.');
  // Native reports `cerebras/qwen-3.8-27b` for Cloud billing; show the model name only.
  const model=typeof row.model==='string'?row.model.replace(/^cerebras\//,''):undefined;
  return {configured:row.configured,provider,...(model?{model}:{})};
}
/** The native bridge verifies the key against Cerebras before it reports success; the key itself
 * never returns to the renderer. */
export async function configureLocalProvider(apiKey:string,model:string=LOCAL_PROVIDER_MODEL) {
  // A bring-your-own key is a developer surface; product phones use the owner's Eliza Cloud plan.
  // (Inline flag read: this module is also imported by Node tests without Vite.)
  if(!(import.meta.env!==undefined&&import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS==='1'))throw Error('Alpha Phone uses your Eliza Cloud plan for AI.');
  if(!Capacitor.isNativePlatform())throw Error('Configure the development provider on the host.');
  if(!await localAgentPackaged())throw Error('On-device agent is unavailable in this version. Connect a remote agent or use Eliza Cloud.');
  if(!native.configureProvider)throw Error('Model provider setup is unavailable.');
  if(model!==LOCAL_PROVIDER_MODEL)throw Error(`Alpha Phone uses ${LOCAL_PROVIDER_MODEL} on Cerebras.`);
  return native.configureProvider({apiKey,model});
}
export async function localProviderStatus():Promise<LocalProviderStatus> {
  if(!Capacitor.isNativePlatform()||!native.providerStatus)throw Error('Provider status is unavailable here.');
  return parseProviderStatus(await native.providerStatus());
}
/** Removes the stored key and reads native status back; success requires configured:false. */
export async function clearLocalProvider():Promise<LocalProviderStatus> {
  if(!Capacitor.isNativePlatform()||!native.clearProvider)throw Error('Provider removal is unavailable in this version.');
  const cleared=await native.clearProvider();
  if(record(cleared).configured!==false)throw Error('The provider key could not be confirmed removed.');
  const status=await localProviderStatus();
  if(status.configured&&status.provider==='cerebras')throw Error('The provider key could not be confirmed removed.');
  return status;
}

/** True only in the Android ACTION_ASSIST surface (native alpha.assistant launch flag). */
export async function launchedAsAssistant():Promise<boolean> {
  if(!Capacitor.isNativePlatform()||!Capacitor.isPluginAvailable('Agent')||!native.launchSurface)return false;
  try{return (await native.launchSurface()).assistant===true;}catch{return false;}
}

/** True only when native confirms an admitted, running, enrolled resident whose stored provider
 * admission is this Cloud credential and is the one the running process launched with. Read-only:
 * it never starts, stops, pairs or rebinds. Any error or doubt reports false, which keeps the
 * ordinary stop → bind → start path; so does an earlier attach by this surface that failed its
 * owner-session verification. */
export async function residentAttachable(credentialId:string,bridge:Pick<LocalAgentBridge,'residentAttachment'>=native,nativePlatform:boolean=Capacitor.isNativePlatform()):Promise<boolean> {
  if(attachDistrusted||!nativePlatform||typeof credentialId!=='string'||!credentialId||!bridge.residentAttachment)return false;
  try{return (await bridge.residentAttachment({credentialId}))?.attachable===true;}catch{return false;}
}
/** Bind the resident's Cloud provider for one surface. A surface that can attach (the assistant
 * opening beside Home, or either surface reconnecting while the other keeps the enrollment)
 * reuses the running agent: rebinding would stop it, retiring another surface's in-flight work
 * and restarting inference. When the last surface is destroyed native clears the enrollment, so
 * a lone recreated surface is not attachable and takes the ordinary path. */
export async function bindResidentCloudProvider(credentialId:string,ports:{attachable:(credentialId:string)=>Promise<boolean>;configure:(credentialId:string)=>Promise<void>}={attachable:residentAttachable,configure:configureLocalCloudProvider}):Promise<'attached'|'configured'> {
  if(await ports.attachable(credentialId))return 'attached';
  await ports.configure(credentialId);
  return 'configured';
}

export async function configureLocalCloudProvider(credentialId:string) {
  if(!Capacitor.isNativePlatform() || !await localAgentPackaged()) throw Error('The on-device runtime is unavailable in this build.');
  await stopLocalAgent();
  if(!native.configureCloudProvider)throw Error('Cloud billing is unavailable in this version.');
  await native.configureCloudProvider({credentialId,model:'cerebras/qwen-3.8-27b'});
}

export async function stopLocalAgent() {
  if(!Capacitor.isNativePlatform()||!native.stop)throw Error('Stop browser development with Ctrl-C in its terminal.');
  await native.stop();
  const deadline=performance.now()+30000;
  while(performance.now()<deadline){
    const status=await native.getStatus?.();
    if(status?.state==='stopped'&&status.serviceActive===false&&status.socketListening===false)return;
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  throw Error('Shutdown is still pending. Check local agent status before starting again.');
}
