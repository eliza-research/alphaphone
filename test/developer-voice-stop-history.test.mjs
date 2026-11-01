import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=readFileSync(process.env.ALPHA_RESTORE_SOURCE||'apps/app/src/runtime/connection-ui.tsx','utf8');
const part=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};
// The real refresh method and restore path; the fixture's update mirrors agent-adapter's history apply,
// where a new history disconnects alphaClient and so aborts the active send.
const abortCode=(()=>{const helper=readFileSync('apps/app/src/runtime/abort-signal.ts','utf8'),a=helper.indexOf('export function anyAbortSignal('),b=helper.indexOf('\n/** Native reserves',a);assert.ok(a>=0&&b>a);return helper.slice(a,b).replace('export ','');})();
const code=stripTypeScriptTypes([
 abortCode,
 part('async function restoreConversationHistory(', '/** Restored chats'),
 'globalThis.controller={',
 part('  async refreshDeveloperVoiceHistory(', '  getPairedVoiceBinding()'),
 ' voiceConversationCurrent:()=>voiceCurrent};',
].join('\n'),{mode:'transform'});
const binding={conversationId:'conversation',session:{sessionId:'session'},connectionEpoch:1};
function fixture({receiptSaved=true}={}){
 const rows=[{id:'user-1',role:'user',text:'What time is it?'},...(receiptSaved?[{id:'receipt-1',role:'assistant',text:'This reply did not finish.'}]:[])];
 const state={session:{sessionId:'session'},history:{sessionId:'session',conversationId:'conversation',revision:1,messages:[{id:'earlier',from:'agent',text:'Earlier reply'}],automatic:true}},writes=[],client={active:null};let reads=0,release;
 const box={state,active:{kind:'resident'},epoch:1,service:null,sending:null,operation:null,voiceCurrent:true,browserLocalAgentEnabled:true,stoppedVoiceRead:undefined,JSON,Error,DOMException,AbortController,AbortSignal,Set,Map,
  residentCloudFlow:()=>false,conversationKey:()=>'owner-key',conversationMemory:new Map(),
  captureConversationChoice:async()=>({id:'conversation',revision:'r1'}),conversationList:async()=>[{id:'conversation'}],
  readConversation:()=>{reads++;return new Promise(resolve=>release=()=>resolve({messages:rows,partial:false,deliveryRevisionAtStart:0}));},
  restoredMessages:messages=>messages.map(m=>({id:m.id,from:m.role==='user'?'user':'agent',text:m.text})),
  cancelStoppedReply(){},scheduleStoppedReply(){throw Error('Unexpected schedule');},
  update:patch=>{writes.push(patch);if(patch.history)client.active?.abort();Object.assign(state,patch);},
  noSessionError:message=>Error(message),NO_SESSION_FALLBACK:'missing'};
 vm.runInNewContext(code,box);
 const read=async afterStop=>{const pending=box.controller.refreshDeveloperVoiceHistory(binding,new AbortController().signal,afterStop);while(!release)await Promise.resolve();return {pending};};
 return {box,state,writes,client,read,release:()=>release(),get reads(){return reads;}};
}
test('a request started during the post-Stop read is not cancelled and the visible chat is not replaced',async()=>{
 for(const started of ['sending','operation']){
  const f=fixture();const {pending}=await f.read(true);
  // p.send resumes once Stop settles and dispatches while the read is in flight.
  f.client.active=new AbortController();f.box[started]=f.client.active;f.release();
  await assert.rejects(pending,{name:'AbortError'});
  assert.equal(f.client.active.signal.aborted,false,started);assert.equal(f.writes.length,0,started);
  assert.equal(f.state.history.revision,1);assert.deepEqual(f.state.history.messages.map(m=>m.id),['earlier']);
 }
});
test('with no new request the post-Stop read shows the stopped turn and its interrupted receipt',async()=>{
 const f=fixture();const {pending}=await f.read(true);f.release();await pending;
 assert.equal(f.state.history.revision,2);assert.equal(f.state.history.automatic,true);assert.equal(f.reads,1);
 assert.deepEqual(f.state.history.messages.map(m=>m.text),['What time is it?','This reply did not finish.']);
});
test('the post-Stop read is single: a receipt saved after it waits for the next history read',async()=>{
 const f=fixture({receiptSaved:false});const {pending}=await f.read(true);f.release();await pending;
 for(let i=0;i<4;i++)await Promise.resolve();
 assert.equal(f.reads,1);assert.deepEqual(f.state.history.messages.map(m=>m.text),['What time is it?']);
});
test('a live voice reconcile keeps committing as before',async()=>{
 const f=fixture();const {pending}=await f.read();f.release();await pending;
 assert.equal(f.state.history.revision,2);assert.deepEqual(f.state.history.messages.map(m=>m.id),['user-1','receipt-1']);
});
// The real browser channel forwards conversation-updated; it is the agent's announcement that it saved a change.
const channelCode=stripTypeScriptTypes((()=>{const agent=readFileSync('apps/app/src/runtime/local-agent.ts','utf8'),a=agent.indexOf('function subscribeBrowserConversationEvents('),b=agent.indexOf('\nfunction record(',a);assert.ok(a>=0&&b>a);return agent.slice(a,b);})(),{mode:'transform'});
test('the browser conversation channel forwards conversation-updated beside proactive messages and nothing else',async()=>{
 const sockets=[],received=[];let connected;const ready=new Promise(resolve=>connected=resolve);
 class FakeSocket{static OPEN=1;readyState=1;constructor(url){this.url=url;sockets.push(this);queueMicrotask(()=>this.onopen?.());}close(){}}
 const box={crypto:{randomUUID:()=>'client'},AbortController,DOMException,URL,JSON,Date,Error,Reflect,Math,setTimeout,clearTimeout,location:{host:'localhost:5173'},WebSocket:FakeSocket};
 vm.runInNewContext(channelCode,box);
 const bridge={request:async()=>({status:200,body:JSON.stringify({wsUrl:'ws://localhost:5173/__alpha-local-renderer/ws?sessionId=ticket',expiresAt:Date.now()+60000})})};
 const stop=box.subscribeBrowserConversationEvents(bridge,'owner',value=>received.push(value.type),state=>{if(state==='connected')connected();});
 try{
  await ready;
  for(const type of ['agent_event','conversation-updated','proactive-message','status'])sockets[0].onmessage({data:JSON.stringify({type,conversation:{id:'conversation'}})});
  assert.deepEqual(received,['conversation-updated','proactive-message']);
 }finally{stop();}
});
// After revoke the agent saves the stopped turn's receipt and announces conversation-updated. The real
// listener, refresh, restore, merge and stop-check retirement; the fixture's update flushes deferred
// resyncs the way connection-ui's update does, and each read returns the rows saved when it was sent.
const stopCode=stripTypeScriptTypes([
 abortCode,
 part('let stoppedReply','/** A restart can land'),
 part('function deliverConversationMessages(','/** Insert canonical delivery IDs'),
 part('export function mergeConversationDelivery','const actionReceipts').replace('export ',''),
 part('function restoredMessages(','/** Eliza Cloud'),
 part('async function restoreConversationHistory(', '/** Restored chats'),
 'globalThis.connectionController={',
 part('  async refreshDeveloperVoiceHistory(', '  getPairedVoiceBinding()'),
 ' voiceConversationCurrent:()=>voiceCurrent};',
].join('\n'),{mode:'transform'});
function stopFixture(){
 const session={sessionId:'session',agentId:'agent'},channel={},writes=[],releases=[];let reads=0;
 const server=[{id:'earlier',role:'assistant',text:'Earlier reply'},{id:'user-1',role:'user',text:'What time is it?'}];
 const selected={kind:'resident',remote:{subscribeConversationEvents(listener){channel.listener=listener;return ()=>{};}}};
 const box={epoch:1,active:selected,state:{session,history:{sessionId:'session',conversationId:'conversation',revision:1,messages:[{id:'earlier',from:'agent',text:'Earlier reply'}],automatic:true}},
  sending:null,operation:null,conversationResync:false,conversationEventRead:undefined,closeConversationEvents:undefined,service:null,voiceCurrent:true,browserLocalAgentEnabled:true,
  conversationMemory:new Map([['owner-key','conversation']]),conversationKey:()=>'owner-key',restoredText:text=>text,JSON,Error,DOMException,AbortController,AbortSignal,Reflect,Set,Map,clearTimeout,
  residentCloudFlow:()=>false,captureConversationChoice:async()=>({id:'conversation',revision:'r1'}),conversationList:async()=>[{id:'conversation'}],
  readConversation:()=>{reads++;const rows=server.slice();return new Promise(resolve=>releases.push(()=>resolve({messages:rows,partial:false,deliveryRevisionAtStart:0})));},
  scheduleStoppedReply(){throw Error('Unexpected schedule');},noSessionError:message=>Error(message),NO_SESSION_FALLBACK:'missing',
  update(patch){writes.push(patch);Object.assign(box.state,patch);void box.flushConversationEvents();}};
 vm.runInNewContext(stopCode,box);box.startConversationEvents(selected,session);
 const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
 return {box,writes,settle,
  // development-cartesia-conversation's stop: one read once revoke settles, failures silent.
  stop:()=>box.connectionController.refreshDeveloperVoiceHistory(binding,new AbortController().signal,true).catch(error=>error),
  saveReceipt:()=>server.push({id:'receipt-1',role:'assistant',text:'',interrupted:true}),
  event:value=>channel.listener(value),updated:id=>channel.listener({type:'conversation-updated',conversation:{id,title:'Chat'}}),
  requested:async count=>{for(let i=0;i<50&&releases.length<count;i++)await Promise.resolve();assert.equal(releases.length,count);},
  release:async index=>{releases[index]();await settle();},
  get reads(){return reads;},get texts(){return box.state.history.messages.map(m=>m.text);}};
}
test('a receipt announced during the post-Stop read is read once more, and the earlier read cannot hide it',async()=>{
 const f=stopFixture(),stopped=f.stop();await f.requested(1);
 f.saveReceipt();f.updated('conversation');await f.requested(2);
 await f.release(1);assert.deepEqual(f.texts,['Earlier reply','What time is it?','This reply did not finish.']);
 // The first read went out before the save; it settles last and is not applied.
 await f.release(0);assert.equal((await stopped).name,'AbortError');
 assert.equal(f.box.state.history.revision,2);assert.deepEqual(f.texts,['Earlier reply','What time is it?','This reply did not finish.']);
 f.updated('conversation');await f.settle();assert.equal(f.reads,2);
});
test('a receipt announced after the post-Stop read is shown once; another conversation does not consume the wait',async()=>{
 const f=stopFixture(),stopped=f.stop();await f.requested(1);await f.release(0);assert.equal(await stopped,undefined);
 assert.deepEqual(f.texts,['Earlier reply','What time is it?']);
 f.saveReceipt();f.updated('other-conversation');f.event({type:'conversation-updated'});await f.settle();assert.equal(f.reads,1);
 f.updated('conversation');await f.requested(2);await f.release(1);
 assert.equal(f.box.state.history.revision,3);assert.deepEqual(f.texts,['Earlier reply','What time is it?','This reply did not finish.']);
 f.updated('conversation');await f.settle();assert.equal(f.reads,2);
 assert.ok(f.writes.every(patch=>!patch.conversationDelivery));
});
test('without a Direct voice Stop, conversation-updated reads nothing, so a typed Stop keeps its single bubble',async()=>{
 const f=stopFixture();
 // Create, import, truncate, delete, heard, recovered and a typed Stop's receipt all arrive as this event.
 for(let i=0;i<6;i++)f.updated('conversation');await f.settle();
 assert.equal(f.reads,0);assert.equal(f.writes.length,0);assert.equal(f.box.conversationResync,false);
 // The typed stream keeps its local id; a delivered receipt would sit beside it as a second bubble.
 const visible=[{id:'earlier',from:'agent',text:'Earlier reply'},{id:'local-user',from:'user',text:'What time is it?'},{id:'local-stream',from:'agent',text:'It is ni\n\nStopped.'}],delivery=f.box.state.conversationDelivery;
 assert.equal(f.box.state.history.revision,1);
 assert.deepEqual((delivery?f.box.mergeConversationDelivery(visible,delivery.messages):visible).map(m=>m.text),['Earlier reply','What time is it?','It is ni\n\nStopped.']);
 // A Direct voice Stop whose read already held its receipt leaves a wait; the next send retires it.
 const g=stopFixture();g.saveReceipt();const stopped=g.stop();await g.requested(1);await g.release(0);await stopped;
 g.box.cancelStoppedReply();const writes=g.writes.length;
 g.updated('conversation');await g.settle();assert.equal(g.reads,1);assert.equal(g.writes.length,writes);
});
test('the announced read never cancels or replaces a newer request',async()=>{
 for(const started of ['sending','operation']){
  // The request is in flight when the receipt is announced.
  const f=stopFixture(),stopped=f.stop();await f.requested(1);await f.release(0);await stopped;
  const request=new AbortController();f.box[started]=request;f.saveReceipt();f.updated('conversation');await f.settle();
  assert.equal(f.reads,1,started);assert.equal(request.signal.aborted,false,started);assert.equal(f.box.state.history.revision,2,started);
  // The request starts while the announced read is in flight.
  const g=stopFixture(),stop=g.stop();await g.requested(1);await g.release(0);await stop;
  g.saveReceipt();g.updated('conversation');await g.requested(2);const next=new AbortController();g.box[started]=next;await g.release(1);
  assert.equal(next.signal.aborted,false,started);assert.equal(g.box.state.history.revision,2,started);assert.deepEqual(g.texts,['Earlier reply','What time is it?'],started);
 }
});
