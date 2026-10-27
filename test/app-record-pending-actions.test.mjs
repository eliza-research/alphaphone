import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';
const connection=readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8');
const pendingCode=stripTypeScriptTypes(connection.slice(connection.indexOf('export function residentPendingText('),connection.indexOf('/** The send/voice refusal')).replace(/^export /gm,''),{mode:'transform'});
const pending=(state,residentAlwaysPresent=false)=>new Function('state','residentAlwaysPresent','RESIDENT_RECOVERY_PENDING','PENDING_FALLBACK',pendingCode+';return {agentPendingText,agentAvailabilityNotice};')(state,residentAlwaysPresent,'Review agent recovery.','Unavailable.');
const source=readFileSync('apps/app/src/prototype/canonical-notes-ui.ts','utf8');
const code=stripTypeScriptTypes(source.replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'transform'});
function notesFixture({kind='offline',resident=false,status='',ready=false}={}){
 const reason=pending({kind},resident),install=new Function('agentPendingText','agentAvailabilityNotice',code+';return installCanonicalNotesView;')(reason.agentPendingText,reason.agentAvailabilityNotice),state={list:[{id:'retained',body:'Exact draft'}],open:'retained',draft:{body:'Unsaved exact draft'},storageStatus:status},before=structuredClone(state),calls=[],toasts=[];
 class Shell{vget(){return state;}api(){return{};}}
 const ui=ready?{renderState:s=>s,create:()=>calls.push('canonical-create'),trashView:v=>v}:undefined;
 const values={notesSourceMode:'canonical',canonicalNotes:ui,toast:x=>toasts.push(x),set:patch=>calls.push(patch)};
 const views={notes:{render:(_state,api)=>({storageStatus:_state.storageStatus,newNote:()=>{if(api.canonicalNotes)api.canonicalNotes.create();else{calls.push('placeholder');api.set({list:[]});}}})}};install(Shell,views);return{state,before,calls,toasts,render:()=>views.notes.render(state,values)};
}
test('attempted New Note explains starting, stopped or unavailable without a placeholder or draft mutation',()=>{
 for(const options of [{kind:'starting',resident:true},{kind:'recovering',resident:true},{kind:'cloud',resident:false}]){
  const f=notesFixture(options),view=f.render();if(options.kind==='starting')assert.equal(view.storageStatus,'','passive startup stays quiet');view.newNote();assert.deepEqual(f.state,f.before);assert.deepEqual(f.calls,[]);assert.equal(f.toasts.length,1);assert.match(f.toasts[0],options.kind==='starting'?/starting/:options.kind==='recovering'?/stopped/:/unavailable for this agent connection/);assert.doesNotMatch(f.toasts[0],/on.phone agent|runs on your phone/);
 }
});
test('a genuine Notes recovery error stays visible and is used by the attempted action',()=>{
 const f=notesFixture({status:'Review unsaved Notes recovery.'});f.render().newNote();assert.deepEqual(f.toasts,['Review unsaved Notes recovery.']);assert.deepEqual(f.state,f.before);assert.deepEqual(f.calls,[]);
});
test('an available private Mac canonical Notes binding keeps its normal create path',()=>{
 const f=notesFixture({kind:'cloud',ready:true});f.render().newNote();assert.deepEqual(f.calls,['canonical-create']);assert.deepEqual(f.toasts,[]);assert.deepEqual(f.state,f.before);
});
test('actual Notes binding accepts the existing app-record port independently of phone-only session labels',async()=>{
 const adapter=readFileSync('apps/app/src/prototype/agent-adapter.ts','utf8'),a=adapter.indexOf('  function canonicalNotesKey('),b=adapter.indexOf('  async function previousNotesObservation(',a);assert(a>=0&&b>a);
 const bindCode=stripTypeScriptTypes(adapter.slice(a,b),{mode:'transform'}),port={identity:{ownerId:'mac-owner',agentId:'mac-agent',sessionId:'mac-session',origin:'http://localhost:5229'},sessionId:'mac-session',scope:'owner',current:()=>true};let selected=port,starts=0,bindings=0;
 class Binding{controller={current:true};constructor(actual){assert.equal(actual,port);bindings++;}listen(){}start(){starts++;return Promise.resolve();}retire(){}}
 const updates=[],sync=new Function('connectionController','CanonicalNotesUi','originalSet','context','window','agentAvailabilityNotice',bindCode+';return syncCanonicalNotes;')({getAppRecordClient:()=>selected},Binding,function(_key,patch){updates.push(patch);},()=>{}, {},pending({kind:'cloud'}).agentAvailabilityNotice);
 const shell={live:true,notesSourceMode:'canonical',setState(){}};sync(shell);await shell.notesReady;assert.equal(bindings,1);assert.equal(starts,1);assert.equal(shell.canonicalNotesUi.controller.current,true);sync(shell);assert.equal(bindings,1);
 selected=null;sync(shell);await shell.notesReady;assert.match(updates.at(-1).storageStatus,/unavailable for this agent connection/);assert.equal(bindings,1);
});
