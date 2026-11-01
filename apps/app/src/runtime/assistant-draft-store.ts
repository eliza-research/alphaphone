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
 * The earlier copy of a composer draft that a send replaced (agent-adapter.ts), kept until the
 * person restores or dismisses it. It is one more row of this same storage, under the binding
 * `["earlier-draft",<composer binding>]`: the same `assistant-draft:v1:` + SHA-256 slot format,
 * Android secure slot and browser document as every draft, scoped to the same owner, agent and
 * conversation. Rows are validated against their binding, so it is never read as any composer's
 * draft. Restoring or dismissing it leaves a revisioned empty row, like a cleared draft.
 */
export interface EarlierDraft {binding:string;text:string;record:DurableDraft|null}
const earlierDraftStore=(binding:string)=>assistantDraftStore(JSON.stringify(['earlier-draft',binding]));

export async function readEarlierDraft(binding:string):Promise<EarlierDraft>{
 const record=await(await earlierDraftStore(binding)).read();
 return {binding,text:record?.text??'',record};
}

/**
 * Save `text` as the binding's earlier copy before anything replaces it. A copy not yet restored
 * or dismissed is kept first (newer text follows it, as when a send is not dispatched). Throws
 * when nothing was saved.
 */
export async function keepEarlierDraft(binding:string,text:string):Promise<EarlierDraft>{
 const store=await earlierDraftStore(binding);
 for(let attempt=0;;attempt++){
  const record=await store.read(),kept=record?.text??'',next=!kept.trim()||kept===text?text:kept+'\n'+text;
  try{return {binding,text:next,record:await store.save(record,next)};}
  // Another window wrote it since the read: read it again rather than replace it.
  catch(error){if(attempt>=2||!(error instanceof Error)||error.name!=='DurableDraftConflict')throw error;}
 }
}

/** Clear exactly the copy `earlier` read or saved; refused when another window changed it since. */
export async function clearEarlierDraft(earlier:EarlierDraft):Promise<void>{
 await(await earlierDraftStore(earlier.binding)).save(earlier.record,'');
}
