/** Installed-data adapter for the common App's Notes host option. No renderer,
 * session owner, migration, credential store or recording controller is started. */
import {Capacitor} from '@capacitor/core';
import {createDeviceNotesClient,type DeviceNotesHost} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-device-client.ts';
import {createNotesDraftSlot} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-draft.ts';
import type {NotesTarget} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-contract.ts';
import type {NotesViewHost} from '../../../../.eliza/client-features/plugins/plugin-notes/src/host.ts';
import type {NotesWorkspacePorts} from '../../../../.eliza/client-features/plugins/plugin-notes/src/workspace.ts';
import {openExistingBrowserNotes,openExistingDeviceNotes} from '../prototype/legacy-notes-access';
import {browserNotesPort} from '../runtime/browser-notes-document';
import {secureConnectionStore} from '../runtime/native-connection';
import {SECURE_NOTES_DRAFT_SLOT} from '../runtime/notes-secure-store';

export interface AlphaInstalledNotesHost {
 /** Existing application/view authority, not an additional registry. */
 key:string;
 current():boolean;
 /** Bind the existing shared Trash/recording effects; no in-memory fallback. */
 trash:NonNullable<DeviceNotesHost['trash']>;
 ports:NotesWorkspacePorts;
 selected(target:NotesTarget|undefined):void;
 failed(cause:unknown):void;
}
export function createAlphaInstalledNotesHost(owner:AlphaInstalledNotesHost):NotesViewHost {
 const android=Capacitor.getPlatform()==='android';
 const client=createDeviceNotesClient({
  current:()=>owner.current(),
  open:signal=>android?openExistingDeviceNotes(secureConnectionStore,localStorage,signal,()=>owner.current()):openExistingBrowserNotes(browserNotesPort,signal,()=>owner.current()),
  commit:async(store,list,signal,authorized)=>{await store.replace(list,{signal,authorized});},
  ...(android?{drafts:createNotesDraftSlot(secureConnectionStore,SECURE_NOTES_DRAFT_SLOT)}:{}),
  trash:owner.trash,
  draftFailed:error=>owner.failed(error),
 });
 let selection=0;
 return {sources:[{
  id:'device',label:'Previous notes',storage:'device',client,binding:{key:owner.key,current:()=>owner.current()},ports:owner.ports,
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
