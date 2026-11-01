import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {tsImport} from 'tsx/esm/api';
import {googleControllerHarness} from './fixtures/google-controller.mjs';

// Android as Capacitor 8 sees it, set up before @capacitor/core loads: the WebView bridge plus the
// AlphaCloudSignIn header listing the real @PluginMethods of AlphaCloudSignInPlugin and the SDK's
// CloudSignInPlugin. The registered plugin is the real proxy, which answers any property name.
const java=['android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaCloudSignInPlugin.java','vendor/eliza/packages/auth/android/src/main/java/ai/eliza/auth/cloud/CloudSignInPlugin.java']
 .map(path=>readFileSync(new URL('../'+path,import.meta.url),'utf8'));
const methods=[...new Set(java.flatMap(source=>[...source.matchAll(/@PluginMethod\s+public void (\w+)\(/g)].map(match=>match[1])))];
const native={calls:[],start:null};
globalThis.androidBridge={postMessage(){}};
globalThis.Capacitor={PluginHeaders:[{name:'AlphaCloudSignIn',methods:methods.map(name=>({name,rtype:'promise'}))}],
 nativePromise:(_plugin,method)=>{native.calls.push(method);if(method==='startGoogle')return new Promise(resolve=>{native.start=resolve;});if(method==='cancel')return Promise.resolve({});return Promise.reject(Error('Unexpected native method '+method));}};
const {registerPlugin,Capacitor}=await import('@capacitor/core');
const {CloudProtocol}=await tsImport(new URL('../apps/app/src/runtime/cloud-protocol.ts',import.meta.url).href,{parentURL:import.meta.url});
const owner='11111111-1111-4111-8111-111111111111',org='22222222-2222-4222-8222-222222222222';
// The slot CloudSignInPlugin.java writes after a native sign-in: a token, never a browser reference.
const saved={credentialId:randomUUID(),token:'synthetic-native-credential-not-a-real-key',expiresAt:Date.now()+3600_000,serverCredentialId:randomUUID()};

async function nativeGoogle(){
 native.calls.length=0;native.start=null;
 const port=registerPlugin('AlphaCloudSignIn'),store={acceptsReferences:false,read:async()=>({...saved}),write:async()=>{throw Error('The native host stores the key');},clear:async()=>{throw Error('No clear');}};
 const client=Object.assign(new CloudProtocol('production',async()=>{throw Error('No external request');},store,async()=>{throw Error('No external window');},{signIn:port}),{identity:async()=>({userId:owner,organizationId:org})});
 const harness=await googleControllerHarness(client,store,{realWork:true});
 const started=async()=>{for(const until=Date.now()+5000;!native.start;await new Promise(resolve=>setTimeout(resolve,1)))assert.ok(Date.now()<until,'native startGoogle was called');};
 return {port,client,harness,started,complete:()=>native.start({status:'authenticated',environment:'production',expiresAt:saved.expiresAt,attemptId:randomUUID(),credentialId:saved.serverCredentialId,accountCreated:false})};
}
test('Android Google port is a Capacitor proxy without a native commit-aware cancel',async()=>{
 assert.equal(Capacitor.getPlatform(),'android');assert.ok(methods.includes('startGoogle')&&methods.includes('cancel'));
 assert.equal(methods.includes('cancelGoogleSignIn'),false);
 const {port,client}=await nativeGoogle();
 assert.equal(typeof port.cancelGoogleSignIn,'function','the proxy answers any method name');
 assert.equal(client.googleCancellationSupported,false);assert.equal(await client.cancelGoogleSignIn(),false);
});
test('native Google completion through the controller adopts the natively stored key',async()=>{
 const f=await nativeGoogle(),signing=f.harness.actions.signInGoogle();await f.started();f.complete();await signing;
 assert.equal(f.harness.state.cloudAccount?.credentialId,saved.credentialId);assert.equal(f.harness.state.signIn,null);assert.equal(f.harness.state.error,'');
 assert.deepEqual(native.calls,['startGoogle']);
});
test('native Google Cancel through the controller cancels the native attempt and returns to the chooser',async()=>{
 const f=await nativeGoogle(),signing=f.harness.actions.signInGoogle();await f.started();
 await f.harness.actions.cancelSignIn();await signing;
 assert.ok(native.calls.includes('cancel'),'the native plugin cancel ran');
 assert.equal(f.harness.state.signIn.step,'choose');assert.equal(f.harness.state.error,'');assert.equal(f.harness.state.busy,false);assert.equal(f.harness.state.cloudAccount,undefined);
 f.complete();
});
