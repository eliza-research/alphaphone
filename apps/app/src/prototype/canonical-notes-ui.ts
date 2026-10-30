import React from 'react';
import {iconStyle} from '../icon-style';
import {agentPendingText,agentAvailabilityNotice} from '../runtime/connection-ui';
import {NotesWorkspace,type NotesWorkspaceHandle} from '../../../../.eliza/client-features/plugins/plugin-notes/src/workspace.ts';
import {createNotesClient} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-api.ts';
import {projectNoteForModel,type StickyNote} from '../../../../.eliza/client-features/plugins/plugin-notes/src/types.ts';
import type {AppRecordPort} from '../runtime/app-record-route-policy';
import {shareSelectedText,copySelectedText} from '../runtime/text-share';
import {noteShareText} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/note-share-text.ts';
import {noteScheduleDraft,type NoteScheduleKind} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/note-schedule-draft.ts';
import {DailyApps} from '../daily';
import {registerPlugin} from '../platform-plugins';
import {speakNote,stopSpeaking} from './local-speech-playback';
import {MobileViewHost,type MobileViewFailure} from '@elizaos/ui/mobile-shell';
import {alphaViews} from '../product/alpha-product';
import {recordRendererFailure} from '../runtime/crash-log';
import {NotesHostContext} from '../product/notes-host-context';
/** Back chevron from the shared icon pack, like every other Back control: it does not reflow as text at large font sizes. */
const backIcon=()=>React.createElement('span',{'aria-hidden':'true','data-alpha-icon':'/icons/lucide/chevron-left.svg',style:{...iconStyle('chevron-left'),width:24,height:24}});
type Bag=Record<string,any>;
const documents=registerPlugin<{exportText(input:{title:string;text:string}):Promise<{status:string;message:string}>}>('AlphaNoteDocuments',{
 web:()=>import('../runtime/browser-note-documents').then(module=>new module.BrowserNoteDocuments()),
});
const identity=(port:AppRecordPort)=>JSON.stringify([port.sessionId,port.scope??null,port.identity.ownerId,port.identity.agentId,port.identity.sessionId,port.identity.origin]);
const row=(note:StickyNote)=>({...structuredClone(note.format?.data??{}),...projectNoteForModel(note),id:note.id,kind:note.format?.kind??'text'});

/** Authenticated transport and platform ports only; the upstream workspace owns UI and drafts. */
export class CanonicalNotesUi {
 private handle:NotesWorkspaceHandle|null=null;
 private resolveReady!:(handle:NotesWorkspaceHandle|null)=>void;
 private ready=new Promise<NotesWorkspaceHandle|null>(resolve=>{this.resolveReady=resolve;});
 private retired=false;
 private active=false;
 private shell:Bag|null=null;
 private element:React.ReactNode=null;
 private elementKey='';
 private rowsRevision:number|null=null;
 private rows:Bag[]=[];
 private readonly attach=(handle:NotesWorkspaceHandle|null)=>{this.handle=handle;if(handle?.current())this.resolveReady(handle);};
 private readonly selectionChanged=()=>this.hooks.paint();
 private target:{id:string;sequence:number}|null=null;
 private api:Bag|null=null;
 private readonly captured:string;
 readonly client;
 readonly binding;
 readonly events;
 constructor(private readonly port:AppRecordPort,private readonly hooks:{paint():void;review():void;committed?(id:string):void}){
  this.captured=identity(port);
  this.binding={key:this.captured,current:()=>this.current};
  this.client=createNotesClient({fetch:async<T>(path:string,options:RequestInit={}):Promise<T>=>{
   const signal=options.signal??new AbortController().signal;signal.throwIfAborted();if(!this.current)throw new DOMException('The Notes connection changed.','AbortError');
   const method=options.method??'GET';if(method!=='GET'&&method!=='POST')throw Error('Unsupported Notes transport method.');
   if(options.body!==undefined&&typeof options.body!=='string')throw Error('Unsupported Notes request framing.');
   const value=await port.request(path,method,options.body===undefined?undefined:JSON.parse(options.body),signal);
   signal.throwIfAborted();if(!this.current)throw new DOMException('The Notes connection changed.','AbortError');return value as T;
  }});
  queueMicrotask(()=>{if(this.current)this.hooks.paint();});
  this.events={subscribeInvalidation:(listener:(revision?:number)=>void)=>{
   const changed=(event:Event)=>{const value=(event as CustomEvent).detail;if(this.current&&value?.sessionId===port.sessionId)listener(Number.isSafeInteger(value.revision)&&value.revision>=0?value.revision:undefined);};
   window.addEventListener('alpha:canonical-notes-invalidated',changed);return()=>window.removeEventListener('alpha:canonical-notes-invalidated',changed);
  }};
 }
 get current(){return !this.retired&&this.port.current()&&identity(this.port)===this.captured;}
 get pending(){return this.handle?.pending()??false;}
 get dirty(){return this.handle?.hasUnsavedChanges()??false;}
 get editing(){return this.handle?.isEditing()??false;}
 get list(){if(!this.current)return [];const revision=this.handle?.revision()??null;if(revision!==this.rowsRevision){const snapshot=this.handle?.snapshot();this.rows=(snapshot?.notes??[]).map(note=>({...row(note),canonicalRevision:revision}));this.rowsRevision=revision;}return this.rows;}
 get open(){return this.handle?.selection()?.id??null;}
 /** The current canonical records, exactly as the shared controller holds them (for origin links). */
 notes():StickyNote[]{return this.current?this.handle?.snapshot()?.notes??[]:[];}
 /**
  * Opens a reviewed Calendar event or reminder draft from the selected note. Nothing is written
  * until Save in Calendar; the saved record keeps the draft's canonical origin link.
  */
 private async scheduleDraft(note:StickyNote,kind:NoteScheduleKind,signal:AbortSignal){
  const result=await noteScheduleDraft(note,kind);signal.throwIfAborted();
  const api=this.api;if(!api||!this.active||!this.current||this.open!==note.id)throw new DOMException('The note changed.','AbortError');
  if(result.status!=='ready'){api.toast(result.message);return;}
  const {draft}=result,shared={id:null,title:draft.title,off:1,t:9,d:1,where:'',video:false,who:[],repeat:'none',notes:draft.notes,origin:draft.origin};
  api.open('calendar',{calendarAuthority:api.get('calendar').calendarAuthority,form:kind==='event'?{...shared,creationId:crypto.randomUUID(),separateCreation:false,cal:'native:local',alert:null}:{...shared,cal:'alpha-reminders',alert:0},open:null,month:null,day:1},'hidden');
  api.toast(kind==='event'?'Review the time, then Save. Nothing is on your calendar yet.':'Review the time, then Save. Nothing scheduled yet.');
 }
 selection(){return this.handle?.selection();}
 private async admitted(){const handle=this.handle?.current()?this.handle:await this.ready;if(!handle||!this.current)throw new DOMException('The Notes connection changed.','AbortError');return handle;}
 async refresh(){const handle=await this.admitted();await handle.refresh();}
 async leave(){const handle=await this.admitted();return handle.requestLeave();}
 async create(kind:'text'|'list'='text'){const handle=await this.admitted();await handle.refresh();return handle.begin(kind);}
 async saveCard(content:string){
  try{const handle=await this.admitted(),result=await handle.interact('create-note',{content});if(!this.current||!result.target)return false;this.hooks.committed?.(result.target.id);return true;}
  catch{if(this.current){this.api?.toast('Could not confirm the save. Check Notes before trying again.');this.hooks.review();}return false;}
 }
 retire(){this.retired=true;this.resolveReady(null);this.handle?.retire();this.handle=null;this.rows=[];this.element=null;}
 select(id:string|null){if(id===null){void this.leave().then(()=>this.hooks.paint()).catch(()=>{});return;}this.target=id?{id,sequence:(this.target?.sequence??0)+1}:null;this.hooks.paint();}
 render(shell:Bag,active:boolean,storageAccessWarning='',covered=false){
  this.shell=shell;this.active=active;
  const api=this.api=shell.api('notes');
  const options=api.notesSourceOptions??[];
  const elementKey=JSON.stringify([active,covered,this.target,storageAccessWarning,options.map((source:Bag)=>[source.id,source.label,source.selected])]);
  if(this.element&&elementKey===this.elementKey)return this.element;
  this.elementKey=elementKey;
  const selected=(note:StickyNote,signal:AbortSignal)=>{signal.throwIfAborted();if(!this.active||!this.current||this.open!==note.id)throw new DOMException('The note changed.','AbortError');return noteShareText(row(note));};
  return this.element=React.createElement('div',{className:'notes-layout',hidden:!active,inert:!active||covered||undefined,'aria-hidden':!active||covered,'data-alpha-shared-notes':true,role:'region','aria-label':'Notes',style:{position:'absolute',inset:0,zIndex:21,background:'var(--bg)',paddingTop:44,boxSizing:'border-box',display:active?'flex':'none',flexDirection:'column','--text':'var(--fg)','--txt':'var(--fg)','--muted':'var(--mut)','--muted-strong':'var(--mut)','--card':'var(--bg)','--surface':'var(--s2)','--border':'var(--line)','--input':'var(--bg)','--eliza-chat-clearance':'var(--alpha-chat-clearance,0px)'} as React.CSSProperties},
   React.createElement('header',{'data-alpha-app-header':'main',style:{display:'flex',alignItems:'center',height:56,flexShrink:0,gap:12,padding:'0 16px'}},React.createElement('button',{className:'app-header-back','aria-label':'Back to apps',onClick:()=>this.shell?.goHome()},backIcon()),React.createElement('h1',{'data-alpha-app-title':true,style:{margin:0,fontSize:24}},'Notes')),
   storageAccessWarning?React.createElement('p',{role:'alert',className:'storage-access-warning'},storageAccessWarning):null,
   React.createElement(NotesWorkspace,{ref:this.attach,client:this.client,binding:this.binding,events:this.events,active,sourceNoteTarget:this.target,onSelectionChange:this.selectionChanged,sources:options.map((source:Bag)=>({id:source.id,label:source.label??(source.id==='legacy'?'Older notes':'Notes'),selected:source.selected,select:async()=>{await this.api?.notesSourceOptions?.find((option:Bag)=>option.id===source.id)?.choose();}})),ports:{
    copyText:async(note,signal)=>{const value=selected(note,signal);await copySelectedText(value.text);},
    share:async(note,signal)=>{await shareSelectedText(selected(note,signal));},
    exportText:async(note,signal)=>{const value=selected(note,signal);const result=await documents.exportText(value);if(this.current&&!signal.aborted)this.api?.toast(result.message);},
    composeEmail:async(note,signal)=>{const value=selected(note,signal);this.api?.open('inbox',{compose:{subject:value.title,body:value.text}});},
    dictate:async signal=>{signal.throwIfAborted();const result=await DailyApps.perform({action:'voice'});signal.throwIfAborted();if(!this.current)throw new DOMException('The Notes connection changed.','AbortError');if(!result.transcript)throw Error(result.message||'Speech recognition is unavailable.');return result.transcript;},
    draftEvent:async(note,signal)=>this.scheduleDraft(note,'event',signal),
    draftReminder:async(note,signal)=>this.scheduleDraft(note,'reminder',signal),
    readAloud:async(note,signal)=>{const value=selected(note,signal),cancel=()=>stopSpeaking();signal.addEventListener('abort',cancel,{once:true});try{const result=await speakNote(value.text,{noteId:note.id});if(result!=='finished'&&result!=='stopped')throw Error('Reading this note is unavailable.');}finally{signal.removeEventListener('abort',cancel);}},
   }}));
 }
}

/** The disconnected state keeps the same opaque app surface and reachable controls. */
function WaitingNotes({shell,storageAccessWarning,covered=false}:{shell:Bag;storageAccessWarning?:string;covered?:boolean}){
 const notice=shell.vget('notes').storageStatus||agentAvailabilityNotice(undefined,'Notes is unavailable for this agent connection. Check Settings › Agent connection.');
 const root=React.useRef<HTMLElement>(null);
 React.useLayoutEffect(()=>{
  const element=root.current;
  if(covered||!element||document.querySelector('dialog[open],[aria-label="Voice conversation"],[data-alpha-layer="conversation"][aria-hidden="false"]'))return;
  element.focus({preventScroll:true});
 },[covered]);
 return React.createElement('section',{ref:root,tabIndex:-1,inert:covered||undefined,'aria-hidden':covered,className:'notes-layout',role:'region','aria-label':'Notes',style:{position:'absolute',inset:0,zIndex:21,background:'var(--bg)',color:'var(--fg)',paddingTop:44,boxSizing:'border-box',display:'flex',flexDirection:'column'} as React.CSSProperties},
  React.createElement('header',{'data-alpha-app-header':'main',style:{display:'flex',alignItems:'center',height:56,flexShrink:0,gap:12,padding:'0 16px'}},
   React.createElement('button',{className:'app-header-back','aria-label':'Back to apps',onClick:()=>shell.goHome()},backIcon()),
   React.createElement('h1',{'data-alpha-app-title':true,style:{margin:0,fontSize:24}},'Notes')),
  React.createElement('div',{style:{display:'flex',flexDirection:'column',alignItems:'flex-start',gap:16,minHeight:0,overflowY:'auto',padding:'16px 24px calc(var(--alpha-chat-clearance, 120px) + 24px)'}},
   storageAccessWarning?React.createElement('p',{role:'alert',className:'storage-access-warning'},storageAccessWarning):null,
   notice?React.createElement('p',{role:'status',style:{margin:0,lineHeight:1.5}},notice):null,
   ...(shell.api('notes').notesSourceOptions??[]).filter((source:Bag)=>!source.selected).map((source:Bag)=>React.createElement('button',{key:source.id,onClick:source.choose,style:{minHeight:48,padding:'12px 18px',borderRadius:16,background:'var(--s2)',color:'var(--fg)',font:'inherit'}},source.id==='legacy'?'Older notes':source.label))));
}

/** What the Notes view draws for the shell that hosts it. */
type NotesHost={shell:Bag;ui:CanonicalNotesUi|null;storageAccessWarning:string;covered:boolean};

/** The canonical workspace while a connection is bound, else the opaque waiting surface. */
function renderNotesSurface(host:NotesHost,active:boolean):React.ReactNode{
 if(host.ui)return host.ui.render(host.shell,active,host.storageAccessWarning,host.covered);
 return active?React.createElement(WaitingNotes,{shell:host.shell,storageAccessWarning:host.storageAccessWarning,covered:host.covered}):null;
}

const surface={position:'absolute',inset:0,zIndex:21,background:'var(--bg)',color:'var(--fg)',paddingTop:44,boxSizing:'border-box',display:'flex',flexDirection:'column'} as React.CSSProperties;
/** A Notes view that could not load or render: the same opaque surface, Back and a retry. */
function NotesFailure({label,retry,close,active}:MobileViewFailure){
 return React.createElement('section',{role:'region','aria-label':label,className:'notes-layout',hidden:!active,inert:!active||undefined,'aria-hidden':!active,'data-alpha-view-failure':'notes',style:{...surface,display:active?'flex':'none'}},
  React.createElement('header',{'data-alpha-app-header':'main',style:{display:'flex',alignItems:'center',height:56,flexShrink:0,gap:12,padding:'0 16px'}},
   React.createElement('button',{className:'app-header-back','aria-label':'Back to apps',onClick:close},backIcon()),
   React.createElement('h1',{'data-alpha-app-title':true,style:{margin:0,fontSize:24}},label)),
  React.createElement('div',{role:'alert',style:{display:'flex',flexDirection:'column',alignItems:'flex-start',gap:16,padding:'16px 24px'}},
   React.createElement('p',{style:{margin:0,lineHeight:1.5}},`${label} could not be shown. Try again, or go back to your apps.`),
   React.createElement('button',{onClick:retry,style:{minHeight:48,padding:'12px 18px',borderRadius:16,background:'var(--s2)',color:'var(--fg)',font:'inherit'}},'Try again')));
}
const reportFailure=(error:unknown)=>{void recordRendererFailure('render',error);};

/** The stable screen-level React hole stays mounted across Home/app changes; Notes renders in it
 * through the shared shell's view host. */
export function installCanonicalNotesView(Component:any,views:Record<string,Bag>):void{
 const prototype=Component.prototype,renderVals=prototype.renderVals,get=prototype.vget,api=prototype.api;
 prototype.vget=function(key:string){const value=get.call(this,key),ui=this.canonicalNotesUi;return key==='notes'&&ui?{...value,list:ui.list,open:ui.open,rec:null,record:false}:value;};
 prototype.api=function(key:string){const value=api.call(this,key);if(key!=='notes')return value;const ui=this.canonicalNotesUi;if(!ui)return this.notesSourceMode==='canonical'?{...value,notesSourceMode:'canonical',notesTrash:undefined,moveNoteToTrash:()=>false,set:(patch:Bag)=>{if(patch.compose){value.toast(this.vget('notes').storageStatus||agentPendingText(undefined,'Notes is unavailable for this agent connection. Check Settings › Agent connection.'));return false;}return value.set(patch);}}:value;return {...value,canonicalNotes:ui,notesSourceMode:'canonical',set:(patch:Bag)=>{if(Object.hasOwn(patch,'list'))return false;if(Object.hasOwn(patch,'open'))ui.select(patch.open);if(patch.compose)void ui.create();const rest={...patch};delete rest.open;delete rest.compose;return Object.keys(rest).length?value.set(rest):true;}};};
 prototype.renderVals=function(){
  const value=renderVals.call(this),ui:CanonicalNotesUi|null=this.canonicalNotesUi??null,active=!!(this.live&&this.S().screen==='home'&&this.S().view==='notes');
  // The view host stays mounted behind Home and other views whenever Notes is canonical, so the
  // lazy view has loaded before Notes opens and a bound workspace keeps its drafts; the waiting
  // surface itself renders only while Notes is open.
  if(!ui&&this.notesSourceMode!=='canonical')return {...value,canonicalNotesWorkspace:null};
  const host:NotesHost={shell:this,ui,storageAccessWarning:value.storageAccessWarning??'',covered:!!value.appHidden};
  return {...value,canonicalNotesWorkspace:React.createElement(NotesHostContext.Provider,{value:(open:boolean)=>renderNotesSurface(host,open)},React.createElement(MobileViewHost,{registry:alphaViews,view:'notes',active,onClose:()=>this.goHome(),onError:reportFailure,renderError:NotesFailure,fallback:active?React.createElement('div',{'aria-busy':true,style:surface}):null}))};
 };
 const notes=views.notes,render=notes.render,back=notes.back,leave=notes.onLeave;
 notes.render=(state:Bag,value:Bag)=>{if(value.notesSourceMode==='canonical'||value.canonicalNotes)return {legacyNotes:false};const result=render(state,value),main=(value.notesSourceOptions??[]).find((source:Bag)=>source.id==='canonical');return {...result,legacyNotes:true,notesTitle:'Older notes',primaryNotes:false,returnToNotesAction:main?.choose};};
 notes.back=(state:Bag,value:Bag)=>{const ui=value.canonicalNotes;if(!ui)return back?.(state,value);if(!ui.editing)return false;void ui.leave();return true;};
 notes.onLeave=(value:Bag)=>{if(!value.canonicalNotes)leave?.(value);};
}
