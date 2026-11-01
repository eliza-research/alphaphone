import {nativeAssistantDraftRecovery} from './native-assistant-draft-recovery';
import {Capacitor} from '@capacitor/core';
import {secureConnectionStore} from './native-connection';
import {compareExchangeDraftStore,emptyDurableDraft,transactionalDraftStore,type DurableDraft} from '../../../../.eliza/client-features/packages/ui/src/state/durable-draft.ts';
import type {DomainRecovery} from '../browser/domain-document';

/**
 * Alpha's installed draft storage over the shared durable draft stores. The slot name
 * (`assistant-draft:v1:` + SHA-256 of the binding), the Android secure slot and the browser
 * document key under `alpha.browser.` are installed-data identifiers and stay unchanged.
 */
export async function assistantDraftStore(binding:string){
 if(!binding||binding.length>4096)throw Error('Invalid assistant draft identity.');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(binding))),n=>n.toString(16).padStart(2,'0')).join('');
 const slot='assistant-draft:v1:'+hash;
 if(Capacitor.getPlatform()==='android'){
  const raw={read:()=>secureConnectionStore.readRaw(slot),compareExchange:(expected:string|null,value:string)=>secureConnectionStore.compareExchangeRaw(slot,expected,value)};
  return compareExchangeDraftStore(binding,raw,{recovery:nativeAssistantDraftRecovery(binding,raw)});
 }
 const domain=new (await import('../browser/json-domain-document')).BrowserJsonDomainDocument('alpha.browser.'+slot);
 return transactionalDraftStore(binding,domain,{recovery:{
  capture:(signal?:AbortSignal)=>domain.capture(signal),
  reset:async(expected:DomainRecovery,signal?:AbortSignal)=>{await domain.restore(expected,JSON.stringify({raw:JSON.stringify(emptyDurableDraft(binding))}),signal);},
 }});
}

/**
 * The earlier copies of a composer draft that sends replaced (agent-adapter.ts), each kept until the
 * person restores or dismisses it. They are more rows of this same storage: the same
 * `assistant-draft:v1:` + SHA-256 slot format, Android secure slot and browser document as every
 * draft, scoped to the same owner, agent and conversation. Row 0 has the binding
 * `["earlier-draft",<composer binding>]` and row n `["earlier-draft",<composer binding>,n]`. Rows are
 * validated against their binding, so none is ever read as any composer's draft. Restoring or
 * dismissing one leaves a revisioned empty row, like a cleared draft, which a later copy reuses; the
 * rows end at the first one never written.
 */
export interface EarlierDraft {binding:string;slot:number;text:string;record:DurableDraft|null}
const earlierDraftStore=(binding:string,slot:number)=>assistantDraftStore(JSON.stringify(slot?['earlier-draft',binding,slot]:['earlier-draft',binding]));

/**
 * One row, or undefined when it holds bytes that do not read as a draft: those are left exactly as
 * they are (never offered, never overwritten) and the copies continue in the next row. A storage
 * failure throws.
 */
async function readEarlierRow(store:Awaited<ReturnType<typeof assistantDraftStore>>):Promise<DurableDraft|null|undefined>{
 try{return await store.read();}
 catch(error){
  let raw:string|null=null;try{raw=(await store.recovery?.capture())?.raw??null;}catch{/* The storage itself failed. */}
  if(raw===null)throw error;
  return undefined;
 }
}

/** The binding's first earlier copy still kept, or an empty one when there is none. */
export async function readEarlierDraft(binding:string):Promise<EarlierDraft>{
 for(let slot=0;;slot++){
  const record=await readEarlierRow(await earlierDraftStore(binding,slot));
  if(record===null||record?.text.trim())return {binding,slot,text:record?.text??'',record};
 }
}

/**
 * Save `text` as one of the binding's earlier copies before anything replaces it. It follows a copy
 * not yet restored or dismissed in the same row (as when a send is not dispatched), or takes the
 * next row when that would be over the draft size limit or the row is unreadable. Throws only when
 * storage failed and nothing was saved.
 */
export async function keepEarlierDraft(binding:string,text:string):Promise<EarlierDraft>{
 for(let slot=0;;slot++){
  const store=await earlierDraftStore(binding,slot);
  for(let attempt=0;;attempt++){
   const record=await readEarlierRow(store);
   if(record===undefined)break;
   const kept=record?.text??'',empty=!kept.trim(),next=empty||kept===text?text:kept+'\n'+text;
   try{return {binding,slot,text:next,record:await store.save(record,next)};}
   catch(error){
    const name=error instanceof Error?error.name:'';
    if(name==='DurableDraftTooLarge'&&!empty)break;
    // Another window wrote it since the read: read it again rather than replace it.
    if(attempt>=2||name!=='DurableDraftConflict')throw error;
   }
  }
 }
}

/** Clear exactly the copy `earlier` read or saved; refused when another window changed it since. */
export async function clearEarlierDraft(earlier:EarlierDraft):Promise<void>{
 await(await earlierDraftStore(earlier.binding,earlier.slot)).save(earlier.record,'');
}
