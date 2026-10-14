import {automationsRouteAllowed, isAutomationsPath} from '../apps/app/src/runtime/automations-route-policy.ts';
import {dirname,join} from 'node:path';
import {once} from 'node:events';
import {localAgentStorage} from './local-agent-dev-storage.ts';
import type { Plugin } from 'vite';
import { readFileSync, statSync } from 'node:fs';
import {createHash} from 'node:crypto';
import {request as httpRequest,type IncomingMessage,type ServerResponse} from 'node:http';
import type {Duplex} from 'node:stream';

export const LOCAL_AGENT_BRIDGE_PATH='/__alpha-local-agent';
export const LOCAL_VOICE_WS_PATH='/__alpha-local-voice/ws';
const LIMIT=2*1024*1024;
const AUDIO_ENVELOPE_LIMIT=3*1024*1024;
const ASR_PATH='/api/asr/whisper';
const TTS_PATH='/api/tts/kokoro';
const VOICE_PATH='/api/v1/voice/session';
const VOICE_AGENT_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VOICE_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function voiceControl(input:any):'health'|'consent'|'mint'|'revoke'|null {
 if(typeof input.path!=='string'||!input.path.startsWith(VOICE_PATH))return null;
 if(typeof input.ownerId!=='string'||!input.ownerId||input.stream||input.storage||input.audioBase64||input.requestId)return null;
 if(Object.keys(input.headers??{}).some(key=>!['accept','content-type','x-eliza-device-id','x-eliza-device-key','x-eliza-device-capabilities'].includes(key.toLowerCase())))return null;
 if(input.method==='GET'&&input.body===undefined&&new RegExp('^'+VOICE_PATH+'/health\\?conversationId=([0-9a-f-]{36})$','i').test(input.path))return VOICE_UUID.test(input.path.split('=')[1])?'health':null;
 if(input.method!=='POST'||(input.body!==undefined&&(typeof input.body!=='string'||input.body.length>2048)))return null;
 let value:any;try{value=input.body===undefined?{}:JSON.parse(input.body);}catch{return null;}
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 if(input.path===VOICE_PATH+'/consent'&&Object.keys(value).length===0)return 'consent';
 if(new RegExp('^'+VOICE_PATH+'/[0-9a-f-]{36}/revoke$','i').test(input.path)&&VOICE_UUID.test(input.path.split('/')[5])&&Object.keys(value).length===0)return 'revoke';
 if(input.path===VOICE_PATH&&Object.keys(value).every(key=>['agentId','conversationId','consentNonce','transport'].includes(key))&&VOICE_AGENT_ID.test(value.agentId)&&VOICE_UUID.test(value.conversationId)&&typeof value.consentNonce==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value.consentNonce)&&value.transport==='websocket')return 'mint';
 return null;
}
function voiceControlResponse(kind:string,input:any,status:number,raw:string,origin:URL){
 const value=JSON.parse(raw),now=Date.now(),exact=(keys:string[])=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
 if(status<200||status>=300){if(!exact(['code'])||typeof value.code!=='string'||!/^[a-z0-9_]{1,100}$/.test(value.code))throw Error('Invalid voice error');return value;}
 if(kind==='health'){if(!exact(['ready','agentId','conversationId'])||value.ready!==true||!VOICE_AGENT_ID.test(value.agentId)||value.conversationId!==input.path.split('=')[1])throw Error('Invalid voice health');}
 else if(kind==='consent'){if(!exact(['consentNonce','expiresAt'])||typeof value.consentNonce!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value.consentNonce))throw Error('Invalid voice consent');}
 else if(kind==='revoke'){if(!exact(['revoked'])||value.revoked!==true)throw Error('Invalid voice revocation');}
 else{
  if(!exact(['sessionId','token','expiresAt','wsUrl','uplink','downlink','iceServers'])||!VOICE_UUID.test(value.sessionId)||typeof value.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value.token)||value.iceServers!==null||JSON.stringify(value.uplink)!=='{"codecs":["pcm16"]}'||JSON.stringify(value.downlink)!=='{"codecs":["pcm16"]}')throw Error('Invalid voice mint');
  const ws=new URL(value.wsUrl);if(ws.protocol!=='ws:'||ws.host!==origin.host||ws.username||ws.password||ws.hash||ws.pathname!==VOICE_PATH+'/ws'||ws.search!==`?sessionId=${value.sessionId}`)throw Error('Invalid voice socket destination');
 }
 if(kind==='mint'||kind==='consent')if(!Number.isFinite(value.expiresAt)||value.expiresAt<=now||value.expiresAt>now+125000)throw Error('Invalid voice expiry');
 return value;
}
export function localAgentPathAllowed(path:unknown):path is string {
  if(typeof path!=='string'||path.length>2048||/[\\#%\r\n]/.test(path)||path.includes('..'))return false;
  if(isAutomationsPath(path))return ['GET','POST','PUT','DELETE'].some(method=>automationsRouteAllowed(path,method));
  if(path===ASR_PATH||path===ASR_PATH+'/status'||path===TTS_PATH||path===TTS_PATH+'/status')return true;
  return /^\/api\/(auth\/me|agents|status|conversations(?:\/[A-Za-z0-9_-]+(?:\/messages(?:\/(?:stream|truncate))?)?)?|views\/interact-(claim|result)|client-devices\/[A-Za-z0-9_/-]+|workflow(?:\/[A-Za-z0-9_/?=&-]+)?)$/.test(path);
}
export function createLocalAgentDevHandler(options:{origin:string;tokenFile:string;request?:typeof fetch;cartesiaEnabled?:boolean}) {
  const origin=new URL(options.origin);
  if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password)
    throw new Error('The development agent must use an explicit 127.0.0.1 HTTP origin.');
  const request=options.request||fetch;
  const tickets=new Map<string,{root:string;ownerId:string;expiresAt:number;claimed:boolean;close?:()=>void}>();
  let pairing:Promise<{root:string;token:string;ownerId:string;expiresAt:number}>|undefined;
  async function session(root:string) {
    if(pairing){const saved=await pairing;if(saved.root===root&&saved.expiresAt>Date.now()+30000)return saved;pairing=undefined;}
    pairing=(async()=>{
      const headers={Authorization:`Bearer ${root}`,'Content-Type':'application/json'};
      const json=async(path:string,body?:unknown)=>{
        const result=await request(origin.origin+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});
        if(!result.ok)throw Error('Local owner enrollment failed');return result.json();
      };
      const status=await json('/api/auth/status');
      const code=await json('/api/auth/pair-code');
      const paired=await json('/api/auth/pair',{code:code.code,instanceId:status.instanceId});
      if(paired.access!=='owner'||typeof paired.token!=='string'||paired.instanceId!==status.instanceId)throw Error('Invalid local owner enrollment');
      const verified=await request(origin.origin+'/api/auth/me',{headers:{Authorization:`Bearer ${paired.token}`},redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!verified.ok)throw Error('Local owner verification failed');
      const who=await verified.json();
      if(who.identity?.id!==paired.identityId||who.access?.role!=='OWNER'||who.session?.id!==paired.token||!Number.isFinite(who.session?.expiresAt)||who.session.expiresAt<=Date.now())throw Error('Invalid local owner identity');
      return {root,token:paired.token,ownerId:paired.identityId,expiresAt:who.session.expiresAt};
    })();
    try{return await pairing;}catch(error){pairing=undefined;throw error;}
  }
  const handler=async(req:IncomingMessage,res:ServerResponse)=>{
    const fail=(status:number,message:string)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:message}));};
    const host=req.headers.host;
    if(!host||!/^127\.0\.0\.1:\d+$/.test(host)||req.headers.origin!==`http://${host}`||
       req.headers['x-alpha-local-agent']!=='1'||req.method!=='POST'||req.headers['content-type']!=='application/json'){
      fail(403,'Local development origin required');return;
    }
    const abort=new AbortController();
    const onClose=()=>{if(!res.writableEnded)abort.abort();};res.on('close',onClose);
    try{
      const chunks:Buffer[]=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>AUDIO_ENVELOPE_LIMIT){fail(413,'Request too large');return;}chunks.push(Buffer.from(chunk));}
      const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const voicePath=typeof input.path==='string'&&input.path.startsWith(VOICE_PATH),voice=voicePath&&options.cartesiaEnabled===true?voiceControl(input):null;
      if(voicePath&&!voice){fail(400,'Unsupported development voice request');return;}
      const asr=input.path===ASR_PATH||input.path===ASR_PATH+'/status',tts=input.path===TTS_PATH||input.path===TTS_PATH+'/status';
      const speech=asr||tts,ttsAudio=input.path===TTS_PATH&&input.method==='POST';
      if(size>LIMIT&&!(input.path===ASR_PATH&&input.method==='POST')){fail(413,'Request too large');return;}
      if(input.storage){const result=localAgentStorage(join(dirname(options.tokenFile),'browser-device'),input.storage);res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));return;}
      if((!voice&&!localAgentPathAllowed(input.path))||(isAutomationsPath(input.path)?!automationsRouteAllowed(input.path,input.method)||typeof input.ownerId!=='string'||!input.ownerId.trim():!['GET','POST'].includes(input.method))||
         ((input.path.startsWith('/api/views/')||input.path.endsWith('/messages/truncate'))&&(input.method!=='POST'||typeof input.ownerId!=='string'||!input.ownerId.trim()))||
         (input.body!==undefined&&typeof input.body!=='string')||
         (['GET','DELETE'].includes(input.method)&&input.body!==undefined)) {fail(400,'Unsupported local request');return;}
      let audio:Buffer|undefined;
      if(asr){
        if(typeof input.ownerId!=='string'||!input.ownerId||input.storage||input.stream||input.body!==undefined){fail(400,'Invalid speech request');return;}
        if(input.path===ASR_PATH+'/status'){
          if(input.method!=='GET'||input.audioBase64!==undefined||input.requestId!==undefined){fail(400,'Invalid speech status request');return;}
        }else{
          if(input.method!=='POST'||typeof input.requestId!=='string'||!/^[0-9a-f-]{36}$/i.test(input.requestId)||
             typeof input.audioBase64!=='string'||!input.audioBase64.length||input.audioBase64.length>Math.ceil(LIMIT/3)*4||
             !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.audioBase64)){
            fail(400,'Invalid speech audio request');return;
          }
          audio=Buffer.from(input.audioBase64,'base64');
          if(audio.length>LIMIT||audio.toString('base64')!==input.audioBase64){fail(400,'Invalid speech audio bytes');return;}
        }
      }else if(tts){
        if(typeof input.ownerId!=='string'||!input.ownerId||input.stream||input.audioBase64!==undefined){fail(400,'Invalid speech request');return;}
        if(input.path===TTS_PATH+'/status'){
          if(input.method!=='GET'||input.body!==undefined||input.requestId!==undefined){fail(400,'Invalid speech status request');return;}
        }else{
          if(!ttsAudio||typeof input.requestId!=='string'||!/^[0-9a-f-]{36}$/i.test(input.requestId)||typeof input.body!=='string'||input.body.length>8192){fail(400,'Invalid speech text request');return;}
          let value;try{value=JSON.parse(input.body);}catch{fail(400,'Invalid speech text');return;}
          if(!value||typeof value.text!=='string'||!value.text.trim()||value.text.length>500||Object.keys(value).some(key=>key!=='text')){fail(400,'Invalid speech text');return;}
        }
      }else if(input.audioBase64!==undefined||input.requestId!==undefined){fail(400,'Speech payload requires a speech route');return;}
      const streamPath=/^\/api\/conversations\/[A-Za-z0-9_-]+\/messages\/stream$/.test(input.path);
      if((input.stream===true)!==streamPath||(streamPath&&(input.method!=='POST'||typeof input.ownerId!=='string'))){fail(400,'Unsupported streaming request');return;}
      const stat=statSync(options.tokenFile);
      if(!stat.isFile()||(stat.mode&0o077)!==0)throw new Error('Private runtime credential required');
      const token=readFileSync(options.tokenFile,'utf8').trim();
      if(!/^[a-f0-9]{64}$/.test(token))throw new Error('Invalid runtime credential');
      for(const [id,ticket]of tickets)if(ticket.root!==token||ticket.expiresAt<=Date.now()){ticket.close?.();tickets.delete(id);}
      const credential=await session(token);
      if(input.ownerId!==undefined&&input.ownerId!==credential.ownerId){fail(409,'Local owner changed; reconnect before continuing');return;}
      const headers:Record<string,string>={Accept:input.stream===true?'text/event-stream':'application/json','Content-Type':'application/json',Authorization:`Bearer ${credential.token}`};
      for(const key of ['X-Eliza-Device-Id','X-Eliza-Device-Key','X-Eliza-Device-Capabilities']){
        const value=input.headers?.[key];if(value!==undefined){if(typeof value!=='string'||value.length>2048||/[\r\n]/.test(value))throw new Error('Invalid device header');headers[key]=value;}
      }
      if(audio){headers['Content-Type']='audio/wav';headers['X-Request-Id']=input.requestId;}
      if(ttsAudio){headers['X-Request-Id']=input.requestId;headers.Accept='audio/wav';}
      const result=await request(origin.origin+input.path,{method:input.method,headers,body:audio??input.body,redirect:'error',
        signal:AbortSignal.any([abort.signal,AbortSignal.timeout(voice?10000:120000)])});
      if(ttsAudio&&result.ok&&(result.headers.get('content-type')!=='audio/wav'||result.headers.get('x-request-id')!==input.requestId||result.headers.get('x-eliza-speech-provider')!=='standalone-kokoro')){await result.body?.cancel();fail(502,'Invalid local speech response');return;}
      if(input.stream===true){
        if(result.status===401)pairing=undefined;
        if(!result.ok||!result.body||!result.headers.get('content-type')?.startsWith('text/event-stream')){
          await result.body?.cancel();fail(result.ok?502:result.status,'Local agent stream unavailable. No automatic retry was made.');return;
        }
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store, no-transform','X-Content-Type-Options':'nosniff'});res.flushHeaders();
        const reader=result.body.getReader();let received=0;
        try{while(true){const part=await reader.read();if(part.done)break;received+=part.value.byteLength;if(received>LIMIT)throw Error('Stream too large');if(!res.write(part.value))await once(res,'drain',{signal:abort.signal});}}
        finally{await reader.cancel().catch(()=>{});}
        if(!abort.signal.aborted)res.end();return;
      }
      const reader=result.body?.getReader();let received=0;const output:Uint8Array[]=[];
      if(reader)try{while(true){const item=await reader.read();if(item.done)break;received+=item.value.length;if(received>(voice?16*1024:ttsAudio&&result.ok?1440044:speech?128*1024:LIMIT))throw new Error('Response too large');output.push(item.value);}}finally{await reader.cancel();}
      if(abort.signal.aborted)return;
      const bytes=Buffer.concat(output);
      if(ttsAudio&&result.ok&&(bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE'||bytes.readUInt32LE(4)+8!==bytes.length)){fail(502,'Invalid local speech audio');return;}
      let body=ttsAudio&&result.ok?JSON.stringify({audioBase64:bytes.toString('base64'),requestId:input.requestId,provider:'standalone-kokoro',contentType:'audio/wav'}):bytes.toString('utf8');
      // The upstream machine session ID is its bearer token. Keep it on the host.
      if(voice){try{if(readFileSync(options.tokenFile,'utf8').trim()!==token||credential.expiresAt<=Date.now())throw Error('Voice owner changed');const projected=voiceControlResponse(voice,input,result.status,body,origin);
        if(result.ok&&voice==='mint'){for(const [id,ticket]of tickets)if(ticket.expiresAt<=Date.now()){ticket.close?.();tickets.delete(id);}if(tickets.size>=32)throw Error('Voice capacity reached');tickets.set(projected.sessionId,{root:token,ownerId:credential.ownerId,expiresAt:projected.expiresAt,claimed:false});projected.wsUrl=`ws://${host}${LOCAL_VOICE_WS_PATH}?sessionId=${projected.sessionId}`;}
        if(result.ok&&voice==='revoke'){const id=input.path.split('/')[5];tickets.get(id)?.close?.();tickets.delete(id);}
        body=JSON.stringify(projected);}catch{if(result.status===401)pairing=undefined;throw Error('Invalid development voice response');}}
      if(input.path==='/api/auth/me'&&result.status===200){const who=JSON.parse(body);if(who.session)who.session.id='host-owned-session';body=JSON.stringify(who);}
      if(result.status===401)pairing=undefined; // Never replay the failed request.
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      res.end(JSON.stringify({status:result.status,body}));
    }catch{if(!abort.signal.aborted){if(!res.headersSent)fail(503,'Local runtime unavailable. Check the private host log.');else res.destroy();}}
    finally{res.off('close',onClose);}
  };
  const upgrade=async(req:IncomingMessage,socket:Duplex,head:Buffer)=>{
    if(!req.url?.startsWith(LOCAL_VOICE_WS_PATH))return false;
    const reject=()=>{socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');};
    try{
      const host=req.headers.host,url=new URL(req.url,'http://localhost'),id=url.searchParams.get('sessionId'),ticket=id?tickets.get(id):undefined;
      if(!options.cartesiaEnabled||!host||!/^127\.0\.0\.1:\d+$/.test(host)||req.headers.origin!==`http://${host}`||req.method!=='GET'||url.pathname!==LOCAL_VOICE_WS_PATH||url.search!==`?sessionId=${id}`||!id||!VOICE_UUID.test(id)||!ticket||ticket.claimed||ticket.expiresAt<=Date.now()||req.headers.upgrade?.toLowerCase()!=='websocket'||req.headers['sec-websocket-version']!=='13'||typeof req.headers['sec-websocket-key']!=='string'||!/^[A-Za-z0-9+/]{22}==$/.test(req.headers['sec-websocket-key'])){reject();return true;}
      const stat=statSync(options.tokenFile);if(!stat.isFile()||(stat.mode&0o077)!==0)throw Error('Private runtime credential required');
      const currentRoot=readFileSync(options.tokenFile,'utf8').trim();for(const [key,entry]of tickets)if(entry.root!==currentRoot||entry.expiresAt<=Date.now()){entry.close?.();tickets.delete(key);}
      const credential=await session(currentRoot);
      if(ticket.root!==currentRoot||ticket.ownerId!==credential.ownerId||ticket.expiresAt<=Date.now()||tickets.get(id)!==ticket||ticket.claimed){reject();return true;}
      ticket.claimed=true;
      const request=httpRequest(new URL(`${VOICE_PATH}/ws?sessionId=${id}`,origin),{headers:{Host:origin.host,Origin:origin.origin,Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':req.headers['sec-websocket-key']}});
      const close=()=>{request.destroy();socket.destroy();};ticket.close=close;
      request.on('upgrade',(response,upstream,upstreamHead)=>{
        if(response.statusCode!==101||ticket.expiresAt<=Date.now()||tickets.get(id)!==ticket){upstream.destroy();close();return;}
        request.setTimeout(0);const accept=response.headers['sec-websocket-accept'],expected=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');if(accept!==expected){upstream.destroy();close();return;}
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
        const timer=setTimeout(()=>{upstream.destroy();close();},Math.max(1,ticket.expiresAt-Date.now()));timer.unref();
        ticket.close=()=>{clearTimeout(timer);upstream.destroy();close();};
        socket.once('close',()=>{clearTimeout(timer);upstream.destroy();tickets.delete(id);});upstream.once('close',()=>{clearTimeout(timer);socket.destroy();tickets.delete(id);});
        socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());
        if(head.length)upstream.write(head);if(upstreamHead.length)socket.write(upstreamHead);socket.pipe(upstream);upstream.pipe(socket);
      });
      request.once('response',response=>{response.resume();close();});request.once('error',close);socket.once('close',()=>request.destroy());request.setTimeout(5000,close);request.end();
      return true;
    }catch{reject();return true;}
  };
  return Object.assign(handler,{upgrade,closeVoice(){for(const ticket of tickets.values())ticket.close?.();tickets.clear();}});
}
export function localAgentDevBridge():Plugin {
  return {name:'alpha-local-agent-development',apply:'serve',configureServer(server){
    if(process.env.VITE_LOCAL_AGENT!=='1')return;
    const tokenFile=process.env.ALPHA_LOCAL_AGENT_TOKEN_FILE;
    if(!tokenFile)throw new Error('ALPHA_LOCAL_AGENT_TOKEN_FILE is required for browser agent development.');
    const handler=createLocalAgentDevHandler({origin:process.env.ALPHA_LOCAL_AGENT_ORIGIN||'http://127.0.0.1:47839',tokenFile,cartesiaEnabled:process.env.ALPHA_DEV_CARTESIA==='1'});
    const upgrade=(req:IncomingMessage,socket:Duplex,head:Buffer)=>{if(req.url?.startsWith(LOCAL_VOICE_WS_PATH))void handler.upgrade(req,socket,head);};
    server.httpServer?.on('upgrade',upgrade);server.httpServer?.once('close',()=>{server.httpServer?.off('upgrade',upgrade);handler.closeVoice();});
    server.middlewares.use((req,res,next)=>{if(req.url!==LOCAL_AGENT_BRIDGE_PATH){next();return;}void handler(req,res);});
  }};
}
