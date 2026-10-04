import {browserScreenLocked} from './screen-locked';
import {revision} from './store';
import {BrowserDomainDocument,type DomainRecovery} from './domain-document';
import {browserDocuments} from './documents';
type Row={id:string;revision:string;title:string;text:string;at:number;phase:'posted'|'dismissed'|'opened';bindingHash?:string};
const key='alpha.browser.workflow-notices.v1';
export const workflowNoticesDocument=new BrowserDomainDocument(browserDocuments,key,()=>localStorage.getItem(key));
const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('alpha.browser.documents.v1');
if(channel)channel.onmessage=event=>{if(event.data?.key===key)changed(false);};
type Receipt=Omit<Row,'text'> & {digest:string};
type State={rows:Row[];archived?:Receipt[]};
const initial=():State=>({rows:[]});
const digest=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(text)))),byte=>byte.toString(16).padStart(2,'0')).join('');
function validate(state:State){
 const ids=new Set<string>();
 if(!state||!Array.isArray(state.rows)||state.rows.length>200||state.archived!==undefined&&!Array.isArray(state.archived))throw Error('Notification history needs recovery. Download its saved data before making changes.');
 for(const row of [...state.rows,...state.archived||[]]){
  if(!row||typeof row.id!=='string'||!/^workflow:[\w-]{1,128}$/.test(row.id)||ids.has(row.id)||typeof row.revision!=='string'||!row.revision||typeof row.title!=='string'||!row.title.trim()||row.title.length>200||row.title.includes('\0')||!Number.isFinite(row.at)||!['posted','dismissed','opened'].includes(row.phase))throw Error('Notification history needs recovery. Download its saved data before making changes.');
  if(row.bindingHash!==undefined&&(typeof row.bindingHash!=='string'||!/^[a-f0-9]{64}$/.test(row.bindingHash)))throw Error('Notification binding needs recovery.');
  ids.add(row.id);
 }
 if(state.rows.some(row=>typeof row.text!=='string'||!row.text.trim()||row.text.length>16000)||(state.archived||[]).some(row=>row.phase==='posted'||typeof row.digest!=='string'||!/^[a-f0-9]{64}$/.test(row.digest)))throw Error('Notification history needs recovery. Download its saved data before making changes.');
}
export async function workflowNoticeHistory(signal?:AbortSignal){await workflowNoticesDocument.readRaw(signal);const recovery=await workflowNoticesDocument.capture(signal);if(recovery.format!=='domain'||recovery.legacyChanged)throw Error('Notification history needs recovery. Download both saved copies before making changes.');const raw=recovery.raw,state:State=raw===null?initial():JSON.parse(raw);validate(state);return {raw,recovery,state,eligible:state.rows.filter(row=>row.phase!=='posted').length};}
export async function savedWorkflowNoticeHistory(){return (await workflowNoticesDocument.capture()).raw??JSON.stringify(initial());}
export async function compactWorkflowNotices(expected:DomainRecovery,signal:AbortSignal){
 const count=await workflowNoticesDocument.edit(initial,async state=>{
  signal.throwIfAborted();if(blocked())throw Error('Return to Alpha Phone before changing history.');
  const current=await workflowNoticesDocument.capture(signal);if(current.snapshot?.revision!==expected.snapshot?.revision||current.raw!==expected.raw||current.legacy!==expected.legacy||current.legacyChanged)throw Error('Notification history changed. Close and reopen history.');
  validate(state);const rows=state.rows.filter(row=>row.phase!=='posted');
  const receipts=await Promise.all(rows.map(async({text,...row})=>({...row,digest:await digest(text)})));
  signal.throwIfAborted();if(blocked())throw Error('Notification history changed. Close and reopen history.');
  state.archived=[...state.archived||[],...receipts];state.rows=state.rows.filter(row=>row.phase==='posted');return rows.length;
 },signal);changed();return count;
}
const blocked=()=>document.hidden||document.documentElement.dataset.devBackground==='true'||!!browserScreenLocked();
const changed=(broadcast=true)=>{if(broadcast)channel?.postMessage({key});window.dispatchEvent(new Event('focus'));};
export async function publishWorkflowNotice(id:string,text:string,signal:AbortSignal,title='Workflow result',bindingHash?:string){
 if(bindingHash!==undefined&&!/^[a-f0-9]{64}$/.test(bindingHash))throw Error('Invalid notification binding');
 signal.throwIfAborted();if(typeof title!=='string'||!title.trim()||title.length>200||title.includes('\0'))throw Error('Choose a notification title between 1 and 200 characters.');if(!/^[\w-]{1,128}$/.test(id)||!text.trim()||text.length>16000)throw Error('Choose notification text between 1 and 16000 characters.');
 const result=await workflowNoticesDocument.edit(initial,async state=>{
  signal.throwIfAborted();validate(state);const prior=state.rows.find(row=>row.id==='workflow:'+id);
  if(prior){if(prior.text!==text||prior.title!==title||prior.bindingHash!==bindingHash)throw Error('Saved notification receipt does not match this step.');return prior;}
  const receipt=state.archived?.find(row=>row.id==='workflow:'+id);if(receipt){if(receipt.title!==title||receipt.bindingHash!==bindingHash||receipt.digest!==await digest(text))throw Error('Saved notification receipt does not match this step.');const {digest:_,...row}=receipt;return {...row,text};}
  if(state.rows.length>=200)throw Error('Workflow notification history is full. Open Workflow history and free notification space after reviewing or dismissing notices.');
  const row:Row={id:'workflow:'+id,revision:revision(),title,text,at:Date.now(),phase:'posted',...(bindingHash?{bindingHash}:{})};state.rows.push(row);return row;
 },signal);changed();return result;
}
export async function listWorkflowNotices(){const state=await workflowNoticesDocument.read(initial),hidden=blocked();validate(state);return state.rows.filter(row=>row.phase==='posted').map(row=>({...row,source:'own' as const,appLabel:'Workflows',title:hidden?'Workflows':row.title,text:hidden?'':row.text,clearable:true,canOpen:!hidden}));}
export async function actOnWorkflowNotice(input:{id:string;revision:string},open:boolean){
 const cancellation=new AbortController(),retire=()=>cancellation.abort(),visibility=()=>{if(document.hidden)retire();};
 const events=['alpha-back','pagehide','launcher-home','alpha:device-state','alpha:browser-open-view'];
 for(const event of events)window.addEventListener(event,retire,true);
 document.addEventListener('visibilitychange',visibility);
 try{
  await workflowNoticesDocument.edit(initial,state=>{validate(state);const row=state.rows.find(row=>row.id===input.id);if(blocked()||!row||row.phase!=='posted'||row.revision!==input.revision)throw Error('Notification changed.');row.phase=open?'opened':'dismissed';row.revision=revision();},cancellation.signal);
  changed();if(open&&!cancellation.signal.aborted&&!blocked())window.dispatchEvent(new CustomEvent('alpha:browser-open-view',{detail:'workflows'}));
 }finally{
  for(const event of events)window.removeEventListener(event,retire,true);
  document.removeEventListener('visibilitychange',visibility);
 }
}

/** Read an exact retained delivery record without posting, reopening or dismissing it. */
export async function workflowNoticeReceipt(id:string,title:string,text:string,bindingHash:string,signal:AbortSignal):Promise<{status:'succeeded'|'unknown'}>{
 signal.throwIfAborted();if(!/^[\w-]{1,128}$/.test(id)||!/^[a-f0-9]{64}$/.test(bindingHash))throw Error('Invalid notification receipt identity');
 const {raw,recovery,state}=await workflowNoticeHistory(signal),row=state.rows.find(item=>item.id==='workflow:'+id),archived=state.archived?.find(item=>item.id==='workflow:'+id);
 const receipt=row||archived;if(!receipt||receipt.bindingHash===undefined)return {status:'unknown'};
 if(receipt.bindingHash!==bindingHash||receipt.title!==title||(row?row.text!==text:archived!.digest!==await digest(text)))throw Error('Saved notification receipt does not match this action');
 signal.throwIfAborted();const current=await workflowNoticesDocument.capture(signal);if(current.snapshot?.revision!==recovery.snapshot?.revision||current.raw!==raw||current.legacyChanged)throw Error('Notification history changed. Refresh its receipt.');return {status:'succeeded'};
}
