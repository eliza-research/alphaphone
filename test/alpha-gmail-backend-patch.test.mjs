import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const route='packages/cloud/api/v1/oauth',target='https://alphacompute.ai/alphaphone/gmail/callback',nonce='s'.repeat(43),oauthState='11111111-1111-4111-8111-111111111111';
test('Gmail backend patch applies and routes only bounded server-bound outcomes',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-gmail-patch-'));
 try {
  mkdirSync(join(dir,route),{recursive:true});writeFileSync(join(dir,route,'generic-callback.ts'),readFileSync('vendor/eliza/'+route+'/generic-callback.ts'));
  const initiation='packages/cloud/api/v1/eliza/google/connect/initiate';mkdirSync(join(dir,initiation),{recursive:true});writeFileSync(join(dir,initiation,'route.ts'),readFileSync('vendor/eliza/'+initiation+'/route.ts'));
  execFileSync('git',['apply','--unsafe-paths','-'],{cwd:dir,input:readFileSync('patches/eliza/alpha-gmail-return.patch')});
  const helper=await import(pathToFileURL(join(dir,route,'app-oauth-return.ts')).href);
  const record=()=>({providerId:'google',organizationId:'org',userId:'user',redirectUrl:target+'?state='+nonce,createdAt:Date.now()});
  const valid=helper.resolveAppOAuthReturn(record(),'google',target);assert.equal(valid.url,target);
  assert.equal(helper.buildAppOAuthReturn(valid,'connected','private-connection'),target+'#state='+nonce+'&result=connected&connectionId=private-connection');
  for(const changed of [{providerId:'slack'},{createdAt:0},{createdAt:Date.now()+60000},{redirectUrl:target+'?state='+nonce+'&token=secret'},{redirectUrl:target+'?state='+nonce+'&state='+nonce},{redirectUrl:target+'?state='+nonce+'#secret'},{redirectUrl:'https://user@alphacompute.ai/alphaphone/gmail/callback?state='+nonce},{redirectUrl:'https://other.invalid/callback?state='+nonce}])assert.equal(helper.resolveAppOAuthReturn({...record(),...changed},'google',target),null);
  assert.equal(helper.resolveAppOAuthReturn(record(),'google',undefined),null);
  assert.equal(helper.resolveAppOAuthReturn(record(),'slack',target),null);
  const initiationCode=stripTypeScriptTypes(readFileSync(join(dir,initiation,'route.ts'),'utf8')).replace(/import\s+\{([\s\S]*?)\}\s+from\s+"([^"]+)";/g,(_,names,path)=>'const {'+names+'} = require('+JSON.stringify(path)+');').replace('export default app;','exports.app = app;');
  for(const enabled of [true,false]) {
   const exports={};let handler;
   const schema=new Proxy({}, {get:(_target,key)=>key==='safeParse'?data=>({success:true,data}):()=>schema});
   const dependencies={
    '../../../../oauth/app-oauth-return':helper,
    '@/lib/runtime/cloud-bindings':{getCloudAwareEnv:()=>({ALPHA_OAUTH_RETURN_URLS:enabled?target:undefined})},
    hono:{Hono:class {post(_path,callback){handler=callback;}}}, zod:{z:schema},
    '@/lib/api/cloud-worker-errors':{failureResponse:(_c,error)=>{throw error}},
    '@/lib/auth/workers-hono-auth':{requireUserOrApiKeyWithOrg:async()=>({id:'user',organization_id:'org'})},
    '@/lib/services/agent-google-connector':{AgentGoogleConnectorError:class extends Error {},initiateManagedGoogleConnection:async input=>{assert.equal(input.redirectUrl,target+'?state='+nonce);return {authUrl:'https://accounts.google.com/o/oauth2/v2/auth'};}},
   };
   vm.runInNewContext(initiationCode,{exports,require:name=>{assert.ok(name in dependencies,name);return dependencies[name]}});
   const result=await handler({req:{json:async()=>({redirectUrl:target+'?state='+nonce})},json:value=>value});
   assert.equal(result.alphaReturn,enabled?2:undefined,'Backend advertises the app-return contract only when configured');
  }
  const compiled=stripTypeScriptTypes(readFileSync(join(dir,route,'generic-callback.ts'),'utf8')).replace(/import\s+\{([\s\S]*?)\}\s+from\s+"([^"]+)";/g,(_,names,path)=>'const {'+names+'} = require('+JSON.stringify(path)+');').replace('export async function handleGenericOAuthCallback','exports.handleGenericOAuthCallback = async function handleGenericOAuthCallback');
  async function invoke({params='code=provider-code&state='+oauthState,stored=record(),allowlist=target,fail=false,configured=true,cacheReadFails=false}={}) {
   const events=[],exports={};let cached=stored;
   const dependencies={
    '@/lib/cache/client':{cache:{get:async key=>{events.push(['read',key]);if(cacheReadFails)throw Error('Cache temporarily unavailable');return cached;},del:async key=>{events.push(['delete',key]);cached=null;}}},
    './app-oauth-return':helper,
    '@/lib/runtime/cloud-bindings':{getCloudAwareEnv:()=>({ALPHA_OAUTH_RETURN_URLS:allowlist})},
    '@/lib/security/redirect-validation':{getDefaultPlatformRedirectOrigins:()=>[],LOOPBACK_REDIRECT_ORIGINS:[],resolveOAuthSuccessRedirectUrl:()=>({target:new URL('https://cloud.eliza.app/cloud/settings'),rejected:false})},
    '@/lib/services/eliza-app':{connectionEnforcementService:{invalidateRequiredConnectionCache:async()=>events.push(['invalidate'])}},
    '@/lib/services/oauth/invalidation':{invalidateOAuthState:async()=>events.push(['invalidate'])},
    '@/lib/services/oauth/provider-registry':{getProvider:()=>({id:'google',useGenericRoutes:true}),isProviderConfigured:()=>configured},
    '@/lib/services/oauth/providers':{handleOAuth2Callback:async()=>{events.push(['exchange']);if(fail)throw Error('Private provider description');if(!cached || cached.providerId!=='google')throw Error('Missing or mismatched state');const value=cached;cached=null;return {...value,connectionId:'private-connection',platformUserId:'private-provider-user'};}},
    '@/lib/services/oauth/success-proof':{clearOAuthSuccessParams:()=>{},isOAuthSuccessLandingPath:()=>false,mintOAuthSuccessProof:async()=>{throw Error('No app proof should be minted')}},
    '@/lib/utils/logger':{logger:{info(){},warn(){},error(){}}},
   };
   vm.runInNewContext(compiled,{exports,require:name=>{assert.ok(name in dependencies,name);return dependencies[name]},URL,Response});
   const response=await exports.handleGenericOAuthCallback(new Request('https://api.eliza.app/api/v1/oauth/google/callback?'+params),{params:Promise.resolve({platform:'google'})});
   return {location:response.headers.get('location'),events,cached};
  }
  const success=await invoke();assert.equal(success.location,target+'#state='+nonce+'&result=connected&connectionId=private-connection');assert.equal(success.events.filter(e=>e[0]==='exchange').length,1);assert.equal(success.events.filter(e=>e[0]==='invalidate').length,2);
  const recovered=await invoke({cacheReadFails:true});assert.equal(recovered.location,target+'#state='+nonce+'&result=connected&connectionId=private-connection');
  const denial=await invoke({params:'state='+oauthState+'&error=access_denied&error_description=private-secret'});assert.equal(denial.location,target+'#state='+nonce+'&result=denied');assert.equal(denial.events.some(e=>e[0]==='exchange'),false);assert.equal(denial.cached,null);
  for(const options of [{fail:true},{configured:false},{params:'state='+oauthState}]) {const result=await invoke(options);assert.equal(result.location,target+'#state='+nonce+'&result=failed');assert.equal(result.cached,null);}
  for(const options of [{allowlist:''},{stored:null},{stored:{...record(),providerId:'slack'}},{params:'state=forged&error=denied'}]) {const result=await invoke(options);assert.equal(new URL(result.location).hostname,'cloud.eliza.app');}
 } finally {rmSync(dir,{recursive:true,force:true});}
});
