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
 * validated against their binding, so none is ever read as any composer's draft. They are offered
 * in row order, and a new copy follows the last row that still holds one, so the oldest copy is
 * always offered first. Restoring or dismissing one leaves a revisioned empty row, like a cleared
 * draft, which is reused once no later row holds a copy; the rows end at the first one never written.
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
 * Save `text` as the binding's newest earlier copy before anything replaces it. It follows the last
 * copy not yet restored or dismissed in the same row (as when a send is not dispatched), or takes the
 * next row when that would be over the draft size limit or the row is unreadable. A copy already kept
 * last is not kept again, so a move tried again after its removal failed never doubles it. Throws
 * only when storage failed and nothing was saved.
 */
export async function keepEarlierDraft(binding:string,text:string):Promise<EarlierDraft>{
 for(let attempt=0;;attempt++){
  let slot=0;
  for(let row=0;;row++){const record=await readEarlierRow(await earlierDraftStore(binding,row));if(record===null)break;if(record?.text.trim())slot=row;}
  for(;;slot++){
   const store=await earlierDraftStore(binding,slot),record=await readEarlierRow(store);
   if(record===undefined)continue;
   const kept=record?.text??'',empty=!kept.trim(),next=empty?text:kept+'\n'+text;
   if(kept===text||kept.endsWith('\n'+text))return {binding,slot,text:kept,record};
   try{return {binding,slot,text:next,record:await store.save(record,next)};}
   catch(error){
    const name=error instanceof Error?error.name:'';
    if(name==='DurableDraftTooLarge'&&!empty)continue;
    // Another window wrote it since the read: read the rows again rather than replace it.
    if(attempt>=2||name!=='DurableDraftConflict')throw error;
    break;
   }
  }
 }
}

/**
 * Remove `earlier`, an offered copy now restored, dismissed or moved, from the front of its row. A
 * copy another window kept behind it since it was read stays, and is offered next; a row that no
 * longer begins with it (another window restored or dismissed it) is left as it is. Each attempt
 * compares and exchanges against a fresh read. Throws when storage failed or other windows kept
 * changing the row, which then still holds `earlier`.
 */
export async function settleEarlierDraft(earlier:EarlierDraft):Promise<void>{
 const store=await earlierDraftStore(earlier.binding,earlier.slot);
 for(let attempt=0;;attempt++){
  const record=await readEarlierRow(store),kept=record?.text??'';
  const rest=kept===earlier.text?'':kept.startsWith(earlier.text+'\n')?kept.slice(earlier.text.length+1):undefined;
  if(!record||rest===undefined)return;
  try{await store.save(record,rest);return;}
  catch(error){if(attempt>=3||!(error instanceof Error&&error.name==='DurableDraftConflict'))throw error;}
 }
}
