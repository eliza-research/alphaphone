import {calendarRangeFitsLocalDays} from "../../../../.eliza/client-features/plugins/plugin-calendar/src/internal/time.ts";
import {calendarEventOverlapsRange} from '../../../../.eliza/client-features/packages/contracts/src/device-reviews.ts';
import {workflowApprovalNoticeIdentity} from '../../../../.eliza/client-features/packages/contracts/src/notice-routes.ts';
import {calendarIdentifier} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/calendar-contract.ts';
import {browserDevProfile} from '../browser/dev-profile';
import type {PhoneWorkflowSpec} from '../../../../.eliza/client-features/packages/contracts/src/phone-workflow.ts';
/** Workflow data scopes. These are never executable code or implicit grants. */
export interface WorkflowDeviceBinding { workflowId:string; versionId:string; runId:string; stepId:string; specDigest:string }
export interface WorkflowDeviceTarget { installationId:string; enrollmentId:string }
/** Reviewed reminder window: open reminders due by the end of the owner day (overdue included) plus reminders completed during it. */
export const SELECTED_REMINDERS_WINDOW='open_and_completed_today';
export type WorkflowReadOperation = {type:'read_selected_notes';notes:Array<{id:string;revision:string}>}
 | {type:'read_calendar_range';calendarIds:string[];start:string;end:string;timeZone:string;maximumEvents:number};
/** Kept outside WorkflowReadOperation until the device dispatcher executes it; it is a reviewed read scope, never a grant. */
export type WorkflowReminderReadOperation = {type:'read_selected_reminders';window:typeof SELECTED_REMINDERS_WINDOW;day:string;timeZone:string;maximumItems:number};
export type WorkflowReminderRow={id:string;revision:string;title:string;dueAt:string;status:'open'|'completed';completedAt?:string};
export type WorkflowReadResult = {kind:'notes';notes:Array<{id:string;revision:string;title:string;text:string}>}
 | {kind:'calendar';events:Array<{id:string;calendarId:string;revision:string;title:string;start:string;end:string;allDay:boolean}>};
/** Alpha's loosely indexed view of the shared phone review; assignable to `@elizaos/contracts/workflow-device` WorkflowPhoneReview. */
export interface WorkflowPhoneReview {runId:string;workflowId:string;versionId:string;specDigest:string;spec:PhoneWorkflowSpec&{device:WorkflowDeviceTarget;steps:Array<Record<string,any>>;[key:string]:unknown};status:string;finished:boolean;cancellationRequestedAt:string|null}
const fail=():never=>{throw new Error('Workflow phone scope could not be verified');};
export const workflowObject=(v:unknown):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:fail();
const exact=(p:Record<string,any>,keys:string[])=>{if(Object.keys(p).some(k=>!keys.includes(k))||keys.some(k=>!(k in p)))fail();};
const text=(v:unknown,max:number,empty=false):string=>typeof v==='string'&&v.length<=max&&!v.includes('\0')&&(empty||!!v.trim())?v:fail();
export const workflowId=(v:unknown):string=>{const s=text(v,128);return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(s)?s:fail();};
/** Preserve existing public dev enrollment labels without broadening native identifiers. */
export function workflowEnrollmentId(value:unknown):string{if(browserDevProfile&&typeof value==='string'&&/^development-cloud\.(first|second)-enrollment$/.test(value))return value;return workflowId(value);}
const digest=(v:unknown):string=>{const s=text(v,64);return /^[a-f0-9]{64}$/.test(s)?s:fail();};
const utc=(v:unknown):string=>{const s=text(v,30);return Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s?s:fail();};
const list=(v:unknown,max:number):unknown[]=>Array.isArray(v)&&v.length>0&&v.length<=max?v:fail();
export function parseWorkflowBinding(value:unknown):WorkflowDeviceBinding{const p=workflowObject(value);exact(p,['workflowId','versionId','runId','stepId','specDigest']);return {workflowId:workflowId(p.workflowId),versionId:workflowId(p.versionId),runId:workflowId(p.runId),stepId:workflowId(p.stepId),specDigest:digest(p.specDigest)};}
export function parseWorkflowRead(value:unknown):WorkflowReadOperation{
 const p=workflowObject(value);
 if(p.type==='read_selected_notes'){exact(p,['type','notes']);const notes=list(p.notes,16).map(v=>{const n=workflowObject(v);exact(n,['id','revision']);return {id:workflowId(n.id),revision:digest(n.revision)};});if(new Set(notes.map(n=>n.id)).size!==notes.length)fail();return {type:p.type,notes};}
 if(p.type==='read_calendar_range'){exact(p,['type','calendarIds','start','end','timeZone','maximumEvents']);const calendarIds=list(p.calendarIds,16).map(calendarIdentifier),start=utc(p.start),end=utc(p.end),timeZone=text(p.timeZone,100);if(new Set(calendarIds).size!==calendarIds.length||!calendarRangeFitsLocalDays(start,end,timeZone)||!Number.isInteger(p.maximumEvents)||p.maximumEvents<1||p.maximumEvents>200)fail();try{new Intl.DateTimeFormat('en-US',{timeZone}).format(0);}catch{fail();}return {type:p.type,calendarIds,start,end,timeZone,maximumEvents:p.maximumEvents};}
 return fail();
}
export function parseWorkflowReminderRead(value:unknown):WorkflowReminderReadOperation{const p=workflowObject(value);if(p.type!=='read_selected_reminders')fail();exact(p,['type','window','day','timeZone','maximumItems']);const timeZone=text(p.timeZone,100),day=text(p.day,10);if(p.window!==SELECTED_REMINDERS_WINDOW||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+'T00:00:00Z'))||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day||!Number.isInteger(p.maximumItems)||p.maximumItems<1||p.maximumItems>200)fail();try{new Intl.DateTimeFormat('en-US',{timeZone}).format(0);}catch{fail();}return {type:p.type,window:SELECTED_REMINDERS_WINDOW,day,timeZone,maximumItems:p.maximumItems};}
export async function workflowSha(value:unknown):Promise<string>{const bytes=new TextEncoder().encode(JSON.stringify(value));return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');}
/** Opaque identity of one pending phone-step approval notice (shared workflowApprovalNoticeIdentity). The ID and binding reveal nothing about the step; the route stays in encrypted native storage. */
export const workflowApprovalNotice=workflowApprovalNoticeIdentity;
export function workflowBytes(value:unknown):number{return new TextEncoder().encode(JSON.stringify(value)).length;}
export async function validateWorkflowResult(operation:WorkflowReadOperation,value:unknown):Promise<WorkflowReadResult>{
 if(workflowBytes(value)>65536)fail();const p=workflowObject(value);
 if(operation.type==='read_selected_notes'){exact(p,['kind','notes']);if(p.kind!=='notes'||!Array.isArray(p.notes)||p.notes.length!==operation.notes.length)fail();const notes=[];for(let i=0;i<p.notes.length;i++){const n=workflowObject(p.notes[i]);exact(n,['id','revision','title','text']);const item={id:workflowId(n.id),revision:digest(n.revision),title:text(n.title,256,true),text:text(n.text,32000,true)};if(item.id!==operation.notes[i].id||item.revision!==operation.notes[i].revision||await workflowSha([item.title,item.text])!==item.revision)fail();notes.push(item);}return {kind:'notes',notes};}
 exact(p,['kind','events']);if(p.kind!=='calendar'||!Array.isArray(p.events)||p.events.length>operation.maximumEvents)fail();const events=[];for(const raw of p.events){const e=workflowObject(raw);exact(e,['id','calendarId','revision','title','start','end','allDay']);const item={id:calendarIdentifier(e.id),calendarId:calendarIdentifier(e.calendarId),revision:digest(e.revision),title:text(e.title,1000,true),start:utc(e.start),end:utc(e.end),allDay:e.allDay};if(typeof item.allDay!=='boolean'||!operation.calendarIds.includes(item.calendarId)||!calendarEventOverlapsRange(operation,{...item,allDay:item.allDay as boolean})||await workflowSha([item.id,item.calendarId,item.title,item.start,item.end,item.allDay])!==item.revision)fail();events.push({...item,allDay:item.allDay as boolean});}if(new Set(events.map(e=>JSON.stringify([e.calendarId,e.id,e.start]))).size!==events.length)fail();return {kind:'calendar',events};
}
/** Validates a phone reminder read against its reviewed owner-day window before any model sees it. */
export async function validateWorkflowReminderResult(operation:WorkflowReminderReadOperation,value:unknown):Promise<{kind:'reminders';reminders:WorkflowReminderRow[]}>{
 if(workflowBytes(value)>65536)fail();const p=workflowObject(value);
  exact(p,['kind','reminders']);if(p.kind!=='reminders'||!Array.isArray(p.reminders)||p.reminders.length>operation.maximumItems)fail();
  // The owner day is computed in the reviewed zone: [start of day, start of next day).
  const bound=(date:string)=>{const [y,m,d]=date.split('-').map(Number);let guess=Date.UTC(y,m-1,d);for(let i=0;i<3;i++){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:operation.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(guess).map(x=>[x.type,x.value]));const local=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second);guess+=Date.UTC(y,m-1,d)-local;}return guess;};
  const next=new Date(Date.parse(operation.day+'T00:00:00Z')+86400000).toISOString().slice(0,10),begin=bound(operation.day),end=bound(next);
  const reminders:WorkflowReminderRow[]=[];for(const raw of p.reminders){const r=workflowObject(raw);const completed=r.status==='completed';exact(r,completed?['id','revision','title','dueAt','status','completedAt']:['id','revision','title','dueAt','status']);if(r.status!=='open'&&!completed)fail();const item:WorkflowReminderRow={id:workflowId(r.id),revision:digest(r.revision),title:text(r.title,1000,true),dueAt:utc(r.dueAt),status:r.status,...(completed?{completedAt:utc(r.completedAt)}:{})};
   if(completed?(Date.parse(item.completedAt!)<begin||Date.parse(item.completedAt!)>=end):Date.parse(item.dueAt)>=end)fail();
   if(await workflowSha([item.id,item.title,item.dueAt,item.status,item.completedAt??null])!==item.revision)fail();reminders.push(item);}
  if(new Set(reminders.map(r=>JSON.stringify([r.id,r.dueAt,r.status]))).size!==reminders.length)fail();return {kind:'reminders',reminders};
 }
export async function parseWorkflowPhoneReview(value:unknown,expected:{id:string;workflowId:string;versionId:string}):Promise<WorkflowPhoneReview>{
 const p=workflowObject(value);if(p.runId!==expected.id||p.workflowId!==expected.workflowId||p.versionId!==expected.versionId||typeof p.finished!=='boolean'||!(p.cancellationRequestedAt===null||typeof p.cancellationRequestedAt==='string'))fail();const spec=workflowObject(p.spec);if(workflowBytes(spec)>65536||spec.version!==1||!Array.isArray(spec.steps)||!spec.steps.length||spec.steps.length>32)fail();text(spec.name,200);text(spec.description,4000,true);const device=workflowObject(spec.device);exact(device,['installationId','enrollmentId']);workflowId(device.installationId);workflowEnrollmentId(device.enrollmentId);const {normalizePhoneSpec}=await import('./phone-workflow-authoring');const canonical=normalizePhoneSpec(spec);if(await workflowSha(spec)!==digest(p.specDigest))fail();return {runId:workflowId(p.runId),workflowId:workflowId(p.workflowId),versionId:workflowId(p.versionId),specDigest:p.specDigest,spec:{...canonical,device:canonical.device!} as WorkflowPhoneReview['spec'],status:text(p.status,100),finished:p.finished,cancellationRequestedAt:p.cancellationRequestedAt};
}
export function assertWorkflowOperation(review:WorkflowPhoneReview,binding:WorkflowDeviceBinding,target:WorkflowDeviceTarget,operation:{type:string;[key:string]:any}){
 if(review.finished||review.cancellationRequestedAt||review.runId!==binding.runId||review.workflowId!==binding.workflowId||review.versionId!==binding.versionId||review.specDigest!==binding.specDigest||review.spec.device.installationId!==target.installationId||review.spec.device.enrollmentId!==target.enrollmentId)fail();const step=review.spec.steps.find(s=>s.id===binding.stepId);if(!step)return fail();
 if(operation.type==='read_selected_notes'){if(step.kind!=='Read'||step.operation!=='selected_notes'||JSON.stringify(parseWorkflowRead({type:operation.type,notes:step.notes}))!==JSON.stringify(operation))fail();}
 else if(operation.type==='read_selected_reminders'){if(step.kind!=='Read'||step.operation!=='selected_reminders'||JSON.stringify(parseWorkflowReminderRead({type:operation.type,...workflowObject(step.scope)}))!==JSON.stringify(operation))fail();}
 else if(operation.type==='read_calendar_range'){if(step.kind!=='Read'||step.operation!=='calendar_range'||JSON.stringify(parseWorkflowRead({type:operation.type,...workflowObject(step.range)}))!==JSON.stringify(operation))fail();}
 else if(operation.type==='create_note'){if(step.kind!=='Write'||step.operation!=='save_note'||step.title!==operation.title||typeof operation.body!=='string')fail();}
 else if(operation.type==='post_notification'){if(step.kind!=='Notify'||step.operation!=='app_notification'||step.title!==operation.title||typeof operation.body!=='string'||!operation.body.trim()||operation.body.length>2000||operation.body.includes('\0')||Object.keys(operation).some(key=>!['type','title','body'].includes(key)))fail();}
 else if(operation.type==='speak_text'){if(step.kind!=='Speak'||step.operation!=='read_aloud'||typeof operation.text!=='string'||!operation.text.trim()||operation.text.length>5000||operation.text.includes('\0')||Object.keys(operation).some(key=>!['type','text'].includes(key)))fail();}
 else fail();
}
