import test from 'node:test';
import assert from 'node:assert/strict';
import {authCodePrompt,requestAuthCode} from '../apps/app/src/runtime/auth-code-prompt.ts';
test('MFA prompt is single-owner and accepts only its current explicit code',async()=>{
 const c=new AbortController();const result=requestAuthCode('totp',Date.now()+60000,c.signal);const p=authCodePrompt.snapshot();
 await assert.rejects(requestAuthCode('sms',Date.now()+60000,c.signal),/active/);
 authCodePrompt.submit(p.id+1,'123456');assert.equal(authCodePrompt.snapshot(),p);
 authCodePrompt.submit(p.id,'bad');assert.equal(authCodePrompt.snapshot(),p);
 authCodePrompt.submit(p.id,'123456');assert.deepEqual(await result,{value:'123456',recovery:false});assert.equal(authCodePrompt.snapshot(),null);
});
test('cancel, expiry and parent abort retire prompts without releasing a code',async()=>{
 const c=new AbortController();const cancelled=requestAuthCode('sms',Date.now()+60000,c.signal);const p=authCodePrompt.snapshot();authCodePrompt.cancel(p.id);await assert.rejects(cancelled,{name:'AbortError'});
 const aborted=requestAuthCode('totp',Date.now()+60000,c.signal);c.abort();await assert.rejects(aborted,{name:'AbortError'});assert.equal(authCodePrompt.snapshot(),null);
 const expired=requestAuthCode('totp',Date.now()+10,new AbortController().signal);await assert.rejects(expired,/expired/);assert.equal(authCodePrompt.snapshot(),null);
});

test('recovery codes require an explicit TOTP prompt and do not survive cancellation',async()=>{
 const c=new AbortController(),sms=requestAuthCode('sms',Date.now()+60000,c.signal),p=authCodePrompt.snapshot();
 authCodePrompt.submit(p.id,'recovery-code',true);assert.equal(authCodePrompt.snapshot(),p);c.abort();await assert.rejects(sms);
 const totp=requestAuthCode('totp',Date.now()+60000,new AbortController().signal),t=authCodePrompt.snapshot();authCodePrompt.submit(t.id,'  recovery-code  ',true);
 assert.deepEqual(await totp,{value:'recovery-code',recovery:true});assert.equal(authCodePrompt.snapshot(),null);
});
