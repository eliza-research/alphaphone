import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewAlphaDelegation, approveAlphaDelegation} from '../apps/app/src/runtime/alpha-delegation.ts';
const appId='12345678-1234-4123-8123-123456789012', clientId='22345678-1234-4123-8123-123456789012';
const scopes=['identity','google.basic_identity','google.gmail.triage'];
const signal=()=>new AbortController().signal;
function url(changes={}) {return 'https://cloud.eliza.app/app-auth/authorize?'+new URLSearchParams({app_id:appId,client_id:clientId,redirect_uri:'https://alphacompute.ai/delegation-return.html',state:'s'.repeat(43),flow:'app_delegation',scopes:scopes.join(' '),...changes});}
const registration=()=>({status:200,data:{success:true,app:{id:appId,name:'Alpha Phone'},scopes}});
test('delegation review validates registry through fixed backend without navigating to frontend',async()=>{
 const calls=[];const review=await reviewAlphaDelegation(url(),['email'],async input=>{calls.push(input);return registration()},signal());
 assert.equal(review.appName,'Alpha Phone');assert.equal(review.environment,'production');assert.equal(calls.length,1);
 const target=new URL(calls[0].url);assert.equal(target.origin,'https://api.eliza.app');assert.equal(target.pathname,'/api/v1/app-auth/delegations/registration');assert.equal(target.searchParams.get('clientId'),clientId);assert.deepEqual(calls[0].headers,{});
});
test('untrusted host, duplicate params and broader scopes never reach the backend',async()=>{
 for(const raw of [url().replace('cloud.eliza.app','attacker.invalid'),url()+'&state=x',url({scopes:scopes.concat('google.gmail.send').join(' ')}),url({redirect_uri:'javascript:alert(1)'}),url({flow:'mobile_pkce'}),url()+'#code=x']){
  let requests=0;await assert.rejects(reviewAlphaDelegation(raw,['email'],async()=>{requests++;return registration()},signal()));assert.equal(requests,0);
 }
});
test('registry cannot change app identity or add permissions',async()=>{
 for(const data of [{success:true,app:{id:clientId,name:'Wrong'},scopes},{success:true,app:{id:appId,name:'Alpha'},scopes:[...scopes,'billing:write']},{success:true,app:{id:appId,name:'Alpha'},scopes:[...scopes,scopes[0]]}])await assert.rejects(reviewAlphaDelegation(url(),['email'],async()=>({status:200,data}),signal()));
});
test('approval uses interactive Bearer and returns only a typed one-time delegation code',async()=>{
 const review=await reviewAlphaDelegation(url(),['email'],async()=>registration(),signal()),calls=[];
 const code=await approveAlphaDelegation(review,async input=>{calls.push(input);return {status:200,data:{success:true,codeType:'app_delegation_code',code:'c'.repeat(43)}}},async env=>{assert.equal(env,'production');return 'interactive-fixture'},signal());
 assert.equal(code,'c'.repeat(43));assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.eliza.app/api/v1/app-auth/connect');assert.equal(calls[0].headers.Authorization,'Bearer interactive-fixture');assert.deepEqual(calls[0].body,{flow:'app_delegation',appId,clientId,redirectUri:review.redirectUri,scopes});
});
test('abort after interactive authentication prevents consent; lost POST is never retried',async()=>{
 const review=await reviewAlphaDelegation(url(),['email'],async()=>registration(),signal()),abort=new AbortController();let requests=0;
 await assert.rejects(approveAlphaDelegation(review,async()=>{requests++;throw Error('unexpected')},async()=>{abort.abort();return 'fixture'},abort.signal));assert.equal(requests,0);
 await assert.rejects(approveAlphaDelegation(review,async()=>{requests++;throw Error('lost response')},async()=> 'fixture',signal()),/lost response/);assert.equal(requests,1);
});
test('staging consent remains on staging APIs and rejects wrong code type',async()=>{
 const review=await reviewAlphaDelegation(url().replace('cloud.eliza.app','cloud-staging.eliza.app'),['email'],async input=>{assert.equal(new URL(input.url).origin,'https://api-staging.eliza.app');return registration()},signal());
 await assert.rejects(approveAlphaDelegation(review,async input=>{assert.equal(new URL(input.url).origin,'https://api-staging.eliza.app');return {status:200,data:{success:true,codeType:'app_auth_code',code:'c'.repeat(43)}}},async env=>{assert.equal(env,'staging');return 'fixture'},signal()));
});
