import {Capacitor} from '@capacitor/core';
import {BrowserJsonDomainDocument} from '../browser/json-domain-document';
import {browserNotesDocument} from '../browser/notes-document';
import {secureConnectionStore} from './native-connection';
import {NotesStore,NOTES_KEY,type NoteRecord} from './notes-store';
import {SECURE_NOTES_SLOT} from './notes-secure-store';
import {notesTarget,type NotesTarget} from './notes-contract';
export type AudioDeletion={id:string;target:NotesTarget;note:NoteRecord;audioId:string;audioRequested?:true};
const slot='notes-audio-deletions:v1:device',key='alpha.browser.notes-audio-deletions.v1';
type Pending=Record<string,AudioDeletion>;
export const audioDeletionDocument=new BrowserJsonDomainDocument(key);
const android=()=>Capacitor.getPlatform()==='android';
function validate(value:any):Pending {
 if(value===null)return {};
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>100||new TextEncoder().encode(JSON.stringify(value)).length>1024*1024)throw Error('Invalid audio deletion recovery store');
 for(const [id,row]of Object.entries(value) as [string,AudioDeletion][]){notesTarget(row.target);if(row.id!==id||!/^[-\w]{1,128}$/.test(id)||row.note.id!==row.target.noteId||row.note.kind!=='voice'||(row.note.audio as any)?.audioId!==row.audioId||(row.note.audio as any)?.noteId!==row.note.id||!row.audioId||(row.audioRequested!==undefined&&row.audioRequested!==true))throw Error('Invalid audio deletion binding');}
 return value;
}
async function read(){return android()?secureConnectionStore.read<Pending>(slot):audioDeletionDocument.readJson<Pending>();}
export async function pendingAudioDeletions(){
 const rows=validate(await read());
 for(const row of Object.values(rows)){
  const raw=JSON.stringify({version:2,collectionId:row.target.sourceId,records:[row.note],deleted:[]});
  const snapshot=new NotesStore({getItem:k=>k===NOTES_KEY?raw:null,setItem:()=>{throw Error('Read-only deletion snapshot');}});
  if(JSON.stringify(await snapshot.target(row.note.id))!==JSON.stringify(row.target))throw Error('Reviewed deletion snapshot changed');
 }
 return rows;
}
export async function changeAudioDeletion(row:AudioDeletion,create:boolean,updated?:AudioDeletion){
 const change=(raw:unknown)=>{const all=validate(raw),prior=all[row.id];
  if(create?(!!prior||Object.values(all).some(x=>x.note.id===row.note.id)):JSON.stringify(prior)!==JSON.stringify(row))throw Error('Audio deletion changed');
  const next={...all};if(create||updated)next[row.id]=updated||row;else delete next[row.id];return validate(next);};
 if(android()){const raw=await read();if((await secureConnectionStore.compareExchange(slot,raw,change(raw))).status!=='saved')throw Error('Audio deletion changed');}
 else await audioDeletionDocument.editJson(change);
 if(JSON.stringify((await pendingAudioDeletions())[row.id]||null)!==JSON.stringify(updated||(create?row:null)))throw Error('Audio deletion persistence unconfirmed');
}
/** Read authoritative storage, never an optimistic editor snapshot. No mutation/replay. */
export async function audioDeletionNoteState(row:AudioDeletion):Promise<'deleted'|'original'|'changed'>{
 const saved=android()?await secureConnectionStore.read<{currentRaw:string}>(SECURE_NOTES_SLOT):null;
 const raw=android()?saved?.currentRaw:(await browserNotesDocument.read())?.raw;if(typeof raw!=='string')throw Error('Notes readback unavailable');
 const store=new NotesStore({getItem:k=>k===NOTES_KEY?raw:null,setItem:()=>{throw Error('Read-only Notes recovery');}});
 const note=store.list.find(n=>n.id===row.note.id),envelope=JSON.parse(raw);
 if(!note&&store.list.some(n=>(n.audio as any)?.audioId===row.audioId))return 'changed';
 if(!note)return envelope.collectionId===row.target.sourceId&&envelope.deleted.some((d:any)=>d.id===row.note.id&&d.revision===row.target.revision&&d.operationId===row.id)?'deleted':'changed';
 return JSON.stringify(await store.target(row.note.id))===JSON.stringify(row.target)?'original':'changed';
}

/** Serialize app-owned deletion, restoration and reconciliation across same-origin views.
 * Missing coordination fails closed; storage CAS alone cannot fence audio effects. */
export async function withAudioDeletionLock<T>(work:()=>Promise<T>):Promise<T>{
 if(!navigator.locks?.request)throw Error('Safe audio recovery requires Web Locks');
 return navigator.locks.request('alpha.notes-audio-effects.v1',{mode:'exclusive'},work);
}
