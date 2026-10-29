import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';
import {verifySource,preparedSourceEnv,workerArtifactDirectory,digest} from '../scripts/local-agent-source.mjs';
import {verifyWorkerArtifact} from '../scripts/workflow-worker-artifact.mjs';
import {preparePrivateRuntimeProfile,runtimeEnvironment} from '../vendor/eliza/packages/agent/native-host/private-runtime-launch.mjs';
import {CLOUD_SDK_BASES} from '../scripts/cloud-sdk-authority.mjs';
const product=JSON.parse(fs.readFileSync('config/alpha-product.json','utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
import {productCharacterHostFixture as fixture} from './fixtures/product-character-host.mjs';
test('native declaration uses canonical product name and the existing bio without a renderer or credential input',()=>{
 const text=fs.readFileSync('backend/native-cloud-runtime.ts','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');const js=stripTypeScriptTypes(text,{mode:'transform'});const value=vm.runInNewContext(js+';nativeCloudRuntime',{product,productionCloud:{api:'https://api.example'}});
 assert.equal(value.productCharacter.name,product.identity.characterName);assert.equal(JSON.stringify(value.productCharacter.bio),JSON.stringify([`The assistant built into ${product.identity.appName} for writing, research, decisions and practical follow-through.`]));assert.equal(Object.isFrozen(value),true);assert.equal(Object.isFrozen(value.productCharacter),true);assert.equal(Object.isFrozen(value.productCharacter.bio),true);assert.equal(value.apiBaseUrl,'https://api.example/api/v1');
 const identity=fs.readFileSync('scripts/agent-identity.mjs','utf8');assert.ok(identity.includes('The assistant built into ${identity.appName} for writing, research, decisions and practical follow-through.'));
});
test('bound and unbound Cloud launches get only the verified packaged module paths, independently of credential settings',async()=>{
 const f=fixture();let host;try{host=await f.make();await host.clear();await host.bind({token:'synthetic-token',credentialId:'one',reference:'one'});await host.clear();assert.equal(f.launches.length,3);
 for(const launched of f.launches){assert.equal(launched.env.ELIZA_SMTHRS_RUNTIME_DIR,f.worker);assert.equal(launched.env.ELIZA_NATIVE_GOOGLE_HOST_MODULE,path.join(f.worker,'google-host.mjs'));assert.equal(launched.env.ELIZA_AGENT_CHARACTER_JSON,undefined);assert.equal(launched.env.CEREBRAS_API_KEY,undefined);assert.equal(launched.env.ELIZA_NATIVE_GOOGLE_BINDING_JSON,undefined);assert.equal(launched.env.ELIZA_MANAGED_GMAIL_READ_BROKER,undefined);}
 assert.equal(f.launches[0].env.ELIZAOS_CLOUD_API_KEY,undefined);assert.equal(f.launches[1].env.ELIZAOS_CLOUD_API_KEY,'synthetic-token');assert.equal(f.launches[2].env.ELIZAOS_CLOUD_API_KEY,undefined);
 assert.ok(!fs.readFileSync(path.join(f.profile,'eliza.json'),'utf8').includes('synthetic-token'));
 }finally{await host?.close();f.close();}
});
for(const mode of ['module-missing','module-changed','input-changed','manifest-changed','symlink'])test(`invalid ${mode} artifact refuses before profile creation or process launch`,async()=>{
 const f=fixture(mode);try{await assert.rejects(f.make());assert.equal(f.launches.length,0);assert.equal(fs.existsSync(f.profile),false);}finally{f.close();}
});
test('native configuration keeps only the verified module path through unbound provider stripping',()=>{
 const java=fs.readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java','utf8');
 const unbound=java.slice(java.indexOf(' static void applyUnboundEnvironment('),java.indexOf(' static JSObject providerIdentity('));assert.ok(!unbound.includes('ELIZA_NATIVE_GOOGLE_HOST_MODULE'));assert.ok(unbound.includes('ELIZA_NATIVE_GOOGLE_BINDING_JSON'));assert.ok(!unbound.includes('ELIZA_SMTHRS_RUNTIME_DIR'));for(const key of ['ELIZAOS_CLOUD_API_KEY','CEREBRAS_API_KEY','ELIZA_MANAGED_GMAIL_READ_BROKER','ELIZA_MANAGED_CALENDAR_READ_BROKER'])assert.ok(unbound.includes(key));
 const configure=java.slice(java.indexOf(' static void configureEnvironment('),java.indexOf(' /** Explicit Retry'));
 const installed=configure.indexOf('WorkflowWorkerAssets.install('),module=configure.indexOf('env.put("ELIZA_NATIVE_GOOGLE_HOST_MODULE"'),credentials=configure.indexOf('String saved=null'),cloud=configure.indexOf('if(provider!=null&&"elizacloud"');assert.ok(installed>=0&&module>installed&&credentials>module&&cloud>credentials);
 assert.ok(configure.includes('else if("cloud".equals(BuildConfig.ELIZA_RUNTIME_PROFILE))throw'));
 assert.equal(configure.match(/env.put\("ELIZA_NATIVE_GOOGLE_HOST_MODULE"/g).length,1);
});
