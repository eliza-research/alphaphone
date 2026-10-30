import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import {CloudSignInPanel,signInFixture} from './helpers/shared-sign-in.mjs';

async function panel(f,run){
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),previous={};
 for(const key of ['window','document','HTMLElement','IS_REACT_ACT_ENVIRONMENT']){previous[key]=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value:key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key],configurable:true,writable:true});}
 const {createRoot}=await import('react-dom/client'),root=createRoot(document.getElementById('root'));
 try{await act(async()=>{root.render(React.createElement(CloudSignInPanel,f.props));});await run(dom.window,()=>root.render(React.createElement(CloudSignInPanel,f.props)));}
 finally{await act(()=>{root.unmount();f.controller.dispose();});dom.window.close();for(const[key,value]of Object.entries(previous)){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}}
}
test('Alpha renders the shared current attempt and preserves a wrong-code retry',async()=>{
 const f=signInFixture({verifyPhone:async()=>{throw Object.assign(Error('private text'),{code:'invalid-code'});}});
 await f.controller.refreshReadiness();await f.controller.startPhone('+14155550100');
 await panel(f,async(window)=>{
  const input=document.querySelector('input');assert.equal(input.getAttribute('aria-label'),'Six-digit code');
  await act(async()=>{await f.controller.verify('000000');});
  assert.match(document.querySelector('[role="alert"]').textContent,/That code did not work/);assert.doesNotMatch(document.body.textContent,/private text/);
  assert.equal(f.controller.getSnapshot().step.kind,'code');assert.equal(document.activeElement,input);assert.equal(f.activated(),0);
  await act(async()=>{await f.controller.chooseAnotherMethod();});assert.equal(document.querySelector('[aria-label="Six-digit code"]'),null);
 });
});
test('Alpha presents only discovered methods and cannot authenticate by rendering',async()=>{
 const f=signInFixture({status:async()=>({inApp:true,methodsKnown:true,email:true,phone:true,google:false})});await f.controller.refreshReadiness();
 await panel(f,async()=>{assert.ok(document.querySelector('form[aria-label="Sign in with email"]'));assert.ok(document.querySelector('form[aria-label="Sign in with phone"]'));assert.doesNotMatch(document.body.textContent,/Continue with Google|Other sign-in methods/);assert.equal(f.activated(),0);});
});
test('Alpha preserves the shared MFA boundary and announces its own brand',async()=>{
 const f=signInFixture({verifyPhone:async()=>({status:'mfa',method:'totp',expiresAt:Date.now()+60000})});await f.controller.startPhone('+14155550100');
 await panel(f,async()=>{await act(async()=>{await f.controller.verify('123456');});assert.equal(f.controller.getSnapshot().step.kind,'mfa');assert.equal(f.activated(),0);assert.match(document.body.textContent,/Alpha Phone/);assert.equal(document.querySelector('input').value,'');await act(async()=>{await f.controller.verify('654321');});assert.equal(f.activated(),1);});
});
test('native Back and Escape share the current sign-in cancellation path',()=>{
 const ui=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
 const start=ui.indexOf('    const dismiss = () => {'),end=ui.indexOf('    const back = ',start);assert.ok(start>=0&&end>start);
 const code=transformSync(ui.slice(start,end),{loader:'ts'}).code;let current={signIn:{}},calls=[];
 const controller={getSnapshot:()=>current,cancelSignIn:()=>calls.push('auth'),cancel:()=>calls.push('generic'),close:()=>calls.push('close')};
 const dismiss=new Function('connectionController','snapshot',code+';return dismiss;')(controller,{busy:true});dismiss();assert.deepEqual(calls,['auth']);current={signIn:null};dismiss();assert.deepEqual(calls,['auth','generic']);
});
