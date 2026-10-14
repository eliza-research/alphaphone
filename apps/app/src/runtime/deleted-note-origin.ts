import type {CalendarDeletionState} from '../browser/calendar-deletions';
import type {ReminderDeletionState} from '../browser/reminder-deletions';
/** Only committed receipts with current source identity retire a link. */
export function verifiedDeletedNoteOrigins(reminders:ReminderDeletionState,calendar:CalendarDeletionState,visible:(owner:string)=>boolean){
 const deleted:Array<{kind:'reminder'|'event';id:string}>=[];
 for(const receipt of Object.values(reminders.deletions||{})){
  if(receipt.phase!=='deleted'||!visible(receipt.owner)||receipt.target.sourceRevision!==reminders.sourceRevision)continue;
  const row=reminders.reminders.find(row=>row.id===receipt.target.row.id);
  if(row?.status==='cancelled'&&row.occurrenceId===receipt.target.row.occurrenceId)deleted.push({kind:'reminder',id:row.id});
 }
 for(const receipt of Object.values(calendar.deletions||{})){
  const row=receipt.target.row;
  if(receipt.phase!=='deleted'||!visible(receipt.owner)||receipt.target.sourceRevision!==calendar.sourceRevision)continue;
  // Deleting one occurrence must retain its series' From note link.
  if(row.seriesId||/:occ:-?\d+$/.test(row.id)||calendar.events.some(current=>current.id===row.id))continue;
  deleted.push({kind:'event',id:row.id});
 }
 return deleted;
}
