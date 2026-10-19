import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
// Compile the actual adapter with Vite's environment substitution, rather than
// invoking its Node-only branch (which intentionally admits both issuers).
async function protocol(env){
 const result=await build({stdin:{contents:"export {cloudEnvironmentAvailable,planManagementUrl} from './apps/app/src/runtime/cloud-protocol.ts';export {browserCloudManagedServiceAllowed} from './apps/app/src/runtime/browser-cloud-resident.ts';export {nativeCloudRequest} from './apps/app/src/runtime/native-connection.ts';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,define:{'import.meta.env':JSON.stringify(env)},logLevel:'silent'});
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
test('actual Cloud adapter admits explicit staging resident without mocks and refuses packaged staging',async()=>{
 const flags={DEV:true,VITE_ALPHA_CLOUD_RESIDENT:'1',VITE_ALPHA_CLOUD_ENVIRONMENT:'staging',VITE_ELIZA_DEV_ALLOW_TEST_MOCKS:''};
 const staging=await protocol(flags);assert.equal(staging.cloudEnvironmentAvailable('staging'),true);assert.equal(staging.planManagementUrl('staging'),'https://cloud-staging.eliza.app/cloud/billing');
 for(const env of [{...flags,DEV:false},{...flags,VITE_ALPHA_CLOUD_RESIDENT:''},{...flags,VITE_ALPHA_CLOUD_ENVIRONMENT:'production'}]){
  const p=await protocol(env);assert.equal(p.cloudEnvironmentAvailable('staging'),false);assert.throws(()=>p.planManagementUrl('staging'),/unavailable/);assert.equal(p.cloudEnvironmentAvailable('production'),true);
 }
});

test('real staging transport reaches identity and entitlement but rejects other authorities and agent routes',async()=>{
 const p=await protocol({DEV:true,VITE_ALPHA_CLOUD_RESIDENT:'1',VITE_ALPHA_CLOUD_ENVIRONMENT:'staging',VITE_ELIZA_DEV_ALLOW_TEST_MOCKS:''});
 for(const path of ['/api/v1/user','/api/v1/subscription/entitlement','/api/v1/subscription/entitlement-keys'])assert.equal(p.browserCloudManagedServiceAllowed('https://api-staging.eliza.app'+path,'GET'),true);
 for(const url of ['https://api.eliza.app/api/v1/user','https://evil.invalid/api/v1/user','https://api-staging.eliza.app.evil.invalid/api/v1/user','https://user@api-staging.eliza.app/api/v1/user','https://api-staging.eliza.app:444/api/v1/user','https://api-staging.eliza.app/api/agents'])assert.equal(p.browserCloudManagedServiceAllowed(url,'GET'),false,url);
 const original=globalThis.fetch,calls=[];globalThis.fetch=async(url,init)=>{calls.push(JSON.parse(init.body));return Response.json({status:200,data:{}});};
 try{const reply=await p.nativeCloudRequest({url:'https://api-staging.eliza.app/api/v1/user',method:'GET',headers:{},timeoutMs:1000,signal:new AbortController().signal});assert.equal(reply.status,200);assert.equal(calls[0].input.url,'https://api-staging.eliza.app/api/v1/user');assert.equal(calls[0].environment,'staging');}finally{globalThis.fetch=original;}
 const packaged=await protocol({DEV:false,VITE_ALPHA_CLOUD_RESIDENT:'1',VITE_ALPHA_CLOUD_ENVIRONMENT:'staging'});assert.equal(packaged.browserCloudManagedServiceAllowed('https://api-staging.eliza.app/api/v1/user','GET'),false);
});
