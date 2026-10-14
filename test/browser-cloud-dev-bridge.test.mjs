import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
if(!process.execArgv.some((arg,i)=>arg==='--import'&&process.execArgv[i+1]==='tsx')){const child=spawnSync(process.execPath,['--import','tsx',process.argv[1]],{stdio:'inherit',timeout:60000});if(child.error)throw child.error;process.exit(child.status??1);}
const {createBrowserCloudDevHandler}=await import('../scripts/browser-cloud-dev-bridge.ts');
const {CloudProtocol}=await import('../apps/app/src/runtime/cloud-protocol.ts');
const {BrowserCloudConnection}=await import('../apps/app/src/browser/cloud-connection.ts');
const owner='11111111-1111-4111-8111-111111111111',org='22222222-2222-4222-8222-222222222222',credentialId='33333333-3333-4333-8333-333333333333',reference='browser-cloud-reference:44444444-4444-4444-8444-444444444444';
const secret='synthetic-cloud-credential-not-a-real-key';
async function fixture(){
 const profile=await mkdtemp(join(tmpdir(),'alpha-browser-cloud-')),file=join(profile,'existing-secret');await writeFile(file,secret,{mode:0o600});
 const seed={environment:'production',credentialFile:file,credentialSha256:createHash('sha256').update(secret).digest('hex'),userId:owner,organizationId:org,credentialReference:reference,credentialId};await writeFile(join(profile,'initial-credential.json'),JSON.stringify(seed),{mode:0o600});
 const calls=[];let response=async()=>new Response('{}'),pollResponse=async()=>Response.json({status:'authenticated',apiKey:secret});const session=randomUUID();
 const request=async(url,input={})=>{
  const path=new URL(url).pathname;calls.push({url,input});
  if(path==='/api/auth/cli-session')return Response.json({sessionId:session,expiresAt:new Date(Date.now()+60000).toISOString()});
  if(path==='/api/auth/cli-session/'+session)return pollResponse();
  assert.equal(new Headers(input.headers).get('Authorization'),'Bearer '+secret);
  if(path==='/api/v1/user')return Response.json({success:true,data:{id:owner,organization_id:org,email:'owned@example.invalid'}});
  if(path==='/api/v1/billing/limits')return Response.json({success:true,data:{v2:{subscription:{status:'available',value:{planKey:'plus_monthly',state:'active'}}}}});
  if(path==='/api/v1/subscription/redeem'){const body=JSON.parse(input.body);return Response.json({success:true,replayed:false,grant:{id:'synthetic-grant',endsAt:'2027-04-14T00:00:00.000Z',paidPlanTakesPrecedence:false,echo:body.code===undefined}});}
  return response(url,input);
 };
 let server,origin;
 const start=async()=>{server=createServer(createBrowserCloudDevHandler({profile,request}));await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;};await start();
 const send=(data,options={})=>fetch(origin,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Alpha-Browser-Cloud':'1',...(options.headers||{})},body:JSON.stringify(data),signal:options.signal});
 const rpc=async data=>{const r=await send(data);return {status:r.status,data:await r.json()};};
 return {profile,file,calls,send,rpc,setResponse:fn=>{response=fn;},setPollResponse:fn=>{pollResponse=fn;},origin:()=>origin,session,restart:async()=>{await new Promise(r=>server.close(r));await start();},close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});}};
}
test('existing Mac credential becomes a real canonical identity/credit reference, never a browser bearer',async()=>{
 const f=await fixture();try{
  const stored=await f.rpc({operation:'secureRead',slot:'cloud:production'});assert.equal(stored.status,200);assert.equal(stored.data.value.includes(secret),false);const credential=JSON.parse(stored.data.value);assert.equal(credential.credentialReference,reference);assert.equal(credential.credentialId,credentialId);assert.equal(credential.token,undefined);
  const result=await f.rpc({operation:'request',environment:'production',requestId:randomUUID(),input:{url:'https://api.eliza.app/api/v1/user',method:'GET',headers:{Accept:'application/json'},credentialReference:reference}});assert.equal(result.data.status,200);assert.equal(result.data.data.data.id,owner);assert.equal(result.data.data.data.organization_id,org);
  const limits=await f.rpc({operation:'request',environment:'production',requestId:randomUUID(),input:{url:'https://api.eliza.app/api/v1/billing/limits',method:'GET',headers:{Accept:'application/json'},credentialReference:reference}});assert.equal(limits.data.data.data.v2.subscription.value.state,'active');
  const redeemed=await f.rpc({operation:'request',environment:'production',requestId:randomUUID(),input:{url:'https://api.eliza.app/api/v1/subscription/redeem',method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({code:'SYNTHETIC0000CODE',idempotencyKey:randomUUID()}),credentialReference:reference}});assert.equal(redeemed.data.data.success,true);
  for(const body of [{code:'SYNTHETIC0000CODE'},{code:'SYNTHETIC0000CODE',idempotencyKey:'short'},{code:'SYNTHETIC0000CODE',idempotencyKey:randomUUID(),extra:1}]){const refused=await f.rpc({operation:'request',environment:'production',requestId:randomUUID(),input:{url:'https://api.eliza.app/api/v1/subscription/redeem',method:'POST',headers:{Accept:'application/json'},body:JSON.stringify(body),credentialReference:reference}});assert.ok([400,409].includes(refused.status),JSON.stringify(body));}
  assert.equal(f.calls.filter(call=>new URL(call.url).pathname==='/api/v1/subscription/redeem').length,1);assert.equal((await stat(f.profile)).mode&0o077,0);
 }finally{await f.close();}
});
test('negative origins, methods, authorities, routes, private bearer headers and wrong reference never dispatch',async()=>{
 const f=await fixture();try{
  const before=f.calls.length;assert.equal((await f.send({operation:'secureRead',slot:'cloud:production'},{headers:{Origin:'https://other.invalid'}})).status,403);
  for(const input of [{url:'https://other.invalid/api/v1/user',method:'GET'},{url:'https://api.eliza.app/api/v1/user',method:'PUT'},{url:'https://api.eliza.app/api/v1/api-keys',method:'POST'},{url:'https://api.eliza.app/api/v1/user?other=1',method:'GET'},{url:'https://api.eliza.app/api/v1/user',method:'GET',credentialReference:'browser-cloud-reference:'+randomUUID()},{url:'https://api.eliza.app/api/v1/user',method:'GET',headers:{Authorization:'Bearer '+secret}}]){
   const r=await f.rpc({operation:'request',environment:'production',requestId:randomUUID(),input:{headers:{Accept:'application/json'},credentialReference:reference,...input}});assert.ok([400,409].includes(r.status));
  }
  assert.equal(f.calls.length,before);
 }finally{await f.close();}
});
test('normal canonical CLI poll claims stay server-private and commit by reference with atomic account generation',async()=>{
 const f=await fixture();try{
  const account=new BrowserCloudConnection(),original=globalThis.fetch;globalThis.fetch=(url,options={})=>original(f.origin(),{...options,headers:{...options.headers,Origin:f.origin()}});
  try{
   const old=await account.secureRead({slot:'cloud:production'});assert.equal(JSON.parse(old.value).credentialReference,reference);
   const store={acceptsReferences:true,read:async()=>{const r=await account.secureRead({slot:'cloud:production'});return r.value?JSON.parse(r.value):null;},write:async(_env,value)=>account.secureWrite({slot:'cloud:production',value:JSON.stringify({...value,credentialId:randomUUID()})}),clear:async()=>account.secureRemove({slot:'cloud:production'})};
   const client=new CloudProtocol('production',input=>account.request({...input,requestId:randomUUID(),body:input.body===undefined?undefined:JSON.stringify(input.body)}),store,async()=>{});
   await client.login(new AbortController().signal);const credential=await store.read();assert.equal(credential.token,undefined);assert.match(credential.credentialReference,/^browser-cloud-reference:/);assert.notEqual(credential.credentialReference,reference);assert.deepEqual(await client.identity(new AbortController().signal),{userId:owner,organizationId:org,email:'owned@example.invalid'});
   assert.equal(JSON.stringify(credential).includes(secret),false);const privateState=JSON.parse(await readFile(join(f.profile,'credentials.json'),'utf8'));assert.equal(privateState.production.token,secret);assert.equal((await stat(join(f.profile,'credentials.json'))).mode&0o077,0);
   await client.disconnect();await f.restart();assert.equal((await f.rpc({operation:'secureRead',slot:'cloud:production'})).data.value,null);
  }finally{globalThis.fetch=original;}
 }finally{await f.close();}
});
test('Cloud STT uses multipart canonical audio route, TTS uses canonical JSON; no local speech route exists',async()=>{
 const f=await fixture();try{
  f.setResponse(async(url,input)=>{if(url.endsWith('/voice/stt')){assert.ok(input.body instanceof FormData);assert.equal(input.body.get('audio').type,'audio/webm');return Response.json({transcript:'Synthetic fixture transcript'});}assert.equal(url,'https://api.eliza.app/api/v1/voice/tts');assert.deepEqual(JSON.parse(input.body),{text:'Synthetic fixture text',format:'mp3'});return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'audio/mpeg'}});});
  const form=new FormData();for(const [k,v]of Object.entries({operation:'stt',environment:'production',credentialReference:reference,credentialId,requestId:randomUUID()}))form.append(k,v);form.append('audio',new Blob(['synthetic closed fixture'],{type:'audio/webm'}),'fixture.webm');
  const response=await fetch(f.origin(),{method:'POST',headers:{Origin:f.origin(),'X-Alpha-Browser-Cloud':'1'},body:form});assert.equal(response.status,200);assert.deepEqual(await response.json(),{text:'Synthetic fixture transcript',local:false});
  const tts=await f.send({operation:'tts',environment:'production',credentialReference:reference,credentialId,requestId:randomUUID(),text:'Synthetic fixture text'});assert.equal(tts.status,200);assert.equal(tts.headers.get('Content-Type'),'audio/mpeg');assert.equal((await tts.arrayBuffer()).byteLength,3);assert.equal(f.calls.filter(x=>x.url.includes('voice')).length,2);assert.ok(f.calls.every(x=>!x.url.includes('whisper')&&!x.url.includes('kokoro')));
 }finally{await f.close();}
});
test('wrong account, logout and server restart invalidate old references without deleting another account',async()=>{
 const f=await fixture();try{
  const wrong=await f.rpc({operation:'tts',environment:'production',credentialReference:reference,credentialId:randomUUID(),requestId:randomUUID(),text:'Synthetic'});assert.equal(wrong.status,409);assert.equal(f.calls.length,0);
  const stale=await f.rpc({operation:'secureRemove',slot:'cloud:production',previousReference:'browser-cloud-reference:'+randomUUID()});assert.equal(stale.status,400);assert.notEqual((await f.rpc({operation:'secureRead',slot:'cloud:production'})).data.value,null);
  assert.equal((await f.rpc({operation:'secureRemove',slot:'cloud:production',previousReference:reference})).status,200);await f.restart();assert.equal((await f.rpc({operation:'secureRead',slot:'cloud:production'})).data.value,null);
  assert.equal((await f.rpc({operation:'tts',environment:'production',credentialReference:reference,credentialId,requestId:randomUUID(),text:'Synthetic'})).status,401);
 }finally{await f.close();}
});
test('cancel closes an in-flight Cloud audio stream; stale account audio cannot be returned',async()=>{
 const f=await fixture();try{
  const entered=Promise.withResolvers(),cancelled=Promise.withResolvers();f.setResponse(async(_url,input)=>{entered.resolve();input.signal.addEventListener('abort',()=>cancelled.resolve(),{once:true});return new Response(new ReadableStream({start(c){input.signal.addEventListener('abort',()=>c.error(new DOMException('Cancelled','AbortError')),{once:true});c.enqueue(new Uint8Array([1]));}}),{headers:{'Content-Type':'audio/mpeg'}});});
  const id=randomUUID(),pending=f.send({operation:'tts',environment:'production',credentialReference:reference,credentialId,requestId:id,text:'Synthetic'});await entered.promise;await f.rpc({operation:'cancel',requestId:id});await cancelled.promise;const r=await pending;assert.equal(r.status,409);assert.equal((await r.json()).error,'Cloud operation cancelled');
 }finally{await f.close();}
});

test('native production Cloud stores never admit a development reference as a bearer',async()=>{
 let writes=0;const id=randomUUID(),client=new CloudProtocol('production',async input=>({status:200,data:input.url.endsWith('/api/auth/cli-session')?{sessionId:id,expiresAt:new Date(Date.now()+60000).toISOString()}:{status:'authenticated',credentialReference:reference}}),{read:async()=>null,write:async()=>{writes++;},clear:async()=>{}},async()=>{});
 await assert.rejects(client.login(new AbortController().signal),e=>e.code==='credential-consumed');assert.equal(writes,0);
});

async function claim(f){
 await f.rpc({operation:'request',environment:'production',requestId:randomUUID(),input:{url:'https://api.eliza.app/api/auth/cli-session',method:'POST',headers:{Accept:'application/json'},body:'{}'}});
 return f.rpc({operation:'request',environment:'production',requestId:randomUUID(),input:{url:'https://api.eliza.app/api/auth/cli-session/'+f.session,method:'GET',headers:{Accept:'application/json'}}});
}
test('login claim cannot cross Cloud environments or resurrect after logout',async()=>{
 const f=await fixture();try{
  const result=await claim(f),ref=result.data.data.credentialReference;assert.match(ref,/^browser-cloud-reference:/);
  const value=JSON.stringify({credentialReference:ref,credentialId:randomUUID(),userId:owner,organizationId:org});
  assert.equal((await f.rpc({operation:'secureWrite',slot:'cloud:staging',previousReference:null,value})).status,409);
  assert.equal((await f.rpc({operation:'secureRead',slot:'cloud:staging'})).data.value,null);
  assert.equal((await f.rpc({operation:'secureRemove',slot:'cloud:production',previousReference:reference})).status,200);
  assert.equal((await f.rpc({operation:'secureWrite',slot:'cloud:production',previousReference:null,value})).status,409);
  assert.equal((await f.rpc({operation:'secureRead',slot:'cloud:production'})).data.value,null);
 }finally{await f.close();}
});
for(const change of ['logout','replacement'])test('in-flight login poll cannot publish a claim after '+change,async()=>{
 const f=await fixture();try{
  const entered=Promise.withResolvers(),release=Promise.withResolvers();f.setPollResponse(async()=>{entered.resolve();await release.promise;return Response.json({status:'authenticated',apiKey:secret});});
  const pending=claim(f);await entered.promise;
  let replacement;
  if(change==='logout')await f.rpc({operation:'secureRemove',slot:'cloud:production',previousReference:reference});
  else{replacement={credentialReference:'browser-cloud-reference:'+randomUUID(),credentialId:randomUUID(),token:secret,userId:owner,organizationId:org};await writeFile(join(f.profile,'credentials.json'),JSON.stringify({production:replacement}),{mode:0o600});}
  release.resolve();const result=await pending;assert.equal(result.status,409);assert.equal(result.data.credentialReference,undefined);
  const current=(await f.rpc({operation:'secureRead',slot:'cloud:production'})).data.value;assert.equal(current===null?null:JSON.parse(current).credentialReference,replacement?.credentialReference??null);
 }finally{await f.close();}
});
test('expired pending login references cannot be committed to the private store',async()=>{
 const f=await fixture(),clock=Date.now;try{
  const result=await claim(f),ref=result.data.data.credentialReference;Date.now=()=>clock()+120000;
  const write=await f.rpc({operation:'secureWrite',slot:'cloud:production',previousReference:reference,value:JSON.stringify({credentialReference:ref,credentialId:randomUUID(),userId:owner,organizationId:org})});assert.equal(write.status,410);
  assert.equal(JSON.parse((await f.rpc({operation:'secureRead',slot:'cloud:production'})).data.value).credentialReference,reference);
 }finally{Date.now=clock;await f.close();}
});

test('empty-store logout invalidates an already issued login claim',async()=>{
 const f=await fixture();try{
  await f.rpc({operation:'secureRemove',slot:'cloud:production',previousReference:reference});
  const result=await claim(f),ref=result.data.data.credentialReference;
  assert.equal((await f.rpc({operation:'secureRemove',slot:'cloud:production',previousReference:null})).status,200);
  const write=await f.rpc({operation:'secureWrite',slot:'cloud:production',previousReference:null,value:JSON.stringify({credentialReference:ref,credentialId:randomUUID(),userId:owner,organizationId:org})});assert.equal(write.status,409);
  assert.equal((await f.rpc({operation:'secureRead',slot:'cloud:production'})).data.value,null);
 }finally{await f.close();}
});
test('empty-store logout retires an in-flight login poll without NULL-state resurrection',async()=>{
 const f=await fixture();try{
  await f.rpc({operation:'secureRemove',slot:'cloud:production',previousReference:reference});
  const entered=Promise.withResolvers(),release=Promise.withResolvers();f.setPollResponse(async()=>{entered.resolve();await release.promise;return Response.json({status:'authenticated',apiKey:secret});});
  const pending=claim(f);await entered.promise;await f.rpc({operation:'secureRemove',slot:'cloud:production',previousReference:null});release.resolve();const result=await pending;assert.equal(result.status,409);assert.equal(result.data.credentialReference,undefined);
  assert.equal((await f.rpc({operation:'secureRead',slot:'cloud:production'})).data.value,null);
 }finally{await f.close();}
});

test('managed Google bridge admits combined consent and encoded owner reads without exposing credentials',async()=>{
 const f=await fixture(),grant=randomUUID();try{
  f.setResponse(async(url,input)=>{assert.equal(input.redirect,'error');const parsed=new URL(url);
   if(parsed.pathname.endsWith('/connect/initiate')){assert.deepEqual(JSON.parse(input.body),{side:'owner',capabilities:['google.basic_identity','google.gmail.triage','google.calendar.read']});return Response.json({authUrl:'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic'});}
   if(parsed.pathname.endsWith('/disconnect')){assert.deepEqual(JSON.parse(input.body),{side:'owner',connectionId:grant});return Response.json({ok:true});}
   return Response.json({fixture:true,query:Object.fromEntries(parsed.searchParams)});
  });
  const call=(route,method='GET',body,environment='production')=>f.rpc({operation:'request',environment,requestId:randomUUID(),input:{url:(environment==='production'?'https://api.eliza.app':'https://api-staging.eliza.app')+route,method,headers:{Accept:'application/json'},credentialReference:reference,...(body===undefined?{}:{body:JSON.stringify(body)})}});
  const consent=await call('/api/v1/eliza/google/connect/initiate','POST',{side:'owner',capabilities:['google.basic_identity','google.gmail.triage','google.calendar.read']});assert.equal(consent.data.status,200);assert.equal(JSON.stringify(consent).includes(secret),false);
  assert.equal((await call('/api/v1/eliza/google/disconnect','POST',{side:'owner',connectionId:grant})).data.data.ok,true);
  const feed=new URLSearchParams({side:'owner',grantId:grant,calendarId:'owner+calendar@example.invalid',timeMin:'2026-10-13T00:00:00-07:00',timeMax:'2026-10-14T00:00:00-07:00',timeZone:'America/Los_Angeles'});
  const result=await call('/api/v1/eliza/google/calendar/feed?'+feed);assert.equal(result.status,200);assert.equal(result.data.data.query.calendarId,'owner+calendar@example.invalid');
  const search=new URLSearchParams({side:'owner',grantId:grant,query:'from:owner@example.invalid after:2026/10/01',maxResults:'25',pageToken:'opaque+/cursor='});
  assert.equal((await call('/api/v1/eliza/google/gmail/search?'+search)).data.data.query.pageToken,'opaque+/cursor=');
  for(const route of [`calendar/calendars?side=owner&grantId=${grant}`,`gmail/read?side=owner&grantId=${grant}&messageId=mail%2Fid`,`gmail/inbox-v1/capabilities?grantId=${grant}`,`gmail/inbox-v1/thread?grantId=${grant}&threadId=one&offset=25&historyId=old`,`gmail/inbox-v1/attachment?grantId=${grant}&messageId=one&partId=0.1&historyId=old`,`gmail/inbox-v1/drafts?grantId=${grant}`,`gmail/inbox-v1/draft?grantId=${grant}&draftId=one&content=1`])assert.equal((await call('/api/v1/eliza/google/'+route)).status,200,route);
  const seed=JSON.parse(await readFile(join(f.profile,'initial-credential.json'),'utf8'));await writeFile(join(f.profile,'credentials.json'),JSON.stringify({staging:seed}),{mode:0o600});
  assert.equal((await call(`/api/v1/eliza/google/calendar/calendars?side=owner&grantId=${grant}`,'GET',undefined,'staging')).status,200);
  assert.equal(new URL(f.calls.at(-1).url).origin,'https://api-staging.eliza.app');
 }finally{await f.close();}
});
test('managed Google bridge refuses scope escalation, mutations, malformed query and stale or secret responses',async()=>{
 const f=await fixture(),grant=randomUUID();try{
  const call=(route,method='GET',body)=>f.rpc({operation:'request',environment:'production',requestId:randomUUID(),input:{url:'https://api.eliza.app'+route,method,headers:{Accept:'application/json'},credentialReference:reference,...(body===undefined?{}:{body:JSON.stringify(body)})}});
  const before=f.calls.length;
  for(const [route,method,body] of [
   ['/api/v1/eliza/google/connect/initiate','POST',{side:'agent',capabilities:['google.basic_identity']}],
   ['/api/v1/eliza/google/connect/initiate','POST',{side:'owner',capabilities:['google.basic_identity','google.gmail.manage']}],
   ['/api/v1/eliza/google/connect/initiate','POST',{side:'owner',capabilities:['google.basic_identity'],redirectUrl:'https://other.invalid'}],
   ['/api/v1/eliza/google/disconnect','POST',{side:'owner'}],
   ['/api/v1/eliza/google/disconnect','POST',{side:'owner',connectionId:'bad'}],
   ['/api/v1/eliza/google/calendar/events','POST',{side:'owner',grantId:grant}],
   ['/api/v1/eliza/google/gmail/inbox-v1/operations','POST',{grantId:grant}],
   [`/api/v1/eliza/google/calendar/calendars?side=agent&grantId=${grant}`],
   [`/api/v1/eliza/google/calendar/calendars?side=owner&side=agent&grantId=${grant}`],
   [`/api/v1/eliza/google/calendar/calendars?side=owner&grantId=${grant}&url=https%3A%2F%2Fother.invalid`],
   [`/api/v1/eliza/google/%63alendar/calendars?side=owner&grantId=${grant}`],
   [`/api/v1/eliza/google/x/../calendar/calendars?side=owner&grantId=${grant}`],
   [`/api/v1/eliza/google/gmail/search?side=owner&grantId=${grant}&query=a&maxResults=1000`],
  ])assert.equal((await call(route,method,body)).status,400,route);
  assert.equal(f.calls.length,before,'invalid requests never reach Cloud');
  const route=`/api/v1/eliza/google/calendar/calendars?side=owner&grantId=${grant}`;
  f.setResponse(async()=>Response.json({accessToken:'provider-secret'}));assert.equal((await call(route)).status,400);
  f.setResponse(async()=>new Response(' '.repeat(16*1024*1024+1)));assert.equal((await call(route)).status,400);
  const entered=Promise.withResolvers(),release=Promise.withResolvers();f.setResponse(async()=>{entered.resolve();await release.promise;return Response.json([{calendarId:'one'}]);});
  const pending=call(route);await entered.promise;await f.rpc({operation:'secureRemove',slot:'cloud:production',previousReference:reference});release.resolve();
  assert.equal((await pending).status,409,'logout prevents publishing an in-flight calendar result');
 }finally{await f.close();}
});
