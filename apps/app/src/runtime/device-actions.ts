import {isNativeNotesQuery,validateNativeNotesQuery,NOTES_QUERY_CAPABILITY,validateNativeNotesReadReplyOrigin,validateNativeNotesReadReplyHint,validateNativeNotesReadReply,type NativeNotesReadReplyOrigin,type NativeNotesReadReplyHint,type NativeNotesReadReply,type NativeNotesQueryOperation} from '../../../../.eliza/client-features/packages/contracts/src/native-notes-query.ts';
import {validateNotesQueryResult,type NotesQueryResult} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/notes-query-result.ts';
import {presentDeviceRecordOperation} from './device-record-presentation';
import {formatDeviceRecordDateTime} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/device-record-presentation.ts';
import {isReminderCreate,validateReminderCreate,validateReminderCreateResult,type ReminderCreateOperation,type ReminderCreateResult} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-create-contract.ts';
import {isClockOperation,validateClockOperation,validateClockResult,assertClockTimeZone,describeClockHandoff,type ClockOperation,type ClockHandoffResult} from './clock-contract.ts';
import { isMapsOperation, validateMapsOperation, validateMapsResult, type MapsOperation, type MapsResult } from './maps-contract';
import { validateMapsSelectedObject } from '../maps/agent-context';
import { isLibraryOperation, validateLibraryOperation, validateLibraryResult, describeLibraryOperation, PHOTO_LIBRARY_CAPABILITY, type LibraryAgentOperation, type LibraryAgentResult } from './photo-library';
import {type ReminderOperation,type ReminderResult,isReminderOperation,reminderFields,validateReminderOperation,validateReminderResult} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-contract.ts';
import {type NotesOperation,type NotesResult,type NotesTarget,isNotesOperation,notesFields,validateNotesOperation,validateNotesResult} from './notes-contract';
import {type CalendarOperation,type CalendarResult,type CalendarRecordResult,calendarCapabilityAvailable,calendarFields,isCalendarOperation,validateCalendarOperation,validateCalendarResult} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/calendar-contract.ts';
import {type DeviceReviewOperation,type CalendarAvailabilityResult,type NotesSearchResult,type NamedTargetResult,type NamedTargetValidators,deviceReviewCapabilityAvailable,isCalendarAvailabilityOperation,isNotesSearchOperation,validateCalendarAvailabilityOperation,validateCalendarAvailabilityResult,validateNotesSearchOperation,validateNotesSearchResult,validateNamedTargetOperation,validateNamedTargetResult} from '../../../../.eliza/client-features/packages/contracts/src/device-reviews.ts';
import { isMvpView } from "../prototype/mvp-features";
import { parseWorkflowBinding, parseWorkflowRead, validateWorkflowResult, assertWorkflowOperation, type WorkflowReadOperation, type WorkflowReadResult, type WorkflowDeviceBinding, type WorkflowPhoneReview } from './workflow-device-contract';
import type { ActionProposal, ContextEnvelope, OperationReceipt, VerifiedSession } from './alpha-client';

export type WorkflowPresentationOperation = {type:'post_notification';title:string;body:string}|{type:'speak_text';text:string};
export type DeviceOperation = ReminderCreateOperation | WorkflowPresentationOperation | ClockOperation | MapsOperation | LibraryAgentOperation | ReminderOperation | NotesOperation | NativeNotesQueryOperation | CalendarOperation | WorkflowReadOperation | { type: 'create_note'; title: string; body: string }
  | { type: 'create_reminder'; title: string; dueAt: string }
  | { type: 'open_view'; view: string } | { type: 'browser_navigate'; url: string };
/** Kept in step with the patched contract's FOREGROUND_REVIEW_TYPES (asserted by test-device-actions). */
export const FOREGROUND_OPERATION_TYPES: readonly string[] = ['calendar_availability','notes_search','notes_named','calendar_named','reminder_named'];
function isForegroundReview(value: unknown): value is ForegroundReviewOperation { return !!value && typeof value === 'object' && FOREGROUND_OPERATION_TYPES.includes(String((value as {type?:unknown}).type)); }
export type ForegroundReviewOperation = DeviceReviewOperation;
/** Exact selected-record operation a named proposal resolves to after the owner's choice. */
export type NamedTargetExactOperation = Extract<NotesOperation|CalendarOperation|ReminderOperation,{target:unknown}>;
export type ForegroundReviewResult = CalendarAvailabilityResult|NotesSearchResult<NotesTarget,NotesResult>|NamedTargetResult<NamedTargetExactOperation,NotesResult|CalendarRecordResult|ReminderResult>;
/** Shared device-review contracts bound to this renderer's Notes, Calendar and reminder contracts.
 * Methods resolve their validators on call, so loading this module touches no domain contract. */
export const namedTargetValidators:NamedTargetValidators<NamedTargetExactOperation,NotesResult|CalendarRecordResult|ReminderResult>={
 notesFields:value=>notesFields(value),calendarFields:value=>calendarFields(value),reminderFields:value=>reminderFields(value),
 exact(value){const exact=isNotesOperation(value)?validateNotesOperation(value):isCalendarOperation(value)?validateCalendarOperation(value):isReminderOperation(value)?validateReminderOperation(value):undefined;if(!exact||!('target' in exact))throw Error('Unsupported named target operation');return exact;},
 record(operation,value){if(isNotesOperation(operation))return validateNotesResult(operation,value);if(isCalendarOperation(operation)){const result=validateCalendarResult(operation,value);if(result.kind==='calendar_read_next')throw Error('Unexpected Calendar discovery result');return result;}return validateReminderResult(operation,value);},
};
export function selectedNotesRead(target:unknown,record:unknown):{target:NotesTarget;record:NotesResult}{const selected=validateNotesOperation({type:'notes_read_selected',target});if(selected.type!=='notes_read_selected')throw Error('Invalid selected Notes read');return {target:selected.target,record:validateNotesResult(selected,record)};}
export function validateForegroundReviewOperation(value:unknown):ForegroundReviewOperation{
 if(isCalendarAvailabilityOperation(value))return validateCalendarAvailabilityOperation(value);
 if(isNotesSearchOperation(value))return validateNotesSearchOperation(value);
 return validateNamedTargetOperation(value,namedTargetValidators);
}
export function validateForegroundReviewResult(operation:ForegroundReviewOperation,value:unknown):ForegroundReviewResult{
 if(operation.type==='calendar_availability')return validateCalendarAvailabilityResult(operation,value);
 if(operation.type==='notes_search')return validateNotesSearchResult(operation,value,selectedNotesRead);
 return validateNamedTargetResult(operation,value,namedTargetValidators);
}
/** Every operation a proposal may carry. Foreground reviews run through their own executor. */
export type ReviewableDeviceOperation = DeviceOperation | ForegroundReviewOperation;
/** Runs the phone's local review (calendar choice, note choice, record disambiguation)
 * and any resulting exact-target effect. Only an owner-confirmed result is returned. */
export type ForegroundReviewExecutor = (operation: ForegroundReviewOperation, operationId: string, context: ContextEnvelope, signal: AbortSignal, bindingHash: string, journalIdentity: DeviceJournalIdentity) => Promise<{ status: 'succeeded' | 'failed' | 'unknown'; summary: string; foregroundResult?: ForegroundReviewResult }>;
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
export type DeviceExecutor = (operation: DeviceOperation, operationId: string, context: ContextEnvelope, signal: AbortSignal, bindingHash: string, workflowRoute?:WorkflowNoticeRoute,journalIdentity?:DeviceJournalIdentity) => Promise<{ status: 'succeeded' | 'failed' | 'unknown'; summary: string; readResult?: WorkflowReadResult; calendarResult?:CalendarResult; notesResult?:NotesResult|NotesQueryResult; reminderResult?:ReminderResult|ReminderCreateResult; mapsResult?:MapsResult;clockResult?:ClockHandoffResult;photoLibraryResult?:LibraryAgentResult }>;
export type DeviceRecovery = (operation:DeviceOperation,operationId:string,bindingHash:string,signal:AbortSignal)=>Promise<{status:string;reminderResult?:ReminderResult|ReminderCreateResult}>;
interface Proposal { id: string; digest: string; state: string; expiresAt: number; operation: ReviewableDeviceOperation; workflow?:WorkflowDeviceBinding; attemptId?: string;readReplyOrigin?:NativeNotesReadReplyOrigin }
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
  if(isReminderCreate(p))return validateReminderCreate(p);
  if(isClockOperation(p))return validateClockOperation(p);
  if(isMapsOperation(p))return validateMapsOperation(p);
  if(isLibraryOperation(p))return validateLibraryOperation(p);
  if(isReminderOperation(p))return validateReminderOperation(p);
  if(isNotesOperation(p))return validateNotesOperation(p);
  if(isCalendarOperation(p))return validateCalendarOperation(p);
  if(p.type==='notes_query')return validateNativeNotesQuery(p);
  if(p.type==='read_selected_notes'||p.type==='read_calendar_range')return parseWorkflowRead(p);
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
 if(operation.type==='notes_search'){if(!['home','notes'].includes(context.view))throw new ContextNotice('Open Home or Notes to review this Notes search.');return;}
 // Name-targeted edits are requested from Home and resolved by a local choice, never by a selection elsewhere.
 if(context.view!=='home')throw new ContextNotice('Return to Home to choose the record for this action.');
}
/** A pending proposal that does not fit the current screen. Its message is shown to the owner. */
export class ContextNotice extends Error { override readonly name='ContextNotice'; }
function assertNotesContext(operation:NotesOperation,context:ContextEnvelope){const s=context.selectedObject,t=operation.target;if(context.sensitive||context.view!=='notes'||!s||s.kind!=='note'||s.id!==t.noteId||s.revision!==t.revision||s.accountId!==t.sourceId||s.sourceRevision!==t.sourceRevision)throw Error('Selected note context changed');}
/** Every screen rule for a proposal; throws when the current screen cannot review it. */
function assertProposalContext(operation:ReviewableDeviceOperation,context:ContextEnvelope){
 if(isForegroundReview(operation))assertForegroundContext(operation,context);
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
    if(isCalendarOperation(op)&&(op.type==='calendar_create_local'||op.type==='calendar_read_next')&&!calendarCapabilityAvailable(op.type,this.credential.capabilities))throw Error('This agent has not negotiated native Calendar creation or discovery. Reconnect to a compatible agent.');
    if(isNativeNotesQuery(op)&&!this.credential.capabilities?.includes(NOTES_QUERY_CAPABILITY))throw Error('Notes discovery was not negotiated with this agent');
    if(isLibraryOperation(op)&&!this.credential.capabilities?.includes(PHOTO_LIBRARY_CAPABILITY))throw Error('Device library access was not negotiated with this agent');
    if(isForegroundReview(op)&&(!deviceReviewCapabilityAvailable(op.type,this.credential.capabilities)||!this.executeForeground))throw Error('This action was not negotiated with this agent. Reconnect to a compatible agent.');
    if(isReminderCreate(op)&&!this.reminderCreate)throw Error('This agent does not support reviewed reminder creation. Reconnect to a compatible agent.');
    if(isReminderOperation(op)&&(op.target.timingVersion===2||op.type==='reminder_update'&&op.fields.schedule?.alertMinutes!==undefined)&&!this.reminderV2)throw Error('This agent does not support this reminder timing. Reconnect to a compatible agent.');
    if((['read_selected_notes','read_calendar_range','post_notification','speak_text'].includes(op.type))&&!workflow)throw new Error('Workflow binding required for phone reads');
    const readReplyOrigin=p.readReplyOrigin===undefined?undefined:validateNativeNotesReadReplyOrigin(p.readReplyOrigin);
    if(readReplyOrigin&&(workflow||!isNativeNotesQuery(op)&&op.type!=='notes_read_selected'))throw Error('Unexpected original Notes reply');
    return { id: id(p.id), digest, state: text(p.state, 32), expiresAt, operation:op,...(workflow?{workflow}:{}), ...(p.execution?.attemptId ? { attemptId: id(p.execution.attemptId) } : {}),...(readReplyOrigin?{readReplyOrigin}:{}) };
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
    if (isForegroundReview(op)) return { id: proposal.id, ...describeForegroundReview(op, context.timeZone), expiresAt: proposal.expiresAt, contextRevision: context.revision };
    if (isLibraryOperation(op)) return { id: proposal.id, ...describeLibraryOperation(op), expiresAt: proposal.expiresAt, contextRevision: context.revision };
    const record = isReminderCreate(op)||isReminderOperation(op)||isNotesOperation(op)||isCalendarOperation(op)||op.type==='create_note'||op.type==='create_reminder'?presentDeviceRecordOperation(op,context.timeZone):undefined;
    const description = isNativeNotesQuery(op)?(op.query.kind==='title'?`Look for the title “${op.query.text}” locally. Choose and review one note before sharing its text.`:`Find the latest ${op.query.by} note locally. Unknown dates or ties require your choice; only the chosen note is shared.`):record?.description ?? (isClockOperation(op) ? describeClockHandoff(op) : isMapsOperation(op) ? 'Send the exact selected place location or route endpoints, mode and distance to the connected agent. This shares location information. It does not start navigation.' : op.type === 'open_view' ? `Open ${op.view} on this phone` : op.type==='browser_navigate'?`Open browser destination ${op.url}`:'Workflow phone read');
    return { id: proposal.id, title: record?.title ?? op.type.replaceAll('_', ' '), description, expiresAt: proposal.expiresAt, contextRevision: context.revision,...(isNativeNotesQuery(op)&&!['home','notes'].includes(context.view)?{reviewDestination:'home' as const}:{}),...(isNativeNotesQuery(op)||op.type==='notes_read_selected'?{privateNotesRead:true as const}:{}),...(proposal.readReplyOrigin?{readReply:{origin:structuredClone(proposal.readReplyOrigin),digest:proposal.digest}}:{}) };
  }
  private async review(context: ContextEnvelope, signal: AbortSignal): Promise<{ items: PendingReviewItem[]; failures: Error[] }> {
    const { valid, invalid } = await this.listing(signal);
    signal.throwIfAborted(); this.proposals.clear();
    const items: PendingReviewItem[] = [];
    for (const proposal of valid) {
      if (proposal.workflow || proposal.state !== 'pending' || proposal.expiresAt <= Date.now()) continue;
      const card = this.card(proposal, context), notice = isNativeNotesQuery(proposal.operation)&&!context.sensitive ? undefined : proposalContextNotice(proposal.operation, context);
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
      const op=p.operation;const scope=op.type==='read_selected_notes'?`Read only ${op.notes.length} selected Notes at the recorded revisions. Text and titles will be sent to this agent.\nSelected IDs: ${op.notes.map(n=>n.id).join(', ')}`:op.type==='read_calendar_range'?`Read calendars ${op.calendarIds.join(', ')} from ${op.start} up to (excluding) ${op.end}, shown in ${op.timeZone}. At most ${op.maximumEvents} events; overflow fails. Event titles, times and IDs will be sent; descriptions, locations and attendees are excluded.`:op.type==='create_note'?`Save one note “${op.title}” on this phone:\n${op.body}`:op.type==='post_notification'?`Post this notification on this device: ${op.title}\n${op.body}`:op.type==='speak_text'?`Read this exact text aloud on this device:\n${op.text}`:'Unsupported phone step';
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
    const p = reviewed.proposal, operationId = crypto.randomUUID();
    try {
      if(p.workflow){if(!reviewed.workflowReview)throw new Error('Workflow step must be reviewed from its execution');assertWorkflowOperation(reviewed.workflowReview,p.workflow,{installationId:this.credential.installationId,enrollmentId:this.credential.enrollmentId!},p.operation);}
      signal.throwIfAborted();
      assertProposalContext(p.operation,context);
      const reserved = await this.journal.reserve({ scope: this.scope, proposalId, operationId, operationHash: await actionScope(JSON.stringify(p.operation)), record: { digest: p.digest, operation: p.operation, context, expiresAt: p.expiresAt, installationId: this.credential.installationId, enrollmentId: this.credential.enrollmentId, sessionId:this.session.sessionId,ownerId:this.session.ownerId,agentId:this.session.agentId,origin:this.session.origin,...(p.workflow?{workflow:p.workflow}:{}) } });
      if (!reserved.created) return { proposalId, status: 'unknown', summary: 'This action already has a device journal entry. Review action history; it was not repeated.' };
      signal.throwIfAborted();
      await this.mutation(p, 'decision', { decision: 'approve' }, signal);
      const claimed = await this.mutation(p, 'claim', {}, signal);
      if (!claimed.attemptId || claimed.state !== 'executing') throw new Error('The server did not grant an execution claim');
      signal.throwIfAborted();
      await this.journal.markApplying({ scope: this.scope, proposalId, attemptId: claimed.attemptId });
      let result: Awaited<ReturnType<DeviceExecutor>> & { foregroundResult?: ForegroundReviewResult };
      try { signal.throwIfAborted(); if (p.expiresAt <= Date.now()) throw new Error('Expired action'); const bindingHash=await actionScope(JSON.stringify([this.scope,this.session.ownerId,this.session.agentId,this.session.sessionId,this.session.origin,this.credential.installationId,this.credential.enrollmentId,p.id,p.digest,operationId]));
        if(isForegroundReview(p.operation)){if(!this.executeForeground)throw Error('Foreground review is unavailable');result=await this.executeForeground(p.operation,operationId,context,signal,bindingHash,{scope:this.scope,proposalId:p.id});}
        else result = await this.execute(p.operation, operationId, context, signal, bindingHash,p.workflow?{scope:this.scope,origin:this.session.origin,ownerId:this.session.ownerId,agentId:this.session.agentId,workflowId:p.workflow.workflowId,runId:p.workflow.runId,versionId:p.workflow.versionId}:undefined,{scope:this.scope,proposalId:p.id}); }
      catch { result = { status: 'unknown', summary: 'Action outcome needs review. It will not be repeated automatically.' }; }
      let clockResult:ClockHandoffResult|undefined;
      if(isClockOperation(p.operation)){
        if(result.clockResult!==undefined){clockResult=validateClockResult(p.operation,result.clockResult);const expected=clockResult.status==='opened'?'succeeded':clockResult.status==='unknown'?'unknown':'failed';if(result.status!==expected)throw Error('Clock handoff outcome mismatch');}
        else if(result.status==='succeeded')throw Error('Missing Clock handoff result');
      }else if(result.clockResult!==undefined)throw Error('Unexpected Clock handoff result');
      let mapsResult:MapsResult|undefined;
      if(isMapsOperation(p.operation)){if(result.status==='succeeded')mapsResult=validateMapsResult(p.operation,result.mapsResult);else if(result.mapsResult!==undefined)throw Error('Failed Maps read cannot return content');}else if(result.mapsResult!==undefined)throw Error('Unexpected Maps result');
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
      if(p.operation.type==='read_selected_notes'||p.operation.type==='read_calendar_range'){
        if(result.status==='succeeded')readResult=await validateWorkflowResult(p.operation,result.readResult);
        else if(result.readResult!==undefined)throw new Error('Failed read cannot return content');
      }else if(result.readResult!==undefined)throw new Error('Unexpected read content');
      await this.journal.finish({ scope: this.scope, proposalId, status:result.status, summary:result.summary, result: { operationId,...(clockResult?{clockResult}:{}),...(mapsResult?{mapsResult}:{}),...(photoLibraryResult?{photoLibraryResult}:{}),...(readResult?{readResult}:{}),...(calendarResult?{calendarResult}:{}),...(notesResult?{notesResult}:{}),...(reminderResult?{reminderResult}:{}),...(foregroundResult?{foregroundResult}:{}) } });
      // A completed device effect is journaled even if the UI epoch was cancelled.
      // Receipt upload is retried only by the explicit history control.
      let confirmed:Proposal;
      try { if(isMapsOperation(p.operation))assertMapsContext(p.operation,context); confirmed=await this.mutation(p, 'receipt', { attemptId: claimed.attemptId, receipt: { outcome: result.status === 'succeeded' ? 'applied' : result.status === 'failed' ? 'failed' : 'unknown', operationId,...(foregroundResult?{result:foregroundResult}:clockResult?{result:clockResult}:mapsResult?{result:mapsResult}:photoLibraryResult?{result:photoLibraryResult}:readResult?{result:readResult}:calendarResult?{result:calendarResult}:notesResult?{result:notesResult}:reminderResult?{result:reminderResult}:{}) } }, signal); }
      catch { return { proposalId, status: result.status, summary: `${result.summary} Server receipt is pending; check action history.` }; }
      finally {if(typeof window!=='undefined'){if(isCalendarOperation(p.operation)&&p.operation.type!=='calendar_read_selected'&&p.operation.type!=='calendar_read_next'&&result.status==='succeeded')window.dispatchEvent(new CustomEvent('alpha:calendar-committed'));if(isNotesOperation(p.operation))window.dispatchEvent(new CustomEvent('alpha:notes-committed'));if(isReminderOperation(p.operation)||isReminderCreate(p.operation)||p.operation.type==='create_reminder')window.dispatchEvent(new CustomEvent('alpha:reminders-committed'));
        if(foregroundResult&&'operation' in foregroundResult){const kind=foregroundResult.kind;window.dispatchEvent(new CustomEvent(kind==='notes_named'?'alpha:notes-committed':kind==='calendar_named'?'alpha:calendar-committed':'alpha:reminders-committed'));}}}
      const retained=this.readReplies.get(proposalId);
      const readReply=result.status==='succeeded'&&notesResult&&p.readReplyOrigin&&confirmed.state==='done'&&confirmed.attemptId===claimed.attemptId&&retained&&!retained.consumed&&retained.digest===p.digest&&JSON.stringify(retained.origin)===JSON.stringify(p.readReplyOrigin)?validateNativeNotesReadReplyHint({...p.readReplyOrigin,proposalId,digest:p.digest,attemptId:claimed.attemptId}):undefined;
      if(readReply)retained!.hint=readReply;
      return { proposalId, status:result.status, summary:result.summary,...(readReply?{readReply}:{}) };
    } catch {
      return { proposalId, status: 'unknown', summary: 'Action did not reach a confirmed result. Check action history before requesting it again.' };
    } finally { this.busy = false; }
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
      if (!p || entry.phase !== 'terminal' || !entry.attemptId || entry.record.digest !== p.digest || !entry.status) continue;
      if(p.workflow&&(!workflow||p.workflow.runId!==workflow.runId||p.workflow.versionId!==workflow.versionId||p.workflow.specDigest!==workflow.specDigest))continue;
      const clockResult=await this.savedClockResult(p,entry);
      const mapsResult=await this.savedMapsResult(p,entry);
      const photoLibraryResult=await this.savedLibraryResult(p,entry);
      const readResult=await this.savedReadResult(p,entry);
      const calendarResult=await this.savedCalendarResult(p,entry);
      const notesResult=await this.savedNotesResult(p,entry);
      const reminderResult=await this.savedReminderResult(p,entry);
      const foregroundResult=await this.savedForegroundResult(p,entry);
      if(p.state==='reconciliation_required'&&entry.status==='succeeded'&&((isReminderOperation(p.operation)||isReminderCreate(p.operation))&&reminderResult||p.operation.type==='post_notification')){
        await this.mutation(p,'reconciliation',{attemptId:entry.attemptId,resolution:{confirmed:true,outcome:'applied',operationId:entry.operationId,...(reminderResult?{result:reminderResult}:{})}},signal);
      }else await this.mutation(p, 'receipt', { attemptId: entry.attemptId, receipt: { outcome: entry.status === 'succeeded' ? 'applied' : entry.status === 'failed' ? 'failed' : 'unknown', operationId: entry.operationId,...(foregroundResult?{result:foregroundResult}:clockResult?{result:clockResult}:mapsResult?{result:mapsResult}:photoLibraryResult?{result:photoLibraryResult}:readResult?{result:readResult}:calendarResult?{result:calendarResult}:notesResult?{result:notesResult}:reminderResult?{result:reminderResult}:{}) } }, signal);
    }
  }
  private async savedClockResult(p:Proposal,summary:JournalEntry):Promise<ClockHandoffResult|undefined>{
    if(!isClockOperation(p.operation))return undefined;
    const {entry}=await this.journal.get({scope:this.scope,proposalId:p.id});
    if(!entry||entry.phase!=='terminal'||entry.operationId!==summary.operationId||entry.record.digest!==p.digest||entry.record.ownerId!==this.session.ownerId||entry.record.agentId!==this.session.agentId||entry.record.origin!==this.session.origin||entry.record.installationId!==this.credential.installationId||entry.record.enrollmentId!==this.credential.enrollmentId)throw Error('No exact saved Clock receipt; handoff will not be repeated');
    if(entry.result?.clockResult===undefined){if(entry.status==='succeeded')throw Error('Missing Clock receipt');return undefined;}
    const result=validateClockResult(p.operation,entry.result.clockResult);const status=result.status==='opened'?'succeeded':result.status==='unknown'?'unknown':'failed';if(entry.status!==status)throw Error('Saved Clock outcome mismatch');return result;
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
    if(p.operation.type!=='read_selected_notes'&&p.operation.type!=='read_calendar_range')return undefined;
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
    const clockResult=entry?await this.savedClockResult(p,entry):undefined;
    if(isClockOperation(p.operation)&&(!clockResult||clockResult.status==='unknown'||(outcome==='applied')!==(clockResult.status==='opened')))throw Error('Clock reconciliation requires the exact saved handoff result; alarm state cannot be inferred');
    const mapsResult=outcome==='applied'&&entry?await this.savedMapsResult(p,entry):undefined;
    if(outcome==='applied'&&isMapsOperation(p.operation)&&!mapsResult)throw Error('Applied Maps read requires exact saved receipt');
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
    if(outcome==='applied'&&(p.operation.type==='read_selected_notes'||p.operation.type==='read_calendar_range')&&!readResult)throw new Error('Applied read requires its exact saved result');
    await this.mutation(p, 'reconciliation', { attemptId: p.attemptId, resolution: { confirmed: true, outcome, ...((outcome === 'applied'||isClockOperation(p.operation)) && entry ? { operationId: entry.operationId } : {}),...(foregroundResult?{result:foregroundResult}:clockResult?{result:clockResult}:mapsResult?{result:mapsResult}:photoLibraryResult?{result:photoLibraryResult}:readResult?{result:readResult}:calendarResult?{result:calendarResult}:notesResult?{result:notesResult}:reminderResult?{result:reminderResult}:{}) } }, signal);
  }
}
