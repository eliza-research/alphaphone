import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
if(!process.execArgv.some((arg,i)=>arg==='--import'&&process.execArgv[i+1]==='tsx')){const child=spawnSync(process.execPath,['--max-old-space-size=512','--import','tsx',process.argv[1]],{stdio:'inherit',timeout:45000});if(child.error)throw child.error;process.exit(child.status??1);}
const {createBrowserCloudDevHandler}=await import('../scripts/browser-cloud-dev-bridge.ts');
const {productionCloud,cloudStorageNamespace}=await import('../apps/app/src/runtime/cloud-deployment.generated.ts');
const secret='synthetic-private-key-never-log',privateValue='private-calendar-name-never-log';
const reference='browser-cloud-reference:44444444-4444-4444-8444-444444444444';
const credential={credentialReference:reference,credentialId:'33333333-3333-4333-8333-333333333333',userId:'11111111-1111-4111-8111-111111111111',organizationId:'22222222-2222-4222-8222-222222222222',token:secret};
const trace='abcdef0123456789abcdef0123456789';
const feed='/api/v1/eliza/google/calendar/feed?side=owner&grantId=11111111-1111-4111-8111-111111111111&calendarId='+privateValue+'&timeMin=2026-11-01T00%3A00%3A00Z&timeMax=2026-11-02T00%3A00%3A00Z&timeZone=UTC';
async function fixture(request,diagnostic){
 const profile=await mkdtemp(join(tmpdir(),'alpha-read-timing-'));
 const dir=join(profile,cloudStorageNamespace.replaceAll(':','-'));await mkdir(dir,{mode:0o700});await writeFile(join(dir,'credentials.json'),JSON.stringify({production:credential}),{mode:0o600});
 const calls=[],logs=[];
 const host=createBrowserCloudDevHandler({profile,request:async(...args)=>{calls.push(args);return request(...args);},...(diagnostic===false?{}:{diagnostic:diagnostic??(event=>logs.push(event))})});
 return {host,calls,logs,close:()=>rm(profile,{recursive:true,force:true}),read:(path=feed,signal=new AbortController().signal)=>host.agentRead({url:productionCloud.api+path,method:'GET',credentialReference:reference,signal})};
}
function safe(event){
 assert.deepEqual(Object.keys(event).sort(),['code','environment','operation','status','timing']);
 assert.match(event.operation,/^agent-read\.(identity|accounts|calendar-catalog|calendar-feed|gmail-search|gmail-read)$/);
 assert.ok(Number.isInteger(event.timing.ordinal)&&event.timing.ordinal>=1&&event.timing.ordinal<=1000000);
 for(const key of ['totalMs','fetchToHeadersMs','bodyMs'])assert.ok(event.timing[key]===null||Number.isFinite(event.timing[key])&&event.timing[key]>=0&&event.timing[key]<=600000);
 const raw=JSON.stringify(event);for(const value of [secret,privateValue,credential.userId,credential.organizationId,reference,productionCloud.api])assert.ok(!raw.includes(value));
}
test('same successful return and request; emits only bounded allowlisted diagnostics',async()=>{
 const body={value:privateValue};const f=await fixture(async(_url,init)=>{assert.equal(init.redirect,'error');assert.equal(new Headers(init.headers).get('Authorization'),'Bearer '+secret);return Response.json(body,{headers:{'Server-Timing':'cloud_worker;dur=12.34, private;dur=999;desc="'+privateValue+'"','X-Eliza-Trace-Id':trace}});});
 try{assert.deepEqual(await f.read(),{status:200,data:body});assert.equal(f.calls.length,1);assert.equal(f.logs.length,1);safe(f.logs[0]);assert.equal(f.logs[0].operation,'agent-read.calendar-feed');assert.equal(f.logs[0].code,'returned');assert.deepEqual(f.logs[0].timing.serverTiming,{cloud_worker:12.34});assert.equal(f.logs[0].timing.traceId,trace);}finally{await f.close();}
});
test('HTTP failure response stays returned for existing caller interpretation',async()=>{
 const body={error:'temporary'};const f=await fixture(async()=>Response.json(body,{status:503}));try{assert.deepEqual(await f.read('/api/v1/user'),{status:503,data:body});assert.equal(f.logs[0].status,503);assert.equal(f.logs[0].code,'returned');safe(f.logs[0]);}finally{await f.close();}
});
test('same fetch exception identity and no raw error content',async()=>{
 const failure=new TypeError(secret);const f=await fixture(async()=>{throw failure;});try{await assert.rejects(f.read(),error=>error===failure);assert.equal(f.calls.length,1);assert.equal(f.logs[0].status,0);assert.equal(f.logs[0].code,'threw');assert.equal(f.logs[0].timing.fetchToHeadersMs,null);safe(f.logs[0]);}finally{await f.close();}
});
test('same body exception identity; metadata cannot expose body or errors',async()=>{
 const failure=new Error(privateValue);const f=await fixture(async()=>new Response(new ReadableStream({start(c){c.error(failure);}})));try{await assert.rejects(f.read(),error=>error===failure);assert.equal(f.logs[0].status,200);assert.equal(f.logs[0].code,'threw');assert.notEqual(f.logs[0].timing.bodyMs,null);safe(f.logs[0]);}finally{await f.close();}
});
test('bad headers omitted and header getter failure cannot change success',async()=>{
 for(const headers of [new Headers({'Server-Timing':'cloud_worker;dur=1, cloud_worker;dur=2','X-Eliza-Trace-Id':privateValue}),{get(){throw Error(secret);}}]){
  const f=await fixture(async()=>({status:200,headers,body:Response.json({ok:true}).body}));try{assert.deepEqual(await f.read(),{status:200,data:{ok:true}});assert.equal(f.logs[0].timing.traceId,undefined);assert.equal(f.logs[0].timing.serverTiming,undefined);safe(f.logs[0]);}finally{await f.close();}
 }
});
test('throwing diagnostic sink cannot change success or original fetch exception',async()=>{
 for(const failure of [undefined,new Error(privateValue)]){
  const f=await fixture(async()=>{if(failure)throw failure;return Response.json({ok:true});},()=>{throw Error(secret);});try{if(failure)await assert.rejects(f.read(),error=>error===failure);else assert.deepEqual(await f.read(),{status:200,data:{ok:true}});assert.equal(f.calls.length,1);}finally{await f.close();}
 }
});
test('abort keeps exact reason and adds no request',async()=>{
 const controller=new AbortController(),failure=new Error(privateValue);const f=await fixture(async()=>{controller.abort(failure);return Response.json({ok:true});});try{await assert.rejects(f.read(feed,controller.signal),error=>error===failure);assert.equal(f.calls.length,1);assert.equal(f.logs[0].code,'threw');safe(f.logs[0]);}finally{await f.close();}
});
test('forbidden route still fails before dispatch or diagnostic',async()=>{
 const f=await fixture(async()=>{throw Error('must not run');});try{await assert.rejects(f.read('/api/v1/private'),error=>error.code==='agent-read-route-refused');assert.equal(f.calls.length,0);assert.equal(f.logs.length,0);}finally{await f.close();}
});
test('default owner log is sanitized when no diagnostic callback supplied',async()=>{
 const logs=[],original=console.info;console.info=(...args)=>logs.push(args);const f=await fixture(async()=>Response.json({ok:true}),false);
 try{assert.deepEqual(await f.read(),{status:200,data:{ok:true}});assert.equal(logs.length,1);assert.equal(logs[0][0],'[alpha-cloud-agent-read]');safe(JSON.parse(logs[0][1]));}finally{console.info=original;await f.close();}
});
test('ordinal increases without changing sequential returns or issuing extra calls',async()=>{
 const f=await fixture(async()=>Response.json({ok:true}));try{await f.read();await f.read('/api/v1/user');assert.deepEqual(f.logs.map(x=>x.timing.ordinal),[1,2]);assert.equal(f.calls.length,2);f.logs.forEach(safe);}finally{await f.close();}
});
test('unavailable diagnostic clock cannot change the successful response',async()=>{
 const f=await fixture(async()=>Response.json({ok:true}));const descriptor=Object.getOwnPropertyDescriptor(performance,'now');
 try{Object.defineProperty(performance,'now',{configurable:true,value:()=>{throw Error(secret);}});assert.deepEqual(await f.read(),{status:200,data:{ok:true}});assert.equal(f.calls.length,1);safe(f.logs[0]);assert.equal(f.logs[0].timing.totalMs,null);assert.equal(f.logs[0].timing.fetchToHeadersMs,null);assert.equal(f.logs[0].timing.bodyMs,null);}
 finally{if(descriptor)Object.defineProperty(performance,'now',descriptor);else delete performance.now;await f.close();}
});
