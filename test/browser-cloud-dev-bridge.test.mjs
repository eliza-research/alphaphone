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
test('Cloud browser login admits only one session and the optional fixed Alpha hint',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'window'),opened=[];
 Object.defineProperty(globalThis,'window',{configurable:true,value:{open:(url,target)=>{const popup={opener:'fixture'};opened.push({url,target,popup});return popup;}}});
 try{
  const connection=new BrowserCloudConnection(),session='11111111-1111-4111-8111-111111111111';
  for(const host of ['eliza.app','staging.eliza.app'])for(const hint of ['', '&app=alpha']){
   const url=`https://${host}/auth/cli-login?session=${session}${hint}`;
   await connection.openExternal({url,requestId:randomUUID()});
   assert.equal(opened.at(-1).url,url);assert.equal(opened.at(-1).target,'_blank');assert.equal(opened.at(-1).popup.opener,null);
  }
  const count=opened.length,base=`https://eliza.app/auth/cli-login?session=${session}`;
  for(const url of [
   base+'&app=other',base+'&app=Alpha',base+'&app=',base+'&app=alpha&app=alpha',base+'&app=alpha&app=other',
   base+'&session='+session,base+'&app=alpha&session='+session,base+'&app=alpha&returnTo=https://attacker.invalid',
   'https://eliza.app/auth/cli-login?app=alpha',base.replace(session,'invalid')+'&app=alpha',
   base.replace('https:','http:')+'&app=alpha',base.replace('eliza.app','attacker.invalid')+'&app=alpha',
   base.replace('eliza.app','user@eliza.app')+'&app=alpha',base.replace('eliza.app','eliza.app:444')+'&app=alpha',
   base.replace('/auth/cli-login','/other')+'&app=alpha',base+'&app=alpha#fragment',
  ])await assert.rejects(connection.openExternal({url,requestId:randomUUID()}),/Unsupported Cloud browser destination/);
  assert.equal(opened.length,count,'refused destinations never open a window');
 }finally{if(descriptor)Object.defineProperty(globalThis,'window',descriptor);else delete globalThis.window;}
});
async function fixture(resident,environment){
 const profile=await mkdtemp(join(tmpdir(),'alpha-browser-cloud-')),file=join(profile,'existing-secret');await writeFile(file,secret,{mode:0o600});
 const seed={environment:'production',credentialFile:file,credentialSha256:createHash('sha256').update(secret).digest('hex'),userId:owner,organizationId:org,credentialReference:reference,credentialId};await writeFile(join(profile,'initial-credential.json'),JSON.stringify(seed),{mode:0o600});
 const calls=[],diagnostics=[];let signIn=null,response=async()=>new Response('{}'),pollResponse=async()=>Response.json({status:'authenticated',apiKey:secret});const session=randomUUID();
 const request=async(url,input={})=>{
  const path=new URL(url).pathname;calls.push({url,input});
  if(signIn){const handled=await signIn(path,input);if(handled)return handled;}
  if(path==='/api/auth/cli-session')return Response.json({sessionId:session,expiresAt:new Date(Date.now()+60000).toISOString()});
  if(path==='/api/auth/cli-session/'+session)return pollResponse();
  assert.equal(new Headers(input.headers).get('Authorization'),'Bearer '+secret);
  if(path==='/api/v1/user')return Response.json({success:true,data:{id:owner,organization_id:org,email:'owned@example.invalid'}});
  if(path==='/api/v1/billing/limits')return Response.json({success:true,data:{v2:{subscription:{status:'available',value:{planKey:'plus_monthly',state:'active'}}}}});
  if(path==='/api/v1/subscription/redeem'){const body=JSON.parse(input.body);return Response.json({success:true,replayed:false,grant:{id:'synthetic-grant',endsAt:'2027-04-14T00:00:00.000Z',paidPlanTakesPrecedence:false,echo:body.code===undefined}});}
  return response(url,input);
 };
 let server,origin,host;
 const start=async()=>{host=createBrowserCloudDevHandler({profile,request,resident,environment,diagnostic:event=>diagnostics.push(event)});server=createServer(host);await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;};await start();
 const send=(data,options={})=>fetch(origin,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Alpha-Browser-Cloud':'1',...(options.headers||{})},body:JSON.stringify(data),signal:options.signal});
 const rpc=async data=>{const r=await send(data);return {status:r.status,data:await r.json()};};
 return {profile,file,calls,diagnostics,send,rpc,host:()=>host,setSignIn:fn=>{signIn=fn;},setResponse:fn=>{response=fn;},setPollResponse:fn=>{pollResponse=fn;},origin:()=>origin,session,restart:async()=>{await new Promise(r=>server.close(r));await start();},close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});}};
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
test('managed Google bridge preserves prepared Gmail review, digest dispatch, and receipt routes',async()=>{
 const f=await fixture(),grant=randomUUID(),requestId=randomUUID(),reviewDigest='a'.repeat(64),root='/api/v1/eliza/google/gmail/inbox-v1/operations';try{
  f.setResponse(async(_url,input)=>Response.json({forwarded:input.body?JSON.parse(input.body):null}));
  const call=(route,method='GET',body)=>f.rpc({operation:'request',environment:'production',requestId:randomUUID(),input:{url:'https://api.eliza.app'+route,method,headers:{Accept:'application/json'},credentialReference:reference,...(body===undefined?{}:{body:JSON.stringify(body)})}});
  const proposal={kind:'send',mode:'compose',to:['self@example.invalid'],cc:[],bcc:[],subject:'Synthetic review',bodyText:'A'.repeat(5000),attachments:[]};
  assert.deepEqual((await call(root,'POST',{grantId:grant,requestId,proposal})).data.data.forwarded,{grantId:grant,requestId,proposal});
  assert.equal((await call(root+'/'+requestId+'/dispatch','POST',{grantId:grant,reviewDigest,proposal})).data.status,200);
  assert.equal((await call(root+'/'+requestId+'?grantId='+grant)).data.status,200);
  const attached={...proposal,attachments:[{name:'fixture.pdf',mimeType:'application/pdf',dataBase64:'A'.repeat(3*1024*1024)}]};
  assert.equal((await call(root,'POST',{grantId:grant,requestId:randomUUID(),proposal:attached})).data.status,200,'normal attachment payloads pass the bounded outer JSON envelope');
  const before=f.calls.length;
  for(const [route,method,body] of [
   [root,'POST',{grantId:grant,requestId,proposal,url:'https://elsewhere.invalid'}],
   [root,'POST',{grantId:'bad',requestId,proposal}],
   [root,'POST',{grantId:grant,requestId,proposal:{kind:'delete-all'}}],
   [root+'/'+requestId+'/dispatch','POST',{grantId:grant,proposal}],
   [root+'/'+requestId+'/dispatch','POST',{grantId:grant,reviewDigest:'bad',proposal}],
   [root+'/'+requestId+'?grantId='+grant+'&side=agent','GET'],
   [root+'/'+requestId+'/send','POST',{grantId:grant,reviewDigest,proposal}],
  ])assert.equal((await call(route,method,body)).status,400);
  assert.equal(f.calls.length,before,'invalid dispatches do not reach Cloud');
 }finally{await f.close();}
});
test('managed Google bridge refuses scope escalation, unreviewed mutations, malformed query and stale or secret responses',async()=>{
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
test('a Cloud refusal whose wait is only in Retry-After reaches the redeem retry time (#410)',async()=>{
 const {SubscriptionRedeemError}=await import('../apps/app/src/runtime/subscription-entitlement.ts');
 const store={read:async()=>({token:secret,credentialId,userId:owner,organizationId:org}),write:async()=>{},clear:async()=>{}};
 // Synthetic Anthropic-style 429: no wait in the body, Retry-After from the transport.
 const client=new CloudProtocol('production',async()=>({status:429,data:{type:'error',error:{type:'rate_limit_error',message:'Synthetic'}},retryAfter:'45'}),store,async()=>{});
 await assert.rejects(client.redeemSubscriptionCode('SYNTHETIC0000CODE',randomUUID(),new AbortController().signal),error=>error instanceof SubscriptionRedeemError&&error.code==='rate-limited'&&error.retryAfterMs===45000);
});

// In-app sign-in through the development host (email code): the Steward session, PKCE material and
// the minted key stay in the host; the page receives only the outcome and a reference. Synthetic.
test('development host email sign-in mints a mobile key server-side and commits it by reference',async()=>{
 const f=await fixture();try{
  const steward='synthetic-steward-session-token-0001',minted='eliza_mobile_synthetic-minted-key-0001',serverId='55555555-5555-4555-8555-555555555555',newOwner='66666666-6666-4666-8666-666666666666';
  let challenge=null,stateSeen=null,emailChallenge=null;const order=[];
  f.setSignIn(async(path,input)=>{
   if(!path.startsWith('/steward/')&&!path.startsWith('/api/v1/app-auth/')&&!(path==='/api/v1/user'&&new Headers(input.headers).get('Authorization')==='Bearer '+minted))return null;
   order.push(path);const body=input.body?JSON.parse(input.body):undefined,auth=new Headers(input.headers).get('Authorization');assert.equal(input.redirect,'error');
   // The six-digit code adapter (config/cloud-email-code.json): no magic link is requested.
   if(path==='/steward/auth/email/code/send'){assert.deepEqual(Object.keys(body).sort(),['client','email','pkce','tenantId']);assert.equal(body.email,'owner@example.invalid');assert.equal(body.tenantId,'elizacloud');assert.equal(body.client,'ai.elizaresearch.alphaphone');assert.equal(body.pkce.codeChallengeMethod,'S256');assert.match(body.pkce.codeChallenge,/^[A-Za-z0-9_-]{43}$/);emailChallenge=body.pkce.codeChallenge;assert.equal(auth,null);return Response.json({ok:true,data:{expiresAt:new Date(Date.now()+600000).toISOString(),challengeId:'c',pollSecret:'p'}});}
   if(path==='/steward/auth/email/code/verify'){assert.equal(body.tenantId,'elizacloud');assert.equal(body.client,'ai.elizaresearch.alphaphone');assert.equal(createHash('sha256').update(body.pkce.codeVerifier).digest('base64url'),emailChallenge,'the verify call proves the phone that asked for the code');if(body.code!=='123456')return Response.json({ok:false,error:'Invalid code'},{status:401});return Response.json({ok:true,token:steward,refreshToken:'synthetic-refresh-0001',expiresIn:900,user:{id:'u'}});}
   if(path==='/api/v1/app-auth/connect'){assert.equal(auth,'Bearer '+steward);assert.equal(body.flow,'mobile_pkce');assert.equal(body.clientId,'ai.elizaresearch.alphaphone');assert.equal(body.environment,'production');assert.equal(body.redirectUri,'https://eliza.app/alphaphone/auth/callback');assert.equal(body.codeChallengeMethod,'S256');assert.match(body.state,/^[A-Za-z0-9_-]{43}$/);challenge=body.codeChallenge;stateSeen=body.state;return Response.json({success:true,code:'emac_'+'a'.repeat(64),codeType:'mobile_app_auth_code',expiresAt:new Date(Date.now()+300000).toISOString(),expiresIn:300,accountCreated:true});}
   if(path==='/api/v1/app-auth/mobile/token'){assert.equal(auth,null);assert.equal(body.state,stateSeen);assert.equal(createHash('sha256').update(body.codeVerifier).digest('base64url'),challenge,'PKCE verifier matches the challenge');return Response.json({success:true,credentialId:serverId,secret:minted,tokenType:'Bearer',expiresAt:new Date(Date.now()+30*86400000).toISOString(),expiresIn:2592000,scopes:['cloud:user'],acknowledgementRequired:true,acknowledgeBy:new Date(Date.now()+300000).toISOString()});}
   if(path==='/api/v1/app-auth/mobile/ack'){assert.equal(body.secret,minted);assert.equal(body.credentialId,serverId);return Response.json({success:true,status:'acknowledged',credentialId:serverId,expiresAt:new Date(Date.now()+30*86400000).toISOString(),scopes:['cloud:user']});}
   if(path==='/api/v1/user')return Response.json({success:true,data:{id:newOwner,organization_id:org,email:'owner@example.invalid'}});
   if(path==='/steward/auth/logout'){assert.equal(auth,'Bearer '+steward);assert.deepEqual(body,{refreshToken:'synthetic-refresh-0001'});return Response.json({ok:true});}
   throw Error('Unexpected sign-in route '+path);
  });
  const {BrowserCloudSignIn}=await import('../apps/app/src/browser/cloud-connection.ts');
  const account=new BrowserCloudConnection(),host=new BrowserCloudSignIn(),original=globalThis.fetch;globalThis.fetch=(url,options={})=>url===f.origin()||String(url).startsWith('/__alpha')?original(f.origin(),{...options,headers:{...options.headers,Origin:f.origin()}}):original(url,options);
  try{
   const store={acceptsReferences:true,read:async()=>{const r=await account.secureRead({slot:'cloud:production'});return r.value?JSON.parse(r.value):null;},write:async()=>{throw Error('The page never writes an in-app sign-in');},clear:async()=>account.secureRemove({slot:'cloud:production'})};
   const client=new CloudProtocol('production',input=>account.request({...input,requestId:randomUUID(),body:input.body===undefined?undefined:JSON.stringify(input.body)}),store,async()=>{throw Error('No page is opened');},{signIn:host});
   await assert.rejects(client.signInWithGoogle(new AbortController().signal),error=>error.code==='browser-unavailable','Google needs the phone');
   const started=await client.startEmailSignIn('owner@example.invalid',new AbortController().signal);
   await assert.rejects(client.startEmailSignIn('owner@example.invalid',new AbortController().signal),error=>error.code==='cooldown');
   await assert.rejects(client.verifyEmailSignIn(started.attemptId,'000000',new AbortController().signal),error=>error.code==='invalid-code');
   const outcome=await client.verifyEmailSignIn(started.attemptId,'123456',new AbortController().signal);
   assert.equal(outcome.status,'authenticated');assert.equal(outcome.accountCreated,true);
   assert.ok(f.diagnostics.some(row=>row.operation==='/api/v1/app-auth/mobile/token'&&row.status===200));assert.ok(f.diagnostics.every(row=>Object.keys(row).every(key=>['environment','operation','status','code'].includes(key))));assert.ok(!JSON.stringify(f.diagnostics).includes(minted));
   assert.deepEqual(order.filter(path=>path!=='/steward/auth/email/code/verify'&&path!=='/steward/auth/logout'),['/steward/auth/email/code/send','/api/v1/app-auth/connect','/api/v1/app-auth/mobile/token','/api/v1/app-auth/mobile/ack','/api/v1/user'],'acknowledged before the identity read and the commit');
   for(let wait=0;wait<50&&!order.includes('/steward/auth/logout');wait++)await new Promise(resolve=>setTimeout(resolve,10));
   assert.ok(order.includes('/steward/auth/logout'),'the Steward session is revoked, best effort');
   const credential=await store.read();assert.equal(credential.token,undefined);assert.match(credential.credentialReference,/^browser-cloud-reference:/);assert.equal(JSON.stringify(credential).includes(minted),false);
   const privateState=JSON.parse(await readFile(join(f.profile,'credentials.json'),'utf8'));assert.equal(privateState.production.token,minted);assert.equal(privateState.production.userId,newOwner);
   assert.equal(JSON.stringify(outcome).includes(steward)||JSON.stringify(outcome).includes(minted),false,'no secret reaches the page');
   await assert.rejects(client.verifyEmailSignIn(started.attemptId,'123456',new AbortController().signal),error=>error.code==='expired','an attempt is single use');
  }finally{globalThis.fetch=original;}
 }finally{await f.close();}
});

test('cancelling an in-flight email verification keeps the existing account and never mints a key',async()=>{
 const f=await fixture();let release;
 try{
  let entered;const waiting=new Promise(resolve=>{entered=resolve;});
  f.setSignIn(async path=>{
   if(path==='/steward/auth/email/code/send')return Response.json({ok:true,data:{expiresAt:new Date(Date.now()+600000).toISOString()}});
   if(path==='/steward/auth/email/code/verify'){
    entered();await new Promise(resolve=>{release=resolve;});
    // Deliberately ignores the aborted transport, like a response already in flight.
    return Response.json({ok:true,token:'synthetic-steward-session-token-0001'});
   }
   return null;
  });
  const started=await f.rpc({operation:'signInStartEmail',environment:'production',email:'owner@example.invalid'});
  assert.equal(started.status,200);
  const pending=f.rpc({operation:'signInVerifyEmail',attemptId:started.data.attemptId,code:'123456'});
  await waiting;
  assert.equal((await f.rpc({operation:'signInCancel'})).status,200);
  release();
  assert.notEqual((await pending).status,200);
  assert.equal(f.calls.some(call=>new URL(call.url).pathname.startsWith('/api/v1/app-auth/')),false);
  const saved=JSON.parse((await f.rpc({operation:'secureRead',slot:'cloud:production'})).data.value);
  assert.equal(saved.credentialId,credentialId);
  assert.equal((await f.rpc({operation:'signInStatus'})).data.active,false);
 }finally{release?.();await f.close();}
});

test('private agent Google port shares the current credential without allowing writes or unrelated services',async()=>{
 const f=await fixture();try{
  const host=f.host(),credential=await host.agentCredential();assert.equal(credential.token,undefined);assert.equal(credential.credentialReference,reference);
  const read={url:'https://api.eliza.app/api/v1/user',method:'GET',credentialReference:reference,signal:new AbortController().signal};
  assert.equal((await host.agentRead(read)).data.data.id,owner);const count=f.calls.length;
  for(const change of [{method:'POST',body:{}},{url:'https://api.eliza.app/api/v1/eliza/google/disconnect'},{url:'https://api.eliza.app/api/v1/eliza/google/calendar/events',method:'POST',body:'{}'},{url:'https://api.eliza.app/api/v1/billing/limits'},{url:'https://elsewhere.invalid/api/v1/user'},{credentialReference:'browser-cloud-reference:'+randomUUID()}])await assert.rejects(host.agentRead({...read,...change}));
  assert.equal(f.calls.length,count,'no refused read or mutation reached Cloud');
  f.setResponse(async()=>Response.json([]));
  const calendars=await host.agentRead({...read,url:'https://api.eliza.app/api/v1/eliza/google/calendar/calendars?side=owner&grantId='+credentialId});assert.deepEqual(calendars.data,[]);
 }finally{await f.close();}
});
test('a Cloud account change while the agent Gmail read is in flight drops the old result',async()=>{
 const f=await fixture();try{
  let enter,release;const entered=new Promise(r=>{enter=r}),held=new Promise(r=>{release=r});
  f.setResponse(async()=>{enter();await held;return Response.json({messages:[{subject:'Old owner content'}]});});
  const pending=f.host().agentRead({url:'https://api.eliza.app/api/v1/eliza/google/gmail/search?side=owner&grantId='+credentialId+'&query=in%3Ainbox&maxResults=10',method:'GET',credentialReference:reference,signal:new AbortController().signal});
  await entered;await writeFile(join(f.profile,'credentials.json'),JSON.stringify({production:{credentialReference:'browser-cloud-reference:'+randomUUID(),credentialId:randomUUID(),userId:owner,organizationId:org,token:secret}}),{mode:0o600});release();
  await assert.rejects(pending,error=>error.code==='account-changed');
 }finally{await f.close();}
});

test('Maps capability discovery is a bare authenticated read, not a location or routing request',async()=>{
 const f=await fixture();try{
  f.setResponse(async()=>Response.json({providerId:'synthetic-maps',revision:'1'}));
  const call=input=>f.rpc({operation:'request',environment:'production',requestId:randomUUID(),input:{url:'https://api.eliza.app/api/v1/maps/capabilities',method:'GET',credentialReference:reference,...input}});
  const result=await call({});assert.equal(result.status,200);assert.equal(result.data.data.providerId,'synthetic-maps');
  const dispatched=f.calls.length;
  for(const input of [{method:'POST',body:'{}'},{url:'https://api.eliza.app/api/v1/maps/capabilities?latitude=1'},{body:'{}'},{url:'https://api.eliza.app/api/v1/maps/routes',method:'POST',body:'{}'}])assert.notEqual((await call(input)).status,200);
  assert.equal(f.calls.length,dispatched);
 }finally{await f.close();}
});

test('Calendar sync bridge forwards only exact owner-bound versioned operations',async()=>{
 const f=await fixture(),grant=randomUUID(),root='/api/v1/eliza/google/calendar/sync-v1/';try{
  f.setResponse(async(_url,input)=>Response.json({forwarded:input.body?JSON.parse(input.body):null}));
  const call=(route,method='GET',body)=>f.rpc({operation:'request',environment:'production',requestId:randomUUID(),input:{url:'https://api.eliza.app'+root+route,method,headers:{Accept:'application/json'},credentialReference:reference,...(body===undefined?{}:{body:JSON.stringify(body)})}});
  const selection={grantId:grant,calendarId:'primary',accountId:'google-user'},event={title:'Synthetic event'};
  for(const [route,method,body] of [
   ['capabilities?'+new URLSearchParams({grantId:grant,calendarId:'primary'}),'GET'],
   ['event?'+new URLSearchParams({...selection,idempotencyKey:'stable'}),'GET'],
   ['event','POST',{...selection,idempotencyKey:'stable',event}],
   ['event','PATCH',{...selection,eventId:'saved',expectedEtag:'"1"',event}],
   ['event?'+new URLSearchParams({...selection,eventId:'saved',expectedEtag:'"1"'}),'DELETE'],
  ])assert.equal((await call(route,method,body)).data.status,200,method+' '+route);
  const before=f.calls.length;
  for(const [route,method,body] of [
   ['event','POST',{grantId:grant,calendarId:'primary',idempotencyKey:'stable',event}],
   ['event','PATCH',{...selection,eventId:'saved',expectedEtag:'*',event}],
   ['event?'+new URLSearchParams({...selection,eventId:'saved',idempotencyKey:'stable'}),'GET'],
   ['event?'+new URLSearchParams({...selection,eventId:'saved',expectedEtag:'*'}),'DELETE'],
   ['event','PUT',{...selection,event}],
   ['event/','PATCH',{...selection,eventId:'saved',expectedEtag:'"1"',event}],
  ])assert.ok([400,403].includes((await call(route,method,body)).status));
  assert.equal(f.calls.length,before,'rejected routes never reach Cloud');
 }finally{await f.close();}
});

test('agent Calendar transport admits only canonical scoped sync operations',async()=>{
 const f=await fixture();try{
  f.setResponse(async()=>Response.json({version:1,calendarId:'owner@example.test',accountId:'account',read:true,write:true,idempotentCreate:true,conditionalWrites:true,providerExactlyOnce:false}));
  const url='https://api.eliza.app/api/v1/eliza/google/calendar/sync-v1/capabilities?grantId=11111111-1111-4111-8111-111111111111&calendarId=owner%40example.test';
  const result=await f.host().agentCalendarOperation({url,method:'GET',credentialReference:reference,signal:new AbortController().signal});
  assert.equal(result.status,200);assert.equal(result.data.write,true);
  const count=f.calls.length;
  await assert.rejects(f.host().agentCalendarOperation({url:url.replace('api.eliza.app','attacker.invalid'),method:'GET',credentialReference:reference,signal:new AbortController().signal}),/agent-calendar-route-refused/);
  assert.equal(f.calls.length,count);
 }finally{await f.close();}
});
test('Maps POST data routes forward one bounded request identity and reject foreign headers, routes and bodies',async()=>{
 const f=await fixture();try{
  f.setResponse(async()=>Response.json({ok:true}));
  const requestId=randomUUID(),base={url:'https://api.eliza.app/api/v1/maps/routes',method:'POST',credentialReference:reference,headers:{'Idempotency-Key':requestId},body:JSON.stringify({from:{latitude:1,longitude:2},to:{latitude:3,longitude:4}})};
  const call=change=>f.rpc({operation:'request',environment:'production',requestId:randomUUID(),input:{...base,...change}});
  for(const route of ['geocode','reverse','places/search','places/details','routes']){
   const count=f.calls.length;assert.equal((await call({url:'https://api.eliza.app/api/v1/maps/'+route})).status,200);assert.equal(f.calls.length,count+1);
   const sent=f.calls.at(-1).input;assert.equal(new Headers(sent.headers).get('Idempotency-Key'),requestId);assert.equal(new Headers(sent.headers).get('Authorization'),'Bearer '+secret);assert.equal(sent.body,base.body);
  }
  const count=f.calls.length;
  for(const change of [
   {url:'https://api.eliza.app/api/v1/maps/routes?latitude=1'}, {url:'https://api.eliza.app/api/v1/maps/routes/'},
   {url:'https://api.eliza.app/api/v1/maps/capabilities'}, {url:'https://api.eliza.app/api/v1/user'}, {method:'GET'}, {method:'DELETE'},
   {headers:{}}, {headers:{'Idempotency-Key':'x'.repeat(129)}}, {headers:{'Idempotency-Key':'bad\nvalue'}},
   {headers:{'Idempotency-Key':requestId,'idempotency-key':requestId}}, {headers:{'Idempotency-Key':requestId,Authorization:'Bearer attacker'}},
   {headers:{'Idempotency-Key':1}}, {body:'null'}, {body:'[]'}, {body:'not JSON'}, {body:{}}, {body:JSON.stringify({query:'x'.repeat(128*1024)})},
   {credentialReference:'browser-cloud-reference:'+randomUUID()},
  ])assert.notEqual((await call(change)).status,200,JSON.stringify(change).slice(0,160));
  assert.equal(f.calls.length,count,'refusals never dispatch');
  f.setResponse(async()=>{throw Error('Synthetic unknown acknowledgement');});
  assert.notEqual((await call({})).status,200);assert.equal(f.calls.length,count+1,'unknown outcome is not automatically retried');
 }finally{await f.close();}
});

test('Maps data returning after a Cloud owner switch is discarded',async()=>{
 const f=await fixture();let release;try{
  let enter;const entered=new Promise(r=>{enter=r}),held=new Promise(r=>{release=r});
  f.setResponse(async()=>{enter();await held;return Response.json({places:[{name:'Previous owner result'}]});});
  const pending=f.rpc({operation:'request',environment:'production',requestId:randomUUID(),input:{url:'https://api.eliza.app/api/v1/maps/places/search',method:'POST',credentialReference:reference,headers:{'Idempotency-Key':randomUUID()},body:JSON.stringify({query:'coffee'})}});
  await entered;await writeFile(join(f.profile,'credentials.json'),JSON.stringify({production:{credentialReference:'browser-cloud-reference:'+randomUUID(),credentialId:randomUUID(),userId:owner,organizationId:org,token:secret}}),{mode:0o600});release();
  const result=await pending;assert.notEqual(result.status,200);assert.equal(JSON.stringify(result).includes('Previous owner result'),false);
 }finally{release?.();await f.close();}
});


test('Cloud resident binding is host-owned, exact-account scoped, and retired before sign-out persists',async()=>{
 const events=[],resident={async bind(value){events.push({kind:'bind',value});return {provider:'elizacloud',configured:true};},async clear(){events.push({kind:'clear'});return {provider:'elizacloud',configured:false};},status(){return {provider:'elizacloud',configured:false};},async ready(){return {state:'host-managed'};}};
 const f=await fixture(resident);try{
  const wrong=await f.rpc({operation:'residentBind',environment:'production',credentialId:randomUUID()});assert.equal(wrong.status,409);assert.equal(events.length,0);
  const staged=await f.rpc({operation:'residentBind',environment:'staging',credentialId});assert.equal(staged.status,400);assert.equal(events.length,0);
  const bound=await f.rpc({operation:'residentBind',environment:'production',credentialId});assert.equal(bound.status,200);assert.equal(events[0].value.token,secret);assert.equal(events[0].value.reference,reference);assert.ok(!JSON.stringify(bound).includes(secret));
  const removed=await f.rpc({operation:'secureRemove',slot:'cloud:production',previousReference:reference});assert.equal(removed.status,200);assert.equal(events.at(-1).kind,'clear');
  const stale=await f.rpc({operation:'residentBind',environment:'production',credentialId});assert.equal(stale.status,409);
 }finally{await f.close();}
});

test('failed Cloud resident retirement preserves the saved credential and fails sign-out',async()=>{
 const resident={async bind(){throw Error('unused');},async clear(){throw Error('shutdown unconfirmed');},status(){return {};},async ready(){return {};}};
 const f=await fixture(resident);try{
  assert.equal((await f.rpc({operation:'secureRemove',slot:'cloud:production',previousReference:reference})).status,400);
  const stored=await f.rpc({operation:'secureRead',slot:'cloud:production'});assert.equal(JSON.parse(stored.data.value).credentialId,credentialId);
 }finally{await f.close();}
});

test('explicit Cloud resident rejects a different issuer before dispatch',async()=>{
 const f=await fixture(undefined,'staging');try{
  const before=f.calls.length;
  const result=await f.rpc({operation:'secureRead',slot:'cloud:production'});
  assert.notEqual(result.status,200);assert.equal(f.calls.length,before);
 }finally{await f.close();}
});
