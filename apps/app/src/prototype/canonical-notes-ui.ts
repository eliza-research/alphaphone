import {parseNoteFormat} from '../../../../.eliza/client-features/plugins/plugin-notes/src/note-format.ts';
/** Thin branded-view binding to canonical Notes commands and one editor draft. */
import type {StickyNote} from '../../../../.eliza/client-features/plugins/plugin-notes/src/types.ts';
import {projectNoteForModel} from '../../../../.eliza/client-features/plugins/plugin-notes/src/types.ts';
import type {AppRecordPort} from '../runtime/app-record-route-policy';
import {CanonicalNotesController,type NotesPhase} from './canonical-notes-controller';
import {CanonicalNotesEditor} from './canonical-notes-editor';
type Bag=Record<string,any>;
export class CanonicalNotesUi {
 readonly controller:CanonicalNotesController;
 readonly editor:CanonicalNotesEditor;
 private phase:NotesPhase='loading';
 private reviewPending=false;
 private baseRows:Bag[]=[];
 private rowsValue:Bag[]=[];
 private openValue:string|null=null;
 private blankCreationValue:string|null=null;
 private trashValue:{id:string;title:string;kind:string}[]=[];
 constructor(port:AppRecordPort,private readonly hooks:{paint():void;review():void;committed?(id:string):void}){
  this.controller=new CanonicalNotesController(port,{snapshot:snapshot=>{this.trashValue=(snapshot.trash??[]).map(entry=>({id:entry.note.id,title:entry.note.title,kind:entry.note.format?.kind??'text'}));this.baseRows=snapshot.notes.map(note=>this.row(note,snapshot.revision));this.editor?.reconcile();this.refreshDraftView();},phase:phase=>{if(phase==='review')this.reviewPending=true;this.phase=phase==='ready'&&this.reviewPending?'review':phase;this.hooks.paint();}});
  this.editor=new CanonicalNotesEditor(this.controller,{changed:()=>this.refreshDraftView(),review:()=>this.needsReview(),committed:target=>{this.reviewPending=false;this.phase='ready';this.hooks.paint();this.hooks.committed?.(target.id);}});
 }
 private needsReview():void{this.reviewPending=true;this.phase='review';this.hooks.paint();this.hooks.review();}
 /** Rich UI data stays owner-visible and lossless; only id/revision becomes
  * phone context. Shared canonical parsing and persistence remain authoritative. */
 private row(note:StickyNote,revision:number):Bag{
  const parts=projectNoteForModel(note);
  return {...structuredClone(note.format?.data??{}),id:note.id,kind:note.format?.kind??'text',title:parts.title,body:parts.body,canonicalRevision:revision};
 }
 private refreshDraftView():void{
  const rows=this.baseRows.slice(),draft=this.editor?.draft;
  this.openValue=draft?draft.id??'draft-'+draft.token:null;this.blankCreationValue=draft&&!draft.id?this.openValue:null;
  if(draft){
   const record={...structuredClone(draft.format?.data??{}),id:this.openValue,kind:draft.format?.kind??'text',title:draft.title,body:draft.body,canonicalRevision:draft.baseRevision};
   const index=rows.findIndex(row=>row.id===draft.id);if(index<0)rows.unshift(record);else rows[index]=record;
  }
  this.rowsValue=rows;this.hooks.paint();
 }
 get list():Bag[]{return this.controller.current?this.rowsValue.slice():[];}
 get open():string|null{return this.controller.current?this.openValue:null;}
 renderState(previous:Bag):Bag{return {...previous,list:this.list,open:this.open,rec:null,proc:null,record:false,playing:false,dict:false,trash:[],trashConfirm:null,trashFull:null,canonicalNotes:true,canonicalNotesPhase:this.phase,storageStatus:this.phase==='loading'?'Opening Notes…':this.phase==='saving'?'Saving…':this.phase==='review'?'Review unsaved changes.':'',blankCreationId:this.blankCreationValue};}
 async start():Promise<void>{await this.controller.refresh();}
 /** Caller supplies only authenticated same-session canonical event names. */
 listen(target:EventTarget):void{this.controller.listen(target);}
 retire():void{this.editor.close();this.controller.retire();this.baseRows=[];this.rowsValue=[];this.openValue=null;this.trashValue=[];}
 select(id:string|null):void{if(id===null)this.editor.close();else this.editor.open(id);}
 create(kind:'text'|'list'='text'):void{
  if(this.editor.draft?.version){this.needsReview();return;}
  this.editor.begin(kind);if(kind==='list')this.editor.edit({format:{kind:'list',data:{items:[],pinned:false}}});
 }
 async update(id:string,patch:Bag|((record:Bag)=>Bag)):Promise<boolean>{
  try{
   if(this.open!==id)this.editor.open(id);
   const original=this.list.find(row=>row.id===id);if(!original)throw Error('Current canonical note unavailable.');
   const next=typeof patch==='function'?patch(structuredClone(original)):patch;
   if(!next||typeof next!=='object'||Array.isArray(next)||next.id!==undefined&&next.id!==id)throw Error('Editor target changed.');
   const draft=this.editor.draft!;
   const data:Record<string,unknown>={...structuredClone(draft.format?.data??{})};
   // These fields are view identity/formatting, not authored rich metadata.
   const reserved=new Set(['id','title','body','kind','canonicalRevision','createdAt','updatedAt','when']);let richChanged=false;
   for(const [key,value]of Object.entries(next))if(!reserved.has(key)){data[key]=value;richChanged=true;}
   const kind=next.kind??draft.format?.kind??'text';
   this.editor.edit({...(next.title===undefined?{}:{title:next.title}),...(next.body===undefined?{}:{body:next.body}),...(richChanged||next.kind!==undefined?{format:parseNoteFormat({kind,data})}:{})});
   return await this.editor.save();
  }catch{this.needsReview();return false;}
 }
 async leave(next:string|null):Promise<void>{
  const draft=this.editor.draft;
  if(draft?.version&&(draft.id||this.editor.hasAuthoredContent)){if(!await this.editor.save())return;}
  // The awaited save may have been retired/replaced while pending.
  if(!this.controller.current)return;
  if(draft&&this.editor.draft?.token!==draft.token)return;
  this.select(next);
 }
 async remove(id:string):Promise<boolean>{return this.editor.remove(id);}
 async saveCard(content:string):Promise<boolean>{
  if(!this.controller.current)return false;
  try{const result=await this.controller.interact('create-note',{content});if(!result.target)return false;this.hooks.committed?.(result.target.id);return true;}catch{this.needsReview();return false;}
 }
 async discardDraftAndReload():Promise<void>{
  const id=this.editor.draft?.id;this.reviewPending=false;this.editor.close();
  try{await this.controller.refresh();if(id&&this.controller.hasViewNote(id))this.editor.open(id);}catch{this.needsReview();}
 }
 /** Canonical Trash has restore semantics, not the legacy device timer. */
 trashView(view:Bag,api:Bag,state:Bag):Bag{
  const rows=this.controller.current?this.trashValue:[];
  return {...view,none:this.controller.revision!==null&&this.phase==='ready'&&view.none,canonicalReview:this.phase==='review',canonicalReviewLabel:this.editor.draft?.version?'Discard draft and reload':'Reload Notes',canonicalReviewAction:()=>void this.discardDraftAndReload(),browserRecovery:false,canRecord:false,canImportText:false,trashAvailable:true,trashOpen:!!state.trashOpen,trashCanErase:false,trashRetentionText:'Deleted notes are kept here for recovery.',trashLabel:rows.length?`Trash, ${rows.length} item${rows.length===1?'':'s'}`:'Trash',trashNone:this.controller.revision!==null&&this.phase==='ready'&&rows.length===0,trashError:'',trashBusy:this.controller.pending,trashEmptyDisabled:true,trashConfirmOpen:false,trashFullOpen:false,
   trashRows:rows.map(row=>({id:row.id,title:row.title||'Untitled',kind:row.kind==='text'?'Note':row.kind==='list'?'Checklist':row.kind==='voice'?'Voice note':'Link',left:'Recoverable',restoreLabel:`Restore ${row.title||'note'}`,disabled:this.controller.pending,restore:()=>void this.editor.restore(row.id)})),
   openTrash:()=>{void this.leave(null).then(()=>{if(this.open===null&&this.controller.current){api.set({trashOpen:true,sheet:null,q:null});void this.controller.refresh().catch(()=>{});}});},closeTrash:()=>api.set({trashOpen:false}),emptyTrash:()=>this.needsReview(),trashConfirmGo:()=>this.needsReview(),trashCancel:()=>api.set({trashConfirm:null,trashFull:null})};
 }
 /** Decorate this view's API only. No global client or shared NotesStore swap. */
 api(original:Bag):Bag{
  return {...original,canonicalNotes:this,storageReady:()=>this.controller.current&&this.controller.revision!==null&&!this.controller.pending,
   get:(key:string)=>key==='notes'?this.renderState(original.get(key)):original.get(key),
   set:(patch:Bag)=>{if(Object.hasOwn(patch,'list')||patch.record===true||patch.rec){this.needsReview();return false;}return original.set(patch);},
   moveNoteToTrash:(note:Bag)=>this.remove(note.id),
   notesTrash:{restore:(id:string)=>this.editor.restore(id),maintain:async()=>{},forget:()=>{},erase:()=>{this.needsReview();return false;},deleteForever:()=>{this.needsReview();return false;}},
  };
 }
}
/** Root initializes shell.canonicalNotesUi only for the explicit canonical
 * source, before its legacy Notes bootstrap branch. Existing legacy UI remains
 * untouched when the binding is absent. Install after the existing app adapter. */
export function installCanonicalNotesView(Component:any,views:Record<string,Bag>):void{
 const prototype=Component.prototype,get=prototype.vget,api=prototype.api;
 prototype.vget=function(key:string){const state=get.call(this,key);return key==='notes'&&this.canonicalNotesUi?this.canonicalNotesUi.renderState(state):state;};
 prototype.api=function(key:string){const value=api.call(this,key);if(key!=='notes')return value;if(this.canonicalNotesUi)return this.canonicalNotesUi.api(value);return this.notesSourceMode==='canonical'?{...value,notesSourceMode:'canonical',notesTrash:undefined,moveNoteToTrash:()=>false}:value;};
 const notes=views.notes,render=notes.render;
 notes.render=(state:Bag,value:Bag)=>{const ui=value.canonicalNotes,pending=!ui&&value.notesSourceMode==='canonical',current=ui?ui.renderState(state):pending?{...state,list:[],open:null,trash:[],record:false,rec:null,storageStatus:'Opening Notes…'}:state,result=render(current,value);const sources=value.notesSourceOptions??[],older=sources.find((source:Bag)=>source.id==='legacy'),main=sources.find((source:Bag)=>source.id==='canonical');result.notesTitle=older?.selected?'Older notes':'Notes';result.primaryNotes=!older?.selected;result.olderNotesAction=older&&!older.selected?(event?:Event)=>{(event?.currentTarget as HTMLElement|null)?.closest('details')?.removeAttribute('open');older.choose();}:null;result.returnToNotesAction=main&&!main.selected?main.choose:null;return ui?ui.trashView(result,value,current):pending?{...result,none:false,browserRecovery:false,trashAvailable:false,canRecord:false,canImportText:false}:result;};
}
