import test from 'node:test';
import assert from 'node:assert/strict';
import {tsImport} from 'tsx/esm/api';
const {ResidentConversationTurns} = await tsImport(new URL('../apps/app/src/runtime/alpha-client.ts', import.meta.url).href, import.meta.url);

const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const room={id:'conversation',roomId:'room'};

test('resident replacement refuses an idle receipt and keeps the stopped turn for history matching',async()=>{
 const turns=new ResidentConversationTurns(async()=> 'idle',()=>false);
 const signal=new AbortController(),reply=deferred();
 const first=turns.send(room,'original-request','Original text',signal.signal,()=>reply.promise);
 const stopped=assert.rejects(first,{name:'AbortError',notDispatched:false});
 signal.abort();await stopped;
 const original=turns.stopped;
 await assert.rejects(turns.send(room,'replacement-request','Replacement text',new AbortController().signal,async()=>{throw Error('Unexpected dispatch');}),{code:'stop-unconfirmed',notDispatched:true});
 assert.equal(turns.stopped,original);
 assert.equal(turns.stopped.clientMessageId,'original-request');
 assert.equal(turns.stopped.input.text,'Original text');
 assert.equal(await turns.stopResult,'idle');
});

test('declined and completed callers cannot cancel the resident successor',async()=>{
 const stops=[];const turns=new ResidentConversationTurns(async target=>{stops.push(target);return 'aborted';},()=>false);
 const firstSignal=new AbortController(),firstReply=deferred();
 const first=turns.send(room,'first','First',firstSignal.signal,()=>firstReply.promise);
 const declinedSignal=new AbortController();
 await assert.rejects(turns.send({id:'foreign',roomId:'foreign'},'declined','Declined',declinedSignal.signal,async()=>{throw Error('Unexpected dispatch');}),{code:'busy',notDispatched:true});
 declinedSignal.abort();assert.deepEqual(stops,[]);
 firstReply.resolve('first reply');assert.equal(await first,'first reply');
 const nextReply=deferred();let context;
 const next=turns.send(room,'next','Next',new AbortController().signal,turn=>{context=turn;return nextReply.promise;});
 await tick();firstSignal.abort();
 assert.equal(context.current(),true);assert.equal(context.signal.aborted,false);assert.deepEqual(stops,[]);
 nextReply.resolve('next reply');assert.equal(await next,'next reply');
});
