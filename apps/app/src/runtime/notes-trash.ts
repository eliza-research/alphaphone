import {Capacitor} from '@capacitor/core';
import type {BrowserJsonDomainDocument} from '../browser/json-domain-document';
import {secureConnectionStore} from './native-connection';
import {SECURE_NOTES_SLOT} from './notes-secure-store';
import {validateNotesTrash,type NotesTrashDocument} from './notes-trash-policy';
export * from './notes-trash-policy';

/**
 * Product-owned durable Trash for deleted Notes content. The shared Notes store keeps only
 * content-free tombstones, so the restorable copy lives beside it: in the Keystore-backed
 * no-backup credential slot on Android and in a browser document on the web build.
 */
export const NOTES_TRASH_SLOT='notes-trash:v1:device';
export const browserNotesTrashKey='alpha.browser.notes-trash.v1';
const android=()=>Capacitor.getPlatform()==='android';
let document:Promise<BrowserJsonDomainDocument>|undefined;
function browserTrash(){return document??=import('../browser/json-domain-document').then(({BrowserJsonDomainDocument})=>new BrowserJsonDomainDocument(browserNotesTrashKey));}

/**
 * Trash writes share the Notes deletion-effects lock with voice deletion, so a write-ahead
 * Trash row and the deletion commit it describes are never interleaved with maintenance,
 * restore or purge in another same-origin view. Callers of editNotesTrash hold it.
 */
export {withAudioDeletionLock as withNotesDeletionLock} from './note-audio-lock';

export async function readNotesTrash():Promise<NotesTrashDocument>{
 return validateNotesTrash(android()?await secureConnectionStore.read<NotesTrashDocument>(NOTES_TRASH_SLOT):await(await browserTrash()).readJson<NotesTrashDocument>());
}
/** Compare-and-exchange edit with readback. Callers hold the Trash lock. */
export async function editNotesTrash(update:(current:NotesTrashDocument)=>NotesTrashDocument):Promise<NotesTrashDocument>{
 let written:NotesTrashDocument|undefined;
 if(android()){
  const raw=await secureConnectionStore.read<NotesTrashDocument>(NOTES_TRASH_SLOT);written=validateNotesTrash(update(validateNotesTrash(raw)));
  if((await secureConnectionStore.compareExchange(NOTES_TRASH_SLOT,raw,written)).status!=='saved')throw Error('Notes Trash changed');
 }else await(await browserTrash()).editJson<NotesTrashDocument>(raw=>written=validateNotesTrash(update(validateNotesTrash(raw))));
 if(JSON.stringify(await readNotesTrash())!==JSON.stringify(written))throw Error('Notes Trash persistence unconfirmed');
 return written!;
}

/** Saved note records read from authoritative storage, never from an optimistic editor list. */
export async function savedNotes():Promise<Array<{id:string;audio?:{audioId?:string}}>>{
 const raw=android()?(await secureConnectionStore.read<{currentRaw:string}>(SECURE_NOTES_SLOT))?.currentRaw:await(await import('./browser-notes-document')).readBrowserNotesRaw();
 if(typeof raw!=='string')throw Error('Notes readback unavailable');
 const records=JSON.parse(raw)?.records;
 if(!Array.isArray(records))throw Error('Notes readback unavailable');
 return records;
}
export async function savedNoteIds():Promise<Set<string>>{return new Set((await savedNotes()).map(n=>n.id));}

