import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer,request as httpRequest} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
if(!process.execArgv.includes('tsx')){const child=spawnSync(process.execPath,['--import','tsx',process.argv[1]],{stdio:'inherit',timeout:60000});process.exit(child.status??1);}
const {createLocalAgentDevHandler,localAgentPathAllowed,LOCAL_VOICE_WS_PATH}=await import('../scripts/local-agent-dev-bridge.ts');
const owner=randomUUID(),agent=randomUUID(),conversation=randomUUID(),nonce='a'.repeat(43),voiceToken='b'.repeat(43),root='1'.repeat(64),paired='synthetic-owner-bearer';
const BASE='/api/v1/voice/session';
function requestJson(url,headers,body){return new Promise((resolve,reject)=>{const request=httpRequest(url,{method:'POST',headers},response=>{let text='';response.setEncoding('utf8');response.on('data',chunk=>text+=chunk);response.on('end',()=>resolve({status:response.statusCode,data:JSON.parse(text)}));});request.on('error',reject);request.end(body);});}

async function fixture(enabled=true,cloudRealtime=false,attestation={}){
 const directory=await mkdtemp(join(tmpdir(),'alpha-voice-bridge-')),tokenFile=join(directory,'token');await writeFile(tokenFile,root,{mode:0o600});
 const calls=[];let mode='ok',upgrades=0;const rendererHeaders=[];
 const runtimeSockets=new Set();const runtime=createServer();runtime.on('upgrade',(req,socket)=>{runtimeSockets.add(socket);socket.once('close',()=>runtimeSockets.delete(socket));upgrades++;if(req.url.startsWith('/ws?'))rendererHeaders.push({url:req.url,authorization:req.headers.authorization});assert.equal(req.headers.origin,runtimeOrigin);const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);socket.on('error',()=>{});socket.on('data',data=>socket.write(data));});
 await new Promise(r=>runtime.listen(0,'127.0.0.1',r));const runtimeOrigin=`http://127.0.0.1:${runtime.address().port}`;
 const request=async(url,input)=>{const path=new URL(url).pathname;calls.push({url,input});
  if(path==='/api/auth/status')return Response.json({instanceId:'fixture'});
  if(path==='/api/auth/pair-code')return Response.json({code:'fixture'});
  if(path==='/api/auth/pair')return Response.json({access:'owner',token:paired,instanceId:'fixture',identityId:owner});
  assert.equal(input.headers.Authorization,'Bearer '+paired);
  if(path==='/api/auth/me')return Response.json({identity:{id:owner},access:{role:'OWNER'},session:{id:paired,expiresAt:Date.now()+600000}});
  if(mode==='error')return Response.json({code:'voice_owner_session_required'},{status:403});
  if(path.endsWith('/health'))return Response.json({ready:true,agentId:agent,conversationId:mode==='wrong-health'?randomUUID():conversation,...attestation});
  if(path.endsWith('/consent'))return Response.json({consentNonce:nonce,expiresAt:Date.now()+120000});
  if(path.endsWith('/revoke'))return Response.json({revoked:true});
  const sessionId=randomUUID();return Response.json({sessionId,token:voiceToken,expiresAt:mode==='expired'?Date.now()-1:Date.now()+120000,wsUrl:`${mode==='foreign'?'ws://other.invalid':runtimeOrigin.replace('http:','ws:')}${BASE}/ws?sessionId=${sessionId}`,uplink:{codecs:['pcm16']},downlink:{codecs:['pcm16']},iceServers:null,...(mode==='secret'?{apiKey:'never-return'}:{})});
 };
 const handler=createLocalAgentDevHandler({origin:runtimeOrigin,tokenFile,request,cartesiaEnabled:enabled,cloudRealtimeEnabled:cloudRealtime}),server=createServer(handler);server.on('upgrade',(req,socket,head)=>void handler.upgrade(req,socket,head));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const call=async (input,hostOverride)=>{if(hostOverride)return requestJson(origin,{Host:hostOverride,Origin:'http://'+hostOverride,'Content-Type':'application/json','X-Alpha-Local-Agent':'1'},JSON.stringify({ownerId:owner,headers:{Accept:'application/json'},...input}));const response=await fetch(origin,{method:'POST',headers:{Origin:hostOverride?`http://${hostOverride}`:origin,...(hostOverride?{Host:hostOverride}:{}),'Content-Type':'application/json','X-Alpha-Local-Agent':'1'},body:JSON.stringify({ownerId:owner,headers:{Accept:'application/json'},...input})});return {status:response.status,data:await response.json()};};
 return {call,calls,origin,tokenFile,mode:value=>{mode=value;},rendererHeaders,upgrades:()=>upgrades,close:async()=>{handler.closeVoice();for(const socket of runtimeSockets)socket.destroy();server.closeAllConnections();runtime.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>runtime.close(r))]);await rm(directory,{recursive:true,force:true});}};
}
const mint=()=>({path:BASE,method:'POST',body:JSON.stringify({agentId:agent,conversationId:conversation,consentNonce:nonce,transport:'websocket'})});
test('canonical developer voice controls reuse private owner and project only minted socket ticket',async()=>{
 const f=await fixture();try{
  const health=await f.call({path:`${BASE}/health?conversationId=${conversation}`,method:'GET'});assert.equal(health.data.status,200);
  const consent=await f.call({path:BASE+'/consent',method:'POST',body:'{}'});assert.equal(JSON.parse(consent.data.body).consentNonce,nonce);
  const response=await f.call(mint()),ticket=JSON.parse(response.data.body);assert.equal(ticket.wsUrl,`${f.origin.replace('http:','ws:')}${LOCAL_VOICE_WS_PATH}?sessionId=${ticket.sessionId}`);assert.equal(ticket.token,voiceToken);assert.equal(JSON.stringify(response).includes(paired),false);assert.equal(JSON.stringify(response).includes(root),false);
  const revoked=await f.call({path:`${BASE}/${ticket.sessionId}/revoke`,method:'POST',body:'{}'});assert.deepEqual(JSON.parse(revoked.data.body),{revoked:true});
  assert.equal(f.calls.filter(c=>new URL(c.url).pathname==='/api/auth/pair').length,1);
 }finally{await f.close();}
});
test('voice gate, malformed controls, foreign mint, expiry, unknown fields and wrong owner fail closed',async()=>{
 const off=await fixture(false);try{assert.equal((await off.call(mint())).status,400);assert.equal(off.calls.length,0);}finally{await off.close();}
 const f=await fixture();try{
  for(const input of [{path:BASE+'/health?conversationId=bad',method:'GET'},{...mint(),body:JSON.stringify({brain:'external'})},{...mint(),headers:{Authorization:'secret'}},{path:BASE+'/consent',method:'GET'},{path:BASE+'/ws',method:'GET'}])assert.equal((await f.call(input)).status,400);
  assert.equal(f.calls.length,0);
  assert.equal((await f.call({...mint(),ownerId:'other'})).status,409);
  for(const mode of ['foreign','expired','secret']){f.mode(mode);const result=await f.call(mint());assert.equal(result.status,503);assert.equal(JSON.stringify(result).includes('never-return'),false);}
  f.mode('wrong-health');assert.equal((await f.call({path:`${BASE}/health?conversationId=${conversation}`,method:'GET'})).status,503);
  f.mode('error');const error=await f.call(mint());assert.equal(error.data.status,403);assert.deepEqual(JSON.parse(error.data.body),{code:'voice_owner_session_required'});
 }finally{await f.close();}
});
function upgrade(url,origin,hostOverride){return new Promise((resolve,reject)=>{const req=httpRequest(url.replace('ws:','http:'),{headers:{Origin:origin,...(hostOverride?{Host:hostOverride}:{}),Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':'dGhlIHNhbXBsZSBub25jZQ=='}});req.on('upgrade',(response,socket)=>resolve({status:response.statusCode,socket}));req.on('response',response=>{response.resume();resolve({status:response.statusCode});});req.on('error',reject);req.end();});}
test('same-origin owned minted upgrade is single use; revoke and credential rollover close its tunnel',async()=>{
 const f=await fixture();try{
  const ticket=JSON.parse((await f.call(mint())).data.body);
  assert.equal((await upgrade(ticket.wsUrl,'https://other.invalid')).status,403);assert.equal(f.upgrades(),0);
  const accepted=await upgrade(ticket.wsUrl,f.origin);assert.equal(accepted.status,101);assert.equal(f.upgrades(),1);
  assert.equal((await upgrade(ticket.wsUrl,f.origin)).status,403);
  const closed=new Promise(r=>accepted.socket.once('close',r));accepted.socket.resume();await f.call({path:`${BASE}/${ticket.sessionId}/revoke`,method:'POST',body:'{}'});await Promise.race([closed,new Promise((_,reject)=>setTimeout(()=>reject(Error('Tunnel close timeout')),1000))]);
  const next=JSON.parse((await f.call(mint())).data.body);await writeFile(f.tokenFile,'2'.repeat(64),{mode:0o600});assert.equal((await upgrade(next.wsUrl,f.origin)).status,403);
 }finally{await f.close();}
});

test('renderer channel uses a single-use same-origin ticket and keeps the paired bearer on the host',async()=>{
 const f=await fixture();try{const clientId=randomUUID();
 const result=await f.call({path:'/api/views/voice-channel',method:'POST',body:JSON.stringify({clientId})});
 assert.equal(result.data.status,200);assert.ok(!JSON.stringify(result).includes(paired));
 const {wsUrl,expiresAt}=JSON.parse(result.data.body);assert.ok(wsUrl.includes('/__alpha-local-renderer/ws?'));assert.ok(expiresAt>Date.now()&&expiresAt<=Date.now()+120000);
 assert.equal((await upgrade(wsUrl,'https://other.invalid')).status,403);
 const connected=await upgrade(wsUrl,f.origin);assert.equal(connected.status,101);
 assert.deepEqual(f.rendererHeaders,[{url:'/ws?clientId='+clientId,authorization:'Bearer '+paired}]);
 assert.equal((await upgrade(wsUrl,f.origin)).status,403);connected.socket.destroy();
 }finally{await f.close();}
});

test('canonical message-history pagination is allowed with bounded cursor fields only',()=>{
 const base='/api/conversations/'+randomUUID()+'/messages';
 for(const suffix of ['?limit=200','?before=1792101404606&beforeId='+randomUUID()+'&limit=200','?before=1792101404606&beforeId=1cba3bf9-56fd-086e-b8bf-c2711d9bcffb&limit=200'])assert.equal(localAgentPathAllowed(base+suffix),true);
 for(const suffix of ['?limit=201','?limit=1&limit=2','?token=secret','?before=123','?before=123&beforeId=not-a-uuid','?limit=-1','?limit=1%26token=secret'])assert.equal(localAgentPathAllowed(base+suffix),false);
});

test('renderer renewal issues a fresh single-use short ticket; expired and old-root replacements fail closed',async()=>{
 const f=await fixture();const realNow=Date.now;
 try{
  const clientId=randomUUID(),issue=async()=>JSON.parse((await f.call({path:'/api/views/voice-channel',method:'POST',body:JSON.stringify({clientId})})).data.body);
  const first=await issue(),second=await issue();assert.notEqual(first.wsUrl,second.wsUrl);assert.ok(first.expiresAt<=realNow()+120000&&second.expiresAt<=realNow()+120000);
  const accepted=await upgrade(first.wsUrl,f.origin);assert.equal(accepted.status,101);
  Date.now=()=>second.expiresAt+1;assert.equal((await upgrade(second.wsUrl,f.origin)).status,403);Date.now=realNow;
  const replacement=await issue();await writeFile(f.tokenFile,'2'.repeat(64),{mode:0o600});assert.equal((await upgrade(replacement.wsUrl,f.origin)).status,403);
  assert.ok(f.rendererHeaders.every(row=>row.authorization===`Bearer ${paired}`));accepted.socket.destroy();
 }finally{Date.now=realNow;await f.close();}
});

test('Cloud realtime bridge shares owned voice/renderer controls but requires genuine route attestation',async()=>{const f=await fixture(false,true,{speechRoute:'cloud',speechProvider:'cartesia',providerAdmission:'at-session-start'});try{const result=await f.call({path:BASE+'/health?conversationId='+conversation,method:'GET'});assert.equal(result.data.status,200);assert.equal(JSON.parse(result.data.body).speechRoute,'cloud');const minted=await f.call(mint());assert.equal(minted.data.status,200);assert.match(JSON.parse(minted.data.body).wsUrl,/__alpha-local-voice/);}finally{await f.close();}});
test('Cloud realtime rejects absent/direct provider metadata, and contradictory flags fail before enrollment',async()=>{for(const attestation of [{},{speechRoute:'direct',speechProvider:'cartesia',providerAdmission:'at-session-start'},{speechRoute:'cloud',speechProvider:'cartesia',providerAdmission:'deferred'}]){const f=await fixture(false,true,attestation);try{assert.notEqual((await f.call({path:BASE+'/health?conversationId='+conversation,method:'GET'})).data.status,200);}finally{await f.close();}}assert.throws(()=>createLocalAgentDevHandler({origin:'http://127.0.0.1:9',tokenFile:'unused',cartesiaEnabled:true,cloudRealtimeEnabled:true}),/cannot both/);});

test('localhost HTTP and websocket aliases remain exact-origin and single-use',async()=>{
 const f=await fixture();try{
  const authority='localhost:'+new URL(f.origin).port,localOrigin='http://'+authority;
  assert.equal((await f.call({path:BASE+'/health?conversationId='+conversation,method:'GET'},authority)).data.status,200);
  const ticket=JSON.parse((await f.call(mint(),authority)).data.body),wire=ticket.wsUrl.replace('localhost','127.0.0.1');
  assert.equal((await upgrade(wire,f.origin,authority)).status,403);
  const accepted=await upgrade(wire,localOrigin,authority);assert.equal(accepted.status,101);assert.equal((await upgrade(wire,localOrigin,authority)).status,403);accepted.socket.destroy();
 }finally{await f.close();}
});
test('localhost does not widen HTTP host or origin trust',async()=>{
 const f=await fixture();try{
  const port=new URL(f.origin).port,input={path:BASE+'/health?conversationId='+conversation,method:'GET'};
  for(const [host,origin] of [['localhost:'+port,f.origin],['127.0.0.1:'+port,'http://localhost:'+port],['localhost.evil:'+port,'http://localhost.evil:'+port],['127.0.0.1.evil:'+port,'http://127.0.0.1.evil:'+port],['example.com:'+port,'http://example.com:'+port],['localhost:'+port,'http://localhost:1']]){
   const r=await requestJson(f.origin,{Host:host,Origin:origin,'Content-Type':'application/json','X-Alpha-Local-Agent':'1'},JSON.stringify({ownerId:owner,...input}));assert.equal(r.status,403);
  }
  assert.equal(f.calls.length,0);
 }finally{await f.close();}
});
