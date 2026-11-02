import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';

// The actual Agent Notes dictation with a closed speech port: a failed or empty dictation ends
// quietly on the open note; a transcript lands in it; checklist guidance is not a voice failure.
const code=stripTypeScriptTypes(readFileSync('apps/app/src/prototype/canonical-notes-ui.ts','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'transform'});
function notes(perform,row={id:'note',kind:'text',title:'Plan',body:'Milk'}){
 class Controller{current=true;revision=1;pending=false;snapshot={notes:[]};listen(){}hasViewNote(){return true;}}
 class Editor{draft={id:'note',token:1,format:{kind:'text',data:{}},version:0};edits=[];reconcile(){}open(){}close(){}begin(){}edit(patch){this.edits.push(patch);}async save(){return true;}}
 const Ui=new Function('parseNoteFormat','projectNoteForModel','noteScheduleDraft','agentPendingText','agentAvailabilityNotice','DailyApps','CanonicalNotesController','CanonicalNotesEditor','window','document',code+';return CanonicalNotesUi;')(({kind,data})=>({kind,data}),()=>({}),()=>({}),()=>'',()=>'',{perform},Controller,Editor,{},{querySelector:()=>null});
 const ui=new Ui({},{paint(){},review(){}});ui.rowsValue=[row];ui.openValue=row.id;
 const toasts=[],view=ui.decorate({ed:{}},{toast:text=>toasts.push(text),get:()=>({}),set(){}},{});
 return {ui,toasts,view,tick:async()=>{for(let count=0;count<10;count++)await new Promise(resolve=>setTimeout(resolve,0));}};
}
for(const [control,start] of [['the editor mic',view=>view.ed.dictate()],['the new note waveform',view=>view.dictateNew()]]){
 for(const [name,perform] of [['rejects',async()=>{throw Error('PRIVATE_PLATFORM_TEXT');}],['hears nothing',async()=>({status:'cancelled',message:'PRIVATE_PLATFORM_TEXT'})],['gives an empty transcript',async()=>({status:'selected',transcript:''})]])
 test(`${control}: a dictation that ${name} ends quietly and leaves the note as it was`,async()=>{
  const f=notes(perform);start(f.view);await f.tick();
  assert.deepEqual(f.toasts,[]);assert.deepEqual(f.ui.editor.edits,[]);
 });
 test(`${control}: a transcript lands in the note, with no message`,async()=>{
  const f=notes(async()=>({status:'selected',transcript:' and eggs'}));start(f.view);await f.tick();
  assert.deepEqual(f.ui.editor.edits,[{body:'Milk and eggs'}]);assert.deepEqual(f.toasts,[]);
 });
}
test('a checklist keeps its guidance and starts no dictation',async()=>{
 let asked=0;const f=notes(async()=>{asked++;return {};},{id:'note',kind:'list',title:'Plan',body:''});f.view.ed.dictate();await f.tick();
 assert.deepEqual(f.toasts,['Convert this checklist to text before dictating.']);assert.equal(asked,0);
});
