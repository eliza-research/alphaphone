import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
test('generic readiness accepts separately registered apps and refuses policy/redirect failures',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'app-readiness-')),path='packages/auth/src/server/api/routes/auth.ts';
 try{
  mkdirSync(join(dir,'packages/auth/src/server/api/routes'),{recursive:true});writeFileSync(join(dir,path),readFileSync('test/fixtures/app-auth-readiness-preimage.txt'));
  execFileSync('git',['apply','--include='+path,'-'],{cwd:dir,input:readFileSync('patches/eliza/white-label-app-auth.patch')});
  const patched=readFileSync(join(dir,path),'utf8'),source=patched.slice(patched.indexOf('auth.get("/oauth/google/app-readiness"'),patched.indexOf('auth.get("/oauth/:provider/authorize"'));
  let handler,allowed=true,registered=true,rate=true,returns=true;
  new Function('auth','checkAuthRateLimit','requireTenantLoginMethodAllowed','assertAllowedOAuthRedirectUri','getProviderConfig','buildOAuthAppErrorReturn','process',source)(
   {get:(_,fn)=>{handler=fn}},async()=>({allowed:rate}),async()=>allowed?null:{},async()=>{if(!registered)throw Error('unregistered')},()=>({}),()=>returns?'https://registered.invalid':null,{env:{}});
  async function check(tenant,redirect){return handler({req:{query:k=>({tenant_id:tenant,redirect_uri:redirect})[k]},header:(k,v)=>assert.equal(v,'no-store'),json:(data,status=200)=>({data,status})});}
  for(const [tenant,redirect] of [['app-one','https://one.invalid/callback'],['app-two','https://two.invalid/callback']])assert.deepEqual(await check(tenant,redirect),{status:200,data:{ok:true,appAuth:1,tenantId:tenant,redirectUri:redirect}});
  for(const redirect of ['http://one.invalid/callback','https://evil@one.invalid/callback','https://one.invalid/callback#x','invalid'])assert.equal((await check('app-one',redirect)).status,400);
  allowed=false;assert.equal((await check('app-one','https://one.invalid/callback')).status,403);allowed=true;
  registered=false;assert.equal((await check('app-one','https://one.invalid/callback')).status,503);registered=true;
  returns=false;assert.equal((await check('app-one','https://one.invalid/callback')).status,503);returns=true;
  rate=false;assert.equal((await check('app-one','https://one.invalid/callback')).status,429);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
