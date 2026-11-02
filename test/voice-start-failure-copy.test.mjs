import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';

// The actual Cloud voice failure mapper, without importing the app, opening credentials or
// contacting any service. A voice conversation that fails to start shows none of this: it ends
// quietly (voice-calm-cloud-errors.test.mjs).
const cloud=readFileSync(new URL('../apps/app/src/runtime/cloud-voice.ts',import.meta.url),'utf8');
const mapperSource=cloud.slice(cloud.indexOf('function voiceLimitMessage('),cloud.indexOf('/** Product registration only;')).replace('export function cloudVoiceFailure','function cloudVoiceFailure');
const makeCloudMapper=own=>new Function('developmentCloudVoiceEnabled','browserCloudResidentEnabled','connectionController','cloudServiceName','cloudVoiceServiceLimit','retryDuration',stripTypeScriptTypes(mapperSource,{mode:'transform'})+';return cloudVoiceFailure;')(false,false,{getCloudEnvironment:()=> 'production',getSnapshot:()=>({residentInference:own?'direct':'cloud'})},()=> 'Cloud',error=>error.code==='voice-http-429'?{kind:'request-limit',retryAfterMs:120000}:null,()=> '2 minutes');
const cloudMapper=makeCloudMapper(false);

test('known auth and rate-limit failures keep their Cloud recovery text',()=>{
 assert.match(cloudMapper({code:'voice-http-401',message:'secret'}),/Sign in to Cloud again in Settings/);
 assert.match(cloudMapper({code:'voice-http-403'}),/Sign in to Cloud again in Settings/);
 assert.match(cloudMapper({code:'voice-http-429'}),/request limit.*2 minutes/);
});

test('own-provider HTTP failures name Cartesia and never request a Cloud plan or expose provider text',()=>{
 for(const code of ['voice-http-401','voice-http-403','voice-http-429','voice-http-503']){
  const text=makeCloudMapper(true)({code,message:'PRIVATE_PROVIDER_TEXT'});
  assert.match(text,/Cartesia.*Check your own key or provider allowance/);
  assert.doesNotMatch(text,/Sign in to Cloud|plan|PRIVATE_PROVIDER_TEXT/);
 }
});
