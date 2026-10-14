import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

// Plain-JVM compile and run of the native renderer-transport route policy. This does not build an
// APK, run on Android, or contact Eliza Cloud or any agent.
test('native transport refuses production pairing and non-Cloud origins and admits DELETE only for Cloud self-revocation',()=>{
 const root=resolve(import.meta.dirname,'..'),temporary=mkdtempSync(join(tmpdir(),'connection-routes-'));
 const java=process.env.JAVA_HOME||(process.platform==='darwin'?'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home':'');const binary=name=>java?join(java,'bin',name):name;
 try{
  execFileSync(binary('javac'),['--release','11','-d',temporary,join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/ConnectionRoutes.java'),join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/CloudKeyRevocation.java'),join(root,'test/fixtures/ConnectionRoutesTest.java')],{timeout:60000});
  assert.match(execFileSync(binary('java'),['-cp',temporary,'ai.elizaresearch.alphaphone.ConnectionRoutesTest'],{encoding:'utf8',timeout:60000}),/^PASS connection routes/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});

// Source-order check of the plugin that applies the policy; the policy itself is run on the JVM above.
test('the transport applies the origin policy before any connection and never touches a credential slot',()=>{
 const source=readFileSync(resolve(import.meta.dirname,'../android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaConnectionPlugin.java'),'utf8');
 const request=source.slice(source.indexOf('@PluginMethod public void request('),source.indexOf('@PluginMethod public void cancel('));
 const validated=request.indexOf('validatedUrl(call.getString("url"), true)');
 const guard=request.indexOf('if(!ConnectionRoutes.admittedOrigin(url.getScheme(),url.getHost(),url.getPort(),BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS))throw new IllegalArgumentException();');
 assert.ok(validated>0&&guard>validated,'the origin guard follows URL validation');
 for(const later of ['openConnection()','call.getObject("headers"','call.getString("body")','foregroundLock.wait','ConnectionRoutes.retiredPairing('])
  assert.ok(request.indexOf(later)>guard,`${later} comes after the origin guard`);
 const service=request.indexOf('if(!ConnectionRoutes.managedService(');
 assert.ok(service>guard&&service<request.indexOf('openConnection()')&&service<request.indexOf('call.getObject("headers"'),'managed path admission precedes transport/header handling');
 assert.doesNotMatch(request,/storage\(|CredentialSlot|AlphaCredentialStore|secure(Read|Write|Remove)/,'request() has no credential-slot access');
});

// Source checks of the native wiring the JVM run above cannot reach (Android classes).
test('Reset Alpha data records the reset, revokes Cloud keys best effort within a deadline, then resets',()=>{
 const source=readFileSync(resolve(import.meta.dirname,'../android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaResetPlugin.java'),'utf8');
 const authenticated=source.slice(source.indexOf('@ActivityCallback private void authenticated('),source.indexOf('static final long REVOCATION_DEADLINE_MS'));
 const record=authenticated.indexOf('AlphaDataReset.record(getContext());'),revoke=authenticated.indexOf('revokeCloudKeysThenReset(');
 assert.ok(record>0&&revoke>record,'the reset is recorded before any network request');
 assert.match(authenticated,/main\.postDelayed\(reset,REVOCATION_DEADLINE_MS\)/,'a deadline resets even when revocation hangs');
 assert.match(authenticated,/finally\{main\.post\(reset\);\}/,'revocation always ends in the reset');
 assert.match(authenticated,/dispatched\.compareAndSet\(false,true\)/,'the reset is dispatched once');
 assert.match(authenticated,/CloudKeyRevocation\.revoke\(environment,/,'revocation goes through the exact self-revocation policy');
 assert.match(source,/REVOCATION_DEADLINE_MS=8000;/);
});
test('production refuses a direct (bring-your-own) provider key before reading it',()=>{
 const source=readFileSync(resolve(import.meta.dirname,'../android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java'),'utf8');
 const method=source.slice(source.indexOf('@PluginMethod public void configureProvider('),source.indexOf('@PluginMethod public void clearProvider('));
 const gate=method.indexOf('if(!directProviderAllowed(BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS)){call.reject(');
 assert.ok(gate>0&&gate<method.indexOf('call.getString("apiKey"')&&gate<method.indexOf('saveVerifiedProvider('),'the gate precedes reading or saving the key');
 assert.match(source,/static boolean directProviderAllowed\(boolean testMocks\)\{return testMocks;\}/);
 const renderer=readFileSync(resolve(import.meta.dirname,'../apps/app/src/runtime/local-agent.ts'),'utf8');
 const configure=renderer.slice(renderer.indexOf('export async function configureLocalProvider('),renderer.indexOf('export async function localProviderStatus('));
 assert.ok(configure.indexOf("VITE_ELIZA_DEV_ALLOW_TEST_MOCKS==='1'))throw")>0&&configure.indexOf("VITE_ELIZA_DEV_ALLOW_TEST_MOCKS==='1'))throw")<configure.indexOf('native.configureProvider('),'the renderer refuses before the native call');
});
test('native transport labels subscription routes and no longer names the credit balance',()=>{
 const source=readFileSync(resolve(import.meta.dirname,'../android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaConnectionPlugin.java'),'utf8');
 assert.doesNotMatch(source,/credits\/balance|BALANCE\b/);
 assert.match(source,/"\/api\/v1\/subscription\/redeem"\.equals\(path\)\)operation=RequestOperation\.REDEEM/);
});
