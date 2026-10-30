import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {createCloudResidentHost,productCharacterHostFixture} from './fixtures/product-character-host.mjs';
import fsSync from 'node:fs';
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

test('Cloud readiness waits for the single running agent after the auth listener is available',async()=>{
 const profile=await fs.mkdtemp(join(tmpdir(),'alpha-cloud-ready-'));let calls=0,done;
 const host=await createCloudResidentHost({source:resolve('vendor/eliza'),profile,port:47869,
  launch:async()=>({completion:new Promise(resolve=>done=resolve),async stop(){done({code:0});}}),
  request:async url=>{
   assert.equal(new URL(url).pathname,'/api/agents');calls++;
   if(calls===1)return new Response('{}',{status:503});
   return Response.json({agents:[{status:calls===2?'starting':'running'}]});
  }});
 try{await host.clear();assert.deepEqual(JSON.parse(JSON.stringify(await host.ready(new AbortController().signal))),{state:'host-managed'});assert.equal(calls,3);
  await host.bind({token:'synthetic-cloud-secret',credentialId:'retained',reference:'retained-ref'});
  const controller=new AbortController();controller.abort();await assert.rejects(host.ready(controller.signal),{name:'AbortError'});
  assert.equal(host.status('retained').attachable,true,'cancelled readiness preserves the admitted Cloud binding');
 }finally{await host.close();await fs.rm(profile,{recursive:true,force:true});}
});

test('first readiness preserves a concurrently queued Cloud binding',async()=>{
 const profile=await fs.mkdtemp(join(tmpdir(),'alpha-cloud-resident-')),launches=[],events=[];
 const launch=async options=>{let done;const completion=new Promise(resolve=>done=resolve);launches.push(options.env.ELIZAOS_CLOUD_USE_INFERENCE);events.push('start');return {completion,async stop(){events.push('stop');done({code:0});}};};
 const host=await createCloudResidentHost({source:resolve('vendor/eliza'),profile,port:47869,launch,request:async()=>Response.json({agents:[{status:'running'}]}),inherited:{PATH:process.env.PATH}});
 try{
  const binding=host.bind({token:'synthetic-cloud-secret',credentialId:'first',reference:'ref-first'});
  const readiness=host.ready(new AbortController().signal);
  await Promise.all([binding,readiness]);
  assert.deepEqual(launches,['true'],'readiness must reuse the bound resident');
  assert.equal(host.status('first').attachable,true);
  assert.deepEqual(events,['start'],'readiness must not retire the bound resident');
 }finally{await host.close();await fs.rm(profile,{recursive:true,force:true});}
});

 test('actual Cloud launcher strips inherited provider authority before enabling only resident batch speech',async()=>{
 const directory=await fs.mkdtemp(join(tmpdir(),'alpha-cloud-launcher-')),source=join(directory,'source'),capture=join(directory,'capture.json'),loader=join(directory,'loader.mjs');
 const port=async()=>{const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const selected=server.address().port;await new Promise(resolve=>server.close(resolve));return selected;};
 try{
  await fs.mkdir(join(source,'node_modules'),{recursive:true});
  await fs.writeFile(loader,`import child from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {EventEmitter} from 'node:events';import {writeFileSync} from 'node:fs';child.spawn=(command,args,options)=>{const keys=['ELIZA_DEV_ALLOW_TEST_MOCKS','VITE_ELIZA_DEV_ALLOW_TEST_MOCKS','VITE_ALPHA_CLOUD_RESIDENT','VITE_ALPHA_CLOUD_ENVIRONMENT','ALPHA_DEV_CLOUD_VOICE','ALPHA_DEV_CARTESIA','ALPHA_DEV_CLOUD_REALTIME_VOICE','VITE_ALPHA_DEV_CLOUD_VOICE','CEREBRAS_API_KEY','OPENAI_API_KEY','ELIZAOS_CLOUD_API_KEY'];writeFileSync(process.env.ALPHA_LAUNCHER_TEST_CAPTURE,JSON.stringify(Object.fromEntries(keys.map(key=>[key,options.env[key]??null]))));const result=new EventEmitter();result.kill=()=>true;queueMicrotask(()=>result.emit('exit',0));return result;};syncBuiltinESMExports();`);
  const run=spawnSync(process.execPath,['--import',loader,'scripts/dev-cloud.mjs'],{cwd:process.cwd(),env:{...process.env,ALPHA_ELIZA_SOURCE:source,ALPHA_REMOTE_PORT:String(await port()),ALPHA_CLOUD_UI_PORT:String(await port()),ALPHA_CLOUD_ENVIRONMENT:'staging',ALPHA_LAUNCHER_TEST_CAPTURE:capture,CEREBRAS_API_KEY:'synthetic-direct',OPENAI_API_KEY:'synthetic-openai',ELIZAOS_CLOUD_API_KEY:'synthetic-cloud',ALPHA_DEV_CARTESIA:'1',ALPHA_DEV_CLOUD_REALTIME_VOICE:'1',VITE_ALPHA_DEV_CLOUD_VOICE:'1'},encoding:'utf8',timeout:20000});
  assert.equal(run.status,0,run.stderr);
  const env=JSON.parse(await fs.readFile(capture,'utf8'));assert.equal(env.ALPHA_DEV_CLOUD_VOICE,'1');assert.equal(env.ELIZA_DEV_ALLOW_TEST_MOCKS,'');assert.equal(env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS,'');assert.equal(env.VITE_ALPHA_CLOUD_RESIDENT,'1');assert.equal(env.VITE_ALPHA_CLOUD_ENVIRONMENT,'staging');
  for(const key of ['CEREBRAS_API_KEY','OPENAI_API_KEY','ELIZAOS_CLOUD_API_KEY','ALPHA_DEV_CARTESIA','ALPHA_DEV_CLOUD_REALTIME_VOICE','VITE_ALPHA_DEV_CLOUD_VOICE'])assert.equal(env[key],null,key);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
 });


for(const existingPassphrase of [false,true])test(`platform vault preserves existing keychain authority with ${existingPassphrase?'an unrelated':'no'} profile passphrase`,{skip:process.platform!=='darwin'},async()=>{
 let touchedPassphrase=false;
 const guardedFs=new Proxy(fsSync,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function')return value;return function(...args){
  if(typeof args[0]==='string'&&args[0].endsWith('/vault-passphrase')){touchedPassphrase=true;throw Error('Platform host must not access a profile passphrase');}
  return value.apply(target,args);
 };}});
 const launches=[];
 const fixture=productCharacterHostFixture(undefined,{vaultMode:'platform',profileMode:'full',inherited:{ELIZA_VAULT_PASSPHRASE:'forbidden-inherited-secret'},launch:async options=>{
  // The existing launch seam retains this personal profile's local embeddings.
  const env={...options.env,ELIZAOS_CLOUD_USE_EMBEDDINGS:'false'};
  delete env.ELIZA_DISABLE_LOCAL_EMBEDDINGS;delete env.ELIZA_LOCAL_EMBEDDING_ENABLED;
  delete env.ELIZAOS_CLOUD_EMBEDDING_MODEL;delete env.ELIZAOS_CLOUD_EMBEDDING_DIMENSIONS;
  launches.push({...options,env});let finish;return {completion:new Promise(done=>finish=done),async stop(){finish({code:0});}};
 }},guardedFs);
 let host;
 try{
  await fs.mkdir(fixture.profile,{mode:0o700});
  const saved=JSON.stringify({cloud:{enabled:true},serviceRouting:{llmText:{backend:'elizacloud',transport:'cloud-proxy'},embeddings:{backend:'eliza-local-inference',transport:'direct'}},plugins:{entries:{'personal-assistant':{enabled:true}}}})+'\n';
  await fs.writeFile(join(fixture.profile,'eliza.json'),saved,{mode:0o600});
  await fs.writeFile(join(fixture.profile,'owner-token'),'1'.repeat(64),{mode:0o600});
  if(existingPassphrase)await fs.writeFile(join(fixture.profile,'vault-passphrase'),'existing-do-not-read-or-replace',{mode:0o600});
  host=await fixture.make();
  await host.bind({token:'synthetic-platform-cloud-token',credentialId:'same-owner',reference:'same-ref'});
  assert.equal(host.status('same-owner').attachable,true);
  await host.bind({token:'synthetic-platform-cloud-token',credentialId:'same-owner',reference:'same-ref'});
  assert.equal(launches.length,1,'same account binding reuses its process');
  await host.clear();
  assert.equal(launches.length,2);
  for(const call of launches){
   assert.equal(Object.hasOwn(call.env,'ELIZA_VAULT_PASSPHRASE'),false);
   assert.equal(call.cwd,fixture.profile);
   assert.equal(call.env.ELIZAOS_CLOUD_USE_EMBEDDINGS,'false');
   assert.equal(call.env.ELIZA_DISABLE_LOCAL_EMBEDDINGS,undefined);
  }
  assert.equal(touchedPassphrase,false,'host must never create, inspect, read or write a profile passphrase');
  assert.equal(await fs.readFile(join(fixture.profile,'eliza.json'),'utf8'),saved);
  if(existingPassphrase)assert.equal(await fs.readFile(join(fixture.profile,'vault-passphrase'),'utf8'),'existing-do-not-read-or-replace');
  else await assert.rejects(fs.stat(join(fixture.profile,'vault-passphrase')),{code:'ENOENT'});
 }finally{await host?.close();fixture.close();}
});
