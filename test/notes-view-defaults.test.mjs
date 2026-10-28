import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{stripTypeScriptTypes}from'node:module';import vm from'node:vm';
const source=readFileSync('apps/app/src/prototype/model.js','utf8'),start=source.indexOf('/* ===== module: notes ===== */'),end=source.indexOf('/* ===== module:',start+20);assert.ok(start>=0&&end>start);
function fixture(){
 let view;const context=vm.createContext({IC:{},NOTES_SEED:[],NOTES_LIVE:[],NOTES_DICT:[],copy:()=>({}),cap:text=>text,registerView:(id,value)=>{assert.equal(id,'notes');view=value;},setTimeout(){throw Error('No recorder starts during an empty render');},setInterval(){throw Error('No recorder starts during an empty render');},clearInterval(){},Date});
 vm.runInContext(source.slice(start,end),context);
 const state={list:[],open:null,q:null},before=structuredClone(state),choose=()=>{},api={name:'Alpha',now:new Date(),get:()=>state,set(){throw Error('Display must not change stored Notes');},person:()=>null,notesSourceOptions:[{id:'canonical',choose}]};
 return {view,state,before,api,choose};
}
test('the intrinsic legacy renderer supplies its labelled fixture surface without product adapters',()=>{
 const f=fixture(),out=f.view.render(f.state,f.api);assert.equal(out.legacyNotes,true);assert.equal(out.notesTitle,'Notes');assert.equal(out.primaryNotes,true);assert.equal(out.canRecord,true);assert.deepEqual(f.state,f.before);
});
function installCanonicalProjection(f){
 const s=readFileSync('apps/app/src/prototype/canonical-notes-ui.ts','utf8'),a=s.indexOf(' notes.render='),b=s.indexOf('\n notes.back=',a);assert.ok(a>=0&&b>a);
 const context=vm.createContext({notes:f.view,render:f.view.render});vm.runInContext(stripTypeScriptTypes(s.slice(a,b),{mode:'transform'}),context);
}
test('a real canonical workspace still suppresses the legacy template completely',()=>{
 const f=fixture();installCanonicalProjection(f);assert.deepEqual({...f.view.render(f.state,{...f.api,notesSourceMode:'canonical'})},{legacyNotes:false});assert.deepEqual(f.state,f.before);
});
test('an explicitly selected retained source keeps Older notes naming and its return action',()=>{
 const f=fixture();installCanonicalProjection(f);const out=f.view.render(f.state,{...f.api,notesSourceMode:'legacy'});assert.equal(out.legacyNotes,true);assert.equal(out.notesTitle,'Older notes');assert.equal(out.primaryNotes,false);assert.equal(out.returnToNotesAction,f.choose);assert.deepEqual(f.state,f.before);
});
