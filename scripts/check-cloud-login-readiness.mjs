/** Public GET-only deployment probe. Never authenticates, sends codes or logs raw responses. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {alphaAuthConfig} from '../apps/app/src/runtime/alpha-auth.ts';
const exec=promisify(execFile);
async function get(url,tenant){
 try{
  const {stdout}=await exec('curl',['--silent','--show-error','--connect-timeout','8','--max-time','15','--max-filesize','131072','--header',`X-Steward-Tenant: ${tenant}`,'--write-out','\n%{http_code}',url],{timeout:18000,maxBuffer:140000});
  const split=stdout.lastIndexOf('\n'),status=Number(stdout.slice(split+1));
  let data=null;try{data=JSON.parse(stdout.slice(0,split));}catch{}
  return {status,data};
 }catch{return {status:null,data:null};}
}
const results=await Promise.all(['staging','production'].map(async environment=>{
 const config=alphaAuthConfig(environment);
 const params=new URLSearchParams({tenant_id:config.tenant,redirect_uri:config.redirect});
 const [providers,google]=await Promise.all([get(`${config.api}/steward/auth/providers`,config.tenant),get(`${config.api}/steward/auth/oauth/google/app-readiness?${params}`,config.tenant)]);
 const ready=google.status===200&&google.data?.ok===true&&google.data.appAuth===1&&google.data.tenantId===config.tenant&&google.data.redirectUri===config.redirect;
 return {environment,api:config.api,providers:{status:providers.status,email:providers.data?.email===true,sms:providers.data?.sms===true,google:providers.data?.google===true||(Array.isArray(providers.data?.oauth)&&providers.data.oauth.includes('google'))},googleApp:{status:google.status,ready}};
}));
console.log(JSON.stringify({checkedAt:new Date().toISOString(),scope:'Public GET-only discovery; not sign-in or delivery acceptance',results},null,2));
if(results.some(r=>r.providers.status!==200||!r.googleApp.ready))process.exitCode=1;
