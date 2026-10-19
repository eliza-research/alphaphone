import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
// Compile the actual adapter with Vite's environment substitution, rather than
// invoking its Node-only branch (which intentionally admits both issuers).
async function protocol(env){
 const result=await build({stdin:{contents:"export {cloudEnvironmentAvailable,planManagementUrl} from './apps/app/src/runtime/cloud-protocol.ts';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,define:{'import.meta.env':JSON.stringify(env)},logLevel:'silent'});
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
test('actual Cloud adapter admits explicit staging resident without mocks and refuses packaged staging',async()=>{
 const flags={DEV:true,VITE_ALPHA_CLOUD_RESIDENT:'1',VITE_ALPHA_CLOUD_ENVIRONMENT:'staging',VITE_ELIZA_DEV_ALLOW_TEST_MOCKS:''};
 const staging=await protocol(flags);assert.equal(staging.cloudEnvironmentAvailable('staging'),true);assert.equal(staging.planManagementUrl('staging'),'https://cloud-staging.eliza.app/cloud/billing');
 for(const env of [{...flags,DEV:false},{...flags,VITE_ALPHA_CLOUD_RESIDENT:''},{...flags,VITE_ALPHA_CLOUD_ENVIRONMENT:'production'}]){
  const p=await protocol(env);assert.equal(p.cloudEnvironmentAvailable('staging'),false);assert.throws(()=>p.planManagementUrl('staging'),/unavailable/);assert.equal(p.cloudEnvironmentAvailable('production'),true);
 }
});
