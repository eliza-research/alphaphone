import {anyAbortSignal} from '../runtime/abort-signal';
/** Canonical Notes view lifecycle only: no local persistence or parallel Notes codec. */
import {createNotesClient,type NotesInteractResult} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-api.ts';
import type {NotesSnapshot} from '../../../../.eliza/client-features/plugins/plugin-notes/src/types.ts';
import type {AppRecordPort} from '../runtime/app-record-route-policy';
export const CANONICAL_NOTES_INVALIDATED_EVENT='alpha:canonical-notes-invalidated';
export type NotesPhase='loading'|'ready'|'saving'|'review'|'retired';
export interface CanonicalNotesViewHooks {
 snapshot(snapshot:NotesSnapshot,reason:'read'|'interact'):void;
 phase(phase:NotesPhase):void;
}
const binding=(port:AppRecordPort)=>JSON.stringify([port.sessionId,port.scope??null,port.identity.ownerId,port.identity.agentId,port.identity.sessionId,port.identity.origin]);
export class CanonicalNotesController {
 private readonly lifetime=new AbortController();
 private readonly identity:string;
 private readonly notes:ReturnType<typeof createNotesClient>;
 private snapshotValue:NotesSnapshot|null=null;
 private read:Promise<NotesSnapshot>|null=null;
 private writing=false;
 private readAbort:AbortController|null=null;
 private invalidated=false;
 private eventTarget:EventTarget|null=null;
 private readonly changed=(event:Event)=>{
  const detail=(event as CustomEvent<{sessionId?:unknown;revision?:unknown}>).detail;
  if(!detail||detail.sessionId!==this.port.sessionId)return;
  this.invalidate(typeof detail.revision==='number'&&Number.isSafeInteger(detail.revision)&&detail.revision>=0?detail.revision:undefined);
 };
 constructor(private readonly port:AppRecordPort,private readonly hooks:CanonicalNotesViewHooks){
  this.identity=binding(port);
  // Adapt the existing canonical client's fetch contract to Root's admitted
  // resident port. JSON parsing here is transport framing, never a domain codec.
  this.notes=createNotesClient({fetch:async<T>(path:string,options:RequestInit={}):Promise<T>=>{
   const signal=anyAbortSignal([this.lifetime.signal,...(options.signal?[options.signal]:[])]);
   this.assertCurrent(signal);
   const method=options.method??'GET';
   if(method!=='GET'&&method!=='POST')throw Error('Unsupported Notes transport method.');
   if(options.body!==undefined&&typeof options.body!=='string')throw Error('Unsupported Notes request framing.');
   const body=options.body===undefined?undefined:JSON.parse(options.body);
   const value=await this.port.request(path,method,body,signal);
   this.assertCurrent(signal);return value as T;
  }});
 }
 private assertCurrent(signal:AbortSignal=this.lifetime.signal):void{
  signal.throwIfAborted();
  if(!this.port.current()||binding(this.port)!==this.identity)throw new DOMException('The Notes connection changed.','AbortError');
 }
 get snapshot():NotesSnapshot|null{return this.current&&this.snapshotValue?structuredClone(this.snapshotValue):null;}
 get revision():number|null{return this.current?this.snapshotValue?.revision??null:null;}
 hasViewNote(id:string):boolean{return this.current&&!!this.snapshotValue?.notes.some(note=>note.id===id);}
 viewNote(id:string){const note=this.current?this.snapshotValue?.notes.find(note=>note.id===id):undefined;return note?structuredClone(note):undefined;}
 get pending():boolean{return this.writing;}
 get current():boolean{try{this.assertCurrent();return true;}catch{return false;}}
 private publish(value:NotesSnapshot,reason:'read'|'interact'):void{
  this.assertCurrent();
  if(this.snapshotValue&&value.revision<this.snapshotValue.revision)throw Error('The Notes response is older than the current collection.');
  this.snapshotValue=structuredClone(value);this.hooks.snapshot(structuredClone(value),reason);
 }
 /** One initial/reload/resume read. Multiple in-flight invalidations coalesce. */
 async refresh():Promise<NotesSnapshot>{
  this.assertCurrent();
  if(this.writing){this.invalidated=true;throw Error('Wait for the current Notes operation.');}
  if(this.read)return this.read;
  this.invalidated=false;this.hooks.phase('loading');
  const abort=new AbortController();this.readAbort=abort;
  const pending=this.notes.readState(anyAbortSignal([this.lifetime.signal,abort.signal])).then(value=>{this.publish(value,'read');this.hooks.phase('ready');return structuredClone(value);}).catch(error=>{if(this.current&&!abort.signal.aborted)this.hooks.phase('review');throw error;});
  this.read=pending;
  try{return await pending;}finally{
   if(this.read===pending){this.read=null;this.readAbort=null;}
   if(this.invalidated&&this.current&&!this.writing){this.invalidated=false;void this.refresh().catch(()=>{});}
  }
 }
 /** Authenticated same-session event payloads contain only revision/mutation.
  * A same/older revision already returned by our mutation needs no extra GET. */
 invalidate(revision?:number):void{
  if(!this.current)return;
  if(revision!==undefined&&this.snapshotValue&&Number.isSafeInteger(revision)&&revision<=this.snapshotValue.revision)return;
  if(this.read||this.writing){this.invalidated=true;return;}
  void this.refresh().catch(()=>{});
 }
 /** Explicit UI command; parameters and all domain validation stay canonical.
  * Never infer a newly created identity by diffing the returned collection. */
 async interact(capability:string,params?:Record<string,unknown>):Promise<NotesInteractResult>{
  this.assertCurrent();
  if(this.writing)throw Error('A Notes operation is already pending.');
  this.writing=true;
  if(this.readAbort){this.readAbort.abort();this.readAbort=null;this.read=null;this.invalidated=true;}
  this.hooks.phase('saving');
  try{
   const result=await this.notes.interact(capability,params,this.lifetime.signal);
   this.assertCurrent();this.publish(result.state,'interact');this.hooks.phase('ready');return result;
  }catch(error){if(this.current)this.hooks.phase('review');throw error;}
  finally{
   this.writing=false;
   if(this.invalidated&&this.current){this.invalidated=false;void this.refresh().catch(()=>{});}
  }
 }
 /** Root forwards canonical note events; no timer/polling or legacy store event. */
 listen(target:EventTarget):void{
  this.unlisten();this.assertCurrent();this.eventTarget=target;target.addEventListener(CANONICAL_NOTES_INVALIDATED_EVENT,this.changed);
 }
 private unlisten():void{this.eventTarget?.removeEventListener(CANONICAL_NOTES_INVALIDATED_EVENT,this.changed);this.eventTarget=null;}
 retire():void{if(this.lifetime.signal.aborted)return;this.unlisten();this.invalidated=false;this.lifetime.abort();this.snapshotValue=null;this.hooks.phase('retired');}
}
