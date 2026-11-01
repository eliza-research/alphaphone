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
