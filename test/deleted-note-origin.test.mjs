import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedDeletedNoteOrigins} from '../apps/app/src/runtime/deleted-note-origin.ts';
const states=()=>({reminders:{sourceRevision:'s',reminders:[{id:'r',status:'cancelled',occurrenceId:'o'}],deletions:{d:{owner:'owner',phase:'deleted',target:{sourceRevision:'s',row:{id:'r',occurrenceId:'o'}}}}},calendar:{sourceRevision:'s',events:[],deletions:{d:{owner:'owner',phase:'deleted',target:{sourceRevision:'s',row:{id:'e'}}}}}});
const read=({reminders,calendar})=>verifiedDeletedNoteOrigins(reminders,calendar,owner=>owner==='owner');
test('committed deletion removes reminder and whole-event links, including after restart',()=>{
 const saved=JSON.parse(JSON.stringify(states()));assert.deepEqual(read(saved),[{kind:'reminder',id:'r'},{kind:'event',id:'e'}]);
});
test('Undo, pending, unknown, conflict and other-owner receipts keep both links',()=>{
 for(const phase of ['queued','paused','undone','unknown','dispatching','conflict']){const s=states();s.reminders.deletions.d.phase=s.calendar.deletions.d.phase=phase;assert.deepEqual(read(s),[]);}
 const s=states();s.reminders.deletions.d.owner=s.calendar.deletions.d.owner='other';assert.deepEqual(read(s),[]);
});
test('source replacement and reused IDs do not remove newer links',()=>{
 for(const mutate of [s=>{s.reminders.sourceRevision=s.calendar.sourceRevision='new';},s=>{s.reminders.reminders[0].occurrenceId='new';s.calendar.events.push({id:'e'});},s=>{s.reminders.reminders[0].status='scheduled';s.calendar.deletions.d.target.row.seriesId='series';}]){const s=states();mutate(s);assert.deepEqual(read(s),[]);}
 const s=states();s.calendar.deletions.d.target.row.id='series:occ:123';assert.deepEqual(read(s),[{kind:'reminder',id:'r'}]);
});
