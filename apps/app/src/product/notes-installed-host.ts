/** Installed-data adapter for the common App's Notes host option. No renderer,
 * session owner, migration, credential store or recording controller is started. */
import {Capacitor} from '@capacitor/core';
import {createDeviceNotesClient,type DeviceNotesCollection} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-device-client.ts';
import {createNotesDraftSlot} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-draft.ts';
import type {NotesTarget} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-contract.ts';
import type {NotesViewHost} from '../../../../.eliza/client-features/plugins/plugin-notes/src/host.ts';
import type {NotesWorkspacePorts} from '../../../../.eliza/client-features/plugins/plugin-notes/src/workspace.ts';
import {openExistingBrowserNotes,openExistingDeviceNotes} from '../prototype/legacy-notes-access';
import {browserNotesPort} from '../runtime/browser-notes-document';
import {secureConnectionStore} from '../runtime/native-connection';
import {SECURE_NOTES_DRAFT_SLOT} from '../runtime/notes-secure-store';
import {createNotesTrashActions,type NotesTrashCollection} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-trash-actions.ts';
import {isNotesTrashFull,type NotesTrashEntry} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-trash-policy.ts';
import type {NoteRecord} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-store.ts';
import type {NotesRecordingEffects} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-recording-effects.ts';
import type {NotesRecordingDeletion} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-recording-deletion.ts';
import {pendingAudioDeletions} from '../runtime/note-audio-deletions';
import {notesTrashPolicy} from '../runtime/notes-trash-policy';
import {editNotesTrash,readNotesTrash,savedNotes,withNotesDeletionLock} from '../runtime/notes-trash';
export type AlphaInstalledNotesCollection = Awaited<ReturnType<typeof openExistingDeviceNotes>> | Awaited<ReturnType<typeof openExistingBrowserNotes>>;

export interface AlphaInstalledNotesHost {
 /** Existing application/view authority, not an additional registry. */
 key:string;
 current():boolean;
 foreground():boolean;
 /** The same shared recording-effects instance and claims used by native recovery. */
 recordings():{effects:NotesRecordingEffects;check():Promise<void>;started(row:NotesRecordingDeletion):void;retired(row:NotesRecordingDeletion):void};
 opened?(collection:AlphaInstalledNotesCollection):void;
 ports:NotesWorkspacePorts;
 selected(target:NotesTarget|undefined):void;
 failed(cause:unknown):void;
}
export function createAlphaInstalledNotesHost(owner:AlphaInstalledNotesHost):NotesViewHost {
 const android=Capacitor.getPlatform()==='android';
 let opened:AlphaInstalledNotesCollection|undefined;
 const committed=()=>window.dispatchEvent(new Event('alpha:notes-committed'));
 const guarded=(signal:AbortSignal,check:()=>void)=>()=>{signal.throwIfAborted();check();if(!owner.foreground())throw new DOMException('Notes is no longer active.','AbortError');};
 const collectionFor=(collection:DeviceNotesCollection,signal:AbortSignal,check:()=>void):NotesTrashCollection<NoteRecord>=>({
  ready:()=>!signal.aborted&&owner.current(),stored:()=>collection.list,visible:()=>collection.list,
  commit:async records=>{await collection.replace(records,{signal,authorized:check});committed();return true;},
 });
 const actionsFor=(signal:AbortSignal,check:()=>void)=>createNotesTrashActions<NoteRecord,NotesTarget>({
  policy:notesTrashPolicy,read:readNotesTrash,edit:change=>{check();return editNotesTrash(doc=>{check();return change(doc);});},
  savedNotes:async()=>await savedNotes() as NoteRecord[],
  withLock:work=>withNotesDeletionLock(async()=>{check();return work();},signal),
  ownsContent:note=>!!note.audio,purge:entry=>owner.recordings().effects.purgeTrashed(entry),
 });
 async function deleteRecording(collection:DeviceNotesCollection,note:NoteRecord,permanent:boolean,signal:AbortSignal,check:()=>void){
  const current=guarded(signal,check);current();
  try{return await withNotesDeletionLock(async()=>{
   current();if(opened!==collection)throw Error('The Notes collection changed.');
   const recording=owner.recordings(),target=await collection.target(note.id);
   const audio=note.audio as {audioId?:unknown}|undefined;
   if(typeof audio?.audioId!=='string')throw Error('The recording identity is unavailable.');
   const index=collection.list.findIndex(value=>value.id===note.id);
   const row=await recording.effects.deleteReviewed({
    row:{id:crypto.randomUUID(),target,note,audioId:audio.audioId,...(permanent?{permanent:true as const}:{})},assertCurrent:current,started:recording.started,
    addTrash:async value=>{await editNotesTrash(doc=>{current();return notesTrashPolicy.add(doc,{id:value.id,note:value.note,target:value.target,index,deletedAt:Date.now(),audio:{audioId:value.audioId}});});},
    removeStaleTrash:async value=>{const ids=(await readNotesTrash()).entries.filter(entry=>entry.note.id===value.note.id).map(entry=>entry.id);await editNotesTrash(doc=>{current();return notesTrashPolicy.remove(doc,ids);});},
    commitNote:async(value,authorized)=>{if(opened!==collection)throw Error('The Notes collection changed.');await opened.execute({type:'notes_delete',target:value.target},value.id,signal,authorized);},
   });
   recording.retired(row);committed();return true;
  },signal);}catch(error){if(!permanent&&isNotesTrashFull(error))return {status:'full' as const};throw error;}
 }
 async function restoreRecording(collection:DeviceNotesCollection,row:NotesRecordingDeletion,signal:AbortSignal,check:()=>void,entry?:NotesTrashEntry<NoteRecord,NotesTarget>){
  const current=guarded(signal,check);current();
  await withNotesDeletionLock(async()=>{
   await owner.recordings().effects.restoreReviewed({row,assertCurrent:current,
    checkRetention:async()=>{const saved=(await readNotesTrash()).entries.find(value=>value.id===row.id);if(entry&&JSON.stringify(saved)!==JSON.stringify(entry)||saved&&notesTrashPolicy.expired(saved,Date.now()))throw Error('The reviewed Trash changed or expired.');},
    commitNote:async(value,authorized)=>{const next=collection.list.slice();if(next.some(note=>note.id===value.note.id))throw Error('A newer note must be kept.');next.splice(Math.min(Math.max(0,entry?.index??0),next.length),0,structuredClone(value.note));await collection.replace(next,{signal,authorized});},
    removeTrash:async(value,authorized)=>{await editNotesTrash(doc=>{authorized();return notesTrashPolicy.remove(doc,[value.id]);});},
   });
  },signal);committed();
 }
 const client=createDeviceNotesClient({
  current:()=>owner.current(),
  open:async signal=>{const value=android?await openExistingDeviceNotes(secureConnectionStore,localStorage,signal,()=>owner.current()):await openExistingBrowserNotes(browserNotesPort,signal,()=>owner.current());signal.throwIfAborted();if(!owner.current())throw new DOMException('Notes source changed.','AbortError');opened=value;owner.opened?.(value);return value;},
  commit:async(store,list,signal,authorized)=>{await store.replace(list,{signal,authorized});committed();},
  ...(android?{drafts:createNotesDraftSlot(secureConnectionStore,SECURE_NOTES_DRAFT_SLOT)}:{}),
  trash:{
   read:async()=>(await readNotesTrash()).entries as NotesTrashEntry<NoteRecord,NotesTarget>[],
   remove:(collection,note,signal,check)=>note.audio?deleteRecording(collection,note,false,signal,check):actionsFor(signal,check).moveToTrash(collectionFor(collection,signal,check),note,collection.list.findIndex(value=>value.id===note.id),()=>collection.target(note.id)),
   restore:async(collection,entry,signal,check)=>{
    if(!entry.audio)return ['restored','live'].includes(await actionsFor(signal,check).restore(collectionFor(collection,signal,check),entry.id,entry));
    if(!entry.target)throw Error('The recording target is unavailable.');
    await restoreRecording(collection,{id:entry.id,note:entry.note,target:entry.target,audioId:entry.audio.audioId},signal,check,entry);return true;
   },
   erase:(ids,expected,signal,check)=>actionsFor(signal,check).erase(ids,expected),
   deleteForever:async(collection,note,signal,check)=>note.audio?(await deleteRecording(collection,note,true,signal,check)===true?'deleted':'unconfirmed'):actionsFor(signal,check).deleteForever(collectionFor(collection,signal,check),note.id,JSON.stringify(note)),
  },
  draftFailed:error=>owner.failed(error),
 });
 let selection=0;
 return {sources:[{
  id:'device',label:'Previous notes',storage:'device',client,binding:{key:owner.key,current:()=>owner.current()},ports:{...owner.ports,recordingRecovery:{
   read:async signal=>{signal.throwIfAborted();const rows=await pendingAudioDeletions();signal.throwIfAborted();return Object.values(rows);},
   check:async signal=>{signal.throwIfAborted();if(!owner.current()||!owner.foreground())throw Error('Open Notes to check recording status.');await owner.recordings().check();signal.throwIfAborted();},
   restore:async(row,signal)=>{if(!opened)throw Error('Open the installed Notes source first.');await restoreRecording(opened,row,signal,()=>{if(!owner.current())throw new DOMException('Notes source changed.','AbortError');});},
  }},
  events:{subscribeInvalidation(listener){
   const changed=()=>{if(owner.current())listener();};
   const visible=()=>{if(document.visibilityState==='visible')changed();};
   window.addEventListener('alpha:notes-committed',changed);
   window.addEventListener('alpha:notes-trash-changed',changed);
   document.addEventListener('visibilitychange',visible);
   return ()=>{window.removeEventListener('alpha:notes-committed',changed);window.removeEventListener('alpha:notes-trash-changed',changed);document.removeEventListener('visibilitychange',visible);};
  }},
  onSelectionChange(value){
   const generation=++selection;
   if(!owner.current())return;
   owner.selected(undefined);
   if(!value)return;
   void client.target(value.id).then(target=>{if(generation===selection&&owner.current())owner.selected(target);},error=>{if(generation===selection&&owner.current())owner.failed(error);});
  },
  onOperationError:error=>{if(owner.current())owner.failed(error);},
 }]};
}
