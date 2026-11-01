import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=readFileSync(process.env.ALPHA_RESTORE_SOURCE||'apps/app/src/runtime/connection-ui.tsx','utf8');
const part=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};
// The real refresh method and restore path; the fixture's update mirrors agent-adapter's history apply,
// where a new history disconnects alphaClient and so aborts the active send.
const code=stripTypeScriptTypes([
 part('async function restoreConversationHistory(', '/** Restored chats'),
 'globalThis.controller={',
 part('  async refreshDeveloperVoiceHistory(', '  getPairedVoiceBinding()'),
 ' voiceConversationCurrent:()=>voiceCurrent};',
].join('\n'),{mode:'transform'});
const binding={conversationId:'conversation',session:{sessionId:'session'},connectionEpoch:1};
function fixture({receiptSaved=true}={}){
 const rows=[{id:'user-1',role:'user',text:'What time is it?'},...(receiptSaved?[{id:'receipt-1',role:'assistant',text:'This reply did not finish.'}]:[])];
 const state={session:{sessionId:'session'},history:{sessionId:'session',conversationId:'conversation',revision:1,messages:[{id:'earlier',from:'agent',text:'Earlier reply'}],automatic:true}},writes=[],client={active:null};let reads=0,release;
 const box={state,active:{kind:'resident'},epoch:1,service:null,sending:null,operation:null,voiceCurrent:true,browserLocalAgentEnabled:true,JSON,Error,DOMException,
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
// The agent saves a stopped turn's receipt after Stop returns and then announces conversation-updated.
// The real browser channel, conversation listener, resync read and delivery merge; the fixture's update
// flushes deferred resyncs the way connection-ui's update does.
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
const eventsCode=stripTypeScriptTypes([
 part('function deliverConversationMessages(','/** Insert canonical delivery IDs'),
 part('export function mergeConversationDelivery','const actionReceipts').replace('export ',''),
 part('function restoredMessages(','/** Eliza Cloud'),
].join('\n'),{mode:'transform'});
function eventsFixture(){
 const session={sessionId:'session',agentId:'agent'},channel={},rows=[{id:'user-1',role:'user',text:'What time is it?'},{id:'receipt-1',role:'assistant',text:'',interrupted:true}];
 const selected={kind:'resident',remote:{subscribeConversationEvents(listener,onState){channel.listener=listener;channel.onState=onState;return ()=>{};}}};
 let reads=0;const releases=[];
 const box={epoch:1,active:selected,state:{session},sending:null,operation:null,conversationResync:false,conversationEventRead:undefined,closeConversationEvents:undefined,
  conversationMemory:new Map([['owner-key','conversation']]),conversationKey:()=>'owner-key',restoredText:text=>text,Error,AbortController,Reflect,Set,
  readConversation:()=>{reads++;return new Promise(resolve=>releases.push(()=>resolve({messages:rows,partial:false,deliveryRevisionAtStart:0})));},
  update(patch){Object.assign(box.state,patch);void box.flushConversationEvents();}};
 vm.runInNewContext(eventsCode,box);box.startConversationEvents(selected,session);
 // The visible chat after the single post-Stop read, which ran before the receipt was saved.
 let visible=[{id:'earlier',from:'agent',text:'Earlier reply'},{id:'user-1',from:'user',text:'What time is it?'}];
 const settle=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
 return {box,channel,settle,release:async()=>{releases.shift()();await settle();},
  updated:id=>channel.listener({type:'conversation-updated',conversation:{id,title:'Chat'}}),
  get reads(){return reads;},get visible(){const delivery=box.state.conversationDelivery;return Array.from(delivery?box.mergeConversationDelivery(visible,delivery.messages):visible);}};
}
test('conversation-updated for the open conversation reads it once and shows the receipt after the stopped turn',async()=>{
 const f=eventsFixture();f.updated('conversation');assert.equal(f.reads,1);await f.release();
 assert.equal(f.reads,1);assert.equal(f.box.conversationResync,false);
 assert.deepEqual(f.visible.map(m=>m.text),['Earlier reply','What time is it?','This reply did not finish.']);
});
test('without the event, or for another conversation, nothing is read again',async()=>{
 const f=eventsFixture();await f.settle();assert.equal(f.reads,0);
 f.updated('other-conversation');f.channel.listener({type:'conversation-updated'});await f.settle();
 assert.equal(f.reads,0);assert.equal(f.box.state.conversationDelivery,undefined);assert.deepEqual(f.visible.map(m=>m.id),['earlier','user-1']);
});
test('the event never cancels or replaces a newer request; it reads once after that request settles',async()=>{
 for(const started of ['sending','operation']){
  const f=eventsFixture(),request=new AbortController();f.box[started]=request;
  f.updated('conversation');await f.settle();
  assert.equal(f.reads,0,started);assert.equal(request.signal.aborted,false,started);assert.equal(f.box.state.conversationDelivery,undefined,started);
  f.box[started]=null;f.box.update({});assert.equal(f.reads,1,started);await f.release();
  assert.deepEqual(f.visible.map(m=>m.id),['earlier','user-1','receipt-1'],started);
 }
 // A request that starts while the read is in flight keeps the chat; the read is repeated once it settles.
 const f=eventsFixture();f.updated('conversation');const request=new AbortController();f.box.sending=request;await f.release();
 assert.equal(request.signal.aborted,false);assert.equal(f.box.state.conversationDelivery,undefined);assert.equal(f.box.conversationResync,true);
 f.box.sending=null;f.box.update({});assert.equal(f.reads,2);await f.release();assert.deepEqual(f.visible.map(m=>m.id),['earlier','user-1','receipt-1']);
});
