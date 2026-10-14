import {managedServiceRequest} from '../apps/app/src/runtime/managed-service-routes.ts';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,lstat} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Plugin} from 'vite';

export const BROWSER_CLOUD_BRIDGE_PATH='/__alpha-browser-cloud';
const UUID=/^[0-9a-f-]{36}$/i,REFERENCE=/^browser-cloud-reference:[0-9a-f-]{36}$/i;
const authorities={production:'https://api.eliza.app',staging:'https://api-staging.eliza.app'};
type Environment=keyof typeof authorities;
type Credential={credentialReference:string;credentialId:string;userId:string;organizationId:string;email?:string;expiresAt?:number;token?:string;credentialFile?:string;credentialSha256?:string};
const publicCredential=(c:Credential)=>({credentialReference:c.credentialReference,credentialId:c.credentialId,userId:c.userId,organizationId:c.organizationId,...(c.expiresAt===undefined?{}:{expiresAt:c.expiresAt})});
function environment(value:unknown):Environment{if(value!=='production'&&value!=='staging')throw Error('Unsupported Cloud environment');return value;}
function refusal(status:number,code:string){return Object.assign(Error(code),{status,code});}
function requestId(value:unknown):string{if(typeof value!=='string'||!UUID.test(value))throw Error('Invalid request identity');return value;}
function object(value:unknown):Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid Cloud request');return value as Record<string,any>;}
const GOOGLE_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Narrow owner-service surface. URL queries carry opaque provider IDs; paths never do. */
function managedGoogleRequest(url:URL,method:string,body:unknown):boolean {
 if(!managedServiceRequest('https://api.eliza.app'+url.pathname+url.search,method,body!==undefined))return false;
 const prefix='/api/v1/eliza/google/',route=url.pathname.slice(prefix.length);
 if(!url.pathname.startsWith(prefix))return false;
 if(method==='POST'){
  if(url.search||typeof body!=='string'||body.length>4096)return false;
  let value:Record<string,any>;try{value=object(JSON.parse(body));}catch{return false;}
  if(value.side!=='owner')return false;
  if(route==='disconnect')return Object.keys(value).every(key=>['side','connectionId'].includes(key))&&typeof value.connectionId==='string'&&GOOGLE_UUID.test(value.connectionId);
  if(route!=='connect/initiate'||Object.keys(value).some(key=>!['side','capabilities'].includes(key))||!Array.isArray(value.capabilities)||!value.capabilities.length||value.capabilities.length>7)return false;
  const allowed=new Set(['google.basic_identity','google.gmail.triage','google.gmail.send','google.gmail.drafts','google.gmail.mailbox','google.calendar.read','google.calendar.write']);
  return new Set(value.capabilities).size===value.capabilities.length&&value.capabilities.every((cap:unknown)=>typeof cap==='string'&&allowed.has(cap))&&value.capabilities.includes('google.basic_identity');
 }
 if(method!=='GET'||body!==undefined)return false;
 const params=url.searchParams,keys=[...params.keys()];
 if(new Set(keys).size!==keys.length)return false;
 const clean=(key:string,max=1024)=>{const value=params.get(key);return value!==null&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);};
 const exact=(allowed:string[])=>keys.every(key=>allowed.includes(key));
 if(route==='accounts'||route==='status')return exact(['side'])&&params.get('side')==='owner';
 const grant=params.get('grantId');if(!grant||!GOOGLE_UUID.test(grant))return false;
 if(route==='calendar/calendars')return exact(['side','grantId'])&&params.get('side')==='owner';
 if(route==='calendar/feed'){
  if(!exact(['side','grantId','calendarId','timeMin','timeMax','timeZone'])||params.get('side')!=='owner'||!clean('calendarId')||!clean('timeMin',64)||!clean('timeMax',64)||!clean('timeZone',128))return false;
  const start=Date.parse(params.get('timeMin')!),end=Date.parse(params.get('timeMax')!);if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return false;
  try{new Intl.DateTimeFormat('en-US',{timeZone:params.get('timeZone')!}).format();return true;}catch{return false;}
 }
 if(route==='gmail/search')return exact(['side','grantId','query','maxResults','pageToken'])&&params.get('side')==='owner'&&clean('query',2048)&&['10','25','50'].includes(params.get('maxResults')??'')&&(!params.has('pageToken')||clean('pageToken',4096));
 if(route==='gmail/read')return exact(['side','grantId','messageId'])&&params.get('side')==='owner'&&clean('messageId');
 if(route==='gmail/inbox-v1/capabilities')return exact(['grantId']);
 if(route==='gmail/inbox-v1/thread')return exact(['grantId','threadId','offset','historyId'])&&clean('threadId')&&(!params.has('offset')||/^\d{1,4}$/.test(params.get('offset')!)&&clean('historyId'))&&(!params.has('historyId')||params.has('offset'));
 if(route==='gmail/inbox-v1/attachment')return exact(['grantId','messageId','partId','historyId','opaque'])&&['messageId','partId','historyId'].every(key=>clean(key))&&(!params.has('opaque')||params.get('opaque')==='1');
 if(route==='gmail/inbox-v1/drafts')return exact(['grantId','pageToken'])&&(!params.has('pageToken')||clean('pageToken',4096));
 if(route==='gmail/inbox-v1/draft')return exact(['grantId','draftId','content'])&&clean('draftId')&&(!params.has('content')||params.get('content')==='1');
 return false;
}
async function boundedServiceJson(response:Response):Promise<any>{
 const reader=response.body?.getReader();if(!reader)throw Error('Empty Cloud response');
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>16*1024*1024)throw Error('Cloud response too large');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
 const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 // Managed services never return authentication material. Refuse accidental exposure.
 const inspect=(item:any):void=>{if(item&&typeof item==='object')for(const [key,nested]of Object.entries(item)){if(/^(?:access_?token|refresh_?token|api_?key|authorization|credentialReference|credentialFile|token|sessionId)$/i.test(key))throw Error('Unexpected Cloud credential response');inspect(nested);}};
 inspect(value);return value;
}
/** DEV transport only. Canonical Cloud owns login, identity, plan entitlement and speech authorization. */
export function createBrowserCloudDevHandler(options:{profile:string;request?:typeof fetch}){
 const profile=path.resolve(options.profile),stateFile=path.join(profile,'credentials.json'),initialFile=path.join(profile,'initial-credential.json'),fetchCloud=options.request??fetch;
 let queue:Promise<unknown>=Promise.resolve();
 const pending=new Map<string,{environment:Environment;expiresAt:number;previousReference:string|null}>();
 const claims=new Map<string,{environment:Environment;previousReference:string|null;expiresAt:number;credential:Credential}>();
 const active=new Map<string,{controller:AbortController;environment:Environment;credentialId?:string}>();
 async function privateFile(file:string){const st=await lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o077))throw Error('Private Cloud file required');return readFile(file,'utf8');}
 async function directory(){await mkdir(profile,{recursive:true,mode:0o700});const st=await lstat(profile);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o077))throw Error('Private Cloud directory required');}
 async function load():Promise<Partial<Record<Environment,Credential>>>{
  await directory();try{return object(JSON.parse(await privateFile(stateFile)));}catch(error:any){if(error.code!=='ENOENT')throw error;}
  try{const seed=object(JSON.parse(await privateFile(initialFile))),env=environment(seed.environment);if(!REFERENCE.test(seed.credentialReference)||!UUID.test(seed.credentialId)||typeof seed.credentialFile!=='string'||!path.isAbsolute(seed.credentialFile)||typeof seed.credentialSha256!=='string'||!UUID.test(seed.userId)||!UUID.test(seed.organizationId))throw Error('Invalid initial Cloud binding');return {[env]:seed as Credential};}catch(error:any){if(error.code==='ENOENT')return {};throw error;}
 }
 async function save(value:Partial<Record<Environment,Credential>>){await directory();const tmp=stateFile+'.'+randomUUID();await writeFile(tmp,JSON.stringify(value)+'\n',{mode:0o600,flag:'wx'});await rename(tmp,stateFile);}
 function serial<T>(run:()=>Promise<T>):Promise<T>{const result=queue.then(run,run);queue=result.catch(()=>{});return result;}
 async function keyFor(c:Credential){if(c.token)return c.token;if(!c.credentialFile||!c.credentialSha256)throw Error('Cloud credential unavailable');const token=(await privateFile(c.credentialFile)).trim();if(createHash('sha256').update(token).digest('hex')!==c.credentialSha256)throw Error('Cloud credential changed');return token;}
 async function admitted(env:Environment,reference:unknown,id?:unknown){const c=(await load())[env];if(!c)throw refusal(401,'credentials-missing');if(c.credentialReference!==reference||id!==undefined&&c.credentialId!==id)throw refusal(409,'account-changed');if(c.expiresAt!==undefined&&c.expiresAt<=Date.now())throw refusal(401,'expired');return c;}
 async function current(env:Environment,c:Credential,signal:AbortSignal){signal.throwIfAborted();await admitted(env,c.credentialReference,c.credentialId);await keyFor(c);signal.throwIfAborted();}
 function retire(env:Environment){for(const row of active.values())if(row.environment===env)row.controller.abort(new DOMException('Cloud account changed','AbortError'));for(const [id,login]of pending)if(login.environment===env)pending.delete(id);for(const [ref,claim]of claims)if(claim.environment===env)claims.delete(ref);}
 async function canonical(env:Environment,route:string,signal:AbortSignal,init:RequestInit={},credential?:Credential){const headers=new Headers(init.headers);headers.set('Accept','application/json');headers.set('User-Agent','AlphaPhone-Browser-Cloud/1');if(credential)headers.set('Authorization','Bearer '+await keyFor(credential));const result=await fetchCloud(authorities[env]+route,{...init,headers,redirect:'error',signal});signal.throwIfAborted();return result;}
 const send=(res:ServerResponse,status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 return async(req:IncomingMessage,res:ServerResponse)=>{
  const host=req.headers.host,origin=req.headers.origin;
  if(req.url!=='/'&&req.url!==''&&req.url!==BROWSER_CLOUD_BRIDGE_PATH){send(res,404,{error:'Unknown development route'});return;}
  if(!host||! /^(127\.0\.0\.1|localhost):\d+$/.test(host)||origin!==`http://${host}`||req.method!=='POST'||req.headers['x-alpha-browser-cloud']!=='1'){send(res,403,{error:'Same-origin development request required'});return;}
  let ownedId:string|undefined;const controller=new AbortController(),closed=()=>{if(!res.writableEnded)controller.abort();};res.on('close',closed);
  try{
   const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>17_000_000)throw Error('Cloud request too large');chunks.push(Buffer.from(chunk));}
   const bytes=Buffer.concat(chunks),content=req.headers['content-type']||'';let data:Record<string,any>,audio:File|undefined;
   if(content.startsWith('multipart/form-data;')){const form=await new Request('http://127.0.0.1',{method:'POST',headers:{'Content-Type':content},body:bytes}).formData();if([...form.keys()].some(k=>!['operation','environment','credentialReference','credentialId','requestId','audio'].includes(k)))throw Error('Invalid speech form');data=Object.fromEntries([...form].filter(([k])=>k!=='audio'));const value=form.get('audio');if(!(value instanceof File)||value.size<1||value.size>16_000_000||!['audio/webm','audio/ogg','audio/mp4','audio/wav','audio/mpeg'].includes(value.type.split(';')[0]))throw Error('Invalid speech audio');audio=value;}
   else{if(content!=='application/json'||size>2*1024*1024)throw Error('JSON development request required');data=object(JSON.parse(bytes.toString('utf8')));}
   if(data.operation==='cancel'){active.get(requestId(data.requestId))?.controller.abort();send(res,200,{});return;}
   const slot=data.slot,env=environment(data.environment??(typeof slot==='string'?slot.replace(/^cloud:/,''):undefined));
   if(data.operation==='secureRead'){if(slot!==`cloud:${env}`)throw Error('Unsupported credential slot');const c=(await load())[env];send(res,200,{value:c?JSON.stringify(publicCredential(c)):null});return;}
   if(data.operation==='secureWrite'||data.operation==='secureRemove'||data.operation==='secureCompareExchange'){
    if(slot!==`cloud:${env}`)throw Error('Unsupported credential slot');await serial(async()=>{
     const state=await load(),old=state[env],expected=data.previousReference??null;if((old?.credentialReference??null)!==expected)throw Error('Cloud account changed');
     if(data.operation==='secureCompareExchange'&&data.expectedValue!==(old?JSON.stringify(publicCredential(old)):null)){send(res,200,{status:'conflict'});return;}
     if(data.operation==='secureRemove'||data.value===null){delete state[env];retire(env);await save(state);send(res,200,data.operation==='secureCompareExchange'?{status:'saved'}:{});return;}
     const value=object(JSON.parse(data.value)),claim=claims.get(value.credentialReference);
     if(claim&&claim.expiresAt<=Date.now())throw refusal(410,'expired');
     if(!claim||claim.environment!==env||claim.previousReference!==(old?.credentialReference??null)||value.token||!UUID.test(value.credentialId))throw refusal(409,'account-changed');
     const claimed=claim.credential;
     if(value.userId!==undefined&&value.userId!==claimed.userId||value.organizationId!==undefined&&value.organizationId!==claimed.organizationId)throw refusal(409,'account-changed');
     controller.signal.throwIfAborted();state[env]={...claimed,credentialId:value.credentialId};retire(env);await save(state);claims.delete(value.credentialReference);send(res,200,data.operation==='secureCompareExchange'?{status:'saved'}:{});
    });return;
   }
   ownedId=requestId(data.requestId);if(active.has(ownedId))throw Error('Cloud request already active');active.set(ownedId,{controller,environment:env,credentialId:data.credentialId});
   if(data.operation==='request'){
    const input=object(data.input);if(typeof input.url!=='string'||input.url.length>12000||/[\\#\s]/.test(input.url))throw Error('Invalid Cloud URL');const rawPath=input.url.split('?')[0];if(rawPath.includes('%')||rawPath.includes('..'))throw Error('Invalid Cloud path');const url=new URL(input.url);if(url.origin!==authorities[env]||url.username||url.password||url.hash||url.port)throw Error('Unsupported Cloud authority');
    const route=url.pathname+url.search;const method=input.method;
    if(Object.keys(input.headers??{}).some(k=>!['accept','content-type'].includes(k.toLowerCase())))throw Error('Unsupported Cloud request header');
    const create=method==='POST'&&route==='/api/auth/cli-session',poll=method==='GET'&&/^\/api\/auth\/cli-session\/[0-9a-f-]{36}$/i.test(route);
    if(create){if(input.credentialReference||Object.keys(object(JSON.parse(input.body??'{}'))).length)throw Error('Invalid login creation');const previous=(await load())[env]?.credentialReference??null;const response=await canonical(env,route,controller.signal,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),result=object(await response.json());if(response.ok){if(!UUID.test(result.sessionId)||!Number.isFinite(Date.parse(result.expiresAt)))throw Error('Invalid login session');controller.signal.throwIfAborted();pending.set(result.sessionId,{environment:env,expiresAt:Date.parse(result.expiresAt),previousReference:previous});}send(res,200,{status:response.status,data:result});return;}
    if(poll){if(input.credentialReference||input.body!==undefined)throw Error('Invalid login poll');const id=route.split('/').at(-1)!,login=pending.get(id);if(!login||login.environment!==env||login.expiresAt<=Date.now())throw refusal(410,'expired');if(((await load())[env]?.credentialReference??null)!==login.previousReference)throw Error('Cloud account changed');const response=await canonical(env,route,controller.signal),result=object(await response.json());if(result.status==='authenticated'){
      const token=['token','accessToken','stewardToken','sessionToken','apiKey'].map(k=>result[k]).find(v=>typeof v==='string'&&v.trim());if(!token){send(res,200,{status:response.status,data:{status:'authenticated'}});return;}
      const identityResponse=await canonical(env,'/api/v1/user',controller.signal,{}, {token}as Credential),identity=object(await identityResponse.json()),who=object(identity.data??identity);if(!identityResponse.ok||!UUID.test(who.id)||!UUID.test(who.organization_id))throw Error('Cloud owner verification failed');
      if(result.expiresAt&&(!Number.isFinite(Date.parse(result.expiresAt))||Date.parse(result.expiresAt)<=Date.now()))throw Error('Cloud credential expired');
      const reference='browser-cloud-reference:'+randomUUID(),claimed:Credential={token,credentialReference:reference,credentialId:randomUUID(),userId:who.id,organizationId:who.organization_id,...(result.expiresAt?{expiresAt:Date.parse(result.expiresAt)}:{})};controller.signal.throwIfAborted();if(login.expiresAt<=Date.now())throw refusal(410,'expired');if(pending.get(id)!==login||((await load())[env]?.credentialReference??null)!==login.previousReference)throw refusal(409,'account-changed');controller.signal.throwIfAborted();claims.set(reference,{environment:env,previousReference:login.previousReference,expiresAt:login.expiresAt,credential:claimed});pending.delete(id);send(res,200,{status:response.status,data:{status:'authenticated',credentialReference:reference,userId:who.id,organizationId:who.organization_id,...(result.expiresAt?{expiresAt:result.expiresAt}:{})}});return;
     }send(res,200,{status:response.status,data:result});return;}
    // Subscription redemption: exactly {code,idempotencyKey}; the code is forwarded, never logged or stored.
    const redeem=method==='POST'&&route==='/api/v1/subscription/redeem';
    if(redeem){const body=object(JSON.parse(input.body??'null'));if(Object.keys(body).sort().join()!=='code,idempotencyKey'||typeof body.code!=='string'||body.code.length>128||typeof body.idempotencyKey!=='string'||!/^[A-Za-z0-9._:-]{8,128}$/.test(body.idempotencyKey))throw Error('Invalid subscription redemption');}
    const accountRead=method==='GET'&&input.body===undefined&&['/api/v1/user','/api/v1/billing/limits','/api/v1/subscription/entitlement','/api/v1/subscription/entitlement-keys'].includes(route);
    if(!redeem&&!accountRead&&!managedGoogleRequest(url,method,input.body))throw Error('Unsupported Cloud route');
    const c=await admitted(env,input.credentialReference);active.get(ownedId)!.credentialId=c.credentialId;const response=await canonical(env,route,controller.signal,{method,...(input.body===undefined?{}:{headers:{'Content-Type':'application/json'},body:input.body})},c);let result=await boundedServiceJson(response);await current(env,c,controller.signal);if(response.ok&&route==='/api/v1/user'&&result.success===true){const who=object(result.data);result={success:true,data:{id:who.id,organization_id:who.organization_id,...(typeof who.email==='string'?{email:who.email}:{})}};}send(res,200,{status:response.status,data:result});return;
   }
   if(data.operation==='stt'||data.operation==='tts'){
    const c=await admitted(env,data.credentialReference,data.credentialId);active.get(ownedId)!.credentialId=c.credentialId;
    let init:RequestInit;
    if(data.operation==='stt'){if(!audio)throw Error('Speech audio required');const form=new FormData();form.append('audio',audio,'recording.'+(audio.type.includes('ogg')?'ogg':audio.type.includes('mp4')?'mp4':audio.type.includes('wav')?'wav':'webm'));init={method:'POST',body:form};}
    else{if(audio||typeof data.text!=='string'||!data.text.trim()||data.text.length>5000)throw Error('Invalid speech text');init={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:data.text,format:'mp3'})};}
    const response=await canonical(env,'/api/v1/voice/'+data.operation,controller.signal,init,c);
    if(!response.ok){await response.body?.cancel();await current(env,c,controller.signal);send(res,response.status,{error:'Cloud voice request failed',code:'voice-http-'+response.status});return;}
    if(data.operation==='stt'){const result=object(await response.json());await current(env,c,controller.signal);if(typeof result.transcript!=='string'||!result.transcript.trim())throw Error('Cloud returned no transcript');send(res,200,{text:result.transcript,local:false});return;}
    const type=response.headers.get('content-type')?.split(';')[0];if(!['audio/mpeg','audio/wav','audio/mp3'].includes(type??'')){await response.body?.cancel();throw Error('Invalid Cloud speech response');}
    const reader=response.body?.getReader();if(!reader)throw Error('Empty Cloud speech');const output:Uint8Array[]=[];let total=0;try{for(;;){const value=await reader.read();if(value.done)break;total+=value.value.byteLength;if(total>8*1024*1024)throw Error('Cloud speech exceeded bounds');output.push(value.value);}}finally{await reader.cancel().catch(()=>{});}
    await current(env,c,controller.signal);res.writeHead(200,{'Content-Type':type!,'Cache-Control':'no-store'});res.end(Buffer.concat(output));return;
   }
   throw Error('Unsupported development operation');
  }catch(error:any){if(!res.writableEnded&&!res.destroyed)send(res,error.name==='AbortError'?409:error.status??400,{error:error.name==='AbortError'?'Cloud operation cancelled':'Cloud development request rejected',...(error.code?{code:error.code}:{})});}
  finally{if(ownedId)active.delete(ownedId);res.removeListener('close',closed);}
 };
}
export function browserCloudDevBridge():Plugin{
 return {name:'alpha-browser-cloud-dev-bridge',apply:'serve',configureServer(server){if(process.env.ELIZA_DEV_ALLOW_TEST_MOCKS!=='1')return;const profile=path.resolve(process.env.ALPHA_BROWSER_CLOUD_PROFILE??path.join(homedir(),'.local/share/alphaphone/browser-cloud'));const handler=createBrowserCloudDevHandler({profile});server.middlewares.use(BROWSER_CLOUD_BRIDGE_PATH,(req,res)=>{void handler(req,res);});}};
}
