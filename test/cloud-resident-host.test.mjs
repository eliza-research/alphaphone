import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createCloudResidentHost} from '../scripts/cloud-resident-host.mjs';
test('Cloud host retires old processes, strips direct-provider keys and never persists Cloud credentials',async()=>{
 const profile=await fs.mkdtemp(join(tmpdir(),'alpha-cloud-resident-')),events=[],launches=[];let rejectStop=false;
 const launch=async options=>{let done;const completion=new Promise(resolve=>done=resolve);const id=launches.length;launches.push(options);events.push('start'+id);return {completion,async stop(){events.push('stop'+id);if(rejectStop)throw Error('stop failed');done({code:0});}};};
 const host=await createCloudResidentHost({source:resolve('vendor/eliza'),profile,port:47869,environment:'staging',launch,inherited:{PATH:process.env.PATH,CEREBRAS_API_KEY:'forbidden-direct-key',OPENAI_API_KEY:'forbidden-openai',ELIZAOS_CLOUD_API_KEY:'forbidden-inherited-cloud'}});
 try{
  await host.clear();assert.equal(launches[0].env.ELIZAOS_CLOUD_USE_INFERENCE,'false');
  const binding={token:'synthetic-cloud-secret',credentialId:'first',reference:'ref-first'};
  await host.bind(binding);assert.deepEqual(events,['start0','stop0','start1']);
  const env=launches[1].env;assert.equal(env.ELIZAOS_CLOUD_API_KEY,binding.token);assert.equal(env.ELIZAOS_CLOUD_BASE_URL,'https://api-staging.eliza.app/api/v1');assert.equal(env.ELIZA_DEV_SOURCE,'1');assert.equal(env.ELIZA_DEV_CLOUD_ENV_AUTHORITY,'staging-explicit');assert.equal(env.ELIZAOS_CLOUD_USE_INFERENCE,'true');assert.equal(env.CEREBRAS_API_KEY,undefined);assert.equal(env.OPENAI_API_KEY,undefined);assert.match(env.ELIZA_VAULT_PASSPHRASE,/^[a-f0-9]{64}$/);
  assert.equal(host.status('first').attachable,true);assert.equal(host.status('other').attachable,false);assert.ok(!JSON.stringify(host.status()).includes(binding.token));
  await host.bind(binding);assert.equal(launches.length,2,'same binding reuses resident');
  await host.clear();assert.deepEqual(events,['start0','stop0','start1','stop1','start2']);assert.equal(host.status().configured,false);assert.equal(launches[2].env.ELIZAOS_CLOUD_API_KEY,undefined);
  rejectStop=true;await assert.rejects(host.bind(binding),/stop failed/);assert.equal(launches.length,3);await assert.rejects(host.bind(binding),/stop failed/);assert.equal(launches.length,3,'failed retirement never launches a replacement');await assert.rejects(host.clear(),/stop failed/);await assert.rejects(host.ready(new AbortController().signal),/retirement unconfirmed/);assert.equal(launches.length,3);rejectStop=false;await host.clear();assert.equal(launches.length,4,'successful retirement can restart an unbound resident');
  assert.ok(!(await fs.readFile(join(profile,'eliza.json'),'utf8')).includes(binding.token));assert.equal((await fs.stat(join(profile,'vault-passphrase'))).mode&0o777,0o600);
 }finally{await host.close();await fs.rm(profile,{recursive:true,force:true});}
});
