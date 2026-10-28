import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {root,nativeSource,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';
import {prepareNativeFixture} from './fixtures/native-source.mjs';
test('explicit native legacy recovery uses real encrypted slots and current token validation',{skip:jsonJarSkip},()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-legacy-recovery-'));
 try{
  const prepared=prepareNativeFixture(root,dir).root;
  const relative='plugins/plugin-native-secure-store/android/src/main/java/ai/eliza/plugins/securestore/nativeonly/JsonCredentialSlots.java';
  let source=readFileSync(join(prepared,relative),'utf8').replace('import android.security.keystore.KeyGenParameterSpec;','').replace('import android.security.keystore.KeyProperties;','');
  const start=source.indexOf(' private SecretKey key()'),end=source.indexOf(' private static Object parseJson',start);assert.ok(start>0&&end>start);
  // Host-only key acquisition adapter. AES-GCM/AAD, parsing, hashing, committed readback and CAS remain real.
  source=source.slice(0,start)+' private SecretKey key(){return new javax.crypto.spec.SecretKeySpec(new byte[32],"AES");}\n'+source.slice(end);
  const store=join(dir,'JsonCredentialSlots.java');writeFileSync(store,source);
  const atomic=join(dir,'AtomicFile.java');
  writeFileSync(atomic,readFileSync(join(root,'test/fixtures/secure-store-memory/android/util/AtomicFile.java'),'utf8').replace('public static int corruptNextCommit;','public static int corruptNextCommit; public static int failAfterStarts=-1;').replace('return new FileOutputStream(file);','if(failAfterStarts==0){failAfterStarts=-1;throw new IOException("synthetic write failure");}if(failAfterStarts>0)failAfterStarts--;return new FileOutputStream(file);'));
  const context=join(dir,'Context.java');writeFileSync(context,`package android.content;public class Context {private final java.io.File directory;public Context(java.io.File directory){this.directory=directory;}public Context getApplicationContext(){return this;}public java.io.File getNoBackupFilesDir(){return directory;}}`);
  const nativeLifecycle=readFileSync(nativeSource('AlphaLocalAgentPlugin.java'),'utf8');
  const powerEpoch=nativeLifecycle.match(/^ private static long powerAuthorizationMutationEpoch;$/m)?.[0];
  const powerStart=nativeLifecycle.indexOf(' static void powerAuthorizationChanged(){'),powerEnd=nativeLifecycle.indexOf(' /** A protected launch constraint',powerStart);
  assert.ok(powerEpoch&&powerStart>0&&powerEnd>powerStart);
  const fastStart=nativeLifecycle.indexOf(' static <T> T mutateCredentials('),fastEnd=nativeLifecycle.indexOf('   startRequestId=',fastStart);
  const intentStart=nativeLifecycle.indexOf(' static void requireCredentialIntent('),intentEnd=nativeLifecycle.indexOf('\n',intentStart);
  const bindingStart=nativeLifecycle.indexOf(' static void bindCloudProvider('),bindingEnd=nativeLifecycle.indexOf(' /** Direct configuration',bindingStart);
  assert.ok(bindingStart>0&&bindingEnd>bindingStart);
  const clearStart=nativeLifecycle.indexOf(' static JSObject clearProviderSlot('),clearEnd=nativeLifecycle.indexOf(' /** Which surface',clearStart);
  const identityStart=nativeLifecycle.indexOf(' static JSObject providerIdentity('),identityEnd=nativeLifecycle.indexOf(' @PluginMethod public void providerStatus(',identityStart);
  assert.ok(clearStart>0&&clearEnd>clearStart&&identityStart>0&&identityEnd>identityStart);
  const jsObject=join(dir,'JSObject.java');writeFileSync(jsObject,'package com.getcapacitor;public class JSObject extends org.json.JSONObject {public JSObject(String text){super(text);}}');
  assert.ok(fastStart>0&&fastEnd>fastStart&&intentStart>0);
  // Use the actual lifecycle→vault fast path and the ACTUAL synchronized intent check.
  // Process shutdown is fixture-only; these tests do not launch or stop an Android service.
  const lifecycle=join(dir,'AlphaLocalAgentPlugin.java');writeFileSync(lifecycle,`package ai.elizaresearch.alphaphone;import android.content.Context;import org.json.JSONObject;import com.getcapacitor.JSObject;class AlphaLocalAgentPlugin {
   static final Object lifecycleLock=new Object();static long credentialIntentEpoch=1;
   ${powerEpoch}
   ${nativeLifecycle.slice(powerStart,powerEnd)}
   ${nativeLifecycle.slice(intentStart,intentEnd)}
   interface CredentialMutation<T>{boolean requiresShutdown()throws Exception;T commit()throws Exception;}
   ${nativeLifecycle.slice(fastStart,fastEnd)}
    synchronized(ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots.LOCK){ownerBoundary(assertOwner);return mutation.commit();}
   }}
   static void ownerBoundary(Runnable owner){owner.run();}static boolean providerAdmissionReadable(){return true;}
   ${nativeLifecycle.slice(bindingStart,bindingEnd)}
   ${nativeLifecycle.slice(clearStart,clearEnd)}
   ${nativeLifecycle.slice(identityStart,identityEnd)}
  }`);
  const identity=join(dir,'AlphaConnectionPlugin.java');writeFileSync(identity,`package ai.elizaresearch.alphaphone;class AlphaConnectionPlugin {static int verified;static org.json.JSONObject readCloudIdentity(String token)throws Exception{if(Thread.holdsLock(AlphaLocalAgentPlugin.lifecycleLock)||Thread.holdsLock(ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots.LOCK))throw new AssertionError("HTTP held a credential lock");if(!token.equals("synthetic-test-token"))throw new AssertionError();verified++;return LocalAgentProviderAdmission.verifiedCloudIdentity(new org.json.JSONObject().put("id","22222222-2222-4222-8222-222222222222"));}}`);
  const sources=[store,atomic,jsObject,context,lifecycle,identity,nativeSource('RendererCredentialSlots.java'),join(root,'test/fixtures/legacy-cloud-recovery/RendererRecoverySlotsTest.java'),nativeSource('AlphaCredentialStore.java'),nativeSource('CloudDeployment.java'),join(root,'test/fixtures/legacy-cloud-recovery/StoreIntegrationTest.java'),join(root,'vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/NativeProviderAdmission.java'),nativeSource('LocalAgentProviderAdmission.java'),nativeSource('LegacyCloudRecovery.java'),join(root,'test/fixtures/legacy-cloud-recovery/LegacyCloudRecoveryTest.java')];
  const result=runJvm(sources,'ai.elizaresearch.alphaphone.LegacyCloudRecoveryTest',{json:true,args:[join(dir,'slots')]});
  assert.match(result,/PASS actual AlphaCredentialStore/);
  assert.match(result,/PASS renderer logical and physical recovery slot isolation/);
  assert.match(result,/PASS \d+ real encrypted-slot recovery assertions/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('all explicit scoped credential and provider mutations durably suppress legacy reuse',()=>{
 const source=readFileSync(nativeSource('AlphaCredentialStore.java'),'utf8');
 const mutate=source.slice(source.indexOf('private boolean mutateSlotOnce'),source.indexOf(' void assertCurrent'));
 assert.match(mutate,/if\(conflict\)return false;\s+legacyRecovery\(\)\.block\(\);/);
 const admission=source.slice(source.indexOf(' String compareExchangeProviderAdmission'),source.indexOf(' void rollbackProviderAdmission'));
 assert.match(admission,/if\(conflict\)return false;\s+legacyRecovery\(\)\.block\(\);/);
 assert.match(source,/Snapshot before=recoveryStep\(\(\)->legacyRecovery\(\)\.snapshot\(\)\)/);
 assert.match(source,/AlphaConnectionPlugin\.readCloudIdentity\(before\.token\(\)\);\s+return recoveryStep\(\(\)->legacyRecovery\(\)\.commit\(before\)\)/);
});
test('chooser recovery continues through normal resident admission only after native success',async()=>{
 const {transformSync}=await import('esbuild');
 const source=readFileSync(join(root,'apps/app/src/runtime/connection-ui.tsx'),'utf8');
 const start=source.indexOf('  async restoreSavedSignIn()'),end=source.indexOf('  async startLocal()',start);assert.ok(start>0&&end>start);
 const method=transformSync('({'+source.slice(start,end)+'})',{loader:'ts',format:'cjs'}).code.trim().replace(/;$/,'');
 // Exercise the exact controller method, with only native and resident boundaries stubbed.
 const make=new Function('flags',`let isAndroid=flags.android??true,operation=flags.operation??null;const state={cloudAccount:flags.account??null,signIn:flags.view?{environment:flags.view}:null};let nativeCalls=0,starts=0,nativeCancels=0;const updates=[];const controller=new AbortController();const cloudSignIn={async cancel(){nativeCancels++;},async restoreSavedSignIn(){nativeCalls++;if(flags.cancel)controller.abort();if(flags.failure)throw Error('transport');return {restored:flags.restored??true};}};const residentCloudFlow=()=>true,residentEnvironment=()=>flags.environment??'production';const update=x=>updates.push(x);const work=async(_,fn)=>{try{await fn(controller.signal)}catch{}};const connectionController={startLocal:async()=>{starts++;}};const subject=${method};return {subject,abort:()=>controller.abort(),read:()=>({nativeCalls,starts,nativeCancels,updates})};`);
 for(const flags of [{},{restored:false},{cancel:true},{failure:true},{android:false},{operation:{}},{account:{}},{environment:'staging'},{view:'staging'}]){
  const h=make(flags);await h.subject.restoreSavedSignIn();const result=h.read();
  assert.equal(result.starts,Object.keys(flags).length?0:1,JSON.stringify(flags));
  if(flags.android===false||flags.operation||flags.account||flags.environment||flags.view)assert.equal(result.nativeCalls,0);
  assert.equal(result.nativeCancels,flags.cancel?1:0,'UI cancellation reaches native recovery epoch');
  h.abort();await Promise.resolve();assert.equal(h.read().nativeCancels,result.nativeCancels,'finished operation removes its native cancellation listener');
 }
 assert.match(source,/snapshot\.legacySignInRecovery&&requiredSignInView\.step==='choose'/);
 assert.match(source,/current=false/);
});
test('native recovery metadata stays private and cancellation invalidates its continuation',()=>{
 const source=readFileSync(nativeSource('AlphaCloudSignInPlugin.java'),'utf8');
 const start=source.indexOf('@PluginMethod public void savedSignInRecoveryStatus'),end=source.indexOf('// ── Readiness:',start);assert.ok(start>0&&end>start);
 const methods=source.slice(start,end);
 assert.match(methods,/\.put\("eligible",store\(\)\.legacyCloudRecoveryEligible\(\)\)/);
 assert.match(methods,/AlphaLocalAgentPlugin\.reserveCredentialIntent\(\)/);
 assert.match(methods,/recoveryEpoch!=owner/);assert.match(methods,/AlphaLocalAgentPlugin\.requireCredentialIntent\(intent\)/);
 assert.match(methods,/\.put\("restored",restored\)/);
 assert.doesNotMatch(methods,/put\("(?:token|credentialId|userId|organizationId|value)"/);
 const cancel=source.slice(source.indexOf('@PluginMethod public void cancel('),source.indexOf('private void requireAuthorization('));assert.match(cancel,/recoveryEpoch\+\+/);
 const slots=readFileSync(nativeSource('RendererCredentialSlots.java'),'utf8');assert.doesNotMatch(slots,/legacy-recovery|JOURNAL/);
});
test('automatic startup requests presence-only unbind; explicit provider clear retains default semantics',async()=>{
 const {transformSync}=await import('esbuild');
 const source=readFileSync(join(root,'apps/app/src/runtime/local-agent.ts'),'utf8');
 const start=source.indexOf('export async function clearLocalProvider('),end=source.indexOf('/** True only when native',start);assert.ok(start>0&&end>start);
 const code=transformSync(source.slice(start,end).replace('export ',''),{loader:'ts',format:'cjs'}).code;
 const calls=[],native={async clearProvider(input){calls.push(input);return {configured:false};}};
 const run=new Function('native',`const browserCloudResidentEnabled=false,Capacitor={isNativePlatform:()=>true},record=value=>value,localProviderStatus=async()=>({configured:false});${code};return clearLocalProvider;`)(native);
 await run();await run(true);assert.deepEqual(calls,[undefined,{onlyIfPresent:true}]);
 const ui=readFileSync(join(root,'apps/app/src/runtime/connection-ui.tsx'),'utf8');
 assert.match(ui,/Unbound: remove any stored Cloud inference binding[\s\S]*?try\{await clearLocalProvider\(true\);\}catch/);
 const plugin=readFileSync(nativeSource('AlphaLocalAgentPlugin.java'),'utf8');
 assert.match(plugin,/Boolean\.TRUE\.equals\(call\.getBoolean\("onlyIfPresent"\)\)/);
});
