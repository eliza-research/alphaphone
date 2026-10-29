import {createDeviceActionExecution} from '../../../../.eliza/client-features/packages/contracts/src/device-action-execution.ts';
import {browserNavigationSummary} from './action-message-presentation';
import {namedCalendarReadTarget} from '../../../../.eliza/client-features/plugins/plugin-calendar/src/client/named-read.ts';
import {foregroundReviewOperationAvailable,isForegroundReviewOperation as isForegroundReview,validateForegroundReviewOperation,validateForegroundReviewResult,type ForegroundReviewOperation,type ForegroundReviewResult} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/foreground-review-contract.ts';
import {CAMERA_CAPTURE_CAPABILITY,isCameraCapture,validateCameraCapture,validateCameraCaptureResult,type CameraCaptureOperation,type CameraCaptureResult} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/camera-contract.ts';
import {isSmsSend,validateSmsSend,validateSmsResult,smsAgentHash,smsDeviceStatus,SMS_SEND_CAPABILITY,type SmsSendOperation,type SmsSendResult} from './sms-agent-contract.ts';
import {isPhoneDial,validatePhoneDial,validatePhoneDialResult,phoneDialCapabilityAvailable,dialDeviceStatus,type PhoneDialOperation,type PhoneDialResult} from './phone-dial-contract.ts';
import {isOriginalDeviceReadOperationType,isNativeNotesQuery,validateNativeNotesQuery,NOTES_QUERY_CAPABILITY,validateNativeNotesReadReplyOrigin,validateNativeNotesReadReplyHint,validateNativeNotesReadReply,type NativeNotesReadReplyOrigin,type NativeNotesReadReplyHint,type NativeNotesReadReply,type NativeNotesQueryOperation} from '../../../../.eliza/client-features/packages/contracts/src/native-notes-query.ts';
import {validateNotesQueryResult,type NotesQueryResult} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/notes-query-result.ts';
import {presentDeviceRecordOperation} from './device-record-presentation';
import {formatDeviceRecordDateTime} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/device-record-presentation.ts';
import {isReminderCreate,validateReminderCreate,validateReminderCreateResult,type ReminderCreateOperation,type ReminderCreateResult} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-create-contract.ts';
import {isClockOperation,validateClockOperation,validateClockResult,assertClockTimeZone,describeClockHandoff,type ClockOperation,type ClockHandoffResult} from './clock-contract.ts';
import { isMapsOperation, validateMapsOperation, validateMapsResult, type MapsOperation, type MapsResult } from './maps-contract';
import { validateMapsSelectedObject } from '../maps/agent-context';
import { isLibraryOperation, validateLibraryOperation, validateLibraryResult, describeLibraryOperation, PHOTO_LIBRARY_CAPABILITY, type LibraryAgentOperation, type LibraryAgentResult } from './photo-library';
import {type ReminderOperation,type ReminderResult,isReminderOperation,validateReminderOperation,validateReminderResult} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-contract.ts';
import {type NotesOperation,type NotesResult,isNotesOperation,validateNotesOperation,validateNotesResult} from './notes-contract';
import {CALENDAR_AGENDA_CAPABILITY,calendarSource,type CalendarSource,type CalendarOperation,type CalendarResult,calendarCapabilityAvailable,isCalendarOperation,validateCalendarOperation,validateCalendarResult} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/calendar-contract.ts';
import { isMvpView } from "../prototype/mvp-features";
import { parseWorkflowBinding, parseWorkflowRead, validateWorkflowResult, assertWorkflowOperation, type WorkflowReadOperation, type WorkflowReadResult, type WorkflowDeviceBinding, type WorkflowPhoneReview } from './workflow-device-contract';
import type { AlphaClient, ActionProposal, ContextEnvelope, OperationReceipt, VerifiedSession } from './alpha-client';

export type WorkflowPresentationOperation = {type:'post_notification';title:string;body:string}|{type:'speak_text';text:string};
export type DeviceOperation = CameraCaptureOperation | SmsSendOperation | PhoneDialOperation | ReminderCreateOperation | WorkflowPresentationOperation | ClockOperation | MapsOperation | LibraryAgentOperation | ReminderOperation | NotesOperation | NativeNotesQueryOperation | CalendarOperation | WorkflowReadOperation | { type: 'create_note'; title: string; body: string }
  | { type: 'create_reminder'; title: string; dueAt: string }
  | { type: 'open_view'; view: string } | { type: 'browser_navigate'; url: string };
/** Foreground reviews (free/busy, Notes search, name-targeted edits) and their validators are
 * the shared device-review contract bound to the shared Notes, Calendar and reminder contracts. */
export {FOREGROUND_REVIEW_TYPES as FOREGROUND_OPERATION_TYPES,namedTargetValidators,selectedNotesRead,validateForegroundReviewOperation,validateForegroundReviewResult,type ForegroundReviewOperation,type ForegroundReviewResult,type NamedTargetExactOperation} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/foreground-review-contract.ts';
/** Every operation a proposal may carry. Foreground reviews run through their own executor. */
export type ReviewableDeviceOperation = DeviceOperation | ForegroundReviewOperation;
/** Runs the phone's local review (calendar choice, note choice, record disambiguation)
 * and any resulting exact-target effect. Only an owner-confirmed result is returned. */
export type ForegroundReviewExecutor = (operation: ForegroundReviewOperation, operationId: string, context: ContextEnvelope, signal: AbortSignal, bindingHash: string, journalIdentity: DeviceJournalIdentity, capabilities: readonly string[]) => Promise<{ status: 'succeeded' | 'failed' | 'unknown'; summary: string; foregroundResult?: ForegroundReviewResult }>;
export interface DeviceCredential { installationId: string; key: string; enrollmentId?: string; capabilities?: readonly string[] }
export interface JournalEntry {
  scope: string; proposalId: string; operationId: string; operationHash: string;
  record: Record<string, unknown>; phase: 'reserved' | 'applying' | 'terminal'; attemptId?: string;
  status?: 'succeeded' | 'failed' | 'unknown' | 'cancelled'; summary?: string; result?: Record<string, unknown>;
}
export interface ActionJournal {
  reserve(input: Omit<JournalEntry, 'phase'>): Promise<{ created: boolean; entry: JournalEntry }>;
  markApplying(input: { scope: string; proposalId: string; attemptId: string }): Promise<unknown>;
  finish(input: { scope: string; proposalId: string; status: NonNullable<JournalEntry['status']>; summary: string; result?: Record<string, unknown> }): Promise<unknown>;
  recoverNotification?(input:{scope:string;proposalId:string;bindingHash:string}):Promise<{entry:JournalEntry|null}>;
  recoverDeletion?(input:{scope:string;proposalId:string}):Promise<{entry:JournalEntry|null}>;
  recoverReminder?(input:{scope:string;proposalId:string;bindingHash:string}):Promise<{entry:JournalEntry|null}>;
  get(input: { scope: string; proposalId: string }): Promise<{ entry: JournalEntry | null }>;
  list(input: { scope: string }): Promise<{ entries: JournalEntry[] }>;
}
export interface WorkflowNoticeRoute {scope:string;origin:string;ownerId:string;agentId:string;workflowId:string;runId:string;versionId:string}
export interface DeviceJournalIdentity {scope:string;proposalId:string}
export type DeviceExecutor = (operation: DeviceOperation, operationId: string, context: ContextEnvelope, signal: AbortSignal, bindingHash: string, workflowRoute?:WorkflowNoticeRoute,journalIdentity?:DeviceJournalIdentity,agendaSource?:CalendarSource) => Promise<{ status: 'succeeded' | 'failed' | 'unknown'; summary: string; dialResult?:PhoneDialResult; readResult?: WorkflowReadResult; calendarResult?:CalendarResult; notesResult?:NotesResult|NotesQueryResult; reminderResult?:ReminderResult|ReminderCreateResult; mapsResult?:MapsResult;clockResult?:ClockHandoffResult;photoLibraryResult?:LibraryAgentResult;cameraResult?:CameraCaptureResult;smsResult?:SmsSendResult;/** Local Browser presentation only; never persisted or uploaded. */presentBrowser?:()=>void }>;
export type DeviceRecovery = (operation:DeviceOperation,operationId:string,bindingHash:string,signal:AbortSignal)=>Promise<{status:string;reminderResult?:ReminderResult|ReminderCreateResult;smsResult?:SmsSendResult}>;
interface Proposal { calendarAgendaSource?:CalendarSource; providerReceipt?:unknown; requestMessageId?: string; id: string; digest: string; state: string; expiresAt: number; operation: ReviewableDeviceOperation; workflow?:WorkflowDeviceBinding; attemptId?: string;providerIdempotencyKey?:string;readReplyOrigin?:NativeNotesReadReplyOrigin }
const views = new Set(['home','notes','reminders','browser','calendar','files','photos','camera','maps','inbox','settings','workflows']);
function object(value: unknown): Record<string, any> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid device action response'); return value as Record<string, any>; }
function text(value: unknown, max = 128): string { if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new Error('Invalid device action field'); return value; }
function id(value: unknown): string { const valueText = text(value); if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(valueText)) throw new Error('Invalid device action identifier'); return valueText; }
/** Every proposal operation, including foreground reviews. */
export function validateReviewableDeviceOperation(value: unknown): ReviewableDeviceOperation {
  const p = object(value);
  return isForegroundReview(p) ? validateForegroundReviewOperation(p) : validateDeviceOperation(p);
}
export function validateDeviceOperation(value: unknown): DeviceOperation {
  const p = object(value);
  if(isCameraCapture(p))return validateCameraCapture(p);
  if(isSmsSend(p))return validateSmsSend(p);
  if(isPhoneDial(p))return validatePhoneDial(p);
  if(isReminderCreate(p))return validateReminderCreate(p);
  if(isClockOperation(p))return validateClockOperation(p);
  if(isMapsOperation(p))return validateMapsOperation(p);
  if(isLibraryOperation(p))return validateLibraryOperation(p);
  if(isReminderOperation(p))return validateReminderOperation(p);
  if(isNotesOperation(p))return validateNotesOperation(p);
  if(isCalendarOperation(p))return validateCalendarOperation(p);
  if(p.type==='notes_query')return validateNativeNotesQuery(p);
  if(p.type==='read_selected_notes'||p.type==='read_calendar_range'||p.type==='read_selected_reminders')return parseWorkflowRead(p);
  if(p.type==='post_notification'){if(Object.keys(p).some(k=>!['type','title','body'].includes(k)))throw Error('Invalid notification fields');return {type:p.type,title:text(p.title,200),body:text(p.body,2000)};}
  if(p.type==='speak_text'){if(Object.keys(p).some(k=>!['type','text'].includes(k)))throw Error('Invalid speech fields');return {type:p.type,text:text(p.text,5000)};}
  if (p.type === 'create_note') {
    if (typeof p.body !== 'string' || p.body.length > 32000 || p.body.includes('\0')) throw new Error('Invalid note');
    return { type: p.type, title: text(p.title, 256), body: p.body };
  }
  if (p.type === 'create_reminder') {
    if(Object.keys(p).length!==3||Object.keys(p).some(k=>!['type','title','dueAt'].includes(k)))throw Error('Unexpected legacy reminder fields');
    const dueAt = text(p.dueAt, 40), time = Date.parse(dueAt);
    if (!Number.isFinite(time) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(dueAt) || new Date(time).toISOString().replace('.000Z','Z') !== dueAt.replace('.000Z','Z')) throw new Error('Invalid reminder time');
    return { type: p.type, title: text(p.title, 200), dueAt };
  }
  if (p.type === 'open_view' && views.has(p.view) && (p.view==='home'||p.view==='reminders'||isMvpView(p.view))) return { type: p.type, view: p.view };
  if (p.type === 'browser_navigate') { const url = new URL(text(p.url, 4096)); if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid browser destination'); return { type: p.type, url: url.href }; }
  throw new Error('Unsupported device operation');
}
function contextKey(value: ContextEnvelope): string {
  const selected = value.selectedObject;
  return JSON.stringify([value.view, value.sensitive === true, value.revision, value.timeZone ?? null, selected ? [selected.kind, selected.id, selected.revision ?? null, selected.accountId ?? null,selected.sourceRevision??null,selected.occurrenceId??null] : null]);
}
function assertCalendarContext(operation:CalendarOperation,context:ContextEnvelope){
 if(operation.type==='calendar_create_local'||operation.type==='calendar_read_next'){if(context.sensitive)throw Error('Return to the unlocked phone and review Calendar access');return;}
 const selected=context.selectedObject;
 if(context.view!=='calendar'||context.sensitive||!selected)throw Error('Open the selected calendar source or event');
 if(operation.type==='calendar_create'){
  if(selected.kind!=='calendar-source'||selected.id!==operation.source.sourceId||selected.revision!==operation.source.sourceRevision)throw Error('Calendar source changed');
 }else if(selected.kind!=='calendar-event'||selected.id!==operation.target.eventId||selected.revision!==operation.target.revision||selected.accountId!==operation.target.sourceId||selected.sourceRevision!==operation.target.sourceRevision)throw Error('Selected calendar event changed');
}
function assertMapsContext(operation:MapsOperation,context:ContextEnvelope){const selected=context.selectedObject,t=operation.target;if(context.sensitive||context.view!=='maps'||!selected||selected.kind!==t.kind||selected.id!==t.id||selected.revision!==t.revision||!validateMapsSelectedObject(t))throw Error('Selected Maps context changed');}
/** Device library operations run only where the owner sees Photos on the unlocked phone. */
function assertLibraryContext(context:ContextEnvelope){if(context.sensitive||context.view!=='photos')throw Error('Open Photos to review this library action');}
function assertReminderContext(operation:ReminderOperation,context:ContextEnvelope){const s=context.selectedObject,t=operation.target;if(context.sensitive||context.view!=='calendar'||!s||s.kind!=='reminder'||s.id!==t.reminderId||s.revision!==t.revision||s.accountId!==t.sourceId||s.sourceRevision!==t.sourceRevision||s.occurrenceId!==t.occurrenceId||s.timingVersion!==t.timingVersion)throw Error('Selected reminder context changed');}
function assertNotesQueryContext(context:ContextEnvelope){if(context.sensitive||!['home','notes'].includes(context.view))throw Error('Review this Notes query from Home or Notes');}
/** Foreground reviews resolve locally; they are offered only where the owner can see the result. */
function assertForegroundContext(operation:ForegroundReviewOperation,context:ContextEnvelope){
 if(context.sensitive)throw new ContextNotice('Unlock the phone to review this action.');
 if(operation.type==='calendar_availability'){if(!['home','calendar'].includes(context.view))throw new ContextNotice('Open Home or Calendar to review this availability check.');
  // All-day events block the owner's local days, so the check must use this phone's time zone.
  if(operation.timeZone!==context.timeZone)throw new ContextNotice('This availability check used a different time zone. Ask again from this phone.');return;}
 if(operation.type==='calendar_named'&&operation.action==='read'){if(!namedCalendarReadTarget(context))throw new ContextNotice('Choose the matching event in Calendar before sharing it.');return;}
 if(operation.type==='notes_search'){if(!['home','notes'].includes(context.view))throw new ContextNotice('Open Home or Notes to review this Notes search.');return;}
 // Name-targeted edits are requested from Home and resolved by a local choice, never by a selection elsewhere.
 if(context.view!=='home')throw new ContextNotice('Return to Home to choose the record for this action.');
}
export const CAMERA_CONTEXT_NOTICE='Open Camera to take the requested photo.';
/** A pending proposal that does not fit the current screen. Its message is shown to the owner. */
export class ContextNotice extends Error { override readonly name='ContextNotice'; }
function assertNotesContext(operation:NotesOperation,context:ContextEnvelope){const s=context.selectedObject,t=operation.target;if(context.sensitive||context.view!=='notes'||!s||s.kind!=='note'||s.id!==t.noteId||s.revision!==t.revision||s.accountId!==t.sourceId||s.sourceRevision!==t.sourceRevision)throw Error('Selected note context changed');}
/** Every screen rule for a proposal; throws when the current screen cannot review it. */
function assertProposalContext(operation:ReviewableDeviceOperation,context:ContextEnvelope){
 if(operation.type==='read_calendar_range'&&(context.sensitive||typeof document!=='undefined'&&document.hidden))throw new ContextNotice('Unlock this foreground Calendar read before approving it.');
 if(isCameraCapture(operation)&&(context.sensitive||context.view!=='camera'))throw new ContextNotice(CAMERA_CONTEXT_NOTICE);
 if(isForegroundReview(operation))assertForegroundContext(operation,context);
 if(isPhoneDial(operation)&&(context.sensitive||typeof document!=='undefined'&&document.hidden))throw new ContextNotice('Unlock Alpha and keep it open to review this number.');
 if(isSmsSend(operation)&&(context.sensitive||context.view!=='messages'||context.selectedObject?.kind!=='sms-subscription'||context.selectedObject.id!==String(operation.subscriptionId)))throw new ContextNotice('Open Messages and select the reviewed SIM before approving SMS.');
 if(isClockOperation(operation))assertClockTimeZone(operation,context.timeZone);
 if(isMapsOperation(operation))assertMapsContext(operation,context);
 if(isLibraryOperation(operation))assertLibraryContext(context);
 if(isReminderOperation(operation))assertReminderContext(operation,context);
 if(isNativeNotesQuery(operation))assertNotesQueryContext(context);
 if(isNotesOperation(operation))assertNotesContext(operation,context);
 if(isCalendarOperation(operation))assertCalendarContext(operation,context);
}
/** Owner-facing reason a pending proposal cannot be reviewed from this screen, or undefined. */
export function proposalContextNotice(operation:ReviewableDeviceOperation,context:ContextEnvelope):string|undefined{
 try{assertProposalContext(operation,context);return undefined;}catch(error){
  if(error instanceof ContextNotice)return error.message;
  if(context.sensitive)return 'Unlock the phone to review this action.';
  if(isClockOperation(operation))return 'This Clock request used a different time zone. Ask again from this phone.';
  if(isMapsOperation(operation))return 'Open the selected place or route in Maps to review this action.';
  if(isLibraryOperation(operation))return 'Open Photos > Device library to review this action.';
  if(isReminderOperation(operation))return 'Open the selected reminder in Calendar to review this action.';
  if(isNativeNotesQuery(operation))return 'Open Home or Notes to review this Notes search.';
  if(isNotesOperation(operation))return 'Open the selected note to review this action.';
  if(isCalendarOperation(operation))return operation.type==='calendar_create'?'Open the selected calendar to review this action.':'Open the selected calendar event to review this action.';
  return 'Return to the screen this action was requested from to review it.';
 }
}
const quoted=(value:string)=>`“${value}”`;
function describeForegroundReview(op:ForegroundReviewOperation,timeZone?:string):{title:string;description:string}{
 if(op.type==='calendar_availability'){
  const zone=timeZone??op.timeZone;
  return {title:'Check availability',description:`Check whether you are free from ${formatDeviceRecordDateTime(op.start,zone)} to ${formatDeviceRecordDateTime(op.end,zone)} (${zone}).\nYou choose which calendars this phone reads. Only busy times are shared with the agent, not event titles or details. Events marked free are ignored; all-day events count as busy.`};
 }
 if(op.type==='calendar_named'&&op.action==='read')return {title:'Share matching event',description:`Choose the event named ${quoted(op.name)} in Calendar, then review the details to share. The edit needs a separate confirmation.`};
 if(op.type==='notes_search')return op.query.kind==='content'
  ?{title:'Search notes',description:`Search your notes for ${quoted(op.query.text)} on this phone.\nChoose and review one note before its text is shared. Other notes stay on this phone.`}
  :{title:'List note titles',description:`List up to ${op.query.limit} note titles on this phone.\nReview the exact titles before they are shared. Note text is not shared.`};
 const noun=op.type==='notes_named'?'note':op.type==='calendar_named'?'event':'reminder';
 const verb=op.action==='update'?'Edit':op.action==='delete'?'Delete':'Cancel';
 const where=op.type==='notes_named'?'Notes':op.type==='calendar_named'?'Calendar':'Reminders';
 let change='';
 if(op.action==='update'){
  if(op.type==='notes_named')change=`\nNew title: ${quoted(op.fields.title)}\n${op.fields.body}`;
  else if(op.type==='calendar_named')change=`\nNew title: ${quoted(op.fields.title)}\n${formatDeviceRecordDateTime(op.fields.start,op.fields.timeZone)} to ${formatDeviceRecordDateTime(op.fields.end,op.fields.timeZone)} (${op.fields.timeZone})`;
  else change=`\nNew title: ${quoted(op.fields.title)}${op.fields.body?`\n${op.fields.body}`:''}`;
 }
 return {title:`${verb} ${noun} by name`,description:`Find ${quoted(op.name)} in ${where} on this phone. You choose the exact ${noun}, then review this ${verb.toLowerCase()} again before anything changes.${change}`};
}
const publishedDeviceReceipts=new WeakSet<OperationReceipt>();
type RefreshClient=Pick<AlphaClient,'getState'|'subscribe'>;
const pendingDeviceChanges=new WeakMap<RefreshClient,{entries:Map<string,{receipt:OperationReceipt;session:VerifiedSession}>;unsubscribe:()=>void;flushing:boolean;flush:()=>void}>();
/** Queue only delivered receipts; publish when the same owner session is idle. */
export function publishCommittedDeviceChanges(receipt:OperationReceipt,client:RefreshClient,session:VerifiedSession){
 if(receipt.status!=='succeeded'||!receipt.committedChanges?.length||publishedDeviceReceipts.has(receipt))return;
 let pending=pendingDeviceChanges.get(client);
 if(!pending){
  pending={entries:new Map(),unsubscribe:()=>{},flushing:false,flush:()=>{}};pendingDeviceChanges.set(client,pending);
  const queue=pending;
  const flush=()=>{
   if(queue.flushing)return;queue.flushing=true;
   try{for(const [id,item]of queue.entries){
    const state=client.getState();
    if(state.connection!=='ready'||JSON.stringify(state.session)!==JSON.stringify(item.session)){queue.entries.delete(id);continue;}
    if(state.pending)break;
    queue.entries.delete(id);publishedDeviceReceipts.add(item.receipt);
    for(const view of new Set(item.receipt.committedChanges))if(['calendar','notes','reminders'].includes(view)&&typeof window!=='undefined')window.dispatchEvent(new CustomEvent('alpha:'+view+'-committed'));
   }}finally{queue.flushing=false;if(!queue.entries.size){queue.unsubscribe();pendingDeviceChanges.delete(client);}}
  };
  queue.flush=flush;queue.unsubscribe=client.subscribe(flush);
  queue.entries.set(receipt.proposalId,{receipt,session:{...session}});flush();return;
 }
 pending.entries.set(receipt.proposalId,{receipt,session:{...session}});pending.flush();
}
export interface PendingReviewItem {
  /** Reviewable from the current screen; null when only a notice can be shown. */
  proposal: ActionProposal | null;
  /** Why a pending proposal cannot be reviewed here, for example "Open the selected note". */
  notice?: string;
}
export async function actionScope(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
/** Authenticated structured actions only. Neither reply prose nor restored history
 * can enter this boundary. A durable journal gates every device effect. */
export class DeviceActions {
  get supportsCalendarAgenda(){return this.credential.capabilities?.includes(CALENDAR_AGENDA_CAPABILITY)===true;}
  private proposals = new Map<string, { proposal: Proposal; context: ContextEnvelope; workflowReview?:WorkflowPhoneReview }>();
  private readReplies = new Map<string,{digest:string;origin:NativeNotesReadReplyOrigin;hint?:NativeNotesReadReplyHint;consumed?:boolean}>();
  private busy = false;
  constructor(readonly session: VerifiedSession, readonly credential: DeviceCredential, readonly scope: string,
    private request: (path: string, body: unknown | undefined, signal: AbortSignal) => Promise<unknown>,
    private journal: ActionJournal, private execute: DeviceExecutor, private recover?:DeviceRecovery, private reminderV2=false, private reminderCreate=false, private executeForeground?:ForegroundReviewExecutor) {}
  private parse(value: unknown): Proposal {
    const p = object(value), payload = object(p.payload);
    if (p.subjectUserId !== this.session.ownerId || p.requestedBy !== this.session.agentId || p.action !== 'device_action' || payload.action !== 'device_action' || payload.version !== 1 || payload.installationId !== this.credential.installationId || payload.enrollmentId !== this.credential.enrollmentId) throw new Error('Device action belongs to another identity');
    const expiresAt = Date.parse(text(p.expiresAt, 40)), digest = text(p.digest, 64);
    if (!Number.isFinite(expiresAt) || !/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid action expiry or digest');
    const workflow=payload.workflow===undefined?undefined:parseWorkflowBinding(payload.workflow),op=validateReviewableDeviceOperation(payload.operation);
    if(isCameraCapture(op)&&!this.credential.capabilities?.includes(CAMERA_CAPTURE_CAPABILITY))throw Error('Camera capture was not negotiated with this agent');
    if(isSmsSend(op)&&!this.credential.capabilities?.includes(SMS_SEND_CAPABILITY))throw Error('Native SMS was not negotiated with this phone');
    if(isPhoneDial(op)&&!phoneDialCapabilityAvailable(op,this.credential.capabilities))throw Error('Dialing was not negotiated with this phone');
    if(isCalendarOperation(op)&&(op.type==='calendar_create_local'||op.type==='calendar_read_next')&&!calendarCapabilityAvailable(op.type,this.credential.capabilities))throw Error('This agent has not negotiated native Calendar creation or discovery. Reconnect to a compatible agent.');
    if(isNativeNotesQuery(op)&&!this.credential.capabilities?.includes(NOTES_QUERY_CAPABILITY))throw Error('Notes discovery was not negotiated with this agent');
    if(isLibraryOperation(op)&&!this.credential.capabilities?.includes(PHOTO_LIBRARY_CAPABILITY))throw Error('Device library access was not negotiated with this agent');
    if(isForegroundReview(op)&&(!foregroundReviewOperationAvailable(op,this.credential.capabilities)||!this.executeForeground))throw Error('This action was not negotiated with this agent. Reconnect to a compatible agent.');
    if(isReminderCreate(op)&&!this.reminderCreate)throw Error('This agent does not support reviewed reminder creation. Reconnect to a compatible agent.');
    if(isReminderOperation(op)&&(op.target.timingVersion===2||op.type==='reminder_update'&&op.fields.schedule?.alertMinutes!==undefined)&&!this.reminderV2)throw Error('This agent does not support this reminder timing. Reconnect to a compatible agent.');
    const agendaSource=payload.calendarAgendaSource===undefined?undefined:calendarSource(payload.calendarAgendaSource);
    if(agendaSource&&(op.type!=='read_calendar_range'||workflow||!payload.requestMessageId||op.calendarIds.length!==1||op.calendarIds[0]!==agendaSource.sourceId||!this.credential.capabilities?.includes(CALENDAR_AGENDA_CAPABILITY)))throw Error('Standalone Calendar read was not negotiated or bound');
    if((['read_selected_notes','read_calendar_range','read_selected_reminders','post_notification','speak_text'].includes(op.type))&&!workflow&&!(op.type==='read_calendar_range'&&agendaSource))throw new Error('Workflow binding required for phone reads');
    const readReplyOrigin=p.readReplyOrigin===undefined?undefined:validateNativeNotesReadReplyOrigin(p.readReplyOrigin);
    if(readReplyOrigin&&(workflow||!isOriginalDeviceReadOperationType(op.type)))throw Error('Unexpected original Notes reply');
    return { ...(agendaSource?{calendarAgendaSource:agendaSource}:{}),providerReceipt:p.execution?.providerReceipt, ...(payload.requestMessageId===undefined?{}:{requestMessageId:id(payload.requestMessageId)}), id: id(p.id), digest, state: text(p.state, 32), expiresAt, operation:op,...(workflow?{workflow}:{}), ...(p.execution?.providerIdempotencyKey ? {providerIdempotencyKey:id(p.execution.providerIdempotencyKey)}:{}), ...(p.execution?.attemptId ? { attemptId: id(p.execution.attemptId) } : {}),...(readReplyOrigin?{readReplyOrigin}:{}) };
  }
  /** Each proposal is parsed on its own: one invalid proposal never hides valid siblings. */
  private async listing(signal: AbortSignal): Promise<{ valid: Proposal[]; invalid: { pending: boolean; error: Error }[] }> {
    const response = object(await this.request('/api/client-devices/proposals', undefined, signal));
    if (!Array.isArray(response.proposals)) throw new Error('Invalid device action list');
    const valid: Proposal[] = [], invalid: { pending: boolean; error: Error }[] = [];
    for (const value of response.proposals) {
      try { valid.push(this.parse(value)); }
      catch (error) {
        const raw = value && typeof value === 'object' ? value as { state?: unknown; expiresAt?: unknown } : {};
        // An invalid proposal that is finished or has expired is history, not a pending notice.
        const expiresAt = typeof raw.expiresAt === 'string' ? Date.parse(raw.expiresAt) : NaN;
        invalid.push({ pending: (raw.state === undefined || raw.state === 'pending') && !(expiresAt <= Date.now()), error: error instanceof Error ? error : new Error('Invalid device action') });
      }
    }
    return { valid, invalid };
  }
  async list(signal: AbortSignal): Promise<Proposal[]> {
    return (await this.listing(signal)).valid;
  }
  private card(proposal: Proposal, context: ContextEnvelope): ActionProposal {
    const op = proposal.operation;
    const notesDestination=(op.type==='notes_delete'||op.type==='notes_update')&&!context.sensitive&&['home','notes'].includes(context.view)&&proposalContextNotice(op,context)?{reviewDestination:'notes' as const,reviewNoteTarget:structuredClone(op.target)}:{};
    if (isForegroundReview(op)) return { ...(op.type==='calendar_named'&&op.action==='read'&&!context.sensitive&&['home','calendar'].includes(context.view)&&!namedCalendarReadTarget(context)?{reviewDestination:'calendar' as const}:{}), id: proposal.id, ...describeForegroundReview(op, context.timeZone), expiresAt: proposal.expiresAt, contextRevision: context.revision,...((op.type==='calendar_availability'||op.type==='calendar_named'&&op.action==='read'&&!!namedCalendarReadTarget(context))&&proposal.readReplyOrigin?{readReply:{origin:structuredClone(proposal.readReplyOrigin),digest:proposal.digest}}:{}) };
    if(isPhoneDial(op))return {id:proposal.id,title:'Open dial screen',description:`${op.target.kind==='number'?`Number: ${op.target.number}`:`Contact: ${op.target.query}`}\n\nAlpha opens your phone app with this number. You place the call there; Alpha does not know whether it connects.`,expiresAt:proposal.expiresAt,contextRevision:context.revision};
    if(isSmsSend(op))return {id:proposal.id,title:'Review SMS',description:`To: ${op.recipients.join(', ')}\nSIM subscription: ${op.subscriptionId}\n\n${op.body}\n\nConfirm again in Android. Submission does not prove delivery.`,expiresAt:proposal.expiresAt,contextRevision:context.revision};
    if(isCameraCapture(op))return {id:proposal.id,title:'Take photo',description:'Use the current camera and save one photo in Photos. The photo stays on this device.',expiresAt:proposal.expiresAt,contextRevision:context.revision};
    if (isLibraryOperation(op)) return { id: proposal.id, ...describeLibraryOperation(op), expiresAt: proposal.expiresAt, contextRevision: context.revision };
    const record = isReminderCreate(op)||isReminderOperation(op)||isNotesOperation(op)||isCalendarOperation(op)||op.type==='create_note'||op.type==='create_reminder'?presentDeviceRecordOperation(op,context.timeZone):undefined;
    const description = op.type==='read_calendar_range'&&!proposal.workflow?`Share this app Calendar from ${formatDeviceRecordDateTime(op.start,op.timeZone)} to ${formatDeviceRecordDateTime(op.end,op.timeZone)} (end not included), in ${op.timeZone}. Only this range is shared; other calendars, descriptions, locations and guests stay private.`:isNativeNotesQuery(op)?(op.query.kind==='title'?`Look for the title “${op.query.text}” locally. Choose and review one note before sharing its text.`:`Find the latest ${op.query.by} note locally. Unknown dates or ties require your choice; only the chosen note is shared.`):record?.description ?? (isClockOperation(op) ? describeClockHandoff(op) : isMapsOperation(op) ? 'Send the exact selected place location or route endpoints, mode and distance to the connected agent. This shares location information. It does not start navigation.' : op.type === 'open_view' ? `Open ${op.view} on this phone` : op.type==='browser_navigate'?`Open browser destination ${op.url}`:'Workflow phone read');
    return { id: proposal.id, title:op.type==='read_calendar_range'&&!proposal.workflow?'Share Calendar agenda':record?.title ?? op.type.replaceAll('_', ' '), description, expiresAt: proposal.expiresAt, contextRevision: context.revision,...notesDestination,...(isNativeNotesQuery(op)&&!['home','notes'].includes(context.view)?{reviewDestination:'home' as const}:{}),...(isNativeNotesQuery(op)||op.type==='notes_read_selected'?{privateNotesRead:true as const}:{}),...(proposal.readReplyOrigin?{readReply:{origin:structuredClone(proposal.readReplyOrigin),digest:proposal.digest}}:{}) };
  }
  private async review(context: ContextEnvelope, signal: AbortSignal): Promise<{ items: PendingReviewItem[]; failures: Error[] }> {
    const { valid, invalid } = await this.listing(signal);
    signal.throwIfAborted(); this.proposals.clear();
    const items: PendingReviewItem[] = [];
    for (const proposal of valid) {
      if (proposal.workflow || proposal.state !== 'pending' || proposal.expiresAt <= Date.now()) continue;
      const card = this.card(proposal, context), notice = (isNativeNotesQuery(proposal.operation)&&!context.sensitive)||card.reviewDestination==='notes'||card.reviewDestination==='calendar' ? undefined : proposalContextNotice(proposal.operation, context);
      if (notice) { items.push({ proposal: null, notice: `${card.title}: ${notice}` }); continue; }
      this.proposals.set(proposal.id, { proposal, context: structuredClone(context) });
      if(proposal.readReplyOrigin&&!this.readReplies.has(proposal.id))this.readReplies.set(proposal.id,{digest:proposal.digest,origin:proposal.readReplyOrigin});
      items.push({ proposal: card });
    }
    const failures = invalid.filter(item => item.pending).map(item => item.error);
    for (const error of failures) items.push({ proposal: null, notice: `An agent action could not be shown on this phone. ${error.message.slice(0, 300)}` });
    return { items, failures };
  }
  /** Reviewable proposals plus owner-visible notices for pending ones that do not fit this screen. */
  async pendingReview(context: ContextEnvelope, signal: AbortSignal): Promise<PendingReviewItem[]> {
    return (await this.review(context, signal)).items;
  }
  /** Reviewable proposals only. An invalid proposal fails the call only when nothing else is reviewable. */
  async pending(context: ContextEnvelope, signal: AbortSignal): Promise<ActionProposal[]> {
    const { items, failures } = await this.review(context, signal);
    const proposals = items.flatMap(item => item.proposal ? [item.proposal] : []);
    if (!proposals.length && failures.length) throw failures[0];
    return proposals;
  }
  /** Only proposals bound by the host to this exact freshly sent user message may run.
   * Only reversible local actions bypass the optional review. Sends, deletes, private
   * reads and Calendar/reminder writes retain their recorded separate review policy.
   * Recovery, workflows and old hosts remain review-only; ordinary OS permissions still apply. */
  async performRequested(messageId:string,context:ContextEnvelope,signal:AbortSignal,allowed:()=>Promise<boolean>,operationType?:ReviewableDeviceOperation['type']):Promise<OperationReceipt[]> {
    const directTypes:readonly ReviewableDeviceOperation['type'][]=['create_note','open_view','browser_navigate','camera_capture_photo','photo_library_select'];
    const results:OperationReceipt[]=[];
    for(const [id,entry] of [...this.proposals]) {
      if(results.length>=4||!directTypes.includes(entry.proposal.operation.type)||entry.proposal.workflow||entry.proposal.requestMessageId!==messageId||(operationType!==undefined&&entry.proposal.operation.type!==operationType))continue;
      // A navigation-only card is not an executable read/write, even in direct-request mode.
      if(this.card(entry.proposal,context).reviewDestination)continue;
      if(!await allowed())break;
      signal.throwIfAborted();
      const result=await this.approve(id,context,signal);results.push(result);
      if(result.status!=='succeeded'||signal.aborted)break;
    }
    return results;
  }
  /** Notice restoration validates pending metadata without creating an executable foreground review. */
  async pendingWorkflowNotice(review:WorkflowPhoneReview,signal:AbortSignal):Promise<Array<{id:string;expiresAt:number}>> {
    if(review.finished||review.cancellationRequestedAt)return [];
    const pending=(await this.list(signal)).filter(p=>p.workflow?.runId===review.runId&&p.state==='pending'&&p.expiresAt>Date.now());signal.throwIfAborted();
    return pending.map(p=>{assertWorkflowOperation(review,p.workflow!,{installationId:this.credential.installationId,enrollmentId:this.credential.enrollmentId!},p.operation);return {id:p.id,expiresAt:p.expiresAt};});
  }
  async pendingForWorkflow(review:WorkflowPhoneReview,context:ContextEnvelope,signal:AbortSignal):Promise<ActionProposal[]> {
    if(context.view!=='workflows'||context.sensitive||context.selectedObject?.kind!=='workflow-run'||context.selectedObject.id!==review.runId||context.selectedObject.revision!==review.versionId)throw new Error('Open this exact workflow execution before reviewing phone steps');
    const pending=(await this.list(signal)).filter(p=>p.workflow?.runId===review.runId&&p.state==='pending'&&p.expiresAt>Date.now());signal.throwIfAborted();this.proposals.clear();
    return pending.map(p=>{assertWorkflowOperation(review,p.workflow!,{installationId:this.credential.installationId,enrollmentId:this.credential.enrollmentId!},p.operation);this.proposals.set(p.id,{proposal:p,context:structuredClone(context),workflowReview:structuredClone(review)});
      const op=p.operation;const scope=op.type==='read_selected_reminders'?`Read reminders open by the end of ${op.day} (overdue included) and reminders completed that day, in ${op.timeZone}. At most ${op.maximumItems} reminders; overflow fails. Titles, due times and completion times will be sent; reminder notes and alarms are excluded.`:op.type==='read_selected_notes'?`Read only ${op.notes.length} selected Notes at the recorded revisions. Text and titles will be sent to this agent.\nSelected IDs: ${op.notes.map(n=>n.id).join(', ')}`:op.type==='read_calendar_range'?`Read calendars ${op.calendarIds.join(', ')} from ${op.start} up to (excluding) ${op.end}, shown in ${op.timeZone}. At most ${op.maximumEvents} events; overflow fails. Event titles, times and IDs will be sent; descriptions, locations and attendees are excluded.`:op.type==='create_note'?`Save one note “${op.title}” on this phone:\n${op.body}`:op.type==='post_notification'?`Post this notification on this device: ${op.title}\n${op.body}`:op.type==='speak_text'?`Read this exact text aloud on this device:\n${op.text}`:'Unsupported phone step';
      return {id:p.id,title:op.type.replaceAll('_',' '),reviewScope:`${scope}\nAgent: ${this.session.origin}`,reviewIdentity:`Owner: ${this.session.ownerId}\nWorkflow: ${p.workflow!.workflowId}\nRun: ${p.workflow!.runId}\nVersion: ${p.workflow!.versionId}\nStep: ${p.workflow!.stepId}\nSpec: ${p.workflow!.specDigest}`,description:`Agent: ${this.session.origin}\nOwner: ${this.session.ownerId}\nWorkflow: ${p.workflow!.workflowId}\nRun: ${p.workflow!.runId}\nVersion: ${p.workflow!.versionId}\nStep: ${p.workflow!.stepId}\nSpec: ${p.workflow!.specDigest}\n${scope}`,expiresAt:p.expiresAt,contextRevision:context.revision};});
  }
  private async mutation(p: Proposal, suffix: string, body: Record<string, unknown>, signal: AbortSignal): Promise<Proposal> {
    if(isMapsOperation(p.operation)&&(suffix==='receipt'||suffix==='reconciliation')&&!validateMapsSelectedObject(p.operation.target))throw Error('Maps selection changed before upload');
    const response = object(await this.request(`/api/client-devices/proposals/${p.id}/${suffix}`, { digest: p.digest, ...body }, signal));
    const result = this.parse({ ...object(response.proposal), digest: response.digest });
    if (result.id !== p.id || result.digest !== p.digest) throw new Error('Device action changed during review');
    return result;
  }
  async approve(proposalId: string, context: ContextEnvelope, signal: AbortSignal): Promise<OperationReceipt> {
    if (this.busy) throw new Error('Another device action is being reviewed');
    const reviewed = this.proposals.get(proposalId);
    if (!reviewed || contextKey(reviewed.context) !== contextKey(context) || context.sensitive || reviewed.proposal.expiresAt <= Date.now()) throw new Error('Review this action again from the current screen');
    if(isClockOperation(reviewed.proposal.operation))assertClockTimeZone(reviewed.proposal.operation,context.timeZone);
    if(isNativeNotesQuery(reviewed.proposal.operation))assertNotesQueryContext(context);
    this.busy = true; this.proposals.delete(proposalId);
    const p = reviewed.proposal, operationId = isSmsSend(p.operation)?p.id:crypto.randomUUID();
    let execution:ReturnType<typeof createDeviceActionExecution>|undefined;
    try {
      execution=createDeviceActionExecution({scope:this.scope,proposalId,operationId},signal,()=>assertProposalContext(p.operation,context));
      if(p.workflow){if(!reviewed.workflowReview)throw new Error('Workflow step must be reviewed from its execution');assertWorkflowOperation(reviewed.workflowReview,p.workflow,{installationId:this.credential.installationId,enrollmentId:this.credential.enrollmentId!},p.operation);}
      execution.assertPrepared();
      const reserved = await this.journal.reserve({ scope: this.scope, proposalId, operationId, operationHash: await actionScope(JSON.stringify(p.operation)), record: { digest: p.digest, operation: p.operation, context, expiresAt: p.expiresAt, installationId: this.credential.installationId, enrollmentId: this.credential.enrollmentId, sessionId:this.session.sessionId,ownerId:this.session.ownerId,agentId:this.session.agentId,origin:this.session.origin,...(p.workflow?{workflow:p.workflow}:{}) } });
      if (!reserved.created) return { proposalId, status: 'unknown', summary: 'This action already has a device journal entry. Review action history; it was not repeated.' };
      execution.assertIdentity(reserved.entry);
      execution.assertPrepared();
      await this.mutation(p, 'decision', { decision: 'approve' }, signal);
      const claimed = await this.mutation(p, 'claim', {}, signal);
      if(isSmsSend(p.operation)&&claimed.providerIdempotencyKey!==operationId)throw Error('SMS execution claim identity changed');
      if (!claimed.attemptId || claimed.state !== 'executing') throw new Error('The server did not grant an execution claim');
      execution.assertPrepared();
      await this.journal.markApplying({ scope: this.scope, proposalId, attemptId: claimed.attemptId });
      let result: Awaited<ReturnType<DeviceExecutor>> & { foregroundResult?: ForegroundReviewResult };
      try { signal.throwIfAborted(); if (p.expiresAt <= Date.now()) throw new Error('Expired action'); const bindingHash=await actionScope(JSON.stringify([this.scope,this.session.ownerId,this.session.agentId,this.session.sessionId,this.session.origin,this.credential.installationId,this.credential.enrollmentId,p.id,p.digest,operationId]));
        execution.markDispatched(reserved.entry);
        if(isForegroundReview(p.operation)){if(!this.executeForeground)throw Error('Foreground review is unavailable');result=await this.executeForeground(p.operation,operationId,context,signal,bindingHash,{scope:this.scope,proposalId:p.id},this.credential.capabilities??[]);}
        else result = await this.execute(p.operation, operationId, context, signal, bindingHash,p.workflow?{scope:this.scope,origin:this.session.origin,ownerId:this.session.ownerId,agentId:this.session.agentId,workflowId:p.workflow.workflowId,runId:p.workflow.runId,versionId:p.workflow.versionId}:undefined,{scope:this.scope,proposalId:p.id},p.calendarAgendaSource); }
      catch { result = { status: 'unknown', summary: 'Action outcome needs review. It will not be repeated automatically.' }; }
      let smsResult:SmsSendResult|undefined;
      if(isSmsSend(p.operation)){if(result.smsResult!==undefined){smsResult=validateSmsResult(p.operation,result.smsResult,operationId,await smsAgentHash(p.operation));if(smsDeviceStatus(smsResult)!==result.status)throw Error('SMS outcome mismatch');}else if(result.status!=='unknown')throw Error('Missing SMS evidence');}else if(result.smsResult!==undefined)throw Error('Unexpected SMS result');
      let dialResult:PhoneDialResult|undefined;
      if(isPhoneDial(p.operation)){if(result.dialResult!==undefined){dialResult=validatePhoneDialResult(p.operation,result.dialResult);if(dialDeviceStatus(dialResult)!==result.status)throw Error('Dial outcome mismatch');}else if(result.status!=='unknown')throw Error('Missing dial result');}else if(result.dialResult!==undefined)throw Error('Unexpected dial result');
      let clockResult:ClockHandoffResult|undefined;
      if(isClockOperation(p.operation)){
        if(result.clockResult!==undefined){clockResult=validateClockResult(p.operation,result.clockResult);const expected=clockResult.status==='opened'?'succeeded':clockResult.status==='unknown'?'unknown':'failed';if(result.status!==expected)throw Error('Clock handoff outcome mismatch');}
        else if(result.status==='succeeded')throw Error('Missing Clock handoff result');
      }else if(result.clockResult!==undefined)throw Error('Unexpected Clock handoff result');
      let mapsResult:MapsResult|undefined;
      if(isMapsOperation(p.operation)){if(result.status==='succeeded')mapsResult=validateMapsResult(p.operation,result.mapsResult);else if(result.mapsResult!==undefined)throw Error('Failed Maps read cannot return content');}else if(result.mapsResult!==undefined)throw Error('Unexpected Maps result');
      let cameraResult:CameraCaptureResult|undefined;
      if(isCameraCapture(p.operation)){if(result.status==='succeeded')cameraResult=validateCameraCaptureResult(result.cameraResult,operationId);else if(result.cameraResult!==undefined)throw Error('Unconfirmed camera capture cannot return a saved photo');}else if(result.cameraResult!==undefined)throw Error('Unexpected camera result');
      let photoLibraryResult:LibraryAgentResult|undefined;
      if(isLibraryOperation(p.operation)){if(result.status==='succeeded')photoLibraryResult=validateLibraryResult(p.operation,result.photoLibraryResult);else if(result.photoLibraryResult!==undefined)throw Error('Failed library action cannot return content');}else if(result.photoLibraryResult!==undefined)throw Error('Unexpected library result');
      let reminderResult:ReminderResult|ReminderCreateResult|undefined;
      if(isReminderCreate(p.operation)){if(result.status==='succeeded')reminderResult=validateReminderCreateResult(p.operation,result.reminderResult,operationId);else if(result.reminderResult!==undefined)throw Error('Unconfirmed creation cannot return a result');}else if(isReminderOperation(p.operation)){if(result.status==='succeeded')reminderResult=validateReminderResult(p.operation,result.reminderResult);else if(result.reminderResult!==undefined)throw Error('Unconfirmed reminder cannot return a result');}else if(result.reminderResult!==undefined)throw Error('Unexpected reminder result');
      let notesResult:NotesResult|NotesQueryResult|undefined;
      if(isReminderOperation(p.operation))assertReminderContext(p.operation,context);
      if(isNativeNotesQuery(p.operation)){if(result.status==='succeeded')notesResult=validateNotesQueryResult(p.operation,result.notesResult);else if(result.notesResult!==undefined)throw Error('Unconfirmed Notes query cannot return content');}
      else if(isNotesOperation(p.operation)){if(result.status==='succeeded')notesResult=validateNotesResult(p.operation,result.notesResult);else if(result.notesResult!==undefined)throw Error('Failed Notes action cannot return content');}else if(result.notesResult!==undefined)throw Error('Unexpected Notes result');
      let calendarResult:CalendarResult|undefined;
      if(isCalendarOperation(p.operation)){if(result.status==='succeeded')calendarResult=validateCalendarResult(p.operation,result.calendarResult);else if(result.calendarResult!==undefined)throw Error('Failed Calendar action cannot return content');}else if(result.calendarResult!==undefined)throw Error('Unexpected Calendar result');
      let foregroundResult:ForegroundReviewResult|undefined;
      if(isForegroundReview(p.operation)){if(result.status==='succeeded')foregroundResult=validateForegroundReviewResult(p.operation,result.foregroundResult);else if(result.foregroundResult!==undefined)throw Error('An unconfirmed review cannot return a result');}else if(result.foregroundResult!==undefined)throw Error('Unexpected foreground review result');
      let readResult:WorkflowReadResult|undefined;
      if(p.operation.type==='read_selected_notes'||p.operation.type==='read_calendar_range'||p.operation.type==='read_selected_reminders'){
        if(result.status==='succeeded')readResult=await validateWorkflowResult(p.operation,result.readResult);
        else if(result.readResult!==undefined)throw new Error('Failed read cannot return content');
      }else if(result.readResult!==undefined)throw new Error('Unexpected read content');
      await this.journal.finish({ scope: this.scope, proposalId, status:result.status, summary:result.summary, result: { operationId,...(smsResult?{smsResult}:{}),...(dialResult?{dialResult}:{}),...(clockResult?{clockResult}:{}),...(mapsResult?{mapsResult}:{}),...(photoLibraryResult?{photoLibraryResult}:{}),...(cameraResult?{cameraResult}:{}),...(readResult?{readResult}:{}),...(calendarResult?{calendarResult}:{}),...(notesResult?{notesResult}:{}),...(reminderResult?{reminderResult}:{}),...(foregroundResult?{foregroundResult}:{}) } });
      if(execution.dispatched)execution.settle(reserved.entry);
      // A completed device effect is journaled even if the UI epoch was cancelled.
      // Receipt upload is retried only by the explicit history control.
      const committedChanges:Array<'calendar'|'notes'|'reminders'>=[];
      if(result.status==='succeeded'){
       if(isCalendarOperation(p.operation)&&p.operation.type!=='calendar_read_selected'&&p.operation.type!=='calendar_read_next')committedChanges.push('calendar');
       if(isNotesOperation(p.operation))committedChanges.push('notes');
       if(isReminderOperation(p.operation)||isReminderCreate(p.operation)||p.operation.type==='create_reminder')committedChanges.push('reminders');
       if(foregroundResult&&'operation'in foregroundResult&&!(foregroundResult.kind==='calendar_named'&&foregroundResult.action==='read'))committedChanges.push(foregroundResult.kind==='notes_named'?'notes':foregroundResult.kind==='calendar_named'?'calendar':'reminders');
      }
      // Presentation changes the foreground context and cancels its approval.
      // Run it only after this exact action's receipt attempt, never as a retry.
      const presentBrowser=()=>{
        if(p.operation.type==='browser_navigate'&&result.status==='succeeded'){
          try{result.presentBrowser?.();}catch{/* A retired foreground must not replace a journaled outcome. */}
        }
      };
      let confirmed:Proposal;
      try { if(isMapsOperation(p.operation))assertMapsContext(p.operation,context); confirmed=await this.mutation(p, 'receipt', { attemptId: claimed.attemptId, receipt: { outcome: result.status === 'succeeded' ? 'applied' : result.status === 'failed' ? 'failed' : 'unknown', operationId,...(smsResult?{result:smsResult}:dialResult?{result:dialResult}:foregroundResult?{result:foregroundResult}:clockResult?{result:clockResult}:mapsResult?{result:mapsResult}:cameraResult?{result:cameraResult}:photoLibraryResult?{result:photoLibraryResult}:readResult?{result:readResult}:calendarResult?{result:calendarResult}:notesResult?{result:notesResult}:reminderResult?{result:reminderResult}:{}) } }, signal); }
      catch { presentBrowser();return { proposalId, status: result.status, summary: `${result.summary} Server receipt is pending; check action history.`,committedChanges }; }
      presentBrowser();
      const retained=this.readReplies.get(proposalId);
      const readReply=result.status==='succeeded'&&isOriginalDeviceReadOperationType(p.operation.type)&&(notesResult||calendarResult||reminderResult||mapsResult||readResult||foregroundResult?.kind==='calendar_availability'||foregroundResult?.kind==='calendar_named'&&foregroundResult.action==='read')&&p.readReplyOrigin&&confirmed.state==='done'&&confirmed.attemptId===claimed.attemptId&&retained&&!retained.consumed&&retained.digest===p.digest&&JSON.stringify(retained.origin)===JSON.stringify(p.readReplyOrigin)?validateNativeNotesReadReplyHint({...p.readReplyOrigin,proposalId,digest:p.digest,attemptId:claimed.attemptId}):undefined;
      if(readReply)retained!.hint=readReply;
      return { proposalId, status:result.status, summary:result.summary,committedChanges,...(readReply?{readReply}:{}) };
    } catch {
      return { proposalId, status: 'unknown', summary: 'Action did not reach a confirmed result. Check action history before requesting it again.' };
    } finally { execution?.retire(); this.busy = false; }
  }
  async completeReadReply(hint:NativeNotesReadReplyHint,signal:AbortSignal):Promise<NativeNotesReadReply>{
    const valid=validateNativeNotesReadReplyHint(hint),retained=this.readReplies.get(valid.proposalId);
    if(!retained||retained.consumed||JSON.stringify(retained.hint)!==JSON.stringify(valid))throw Error('This original Notes answer is unavailable. Check conversation history.');
    signal.throwIfAborted();retained.consumed=true;
    const response=object(await this.request(`/api/client-devices/proposals/${valid.proposalId}/read-completion`,valid,signal));signal.throwIfAborted();
    const reply=validateNativeNotesReadReply(response.reply);
    if(reply.requestId!==valid.requestId||reply.conversationId!==valid.conversationId||reply.inReplyTo!==valid.inReplyTo||reply.messageId===valid.inReplyTo)throw Error('The original Notes answer changed. Check conversation history.');
    return reply;
  }
  async cancelReadReply(proposalId:string,digest:string,signal:AbortSignal):Promise<void>{
    const retained=this.readReplies.get(proposalId);if(!retained||retained.digest!==digest)return;
    retained.consumed=true;
    signal.throwIfAborted();await this.request(`/api/client-devices/proposals/${proposalId}/cancel-read-completion`,{digest},signal);
  }
  async reject(proposalId: string, signal: AbortSignal): Promise<void> {
    const p = (await this.list(signal)).find(item => item.id === proposalId);
    if (!p || p.state !== 'pending') throw new Error('This proposal can no longer be rejected');
    await this.mutation(p, 'decision', { decision: 'reject' }, signal);
    this.proposals.delete(proposalId);
  }
  /** Reconstruct only committed Notes-create, calendar-write and browser-open acknowledgments for fetched user messages.
   * Both the authenticated server receipt and this device's exact journal must agree. */
  async conversationReceipts(requestMessageIds:ReadonlySet<string>,signal:AbortSignal):Promise<Array<{id:string;requestMessageId:string;summary:string;browserDestination?:string}>>{
    if(!requestMessageIds.size)return [];
    const proposals=await this.list(signal);
    signal.throwIfAborted();
    const results:Array<{id:string;requestMessageId:string;summary:string;browserDestination?:string}>=[];
    for(const p of proposals){
      if(p.workflow||p.state!=='done'||!p.requestMessageId||!requestMessageIds.has(p.requestMessageId)||!(p.operation.type==='create_note'||p.operation.type==='browser_navigate'||['calendar_create','calendar_create_local','calendar_update','calendar_delete'].includes(p.operation.type)&&isCalendarOperation(p.operation)))continue;
      try{
        const receipt=object(p.providerReceipt),{entry}=await this.journal.get({scope:this.scope,proposalId:p.id});
        signal.throwIfAborted();
        if(receipt.outcome!=='applied'||!entry||entry.scope!==this.scope||entry.phase!=='terminal'||entry.status!=='succeeded'||!p.attemptId||entry.attemptId!==p.attemptId||entry.record.digest!==p.digest||entry.record.ownerId!==this.session.ownerId||entry.record.agentId!==this.session.agentId||typeof entry.record.sessionId!=='string'||entry.record.origin!==this.session.origin||entry.record.installationId!==this.credential.installationId||entry.record.enrollmentId!==this.credential.enrollmentId||receipt.operationId!==entry.operationId||entry.result?.operationId!==entry.operationId||entry.operationHash!==await actionScope(JSON.stringify(p.operation)))continue;
        if(isCalendarOperation(p.operation)){
          const server=validateCalendarResult(p.operation,receipt.result),saved=validateCalendarResult(p.operation,entry.result?.calendarResult);
          if(JSON.stringify(server)!==JSON.stringify(saved))continue;
        }else if(p.operation.type==='create_note'||p.operation.type==='browser_navigate'){
          // These operations return no typed record result. Restore only
          // this exact terminal journal's acknowledgment, never infer a new effect.
          if(JSON.stringify(entry.record.operation)!==JSON.stringify(p.operation)||receipt.result!==undefined||entry.result?.notesResult!==undefined)continue;
        }else continue;
        results.push({id:`device-receipt:${p.id}`,requestMessageId:p.requestMessageId,summary:p.operation.type==='browser_navigate'?browserNavigationSummary(p.operation.url):text(entry.summary,2000),...(p.operation.type==='browser_navigate'?{browserDestination:p.operation.url}:{})});
      }catch{/* An incomplete, foreign or contradictory receipt is not a success. */}
    }
    signal.throwIfAborted();return results;
  }
  async history(signal: AbortSignal) {
    const proposals = await this.list(signal), local = await this.journal.list({ scope: this.scope });
    return proposals.map(p => ({ id: p.id, state: p.state, operation: p.operation, local: local.entries.find(entry => entry.proposalId === p.id) }));
  }
  private async recoverNotification(p:Proposal,entry:JournalEntry,signal:AbortSignal):Promise<JournalEntry>{
    if(p.operation.type!=='post_notification')return entry;
    if(!p.workflow)throw Error('Notification workflow binding is missing');
    if(entry.scope!==this.scope||entry.proposalId!==p.id||entry.attemptId!==p.attemptId||entry.record.digest!==p.digest||entry.record.ownerId!==this.session.ownerId||entry.record.agentId!==this.session.agentId||entry.record.origin!==this.session.origin||entry.record.installationId!==this.credential.installationId||entry.record.enrollmentId!==this.credential.enrollmentId||typeof entry.record.sessionId!=='string'||JSON.stringify(entry.record.workflow)!==JSON.stringify(p.workflow)||await actionScope(JSON.stringify(p.operation))!==entry.operationHash)throw Error('Notification recovery identity changed');
    const bindingHash=await actionScope(JSON.stringify([this.scope,this.session.ownerId,this.session.agentId,entry.record.sessionId,this.session.origin,this.credential.installationId,this.credential.enrollmentId,p.id,p.digest,entry.operationId]));
    if(!this.journal.recoverNotification||entry.status==='succeeded'||!entry.attemptId||entry.phase!=='applying'&&!(entry.phase==='terminal'&&entry.status==='unknown'))return entry;
    signal.throwIfAborted();const recovered=await this.journal.recoverNotification({scope:this.scope,proposalId:p.id,bindingHash});signal.throwIfAborted();
    const next=recovered.entry;if(!next)return entry;
    if(next.operationId!==entry.operationId||next.operationHash!==entry.operationHash||next.attemptId!==entry.attemptId||JSON.stringify(next.record)!==JSON.stringify(entry.record))throw Error('Recovered notification identity changed');
    if(next.status==='succeeded'&&(next.phase!=='terminal'||next.result?.operationId!==entry.operationId))throw Error('Recovered notification result changed');
    return next;
  }
  private async recoverDeletion(p:Proposal,entry:JournalEntry,signal:AbortSignal):Promise<JournalEntry>{
    if(!this.journal.recoverDeletion||!['calendar_delete','reminder_cancel'].includes(p.operation.type)||entry.status==='succeeded'||entry.status==='failed'||!entry.attemptId||entry.record.digest!==p.digest||entry.record.ownerId!==this.session.ownerId||entry.record.agentId!==this.session.agentId||entry.record.origin!==this.session.origin||entry.record.installationId!==this.credential.installationId||entry.record.enrollmentId!==this.credential.enrollmentId)return entry;
    signal.throwIfAborted();const {entry:next}=await this.journal.recoverDeletion({scope:this.scope,proposalId:p.id});signal.throwIfAborted();if(!next)return entry;
    if(next.operationId!==entry.operationId||next.operationHash!==entry.operationHash||next.attemptId!==entry.attemptId||JSON.stringify(next.record)!==JSON.stringify(entry.record))throw Error('Recovered deletion identity changed');
    if(next.status==='succeeded'){
      if(next.phase!=='terminal'||next.result?.operationId!==entry.operationId)throw Error('Recovered deletion result changed');
      if(isReminderOperation(p.operation))validateReminderResult(p.operation,next.result?.reminderResult);
      else if(isCalendarOperation(p.operation))validateCalendarResult(p.operation,next.result?.calendarResult);
    }
    return next;
  }
  private async recoverReminder(p:Proposal,entry:JournalEntry,signal:AbortSignal):Promise<JournalEntry>{
    if(!this.recover||!(isReminderOperation(p.operation)||isReminderCreate(p.operation))||entry.status==='succeeded'||!entry.attemptId||entry.record.digest!==p.digest||entry.record.ownerId!==this.session.ownerId||entry.record.agentId!==this.session.agentId||entry.record.origin!==this.session.origin||entry.record.installationId!==this.credential.installationId||entry.record.enrollmentId!==this.credential.enrollmentId||typeof entry.record.sessionId!=='string')return entry;
    const bindingHash=await actionScope(JSON.stringify([this.scope,this.session.ownerId,this.session.agentId,entry.record.sessionId,this.session.origin,this.credential.installationId,this.credential.enrollmentId,p.id,p.digest,entry.operationId]));
    signal.throwIfAborted();const result=await this.recover(p.operation,entry.operationId,bindingHash,signal);signal.throwIfAborted();
    if(result.status!=='succeeded')return entry;
    isReminderCreate(p.operation)?validateReminderCreateResult(p.operation,result.reminderResult,entry.operationId):validateReminderResult(p.operation,result.reminderResult);
    if(!this.journal.recoverReminder)return entry;
    const recovered=await this.journal.recoverReminder({scope:this.scope,proposalId:p.id,bindingHash});
    if(recovered.entry?.status==='succeeded'){if(isReminderCreate(p.operation))validateReminderCreateResult(p.operation,recovered.entry.result?.reminderResult,entry.operationId);else validateReminderResult(p.operation,recovered.entry.result?.reminderResult);}
    return recovered.entry ?? entry;
  }
  async syncReceipts(signal: AbortSignal, workflow?:{runId:string;versionId:string;specDigest:string}): Promise<void> {
    const proposals = await this.list(signal), local = await this.journal.list({ scope: this.scope });
    for (let entry of local.entries) {
      signal.throwIfAborted();
      const p = proposals.find(item => item.id === entry.proposalId);
      if(p){if(p.workflow&&(!workflow||p.workflow.runId!==workflow.runId||p.workflow.versionId!==workflow.versionId||p.workflow.specDigest!==workflow.specDigest))continue;entry=await this.recoverDeletion(p,entry,signal);entry=await this.recoverNotification(p,entry,signal);entry=await this.recoverReminder(p,entry,signal);}
      if(p&&isSmsSend(p.operation)&&entry.status==='unknown'&&['done','retryable'].includes(p.state))continue;
      if (!p || entry.phase !== 'terminal' || !entry.attemptId || entry.record.digest !== p.digest || !entry.status) continue;
      if(p.workflow&&(!workflow||p.workflow.runId!==workflow.runId||p.workflow.versionId!==workflow.versionId||p.workflow.specDigest!==workflow.specDigest))continue;
      const smsResult=await this.savedSmsResult(p,entry);
      const clockResult=await this.savedClockResult(p,entry);
      const dialResult=await this.savedDialResult(p,entry);
      const mapsResult=await this.savedMapsResult(p,entry);
      const cameraResult=await this.savedCameraResult(p,entry);
      const photoLibraryResult=await this.savedLibraryResult(p,entry);
      const readResult=await this.savedReadResult(p,entry);
      const calendarResult=await this.savedCalendarResult(p,entry);
      const notesResult=await this.savedNotesResult(p,entry);
      const reminderResult=await this.savedReminderResult(p,entry);
      const foregroundResult=await this.savedForegroundResult(p,entry);
      if(p.state==='reconciliation_required'&&entry.status==='succeeded'&&((isReminderOperation(p.operation)||isReminderCreate(p.operation))&&reminderResult||p.operation.type==='post_notification')){
        await this.mutation(p,'reconciliation',{attemptId:entry.attemptId,resolution:{confirmed:true,outcome:'applied',operationId:entry.operationId,...(reminderResult?{result:reminderResult}:{})}},signal);
      }else await this.mutation(p, 'receipt', { attemptId: entry.attemptId, receipt: { outcome: entry.status === 'succeeded' ? 'applied' : entry.status === 'failed' ? 'failed' : 'unknown', operationId: entry.operationId,...(smsResult?{result:smsResult}:dialResult?{result:dialResult}:foregroundResult?{result:foregroundResult}:clockResult?{result:clockResult}:mapsResult?{result:mapsResult}:cameraResult?{result:cameraResult}:photoLibraryResult?{result:photoLibraryResult}:readResult?{result:readResult}:calendarResult?{result:calendarResult}:notesResult?{result:notesResult}:reminderResult?{result:reminderResult}:{}) } }, signal);
    }
  }
  private async savedSmsResult(p:Proposal,summary:JournalEntry):Promise<SmsSendResult|undefined>{
    if(!isSmsSend(p.operation))return undefined;
    const {entry}=await this.journal.get({scope:this.scope,proposalId:p.id});
    if(!entry||entry.phase!=='terminal'||entry.operationId!==p.id||entry.operationId!==summary.operationId||p.providerIdempotencyKey!==entry.operationId||entry.record.digest!==p.digest||entry.record.ownerId!==this.session.ownerId||entry.record.agentId!==this.session.agentId||entry.record.origin!==this.session.origin||entry.record.installationId!==this.credential.installationId||entry.record.enrollmentId!==this.credential.enrollmentId)throw Error('No exact saved SMS receipt; the message will not be repeated');
    if(entry.result?.smsResult===undefined){if(entry.status!=='unknown')throw Error('Missing saved SMS evidence');return undefined;}
    const result=validateSmsResult(p.operation,entry.result.smsResult,entry.operationId,await smsAgentHash(p.operation));if(entry.status!==smsDeviceStatus(result))throw Error('Saved SMS outcome mismatch');return result;
  }
  /** Explicit owner reconciliation may read newer durable native evidence, never dispatch again. */
  private async smsReconciliationResult(p:Proposal,entry:JournalEntry,signal:AbortSignal):Promise<SmsSendResult|undefined>{
    if(!isSmsSend(p.operation))return undefined;
    if(entry.operationId!==p.id||p.providerIdempotencyKey!==p.id||entry.attemptId!==p.attemptId||entry.record.digest!==p.digest||entry.record.ownerId!==this.session.ownerId||entry.record.agentId!==this.session.agentId||entry.record.origin!==this.session.origin||entry.record.installationId!==this.credential.installationId||entry.record.enrollmentId!==this.credential.enrollmentId||entry.operationHash!==await actionScope(JSON.stringify(p.operation)))throw Error('SMS reconciliation identity changed');
    const historical=entry.phase==='terminal'?await this.savedSmsResult(p,entry):undefined;
    if(historical&&smsDeviceStatus(historical)!=='unknown')return historical;
    if(!this.recover)return historical;
    signal.throwIfAborted();const read=await this.recover(p.operation,entry.operationId,await smsAgentHash(p.operation),signal);signal.throwIfAborted();
    if(read.smsResult===undefined)return historical;
    const result=validateSmsResult(p.operation,read.smsResult,entry.operationId,await smsAgentHash(p.operation));if(read.status!==smsDeviceStatus(result))throw Error('Reconciled SMS outcome mismatch');return result;
  }
  /** The journaled dial handoff for exactly this proposal and session; a handoff is resent, never redialed. */
  private async savedDialResult(p:Proposal,summary:JournalEntry):Promise<PhoneDialResult|undefined>{
    if(!isPhoneDial(p.operation))return undefined;
    const {entry}=await this.journal.get({scope:this.scope,proposalId:p.id});
    if(!entry||entry.phase!=='terminal'||entry.operationId!==summary.operationId||entry.record.digest!==p.digest||entry.record.ownerId!==this.session.ownerId||entry.record.agentId!==this.session.agentId||entry.record.origin!==this.session.origin||entry.record.installationId!==this.credential.installationId||entry.record.enrollmentId!==this.credential.enrollmentId)throw Error('No exact saved dial receipt');
    if(entry.result?.dialResult===undefined){if(entry.status==='succeeded')throw Error('Missing dial receipt');return undefined;}
    const result=validatePhoneDialResult(p.operation,entry.result.dialResult);if(entry.status!==dialDeviceStatus(result))throw Error('Saved dial outcome mismatch');return result;
  }
  private async savedClockResult(p:Proposal,summary:JournalEntry):Promise<ClockHandoffResult|undefined>{
    if(!isClockOperation(p.operation))return undefined;
    const {entry}=await this.journal.get({scope:this.scope,proposalId:p.id});
    if(!entry||entry.phase!=='terminal'||entry.operationId!==summary.operationId||entry.record.digest!==p.digest||entry.record.ownerId!==this.session.ownerId||entry.record.agentId!==this.session.agentId||entry.record.origin!==this.session.origin||entry.record.installationId!==this.credential.installationId||entry.record.enrollmentId!==this.credential.enrollmentId)throw Error('No exact saved Clock receipt; handoff will not be repeated');
    if(entry.result?.clockResult===undefined){if(entry.status==='succeeded')throw Error('Missing Clock receipt');return undefined;}
    const result=validateClockResult(p.operation,entry.result.clockResult);const status=result.status==='opened'?'succeeded':result.status==='unknown'?'unknown':'failed';if(entry.status!==status)throw Error('Saved Clock outcome mismatch');return result;
  }
  private async savedCameraResult(p:Proposal,summary:JournalEntry):Promise<CameraCaptureResult|undefined>{
    if(!isCameraCapture(p.operation)||summary.status!=='succeeded')return undefined;
    const {entry}=await this.journal.get({scope:this.scope,proposalId:p.id});
    if(!entry||entry.phase!=='terminal'||entry.status!=='succeeded'||entry.operationId!==summary.operationId||entry.record.digest!==p.digest||entry.record.ownerId!==this.session.ownerId||entry.record.agentId!==this.session.agentId||entry.record.origin!==this.session.origin||entry.record.installationId!==this.credential.installationId||entry.record.enrollmentId!==this.credential.enrollmentId)throw Error('No exact saved photo receipt; capture will not be repeated');
    return validateCameraCaptureResult(entry.result?.cameraResult,entry.operationId);
  }
  private async savedMapsResult(p:Proposal,summary:JournalEntry):Promise<MapsResult|undefined>{
    if(!isMapsOperation(p.operation)||summary.status!=='succeeded')return undefined;
    const {entry}=await this.journal.get({scope:this.scope,proposalId:p.id});
    if(!entry||entry.phase!=='terminal'||entry.status!=='succeeded'||entry.operationId!==summary.operationId||entry.record.digest!==p.digest||entry.record.ownerId!==this.session.ownerId||entry.record.agentId!==this.session.agentId||entry.record.origin!==this.session.origin||entry.record.installationId!==this.credential.installationId||entry.record.enrollmentId!==this.credential.enrollmentId||entry.record.sessionId!==this.session.sessionId)throw Error('No exact saved Maps receipt; the selection will not be read again');
    // Replay only the already approved snapshot while its current capability is
    // still valid. Reload/leave does not authorize a fresh read or late upload.
    assertMapsContext(p.operation,entry.record.context as ContextEnvelope);
    return validateMapsResult(p.operation,entry.result?.mapsResult);
  }
  private async savedLibraryResult(p:Proposal,summary:JournalEntry):Promise<LibraryAgentResult|undefined>{
    if(!isLibraryOperation(p.operation)||summary.status!=='succeeded')return undefined;
    const {entry}=await this.journal.get({scope:this.scope,proposalId:p.id});
    if(!entry||entry.phase!=='terminal'||entry.status!=='succeeded'||entry.operationId!==summary.operationId||entry.record.digest!==p.digest||entry.record.ownerId!==this.session.ownerId||entry.record.agentId!==this.session.agentId||entry.record.origin!==this.session.origin)throw Error('No exact saved library receipt; the library will not be read again');
    return validateLibraryResult(p.operation,entry.result?.photoLibraryResult);
  }
  private async savedCalendarResult(p:Proposal,summary:JournalEntry):Promise<CalendarResult|undefined>{
    if(!isCalendarOperation(p.operation)||summary.status!=='succeeded')return undefined;
    const {entry}=await this.journal.get({scope:this.scope,proposalId:p.id});
    if(!entry||entry.phase!=='terminal'||entry.status!=='succeeded'||entry.operationId!==summary.operationId||entry.record.digest!==p.digest||entry.record.ownerId!==this.session.ownerId||entry.record.agentId!==this.session.agentId||entry.record.origin!==this.session.origin)throw Error('No exact saved Calendar receipt; operation will not be repeated');
    return validateCalendarResult(p.operation,entry.result?.calendarResult);
  }
  private async savedReminderResult(p:Proposal,summary:JournalEntry):Promise<ReminderResult|ReminderCreateResult|undefined>{
    if(!(isReminderOperation(p.operation)||isReminderCreate(p.operation))||summary.status!=='succeeded')return undefined;
    const {entry}=await this.journal.get({scope:this.scope,proposalId:p.id});
    if(!entry||entry.phase!=='terminal'||entry.status!=='succeeded'||entry.operationId!==summary.operationId||entry.record.digest!==p.digest||entry.record.ownerId!==this.session.ownerId||entry.record.agentId!==this.session.agentId||entry.record.origin!==this.session.origin)throw Error('No exact saved Reminder receipt; operation will not be repeated');
    return isReminderCreate(p.operation)?validateReminderCreateResult(p.operation,entry.result?.reminderResult,entry.operationId):validateReminderResult(p.operation,entry.result?.reminderResult);
  }
  private async savedNotesResult(p:Proposal,summary:JournalEntry):Promise<NotesResult|NotesQueryResult|undefined>{
    if((!isNotesOperation(p.operation)&&!isNativeNotesQuery(p.operation))||summary.status!=='succeeded')return undefined;
    const {entry}=await this.journal.get({scope:this.scope,proposalId:p.id});
    if(!entry||entry.phase!=='terminal'||entry.status!=='succeeded'||entry.operationId!==summary.operationId||entry.record.digest!==p.digest||entry.record.ownerId!==this.session.ownerId||entry.record.agentId!==this.session.agentId||entry.record.origin!==this.session.origin)throw Error('No exact saved Notes receipt; operation will not be repeated');
    return isNativeNotesQuery(p.operation)?validateNotesQueryResult(p.operation,entry.result?.notesResult):validateNotesResult(p.operation,entry.result?.notesResult);
  }
  private async savedForegroundResult(p:Proposal,summary:JournalEntry):Promise<ForegroundReviewResult|undefined>{
    if(!isForegroundReview(p.operation)||summary.status!=='succeeded')return undefined;
    const {entry}=await this.journal.get({scope:this.scope,proposalId:p.id});
    if(!entry||entry.phase!=='terminal'||entry.status!=='succeeded'||entry.operationId!==summary.operationId||entry.record.digest!==p.digest||entry.record.ownerId!==this.session.ownerId||entry.record.agentId!==this.session.agentId||entry.record.origin!==this.session.origin)throw Error('No exact saved review receipt; the phone will not read or change anything again');
    return validateForegroundReviewResult(p.operation,entry.result?.foregroundResult);
  }
  private async savedReadResult(p:Proposal,summary:JournalEntry):Promise<WorkflowReadResult|undefined>{
    if(p.operation.type!=='read_selected_notes'&&p.operation.type!=='read_calendar_range'&&p.operation.type!=='read_selected_reminders')return undefined;
    if(summary.status!=='succeeded')return undefined;
    const {entry}=await this.journal.get({scope:this.scope,proposalId:p.id});
    if(!entry||entry.phase!=='terminal'||entry.status!=='succeeded'||entry.operationId!==summary.operationId||entry.record.digest!==p.digest||JSON.stringify(entry.record.workflow)!==JSON.stringify(p.workflow)||entry.record.ownerId!==this.session.ownerId||entry.record.agentId!==this.session.agentId||entry.record.origin!==this.session.origin)throw new Error('No exact saved read receipt is available; the source will not be read again');
    return validateWorkflowResult(p.operation,entry.result?.readResult);
  }
  async reconcile(proposalId: string, outcome: 'applied' | 'not_applied', signal: AbortSignal): Promise<void> {
    const p = (await this.list(signal)).find(item => item.id === proposalId);
    if (!p?.attemptId) throw new Error('No dispatched action to reconcile');
    let { entry } = await this.journal.get({ scope: this.scope, proposalId });
    if(entry&&outcome==='applied'){entry=await this.recoverDeletion(p,entry,signal);entry=await this.recoverNotification(p,entry,signal);entry=await this.recoverReminder(p,entry,signal);}
    if(outcome==='applied'&&p.operation.type==='post_notification'&&(!entry||entry.phase!=='terminal'||entry.status!=='succeeded'))throw Error('Applied notification reconciliation requires its exact saved delivery receipt');
    const smsResult=entry?await this.smsReconciliationResult(p,entry,signal):undefined;
    if(isSmsSend(p.operation)&&(!smsResult||smsDeviceStatus(smsResult)==='unknown'||(outcome==='applied')!==(smsDeviceStatus(smsResult)==='succeeded')))throw Error('SMS reconciliation requires exact saved evidence; unknown or partial sends cannot be called not sent');
    const clockResult=entry?await this.savedClockResult(p,entry):undefined;
    if(isClockOperation(p.operation)&&(!clockResult||clockResult.status==='unknown'||(outcome==='applied')!==(clockResult.status==='opened')))throw Error('Clock reconciliation requires the exact saved handoff result; alarm state cannot be inferred');
    const mapsResult=outcome==='applied'&&entry?await this.savedMapsResult(p,entry):undefined;
    if(outcome==='applied'&&isMapsOperation(p.operation)&&!mapsResult)throw Error('Applied Maps read requires exact saved receipt');
    const cameraResult=outcome==='applied'&&entry?await this.savedCameraResult(p,entry):undefined;
    if(outcome==='applied'&&isCameraCapture(p.operation)&&!cameraResult)throw Error('Applied camera capture requires its exact saved photo receipt');
    const photoLibraryResult=outcome==='applied'&&entry?await this.savedLibraryResult(p,entry):undefined;
    if(outcome==='applied'&&isLibraryOperation(p.operation)&&!photoLibraryResult)throw Error('Applied library action requires its exact saved receipt');
    const readResult=outcome==='applied'&&entry?await this.savedReadResult(p,entry):undefined;
    const calendarResult=outcome==='applied'&&entry?await this.savedCalendarResult(p,entry):undefined;
    const notesResult=outcome==='applied'&&entry?await this.savedNotesResult(p,entry):undefined;
    const reminderResult=outcome==='applied'&&entry?await this.savedReminderResult(p,entry):undefined;
    const foregroundResult=outcome==='applied'&&entry?await this.savedForegroundResult(p,entry):undefined;
    if(outcome==='applied'&&isForegroundReview(p.operation)&&!foregroundResult)throw Error('Applied review reconciliation requires its exact saved receipt');
    if(outcome==='applied'&&(isReminderOperation(p.operation)||isReminderCreate(p.operation))&&!reminderResult)throw Error('Applied reminder reconciliation requires exact saved receipt');
    if(outcome==='applied'&&(isNotesOperation(p.operation)||isNativeNotesQuery(p.operation))&&!notesResult)throw Error('Applied Notes reconciliation requires its exact saved receipt');
    if(outcome==='applied'&&isCalendarOperation(p.operation)&&!calendarResult)throw Error('Applied Calendar reconciliation requires exact saved provider receipt');
    if(outcome==='applied'&&(p.operation.type==='read_selected_notes'||p.operation.type==='read_calendar_range'||p.operation.type==='read_selected_reminders')&&!readResult)throw new Error('Applied read requires its exact saved result');
    await this.mutation(p, 'reconciliation', { attemptId: p.attemptId, resolution: { confirmed: true, outcome, ...((outcome === 'applied'||isClockOperation(p.operation)||isSmsSend(p.operation)) && entry ? { operationId: entry.operationId } : {}),...(smsResult?{result:smsResult}:foregroundResult?{result:foregroundResult}:clockResult?{result:clockResult}:mapsResult?{result:mapsResult}:cameraResult?{result:cameraResult}:photoLibraryResult?{result:photoLibraryResult}:readResult?{result:readResult}:calendarResult?{result:calendarResult}:notesResult?{result:notesResult}:reminderResult?{result:reminderResult}:{}) } }, signal);
  }
}
