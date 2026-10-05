import {DocumentNotesStore,NotesDocumentConflict,type NotesDocumentPort,type NotesDocumentSnapshot} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-document-store.ts';
import {browserDocuments} from './documents';
import type {DomainRecovery} from './domain-document';
import {NOTES_KEY,LEGACY_NOTES_KEY} from '../runtime/notes-store';
import {readLegacyDailyNotes} from '../runtime/notes-secure-store';

const key='alpha.browser.notes.v1',dailyKey='alphaphone:daily:v1';
type Sources={v2:string|null;v1:string|null;daily:string|null};
type Saved={version:1;revision:string;currentRaw:string|null;archive:Sources};
const sources=():Sources=>({v2:localStorage.getItem(NOTES_KEY),v1:localStorage.getItem(LEGACY_NOTES_KEY),daily:localStorage.getItem(dailyKey)});
// Daily receipts and preferences can change independently of the retired Notes source.
function dailyNotes(raw:string|null):string{
 if(raw===null)return 'missing';
 try{return JSON.stringify(['notes',JSON.parse(raw)?.notes]);}catch{return JSON.stringify(['invalid',raw]);}
}
function unchanged(actual:Sources,expected:Sources){
 if(actual.v2!==expected.v2||actual.v1!==expected.v1||dailyNotes(actual.daily)!==dailyNotes(expected.daily))throw Error('Older Notes changed. Close older tabs and review recovery before continuing.');
}
function decode(raw:string|null):Saved{
 const value=raw===null?null:JSON.parse(raw);
 if(!value||value.version!==1||typeof value.revision!=='string'||!value.revision||!Object.hasOwn(value,'currentRaw')||value.currentRaw!==null&&typeof value.currentRaw!=='string'||!value.archive||Object.keys(value.archive).length!==3||['v2','v1','daily'].some(k=>!Object.hasOwn(value.archive,k)||value.archive[k]!==null&&typeof value.archive[k]!=='string'))throw Error('Saved browser Notes need recovery.');
 return value;
}
const receipt=(saved:Saved):NotesDocumentSnapshot=>{
 if(saved.currentRaw===null)throw Error('Notes were reset. Reopen before editing.');
 return {revision:saved.revision,raw:saved.currentRaw};
};
/** Product source retention and recovery; shared clients own Notes and atomic persistence. */
export const browserNotesDocument:NotesDocumentPort & {capture(signal?:AbortSignal):Promise<DomainRecovery>;reset(expected:DomainRecovery,signal?:AbortSignal):Promise<void>}={
 async initialize(create,signal){
  const current=await browserDocuments.read(key,signal);
  if(current){const saved=decode(current.raw);unchanged(sources(),saved.archive);if(saved.currentRaw!==null)return receipt(saved);}
  return browserDocuments.edit(key,async before=>{
   const original=sources();let saved:Saved;
   if(before){saved=decode(before.raw);unchanged(original,saved.archive);if(saved.currentRaw===null)saved={...saved,currentRaw:create(null,null),revision:crypto.randomUUID()};}
   else {
    const legacy=original.v1??(original.v2===null?JSON.stringify(readLegacyDailyNotes({getItem:()=>original.daily})):null);
    saved={version:1,revision:crypto.randomUUID(),currentRaw:create(original.v2,legacy),archive:original};
   }
   unchanged(sources(),original);return {raw:JSON.stringify(saved),result:receipt(saved)};
  },signal);
 },
 async read(signal){
  const current=await browserDocuments.read(key,signal);if(!current)return null;
  const saved=decode(current.raw);unchanged(sources(),saved.archive);return saved.currentRaw===null?null:receipt(saved);
 },
 async compareExchange(expected,raw,signal){
  return browserDocuments.edit(key,async before=>{
   if(!before)throw new NotesDocumentConflict('Notes changed. Reopen before editing.');
   const saved=decode(before.raw);unchanged(sources(),saved.archive);
   if(saved.revision!==expected.revision||saved.currentRaw!==expected.raw)throw new NotesDocumentConflict('Notes changed in another view. Reopen before editing.');
   const next={...saved,currentRaw:raw,revision:crypto.randomUUID()};
   return {raw:JSON.stringify(next),result:receipt(next)};
  },signal);
 },
 async capture(signal){
  const snapshot=await browserDocuments.read(key,signal),original=sources(),legacy=JSON.stringify(original);
  if(!snapshot)return {snapshot,legacy,raw:Object.values(original).every(v=>v===null)?null:legacy,format:'domain',legacyChanged:false};
  try{const saved=decode(snapshot.raw);let legacyChanged=false;try{unchanged(original,saved.archive);}catch{legacyChanged=true;}return {snapshot,legacy,raw:snapshot.raw,format:'domain',legacyChanged};}
  catch{return {snapshot,legacy,raw:snapshot.raw,format:'unrecognized',legacyChanged:false};}
 },
 async reset(expected,signal){
  signal?.throwIfAborted();const archive=sources();unchanged(archive,JSON.parse(expected.legacy!));
  const saved:Saved={version:1,revision:crypto.randomUUID(),currentRaw:null,archive};
  await browserDocuments.compareExchange(key,expected.snapshot,JSON.stringify(saved),signal);
 },
};
export const openBrowserNotes=(signal?:AbortSignal)=>DocumentNotesStore.open(browserNotesDocument,[],signal);
