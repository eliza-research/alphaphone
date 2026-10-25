import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudLogin} from '../apps/app/src/runtime/cloud-login.ts';
import {cloudCredentialSlot,validateCloudDeployment} from '../apps/app/src/runtime/cloud-deployment.ts';
const signal=()=>new AbortController().signal;
const providers={ok:true,google:true,email:true,sms:true,captcha:{enabled:false,requiredFor:[]}};
test('backend outages and missing app endpoints do not blame account details or expose server errors',async()=>{
 for(const [status,message] of [[503,/temporarily unavailable/],[500,/temporarily unavailable/],[404,/does not support this in-app/],[429,/Too many attempts/]]){
  const client=new CloudLogin('production',async()=>({status,data:{error:'private server diagnostic'}}));
  await assert.rejects(client.methods(signal()),error=>message.test(error.message)&&!error.message.includes('private'));
 }
});
function fixture(replies=[]){const calls=[];return {calls,client:new CloudLogin('production',async input=>{calls.push(input);return {status:200,data:input.url.endsWith('/providers')?providers:replies.shift()};})};}
test('code login uses tenant-bound APIs and preserves MFA before issuing a session',async()=>{
 const f=fixture([{ok:true,expiresAt:new Date(Date.now()+60000).toISOString()},{ok:true,mfaRequired:true,mfa:{type:'totp',challengeId:'challenge',expiresAt:new Date(Date.now()+60000).toISOString()}},{ok:true,token:'synthetic'}]);
 const challenge=await f.client.send('sms','+14155550123',signal());const first=await f.client.verify(challenge,'123456',signal());assert.ok(first.mfa);assert.equal(first.token,undefined);
 assert.deepEqual(await f.client.completeMfa(first.mfa,'234567',signal()),{token:'synthetic'});
 assert.deepEqual(f.calls.map(c=>new URL(c.url).pathname),['/steward/auth/providers','/steward/auth/sms/send','/steward/auth/sms/verify','/steward/auth/mfa/totp/complete']);
 for(const c of f.calls){assert.equal(c.headers['X-Steward-Tenant'],'elizacloud');if(c.body)assert.equal(c.body.tenantId,'elizacloud');assert.equal(c.redirect,'error');}
});
test('email uses the native code-only endpoint and requires its delivery contract',async()=>{
 const f=fixture([{ok:true,data:{expiresAt:Date.now()+60000,codeLength:6}},{ok:true,data:{token:'synthetic'}}]);
 const c=await f.client.send('email','user@example.invalid',signal());assert.deepEqual(await f.client.verify(c,'123456',signal()),{token:'synthetic'});assert.ok(f.calls[1].url.endsWith('/steward/auth/email/code/send'));
 const missing=fixture([{ok:true,data:{expiresAt:Date.now()+60000,challengeId:'not-a-code'}}]);await assert.rejects(missing.client.send('email','user@example.invalid',signal()),/did not confirm/);
});
test('disabled methods and CAPTCHA requirements cannot send codes',async()=>{
 for(const discovery of [{...providers,sms:false},{...providers,captcha:{enabled:true,requiredFor:['sms_otp']}},{...providers,captcha:{enabled:true}}]){
  const calls=[];const client=new CloudLogin('staging',async i=>{calls.push(i);return {status:200,data:discovery};});
  await assert.rejects(client.send('sms','+14155550123',signal()));assert.equal(calls.length,1);assert.equal(calls[0].headers['X-Steward-Tenant'],'elizacloud-staging');
 }
});
test('expiration, malformed tokens, unsupported MFA and late cancellation fail closed',async()=>{
 const f=fixture();await assert.rejects(f.client.verify({method:'sms',address:'+14155550123',expiresAt:0},'123456',signal()),/expired/);assert.equal(f.calls.length,0);
 for(const response of [{ok:true},{ok:false,token:'bad'},{ok:true,token:'bad\r\n'},{ok:true,mfaRequired:true,token:'must-not-use',mfa:{type:'passkey'}}]){
  const x=fixture([response]);await assert.rejects(x.client.verify({method:'sms',address:'+14155550123',expiresAt:Date.now()+60000},'123456',signal()));
 }
 const c=new AbortController();const x=new CloudLogin('production',async()=>{c.abort();return {status:200,data:{ok:true,token:'late'}}});await assert.rejects(x.verify({method:'sms',address:'+14155550123',expiresAt:Date.now()+60000},'123456',c.signal),{name:'AbortError'});
});
test('deployment config requires exact HTTPS authorities and isolates credential slots',()=>{
 const c=validateCloudDeployment({api:'https://api.example.invalid:8443',agents:'agents.example.invalid',tenant:'example',authorizationOrigins:['https://app.example.invalid']});
 assert.notEqual(cloudCredentialSlot('production',c),cloudCredentialSlot('production'));assert.notEqual(cloudCredentialSlot('production',c),cloudCredentialSlot('staging',c));
 for(const api of ['http://api.example.invalid','https://user:pass@api.example.invalid','https://api.example.invalid/path','https://api.example.invalid?x=1'])assert.throws(()=>validateCloudDeployment({...c,api}));
});

test('TOTP recovery submits exactly one factor and is unavailable for SMS',async()=>{
 const f=fixture([{ok:true,token:'recovered'}]),mfa={type:'totp',challengeId:'recovery-challenge',expiresAt:Date.now()+60000};
 assert.deepEqual(await f.client.completeMfa(mfa,'  fixture-recovery-code  ',signal(),true),{token:'recovered'});
 assert.deepEqual(f.calls[0].body,{tenantId:'elizacloud',challengeId:'recovery-challenge',recoveryCode:'fixture-recovery-code'});
 await assert.rejects(f.client.completeMfa({...mfa,type:'sms'},'fixture-recovery-code',signal(),true));assert.equal(f.calls.length,1);
});

test('CAPTCHA is completed before a code send and a cancelled challenge cannot send late',async()=>{
 const calls=[],config={...providers,captcha:{enabled:true,siteKey:'public-fixture-key',provider:'turnstile'}},c=new AbortController();
 let cancel=false;
 const client=new CloudLogin('production',async input=>{calls.push(input);return {status:200,data:input.url.endsWith('/providers')?config:{ok:true,data:{codeLength:6,expiresAt:Date.now()+60000}}};},async(request,signal)=>{
  assert.deepEqual(request,{provider:'turnstile',siteKey:'public-fixture-key',action:'email_otp'});assert.ok(calls.at(-1).url.endsWith('/providers'));if(cancel)c.abort();return 'single-use-fixture-token';
 });
 await client.send('email','fixture@example.invalid',c.signal);assert.equal(calls.length,2);assert.equal(calls[1].body.captchaToken,'single-use-fixture-token');
 cancel=true;await assert.rejects(client.send('email','fixture@example.invalid',c.signal),{name:'AbortError'});assert.equal(calls.length,3);
});
