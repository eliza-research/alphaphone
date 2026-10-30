import test from 'node:test';
import {signInReadiness} from '../apps/app/src/runtime/cloud-sign-in.ts';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
const require=createRequire(import.meta.url);

test('phone sign-in and code entry use the shared controller and stay absent without native support',async()=>{
 const {CloudSignInPanel,signInFixture}=await import('./helpers/shared-sign-in.mjs');
 const f=signInFixture({status:async()=>({inApp:true,methodsKnown:true,email:true,phone:false,google:false})});
 const render=()=>renderToStaticMarkup(React.createElement(CloudSignInPanel,f.props));
 await f.controller.refreshReadiness();
 assert.doesNotMatch(render(),/Text me a code/);assert.match(render(),/Sign in to verify your account/);
 assert.match(render(),/review access before authorizing Alpha Phone/);assert.doesNotMatch(render(),/By continuing, you allow/);
 f.port.status=async()=>({inApp:true,methodsKnown:true,email:false,phone:true,google:false});await f.controller.refreshReadiness();
 assert.match(render(),/Phone number with country code/);assert.match(render(),/type="tel"/);assert.doesNotMatch(render(),/Email me a code/);
 await f.controller.startPhone('+14155550100');
 assert.match(render(),/Enter your phone code/);assert.match(render(),/\+14155550100/);assert.match(render(),/Resend code in/);
 assert.doesNotMatch(render(),/href=|iframe|type="email"/);f.controller.dispose();
});

test('phone codes use the native host, retain MFA, and never reach renderer HTTP',async()=>{
 const server=await createServer({configFile:false,logLevel:'silent',server:{middlewareMode:true,hmr:false,ws:false,watch:null}});
 try {
  const {CloudProtocol}=await server.ssrLoadModule('/apps/app/src/runtime/cloud-protocol.ts');
  const calls=[];const attemptId='00000000-0000-4000-8000-000000000001';
  const signIn={startPhone:async input=>{calls.push(input);return {attemptId,expiresAt:Date.now()+60000,resendAt:Date.now()+30000};},verifyPhone:async input=>{calls.push(input);return {status:'mfa',method:'totp',expiresAt:Date.now()+60000};},cancel:async()=>{}};
  const client=new CloudProtocol('production',async()=>{throw Error('renderer network must not run');},{read:async()=>null,write:async()=>{},clear:async()=>{}},async()=>{},{signIn});
  const signal=new AbortController().signal;
  assert.equal((await client.startPhoneSignIn('+14155550100',signal)).attemptId,attemptId);
  assert.equal((await client.verifyPhoneSignIn(attemptId,'123456',signal)).status,'mfa');
  assert.deepEqual(calls,[{environment:'production',phone:'+14155550100'},{attemptId,code:'123456'}]);
  delete signIn.startPhone;
  await assert.rejects(client.startPhoneSignIn('+14155550100',signal),error=>error.code==='unavailable');
 }finally{await server.close();}
});

test('method discovery accepts independent methods and never guesses SMS from old or malformed answers',()=>{
 assert.deepEqual(signInReadiness({inApp:true,email:false,phone:true,google:false}),{email:false,phone:true,google:false});
 assert.deepEqual(signInReadiness({inApp:true,email:false,google:true}),{email:false,phone:false,google:true});
 assert.equal(signInReadiness({inApp:false,phone:true}),null);
 assert.equal(signInReadiness({inApp:true,email:true,phone:'true'}).phone,false);
 assert.equal(signInReadiness(null),null);
 assert.deepEqual(signInReadiness({inApp:false,methodsKnown:true,email:false,phone:false,google:false}),{email:false,phone:false,google:false});
});
