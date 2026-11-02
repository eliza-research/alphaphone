import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
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

// Root P1 (ABA): a request that starts and finishes during the post-Stop read leaves both busy flags clear. The
// real controller send, operation, voice start, post-Stop read, restore and update, with the real agent-adapter
// composer send, agentSay and history apply. The transport, storage and React queue are fakes; nothing is held busy.
const adapter=readFileSync('apps/app/src/prototype/agent-adapter.ts','utf8');
const slice=(text,start,end)=>{const a=text.indexOf(start),b=text.indexOf(end,a);assert.ok(a>=0&&b>a,start);return text.slice(a,b);};
const consumerSource=[
 abortCode,
 part('function update(patch: Partial<ConnectionSnapshot>)','// P-43: where the resident'),
 part('function deliverConversationMessages(','/** Insert canonical delivery IDs'),
 part('export function mergeConversationDelivery','const actionReceipts').replace('export ',''),
 part('let residentStartInBackground','/** Start (or restart) the resident.'),
 part('let stoppedReply','/** A restart can land'),
 part('async function ensureSelectedConversation(','async function createSelectedConversation('),
 part('function restoredMessages(','/** Eliza Cloud'),
 part('async function restoreConversationHistory(','/** Restores the saved conversation'),
 'globalThis.connectionController={getSnapshot:()=>state,getSelectedConversationId:()=>conversationMemory.get(conversationKey(state.session)),getCloudEnvironment:()=>undefined,getCloudClient:()=>undefined,captureViewNavigation:()=>({}),',
 part('  async refreshDeveloperVoiceHistory(','  getPairedVoiceBinding()'),
 part('  voiceConversationCurrent(binding','  async send(text: string'),
 part('  async send(text: string','\n};\n'),
 '};',
 slice(adapter,'function planActionCard(','/** Context notices'),
 slice(adapter,'function replyNotices(','/** Decline one pending proposal'),
 'const p={};',
 slice(adapter,'  p.send = async function','  p.agentSay = function'),
 slice(adapter,'  p.agentSay = function','  p.reply = function'),
 'p.receiveHistory=function(){const session=connectionController.getSnapshot().session?.sessionId;',
 slice(adapter,'      const history = connectionController.getSnapshot().history;','      const delivery=connectionController.getSnapshot().conversationDelivery;'),
 '};globalThis.adapter=p;',
].join('\n');
const X='00000000-0000-4000-8000-000000000001',Y='00000000-0000-4000-8000-000000000002';
function consumerFixture(code=consumerSource){
 const session={sessionId:'session',agentId:'agent',ownerId:'owner',origin:'https://agent.invalid'},channel={},reads=[],holds=new Set(),held={};
 const server=[{id:'earlier',role:'assistant',text:'Earlier reply'},{id:'user-1',role:'user',text:'What time is it?'}];
 const stage=(name,value)=>holds.delete(name)?new Promise(resolve=>held[name]=()=>resolve(value)):Promise.resolve(value);
 const remote={
  messages:()=>{const rows=server.slice();return new Promise(resolve=>reads.push(()=>resolve({messages:rows})));},
  // An ordinary resident reply: no proactive event, so its rows carry no delivery revision.
  send:async(_id,text)=>{server.push({id:X,role:'user',text},{id:Y,role:'assistant',text:'It is noon.'});return {text:'It is noon.',messageId:Y,userMessageId:X};},
  subscribeConversationEvents(listener){channel.listener=listener;return ()=>{};},
 };
 const selected={kind:'resident',remote},accepted={view:'home',revision:7,sensitive:false};
 // AlphaClient's disconnect aborts its active request; the controller send is the transport.
 const client={active:null,pending:false,disconnects:0,getState:()=>({context:accepted,pending:client.pending}),disconnect(){client.disconnects++;client.active?.abort();client.active=null;},
  async send(text,onText,replyTo,onReplyReady){const request=client.active=new AbortController();client.pending=true;
   try{const reply=await box.connectionController.send(text,accepted,'11111111-1111-4111-8111-111111111111',request.signal,onText,replyTo,onReplyReady);if(request.signal.aborted)throw Error('Request cancelled.');return reply;}
   finally{client.pending=false;if(client.active===request)client.active=null;}}};
 const box={state:{session,history:{sessionId:'session',conversationId:'conversation',revision:1,messages:[{id:'earlier',from:'agent',text:'Earlier reply'},{id:'user-1',from:'user',text:'What time is it?'}],automatic:true},busy:false,open:false},
  active:selected,epoch:1,sending:null,operation:null,service:null,isAndroid:false,testMocksEnabled:false,developmentPageSuspended:false,listeners:new Set(),browserLocalAgentEnabled:true,residentAlwaysPresent:true,
  conversationResync:false,conversationEventRead:undefined,closeConversationEvents:undefined,signInReadinessOwner:null,clientObservationSession:undefined,requestedCameraContinuation:undefined,
  conversationMemory:new Map([['owner-key','conversation']]),conversationKey:()=>'owner-key',
  captureConversationChoice:()=>stage('choice',{id:'conversation',revision:'r1'}),conversationList:()=>stage('list',[{id:'conversation'}]),
  residentCloudFlow:()=>false,ownProviderSelected:()=>false,phoneContextMessage:(text,context)=>({text,context}),boundNavigation:()=>undefined,
  validateUuid:value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),readDevicePreferences:async()=>({askBeforeAgentActions:true}),
  withResidentMapsNavigation:(_request,_id,_signal,run)=>run(),appRecordInvalidations:()=>[],automationsCommitted:()=>false,
  runQueuedResidentRebind(){},runQueuedSignInReturn(){},scheduleStoppedReply(){throw Error('Unexpected schedule');},setTimeout:run=>queueMicrotask(run),
  restoredText:text=>text,noSessionError:message=>Error(message),NO_SESSION_FALLBACK:'missing',NO_AGENT_SEND:'missing',NO_AGENT_VOICE:'missing',
  console,crypto:{randomUUID},document:{hidden:false,querySelector:()=>null},alphaClient:client,context(){},selectedCloudName:()=>'Eliza Cloud',
  localTurnStatus:new EventTarget(),batchVoiceProgressEvents:new EventTarget(),batchVoiceReplyEvents:new EventTarget(),sourceOf:()=>undefined,
  NotDispatched:class NotDispatched extends Error{},AlphaClientError:class AlphaClientError extends Error{},privateLocalPreviewEnabled:false,pageLeaving:false,
  RESIDENT_STARTING_NOTICE:'Starting',RESIDENT_RECOVERING_NOTICE:'Recovering',deliverChatNavigation:async()=>false,retainReadReply(){},completeReadReply:async()=>{},
  proposalCard:()=>undefined,publishCommittedDeviceChanges(){},transportSettled:async()=>{},dispatched:()=>true,releaseComposerSend(){},
  JSON,Error,DOMException,AbortController,AbortSignal,Reflect,Set,Map,Promise,Object,Date,EventTarget,queueMicrotask};
 const shell={live:true,state:{msgs:[],draft:'',typing:false,chat:'sheet',shade:false,view:'home'},S(){return this.state;},async connectAgent(){},toast(){},draftBindingTask:Promise.resolve(),
  composerDraft:{holding:false,binding:'draft',async hold(){this.holding=true;},async commit(){this.holding=false;},release(){},abandon(){},retire(){}},
  setState(change,callback){const patch=typeof change==='function'?change(this.state):change;if(patch)this.state={...this.state,...patch};callback?.();}};
 vm.runInNewContext(stripTypeScriptTypes(code,{mode:'transform'}),box);
 Object.assign(shell,box.adapter);box.listeners.add(()=>shell.receiveHistory());shell.receiveHistory();client.disconnects=0;
 box.startConversationEvents(selected,session);
 const binding={conversationId:'conversation',session:{...session},connectionEpoch:1};
 const settle=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
 return {box,shell,client,holds,held,reads,settle,
  stop:()=>box.connectionController.refreshDeveloperVoiceHistory(binding,new AbortController().signal,true).catch(error=>error),
  reconcile:()=>box.connectionController.refreshDeveloperVoiceHistory(binding,new AbortController().signal).catch(error=>error),
  requested:async count=>{for(let i=0;i<200&&reads.length<count;i++)await Promise.resolve();assert.equal(reads.length,count);},
  heldAt:async name=>{for(let i=0;i<200&&!held[name];i++)await Promise.resolve();assert.ok(held[name],name);},
  release:async index=>{reads[index]();await settle();},
  // The composer's own send, through the real adapter and controller, settled before it returns.
  send:async()=>{shell.state={...shell.state,draft:'Is it noon?'};await shell.send();await settle();assert.equal(box.sending,null);},
  voiceStart:async()=>{await box.connectionController.prepareVoiceConversation(new AbortController().signal);assert.equal(box.operation,null);},
  operation:async()=>{await box.work('Checking',async()=>{},true);assert.equal(box.operation,null);assert.equal(box.state.busy,false);},
  receipt:()=>{server.push({id:'receipt-1',role:'assistant',text:'',interrupted:true});channel.listener({type:'conversation-updated',conversation:{id:'conversation'}});},
  get ids(){return Array.from(shell.state.msgs,m=>m.id);},get texts(){return Array.from(shell.state.msgs,m=>m.text);},get revision(){return box.state.history.revision;}};
}
test('a composer send that starts and finishes during the post-Stop read keeps its rows; the old read never applies',async()=>{
 // Ownership alone, without the abort, still refuses the commit.
 const ownershipOnly=consumerSource.replace('stoppedVoiceRead?.controller.abort();','');
 for(const code of [consumerSource,ownershipOnly]){
  const f=consumerFixture(code),stopped=f.stop();await f.requested(1);
  await f.send();assert.equal(f.box.operation,null);
  assert.deepEqual(f.ids,['earlier','user-1',X,Y]);
  assert.ok(f.shell.state.msgs.slice(2).every(m=>m.messageBinding?.conversationId==='conversation'&&m.conversationDeliveryRevision===undefined),'ordinary rows carry no delivery revision');
  await f.release(0);assert.deepEqual(f.ids,['earlier','user-1',X,Y]);
  assert.equal(f.revision,1);assert.equal(f.client.disconnects,0);assert.equal((await stopped)?.name,'AbortError');
  // A live voice reconcile after that send keeps its own rules and still applies.
  const live=f.reconcile();await f.requested(2);await f.release(1);assert.equal(await live,undefined);
  assert.equal(f.revision,2);assert.equal(f.client.disconnects,1);assert.deepEqual(f.ids,['earlier','user-1',X,Y]);
 }
 assert.notEqual(ownershipOnly,consumerSource);
});
test('without a newer request the post-Stop read and its announced repeat apply through the real history consumer',async()=>{
 const f=consumerFixture(),stopped=f.stop();await f.requested(1);await f.release(0);assert.equal(await stopped,undefined);
 assert.equal(f.revision,2);assert.equal(f.client.disconnects,1);
 f.receipt();await f.requested(2);await f.release(1);
 assert.equal(f.revision,3);assert.deepEqual(f.texts,['Earlier reply','What time is it?','This reply did not finish.']);
});
test('a voice session start or an operation that finishes during the post-Stop read also retires it',async()=>{
 for(const start of ['voiceStart','operation']){
  const f=consumerFixture(),stopped=f.stop();await f.requested(1);await f[start]();
  await f.release(0);assert.equal((await stopped)?.name,'AbortError',start);
  assert.equal(f.revision,1,start);assert.equal(f.client.disconnects,0,start);
 }
});
test('the announced repeat obeys the same ownership: a request started after the post-Stop read is never replaced',async()=>{
 // Finished before the receipt is announced: no repeat read.
 for(const start of ['voiceStart','operation','send']){
  const f=consumerFixture(),stopped=f.stop();await f.requested(1);await f.release(0);await stopped;
  await f[start]();f.receipt();await f.settle();
  assert.equal(f.reads.length,1,start);assert.equal(f.revision,2,start);
  if(start==='send')assert.deepEqual(f.ids,['earlier','user-1',X,Y]);
 }
 // Started and finished while the repeat read is in flight.
 for(const start of ['voiceStart','operation','send']){
  const f=consumerFixture(),stopped=f.stop();await f.requested(1);await f.release(0);await stopped;
  f.receipt();await f.requested(2);await f[start]();await f.release(1);
  assert.equal(f.revision,2,start);assert.equal(f.client.disconnects,1,start);
  if(start==='send')assert.deepEqual(f.ids,['earlier','user-1',X,Y]);
 }
});
test('a request that starts and finishes within one await of the post-Stop read is seen at the next check',async()=>{
 for(const stage of ['choice','list','messages']){
  const f=consumerFixture();if(stage!=='messages')f.holds.add(stage);
  const stopped=f.stop();if(stage==='messages')await f.requested(1);else await f.heldAt(stage);
  // Both busy flags are clear again before the read makes its next check.
  await f.operation();
  if(stage==='messages')await f.release(0);else{f.held[stage]();await f.settle();}
  assert.equal(f.reads.length,stage==='messages'?1:0,stage);assert.equal((await stopped)?.name,'AbortError',stage);assert.equal(f.revision,1,stage);
 }
});
test('every operation start retires the post-Stop read, and a send retires it before its first await',()=>{
 const starts=source.match(/(?<![\w.])operation\s*=\s*controller;/g)||[];
 const retired=source.match(/stoppedVoiceRead\s*=\s*undefined;\s*signInReadinessOwner\s*=\s*null;\s*operation\s*=\s*controller;/g)||[];
 assert.equal(starts.length,4);assert.equal(retired.length,starts.length);
 const send=part('    sending = controller;','    try {');assert.match(send,/\n    cancelStoppedReply\(\);\n$/);assert.doesNotMatch(send,/await/);
});
