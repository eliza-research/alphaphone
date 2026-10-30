import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import {googleOutcome} from '../apps/app/src/runtime/cloud-sign-in.ts';

const attemptId='12345678-1234-1234-1234-123456789abc';
const required=()=>({status:'mfa',method:'totp',expiresAt:Date.now()+60000,attemptId,environment:'production'});
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
function method(source,start,end){const from=source.indexOf(start),to=source.indexOf(end,from);assert.ok(from>=0&&to>from);return source.slice(from,to);}

test('Google MFA outcome is bound to the native attempt and environment, with no credential or challenge disclosure',()=>{
 const outcome=required();assert.deepEqual(googleOutcome(outcome,'production'),outcome);
 for(const patch of [{attemptId:undefined},{attemptId:'---'},{environment:'staging'},{method:'unknown'},{challengeId:'server-secret'},{token:'secret'},{expiresAt:0}]) {
  assert.throws(()=>googleOutcome({...required(),...patch},'production'));
 }
 assert.throws(()=>googleOutcome({...required(),expiresAt:Date.now()-1},'production'),error=>error.code==='expired');
});

test('Google protocol requests a native second factor without requiring or accepting a stored Cloud credential',async()=>{
 const source=read('apps/app/src/runtime/cloud-protocol.ts');
 const code=method(source,'  async signInWithGoogle(','  /** Sends a six-digit code');
 const compiled=transformSync('const client={'+code+'};',{loader:'ts'}).code;
 const client=new Function('googleOutcome',compiled+'return client;')(googleOutcome);
 client.environment='production';
 let credentialChecks=0;
 client.confirmStoredSignIn=async result=>{credentialChecks++;return result;};
 client.signInStep=async(signal,run,parse)=>parse(await run({startGoogle:async input=>{assert.equal(input.environment,'production');return required();}}));
 assert.equal((await client.signInWithGoogle(new AbortController().signal)).status,'mfa');
 assert.equal(credentialChecks,0,'no sign-in or credential admission before MFA');
 const completed={status:'authenticated',environment:'production',expiresAt:Date.now()+60000,accountCreated:false};
 client.signInStep=async()=>completed;
 assert.deepEqual(await client.signInWithGoogle(new AbortController().signal),completed);
 assert.equal(credentialChecks,1,'a completed sign-in still requires the saved credential');
});

test('native Google and email share MFA admission; callback state custody remains native',()=>{
 const source=read('vendor/eliza/packages/auth/android/src/main/java/ai/eliza/auth/cloud/CloudSignInPlugin.java');
 const complete=method(source,' private void complete(Attempt current, JSONObject session)',' /** The saved key');
 assert.ok(complete.indexOf('session.opt("mfaRequired")')<complete.indexOf('session.optString("token"'),'MFA is handled before a token is required');
 assert.match(complete,/Math\.min\(current\.expiresAt, expiresAt\)/);
 assert.match(complete,/deadline <= System\.currentTimeMillis\(\)/);
 assert.match(complete,/if \(destroyed \|\| attempt != current \|\| current\.cancelled\)/);
 assert.match(complete,/if \(current\.mfaType != null\)/,'a second challenge cannot replace an active challenge');
 assert.match(complete,/notifyListeners\("signInMfaRequired", required, true\)/,'cold Google return retains only its nonsecret outcome');
 const verify=method(source,' private void verify(PluginCall call, boolean mfa)',' private void release(');
 assert.match(verify,/\(current\.google && !mfa\)/,'Google may verify MFA, never an email code');
 assert.match(verify,/!current\.id\.equals\(call\.getString\("attemptId"\)\)/);
 assert.match(verify,/current\.failedVerifies >= CloudSignInFlow\.MAX_VERIFY_ATTEMPTS/);
 assert.match(source,/owner\.expiresAt = pending\.expiresAt/,'Google MFA remains bounded by the original attempt');
});

test('native Google MFA resume requires the same current unexpired attempt',()=>{
 const native=read('vendor/eliza/packages/auth/android/src/main/java/ai/eliza/auth/cloud/CloudSignInPlugin.java');
 const resume=method(native,' @PluginMethod public void resumeMfa(',' @PluginMethod public void cancel(');
 for(const guard of ['!attempt.cancelled','attempt.mfaType != null','attempt.id.equals(call.getString("attemptId"))','attempt.environment.name.equals(call.getString("environment"))','attempt.expiresAt > System.currentTimeMillis()'])assert.ok(resume.includes(guard),guard);
});
