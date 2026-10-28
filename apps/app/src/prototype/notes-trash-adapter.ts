import {
 addNotesTrashEntry,editNotesTrash,isNotesTrashFull,notesTrashDaysLabel,notesTrashExpired,readNotesTrash,removeNotesTrashEntries,
 restoreNotesTrashEntry,savedNoteIds,savedNotes,sortedNotesTrash,withNotesDeletionLock,type NotesTrashEntry,
} from '../runtime/notes-trash';
import {notesTrashPolicy} from '../runtime/notes-trash-policy';
import {maintainNotesTrash} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-trash-maintenance.ts';
import {scheduleNotesTrashMaintenance} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-trash-schedule.ts';
import {DailyApps} from '../daily';
import {releaseUnusedSourceReferences} from './note-source-adapter';
type Bag=Record<string,any>;
type Shell=any;
const kindLabel:Record<string,string>={text:'Note',list:'Checklist',voice:'Voice note',link:'Link'};

/** While the shell is alive, Trash is checked at least this often, whichever view is open. */
export const NOTES_TRASH_MAINTENANCE_INTERVAL_MS=15*60*1000;

/**
 * Deleted notes go to a durable Trash and are erased three days after deletion.
 * Maintenance (drop rows whose note is live again, purge expired rows) runs at startup,
 * whenever Notes opens, when the app returns to the foreground (visibilitychange and the
 * native appResumed event) and on a 15-minute timer while the shell is alive, so expiry
 * never depends on the user opening Notes. It is idempotent and reads authoritative
 * storage only. On Android a native WorkManager sweep is the backstop while Alpha is closed.
 */
export function installNotesTrashAdapter(Component:Shell,views:Record<string,Bag>){
 const notes=views.notes,render=notes.render,back=notes.back;
 const p=Component.prototype,originalApi=p.api,originalMount=p.componentDidMount,originalUnmount=p.componentWillUnmount;
 let busy=false,maintaining:Promise<unknown>|null=null;
 /** The exact reviewed note a full Trash refused. Held in memory only; a restart simply asks again. */
 let refused:{note:Bag;snapshot:string;index:number}|null=null;
 const noteTitle=(note:Bag)=>note.title||kindLabel[note.kind]||'Note';

 const ready=(shell:Shell)=>shell.live&&shell.notesStore&&!shell.notesStorageFailed&&!shell.notesPending;
 const voice=(shell:Shell)=>shell.api('notes') as Bag;
 async function purge(shell:Shell,entry:NotesTrashEntry){
  // Caller holds the deletion-effects lock. A recording is erased before its row disappears.
  if(!entry.audio)return true;
  const hook=voice(shell).purgeTrashedVoice;
  return typeof hook==='function'?!!await hook(entry):false;
 }
 async function load(shell:Shell){
  if(shell.notesSourceMode==='canonical')return;
  try{const doc=await readNotesTrash();if(shell.live)shell.vset('notes',{trash:sortedNotesTrash(doc),trashError:''});}
  catch{if(shell.live)shell.vset('notes',{trash:[],trashError:'Trash could not be read. Nothing in it was deleted.'});}
 }
 /** Idempotent: a second run with the same clock finds nothing to do. */
 async function maintain(shell:Shell,background:boolean,now=Date.now()){
  if(shell.notesSourceMode==='canonical')return;
  // Interrupted voice deletions are settled with every pass (startup, resume, timer, Notes open), so
  // a permanent deletion cut short by process death never waits for the person to open Notes. Not
  // awaited: it queues for the deletion-effects lock on its own and never delays Trash upkeep.
  try{const recover=voice(shell).recoverVoiceDeletions;if(typeof recover==='function')void Promise.resolve(recover()).catch(()=>{/* The row stays under review. */});}catch{/* Unavailable. */}
  const result=await maintainNotesTrash({policy:notesTrashPolicy,read:readNotesTrash,edit:editNotesTrash,liveNoteIds:savedNoteIds,withLock:work=>withNotesDeletionLock(work),purge:entry=>purge(shell,entry)},now);
  // Source links of notes that are neither saved nor restorable from Trash give up their grants.
  // Best effort: a failure keeps every reference and retries on the next pass.
  try{await withNotesDeletionLock(async()=>releaseUnusedSourceReferences([...await savedNotes(),...(await readNotesTrash()).entries.map(entry=>entry.note)]));}catch{/* Retried. */}
  // A background pass repaints only when it changed Trash; an open Notes view re-reads every time.
  if(!background||result.removed.length)await load(shell);
 }
 function runMaintenance(shell:Shell,background=false){
  // A foreground caller joining a background pass still re-reads Trash afterwards.
  if(maintaining)return background?maintaining:maintaining.then(()=>load(shell));
  maintaining=maintain(shell,background).catch(()=>load(shell)).finally(()=>{maintaining=null;});
  return maintaining;
 }
 /** Foreground, resume and timer passes. They wait for saved Notes and never run on failed storage. */
 function scheduleMaintenance(shell:Shell){
  return scheduleNotesTrashMaintenance({
   intervalMs:NOTES_TRASH_MAINTENANCE_INTERVAL_MS,visibility:document,
   run:()=>{if(!shell.live)return;void Promise.resolve(shell.notesReady).then(()=>{if(shell.live&&!shell.notesStorageFailed)return runMaintenance(shell,true);}).catch(()=>{});},
   onResume:listener=>{const handle=DailyApps.addListener('appResumed',listener).catch(()=>null);return ()=>void handle.then(value=>value?.remove()).catch(()=>{});},
  });
 }

 async function moveToTrash(shell:Shell,note:Bag,index:number){
  if(!ready(shell)){shell.toast(shell.notesPending&&!shell.notesStorageFailed?'Still saving. Try again in a moment. Nothing was deleted.':'Notes storage needs recovery. Nothing was deleted.');return false;}
  let entry:NotesTrashEntry|undefined,changed=false;
  try{
   const saved=await withNotesDeletionLock(async()=>{
    if(!ready(shell))throw Error('Notes changed');
    const stored=shell.notesStore.list.find((n:Bag)=>n.id===note.id);
    if(JSON.stringify(stored)!==JSON.stringify(note))throw Error('Note changed');
    // Revision compare-and-swap against authoritative storage, under the origin-wide lock: this view's
    // copy may be stale. Another view may have edited this note, or deleted a newer revision whose
    // Trash row is now its only restorable copy and must not be replaced by this older one.
    const authoritative=(await savedNotes()).find(n=>n.id===note.id);
    if(!authoritative||JSON.stringify(authoritative)!==JSON.stringify(note)){changed=true;throw Error('Note changed');}
    const rows=(doc:{entries:NotesTrashEntry[]})=>doc.entries.filter(row=>row.note.id===note.id).map(row=>JSON.stringify(row)).sort().join('\n');
    const expected=rows(await readNotesTrash());
    entry={id:crypto.randomUUID(),note:stored,target:await shell.notesStore.target(note.id),index,deletedAt:Date.now()};
    // Write-ahead: the restorable copy is durable before the note leaves the saved list. Only rows this
    // pass read (stale write-ahead rows of a note that is still saved) may be replaced.
    await editNotesTrash(doc=>{if(rows(doc)!==expected){changed=true;throw Error('Trash changed');}return addNotesTrashEntry(doc,entry!);});
    const list=shell.vget('notes').list.filter((n:Bag)=>n.id!==note.id);
    return await shell.vset('notes',{list,open:null,sheet:null,playing:false,dict:false})===true;
   });
   if(!saved)return false;
  }catch(error){
   // A full Trash never silently drops this note or any other: nothing was written, and the
   // person chooses between making room and a separately confirmed permanent deletion.
   if(isNotesTrashFull(error)&&shell.live){refused={note,snapshot:JSON.stringify(note),index};shell.vset('notes',{trashFull:{id:note.id,title:noteTitle(note)},trashConfirm:null});}
   else shell.toast(changed?'This note changed in another view. Nothing was deleted.':'Could not move this note to Trash. Nothing was deleted.');
   return false;
  }
  void load(shell);
  shell.toast(`${note.title||kindLabel[note.kind]||'Note'} moved to Trash`,{undo:()=>void restore(shell,entry!.id)});
  return true;
 }

 async function restore(shell:Shell,id:string){
  if(busy)return;busy=true;shell.vset('notes',{trashBusy:true});
  try{
   await runMaintenance(shell);
   const entry=(await readNotesTrash()).entries.find(x=>x.id===id);
   if(!entry){shell.toast('This note is no longer in Trash.');return;}
   if(notesTrashExpired(entry,Date.now())){shell.toast('This note has expired and cannot be restored. Permanent deletion will be retried.');return;}
   if(entry.audio){
    // The recording follows its note through the reviewed voice restore path.
    const hook=voice(shell).restoreTrashedVoice;
    if(typeof hook==='function')await hook(entry);else shell.toast('Voice restore is unavailable. The note stays in Trash.');
    return;
   }
   const restored=await withNotesDeletionLock(async()=>{
    if(!ready(shell))throw Error('Notes storage needs recovery');
    const current=(await readNotesTrash()).entries.find(x=>x.id===id);
    if(!current)return 'gone';
    if(notesTrashExpired(current,Date.now()))throw Error('Trash retention expired');
    if((await savedNoteIds()).has(current.note.id)){await editNotesTrash(doc=>removeNotesTrashEntries(doc,[id]));return 'live';}
    const list=restoreNotesTrashEntry(shell.notesStore.list,current);
    if(await shell.vset('notes',{list},{exact:true})!==true)throw Error('Restore unconfirmed');
    await editNotesTrash(doc=>removeNotesTrashEntries(doc,[id]));
    return 'restored';
   });
   shell.toast(restored==='restored'?`${entry.note.title||kindLabel[entry.note.kind]||'Note'} restored`:restored==='live'?'This note is already in Notes.':'This note is no longer in Trash.');
  }catch{shell.toast('Restore is unconfirmed. Reopen Notes to check Trash. No newer note was replaced.');}
  finally{busy=false;if(shell.live)shell.vset('notes',{trashBusy:false});await load(shell);}
 }

 async function erase(shell:Shell,ids:'all'|string){
  if(busy)return;busy=true;shell.vset('notes',{trashBusy:true,trashConfirm:null});
  let failed=0,count=0;
  try{
   await withNotesDeletionLock(async()=>{
    const entries=(await readNotesTrash()).entries.filter(entry=>ids==='all'||entry.id===ids),drop:string[]=[];
    for(const entry of entries){try{if(await purge(shell,entry))drop.push(entry.id);else failed++;}catch{failed++;}}
    if(drop.length)await editNotesTrash(doc=>removeNotesTrashEntries(doc,drop));
    count=drop.length;
   });
   shell.toast(failed?`${failed} item(s) could not be deleted yet. They stay in Trash.`:ids==='all'?'Trash emptied':count?'Deleted forever':'This note is no longer in Trash.');
  }catch{shell.toast('Permanent deletion is unconfirmed. Reopen Trash to check.');}
  finally{busy=false;if(shell.live)shell.vset('notes',{trashBusy:false});await load(shell);}
 }

 /**
  * Permanent deletion without a Trash copy, offered only after a full Trash refused this
  * exact note and confirmed separately. One saved-list commit; a note that changed since the
  * refusal, or that owns a recording, is left untouched.
  */
 async function deleteForever(shell:Shell,id:string){
  const candidate=refused;
  if(busy||!candidate||candidate.note.id!==id)return;
  busy=true;shell.vset('notes',{trashBusy:true});
  let outcome:'deleted'|'changed'|'unconfirmed'|'unavailable'='unconfirmed';
  try{
   outcome=await withNotesDeletionLock(async()=>{
    // Nothing is attempted while a save is pending or storage needs recovery.
    if(!ready(shell))return 'unavailable';
    const stored=shell.notesStore.list.find((n:Bag)=>n.id===id);
    if(!stored||stored.audio||JSON.stringify(stored)!==candidate.snapshot)return 'changed';
    // The refused record must also be the one in authoritative storage, not only in this view's
    // copy: another view may have changed it or already moved it (or a newer revision) to Trash,
    // and then its Trash row is the only restorable copy and must not be touched.
    const saved=(await savedNotes()).find(n=>n.id===id);
    if(!saved||JSON.stringify(saved)!==candidate.snapshot)return 'changed';
    // Any row for this saved note is stale (maintenance would drop it); left in place it would
    // offer the permanently deleted note for restore again.
    const stale=(await readNotesTrash()).entries.filter(entry=>entry.note.id===id).map(entry=>entry.id);
    if(stale.length)await editNotesTrash(doc=>removeNotesTrashEntries(doc,stale));
    const list=shell.vget('notes').list.filter((n:Bag)=>n.id!==id);
    if(await shell.vset('notes',{list,open:null,sheet:null,playing:false,dict:false})!==true)return 'unconfirmed';
    return (await savedNoteIds()).has(id)?'unconfirmed':'deleted';
   });
  }catch{outcome='unconfirmed';}
  finally{
   busy=false;
   const settled=outcome==='deleted'||outcome==='changed';
   if(settled)refused=null;
   if(shell.live)shell.vset('notes',{trashBusy:false,...(settled?{trashFull:null}:{})});
   await load(shell);
  }
  shell.toast(outcome==='deleted'?`${noteTitle(candidate.note)} deleted forever`:outcome==='changed'?'This note changed. Nothing was deleted.'
   :outcome==='unavailable'?(shell.notesPending&&!shell.notesStorageFailed?'Still saving. Try again in a moment. Nothing was deleted.':'Notes storage needs recovery. Nothing was deleted.')
   :'Permanent deletion is unconfirmed. Reopen Notes to check. Nothing else was deleted.');
 }

 p.api=function(key:string){
  const api=originalApi.call(this,key);
  // Installed only for live Notes (never fixtures), so deletion never falls back to an in-memory remove.
  if(key==='notes'){
   const shell=this;
   api.moveNoteToTrash=(note:Bag,index:number)=>moveToTrash(shell,note,index);
   api.notesTrash={restore:(id:string)=>restore(shell,id),erase:(ids:'all'|string)=>erase(shell,ids),maintain:()=>runMaintenance(shell),
    deleteForever:(id:string)=>deleteForever(shell,id),forget:()=>{refused=null;}};
  }
  return api;
 };
 p.componentDidMount=function(...args:unknown[]){
  const result=originalMount?.apply(this,args);
  // Startup purge, once saved Notes are open. Restarts simply repeat it.
  void Promise.resolve(this.notesReady).then(()=>{if(this.live&&!this.notesStorageFailed)return runMaintenance(this);}).catch(()=>{});
  this.notesTrashChanged=()=>{if(this.live)void load(this);};
  window.addEventListener('alpha:notes-trash-changed',this.notesTrashChanged);
  this.notesTrashSchedule=scheduleMaintenance(this);
  return result;
 };
 p.componentWillUnmount=function(...args:unknown[]){
  window.removeEventListener('alpha:notes-trash-changed',this.notesTrashChanged);
  this.notesTrashSchedule?.();this.notesTrashSchedule=undefined;
  return originalUnmount?.apply(this,args);
 };

 notes.back=(state:Bag,api:Bag)=>{
  if(state.trashFull){(api.notesTrash as Bag|undefined)?.forget();api.set({trashFull:null});return true;}
  if(state.trashConfirm){api.set({trashConfirm:null});return true;}
  if(state.trashOpen){api.set({trashOpen:false});return true;}
  return back(state,api);
 };
 notes.render=(state:Bag,api:Bag)=>{
  const view=render(state,api),trash=api.notesTrash as Bag|undefined;
  view.trashAvailable=!!trash;view.trashCanErase=true;view.trashRetentionText='Deleted notes stay here for 3 days, then they are deleted permanently.';
  if(!trash)return view;
  // Notes opened: purge due entries. Navigation resets this flag, so every open checks again.
  if(!state.trashChecked){queueMicrotask(()=>{api.set({trashChecked:true});void trash.maintain();});}
  const rows:NotesTrashEntry[]=state.trash||[],now=Date.now(),disabled=!!state.trashBusy;
  view.openTrash=()=>{trash.forget();api.set({trashOpen:true,open:null,sheet:null,q:null,trashConfirm:null,trashFull:null});void trash.maintain();};
  view.closeTrash=()=>api.set({trashOpen:false,trashConfirm:null});
  view.trashOpen=!!state.trashOpen;
  view.trashLabel=rows.length?`Trash, ${rows.length} item${rows.length===1?'':'s'}`:'Trash';
  view.trashRows=rows.map(entry=>{
   const title=entry.note.title||kindLabel[entry.note.kind]||'Untitled';
   return {id:entry.id,title,kind:kindLabel[entry.note.kind]||'Note',left:notesTrashDaysLabel(entry,now),
    restoreLabel:`Restore ${title}`,deleteLabel:`Delete ${title} forever`,disabled,
    restore:()=>void trash.restore(entry.id),
    erase:()=>api.set({trashConfirm:{id:entry.id,title}})};
  });
  view.trashNone=!rows.length;
  view.trashError=state.trashError||'';
  view.trashEmptyDisabled=disabled||!rows.length;
  view.trashBusy=disabled;
  view.emptyTrash=()=>api.set({trashConfirm:{id:'all'}});
  const confirm=state.trashConfirm as Bag|null;
  // Full Trash: the refused note stays open and saved until one of three explicit choices.
  const full=(state.trashFull as Bag|null)&&(state.list||[]).some((n:Bag)=>n.id===state.trashFull.id&&n.id===state.open)?state.trashFull as Bag:null;
  if(state.trashFull&&!full)queueMicrotask(()=>{trash.forget();api.set({trashFull:null});});
  view.trashFullOpen=!!full;
  view.trashConfirmOpen=!!full||(!!confirm&&!!state.trashOpen);
  view.trashConfirmTitle=full?'Trash is full':confirm?.id==='all'?'Empty Trash?':'Delete forever?';
  view.trashConfirmText=full?`“${full.title}” was not deleted because Trash has no room for a restorable copy. Empty Trash to make room, or delete this ${full.voice?'voice note and its recording':'note'} permanently now. Permanent deletion skips Trash and cannot be undone.`
   :confirm?.id==='all'?`${rows.length} item${rows.length===1?'':'s'} will be deleted permanently. This cannot be undone.`:`“${confirm?.title||'This note'}” will be deleted permanently. This cannot be undone.`;
  view.trashConfirmLabel=full?'Delete forever without Trash':confirm?.id==='all'?'Confirm empty Trash':'Confirm delete forever';
  view.trashConfirmText2=confirm?.id==='all'&&!full?'Empty Trash':'Delete forever';
  view.trashCancel=()=>{if(full)trash.forget();api.set({trashConfirm:null,trashFull:null});};
  view.trashFullReview=()=>view.openTrash();
  view.trashConfirmGo=()=>{
   if(full){
    // A voice note is erased together with its recording by the reviewed voice path.
    if(full.voice){const hook=api.deleteVoiceNoteForever;if(typeof hook==='function')void hook(full.id);else api.toast('Permanent voice deletion is unavailable. Nothing was deleted.');}
    else void trash.deleteForever(full.id);
    return;
   }
   if(confirm)void trash.erase(confirm.id);
  };
  return view;
 };
}
