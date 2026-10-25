import test from 'node:test';
import assert from 'node:assert/strict';
import {readAlphaDelegationReturn} from '../apps/app/src/runtime/alpha-auth-return.ts';
function fixture(purpose = 'delegation:agent-a:'+'d'.repeat(43)) {
 const pending={environment:'production',state:'s'.repeat(43),verifier:'v'.repeat(43),expiresAt:Date.now()+60000,purpose};
 let callback='alphaphone://auth/production#state='+pending.state+'&code='+'c'.repeat(43);
 return {pending, host:{read:async()=>pending,callback:async()=>callback,clear:async()=>{throw Error('Routing must not consume state')},clearCallback:async()=>{throw Error('Routing must not consume callback')}},setCallback:value=>{callback=value}};
}
test('cold return routing preserves the validated callback and identifies its original agent',async()=>{
 const f=fixture();assert.deepEqual(await readAlphaDelegationReturn(f.host),{scope:'agent-a',state:'d'.repeat(43)});
 assert.deepEqual(await readAlphaDelegationReturn(f.host),{scope:'agent-a',state:'d'.repeat(43)});
});
test('account returns, expired requests, wrong-state and wrong-environment links cannot route delegation',async()=>{
 for(const purpose of ['account',undefined,'delegation:agent-a:invalid']) {const f=fixture();f.pending.purpose=purpose;assert.equal(await readAlphaDelegationReturn(f.host),null);}
 const expired=fixture();expired.pending.expiresAt=0;assert.equal(await readAlphaDelegationReturn(expired.host),null);
 for(const callback of ['alphaphone://auth/staging#state='+'s'.repeat(43)+'&code='+'c'.repeat(43),'alphaphone://auth/production#state='+'x'.repeat(43)+'&code='+'c'.repeat(43),'https://attacker.invalid/#state='+'s'.repeat(43)+'&code='+'c'.repeat(43)]) {const f=fixture();f.setCallback(callback);assert.equal(await readAlphaDelegationReturn(f.host),null);}
});
test('provider denial routes back to its original consent without fabricating success',async()=>{
 const f=fixture();f.setCallback('alphaphone://auth/production#state='+'s'.repeat(43)+'&error=access_denied');assert.deepEqual(await readAlphaDelegationReturn(f.host),{scope:'agent-a',state:'d'.repeat(43)});
});
