import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateAlpha, alphaAuthConfig, parseAlphaAuthCallback } from '../apps/app/src/runtime/alpha-auth.ts';
const pending = () => ({environment:'production',state:'s'.repeat(43),verifier:'v'.repeat(43),expiresAt:Date.now()+60000});
const link = (p, extra='') => `${alphaAuthConfig(p.environment).redirect}#code=${'c'.repeat(43)}&state=${p.state}${extra}`;
test('callbacks require exact origin, route, environment, state and one bounded code',()=>{
 const p=pending();assert.deepEqual(parseAlphaAuthCallback(link(p),p),{code:'c'.repeat(43)});
 assert.deepEqual(parseAlphaAuthCallback(`alphaphone://auth/production#state=${p.state}&error=oauth_authorization_failed`,p),{error:'denied'});
 for(const raw of [link(p,'&token=secret'),link(p,'&state='+p.state),link(p).replace('alphacompute.ai','evil.invalid'),link(p).replace('/auth/callback','/auth/staging/callback'),link(p).replace(p.state,'x'.repeat(43)),link(p).replace('#','?token=secret#'),'alphaphone://auth/staging#code='+ 'c'.repeat(43)+'&state='+p.state])assert.equal(parseAlphaAuthCallback(raw,p),null);
});
function fixture(resume=false) {
 let saved=resume?pending():null,callback=null,opened=[],calls=[];
 const host={read:async()=>saved,write:async p=>{saved=p},clear:async()=>{saved=null},open:async url=>{opened.push(url);callback=link(saved)},callback:async()=>callback,clearCallback:async()=>{callback=null}};
 if(resume)callback=link(saved);
 const request=async input=>{calls.push(input);const url=new URL(input.url);return {status:200,data:url.pathname.endsWith('/app-readiness')?{ok:true,appAuth:1,tenantId:url.searchParams.get('tenant_id'),redirectUri:url.searchParams.get('redirect_uri')}:{ok:true,token:'synthetic'}}};
 return {host,request,opened,calls,saved:()=>saved,setCallback:v=>{callback=v}};
}
test('direct backend Google PKCE flow exchanges once and clears encrypted pending state',async()=>{
 const f=fixture();assert.equal(await authenticateAlpha('production',f.request,f.host,new AbortController().signal),'synthetic');
 const u=new URL(f.opened[0]);assert.equal(u.origin,'https://api.eliza.app');assert.equal(u.pathname,'/steward/auth/oauth/google/authorize');assert.equal(u.searchParams.get('response_type'),'code');assert.equal(u.searchParams.get('code_challenge_method'),'S256');
 const request=f.calls[1];assert.equal(request.url,'https://api.eliza.app/steward/auth/oauth/exchange');assert.equal(request.body.redirect_uri,u.searchParams.get('redirect_uri'));assert.equal(request.body.tenant_id,'elizacloud');
 const challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(request.body.code_verifier))).toString('base64url');assert.equal(challenge,u.searchParams.get('code_challenge'));assert.equal(f.calls.length,2);assert.equal(f.saved(),null);
});
test('cold callback resumes without another provider window',async()=>{const f=fixture(true);await authenticateAlpha('production',f.request,f.host,new AbortController().signal);assert.equal(f.opened.length,0);assert.equal(f.calls.length,1);assert.equal(f.saved(),null)});
test('a delegation callback cannot be consumed by account login or a different agent',async()=>{
 const f=fixture(true);f.saved().purpose='delegation:agent-a:request-a';
 for(const purpose of ['account','delegation:agent-b:request-a']) {
  await assert.rejects(authenticateAlpha('production',f.request,f.host,new AbortController().signal,purpose),e=>e.code==='unavailable');
  assert.equal(f.saved().purpose,'delegation:agent-a:request-a');assert.equal(f.calls.length,0);
 }
 await authenticateAlpha('production',f.request,f.host,new AbortController().signal,'delegation:agent-a:request-a');
 assert.equal(f.opened.length,0);assert.equal(f.calls.length,1);assert.equal(f.saved(),null);
});
test('staging has separate backend, tenant and return path',async()=>{const f=fixture();await authenticateAlpha('staging',f.request,f.host,new AbortController().signal);assert.equal(new URL(f.opened[0]).origin,'https://api-staging.eliza.app');assert.equal(f.calls[1].body.tenant_id,'elizacloud-staging');assert.match(f.calls[1].body.redirect_uri,/\/staging\/callback$/)});
test('cancelled and denied flows cannot exchange credentials',async()=>{
 const f=fixture(),controller=new AbortController();f.host.open=async()=>{controller.abort(new DOMException('Cancelled','AbortError'))};await assert.rejects(authenticateAlpha('production',f.request,f.host,controller.signal),{name:'AbortError'});assert.equal(f.calls.length,1);assert.equal(f.saved(),null);
 const denied=fixture(true);denied.setCallback(`alphaphone://auth/production#state=${'s'.repeat(43)}&error=access_denied`);await assert.rejects(authenticateAlpha('production',denied.request,denied.host,new AbortController().signal),e=>e.code==='denied');assert.equal(denied.calls.length,0);
});
test('lost exchange response is not replayed on restart',async()=>{const f=fixture(true);f.request=async()=>{throw Error('lost response')};await assert.rejects(authenticateAlpha('production',f.request,f.host,new AbortController().signal),/lost response/);assert.equal(f.saved(),null)});
test('wrong-state callbacks do not trigger exchange; a later valid callback can finish',async()=>{
 const f=fixture(true),p=f.saved();let reads=0;
 f.host.callback=async()=>++reads===1?link({...p,state:'x'.repeat(43)}):link(p);
 await authenticateAlpha('production',f.request,f.host,new AbortController().signal);assert.equal(reads,2);assert.equal(f.calls.length,1);
});
test('abort during exchange cannot return the late identity token',async()=>{
 const f=fixture(true),controller=new AbortController();f.request=async()=>{controller.abort(new DOMException('Cancelled','AbortError'));return {status:200,data:{ok:true,token:'late'}}};
 await assert.rejects(authenticateAlpha('production',f.request,f.host,controller.signal),{name:'AbortError'});assert.equal(f.saved(),null);
});

test('missing or mismatched readiness stays inside Alpha without opening a provider',async()=>{
 for(const response of [{status:404,data:{}},{status:200,data:{ok:true}},{status:503,data:{ok:false}},{status:200,data:{ok:true,appAuth:1,tenantId:'elizacloud-staging',redirectUri:alphaAuthConfig('production').redirect}}]) {
  const f=fixture();f.request=async()=>response;
  await assert.rejects(authenticateAlpha('production',f.request,f.host,new AbortController().signal),e=>e.code==='unavailable');
  assert.equal(f.opened.length,0);assert.equal(f.saved(),null);
 }
});
test('cancel during readiness cannot open Google after a late response',async()=>{
 const f=fixture(),controller=new AbortController(),request=f.request;
 f.request=async input=>{const result=await request(input);controller.abort(new DOMException('Cancelled','AbortError'));return result};
 await assert.rejects(authenticateAlpha('production',f.request,f.host,controller.signal),{name:'AbortError'});
 assert.equal(f.opened.length,0);assert.equal(f.saved(),null);
});

test('Google requests an app-owned MFA continuation and cannot skip the challenge',async()=>{
 const f=fixture(),request=f.request;let completions=0;
 f.request=async input=>input.url.endsWith('/exchange')?{status:200,data:{ok:true,mfaRequired:true,token:'must-not-use',mfa:{type:'totp',challengeId:'bound-challenge',expiresAt:new Date(Date.now()+60000).toISOString()}}}:request(input);
 f.host.completeMfa=async (challenge,signal)=>{signal.throwIfAborted();assert.equal(challenge.challengeId,'bound-challenge');completions++;return 'verified-mfa-token';};
 assert.equal(await authenticateAlpha('production',f.request,f.host,new AbortController().signal),'verified-mfa-token');
 assert.equal(new URL(f.opened[0]).searchParams.get('mfa'),'exchange');assert.equal(completions,1);assert.equal(f.saved(),null);
});
test('cancellation during Google MFA cannot release a late token',async()=>{
 const f=fixture(true),controller=new AbortController();
 f.request=async()=>({status:200,data:{ok:true,mfaRequired:true,mfa:{type:'sms',challengeId:'bound-challenge',expiresAt:new Date(Date.now()+60000).toISOString()}}});
 f.host.completeMfa=async()=>{controller.abort();return 'late-token';};
 await assert.rejects(authenticateAlpha('production',f.request,f.host,controller.signal),{name:'AbortError'});assert.equal(f.saved(),null);
});
