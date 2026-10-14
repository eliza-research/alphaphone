import {verifiedDeletedNoteOrigins} from '../runtime/deleted-note-origin';
import {calendarDocument} from './calendar-store';
import {reminderDocument} from './reminder-store';
import type {CalendarDeletionState} from './calendar-deletions';
import type {ReminderDeletionState} from './reminder-deletions';
import {browserDeletionOwnerVisible} from '../runtime/deletion-owner';

/** Durable terminal receipts, never absence from a filtered calendar range or pending list. */
export async function deletedNoteOrigins(){
 const reminders=await reminderDocument.read<ReminderDeletionState>(()=>({sourceRevision:'',reminders:[]}));
 const calendar=await calendarDocument.read<CalendarDeletionState>(()=>({sourceRevision:'',events:[]}));
 return verifiedDeletedNoteOrigins(reminders,calendar,browserDeletionOwnerVisible);
}
