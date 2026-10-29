import {registerPlugin} from '../platform-plugins';
import type {DeferredDeletionEntry,DeferredDeletionsBridge} from '../../../../.eliza/client-features/packages/contracts/src/deletion-window';
export {reminderDeletionRefusal} from '../../../../.eliza/client-features/packages/contracts/src/deletion-window';
/** A pending Calendar or reminder deletion row (the shared deletion-window contract). */
export type DeletionEntry=DeferredDeletionEntry&{kind:'calendar'|'reminder'};
/** Alpha's installed bridge name for the shared reviewed deletion Undo window. */
export const deletions=registerPlugin<DeferredDeletionsBridge&{
 receipt(input:{entry:import("./device-actions").JournalEntry}):Promise<{recovery:{status:"succeeded"|"failed";summary:string;result:Record<string,unknown>}|null}>;
 pending():Promise<{deletions:DeletionEntry[];deletedOrigins?:Array<{kind:'event'|'reminder';id:string}>}>;
 undo(input:{kind:string;id:string}):Promise<{phase?:string}|unknown>;
 reviewReminder(input:{target:unknown}):Promise<{status:string}>;
 reviewAgentReminder(input:{operation:unknown;operationId:string;bindingHash:string;journalIdentity:unknown}):Promise<{status:string}>;
}>('AlphaDeletions');
export function refreshDeletionViews(){window.dispatchEvent(new Event('alpha:deletions-changed'));window.dispatchEvent(new Event('alpha:calendar-document-changed'));window.dispatchEvent(new Event('alpha:reminders-document-changed'));}
