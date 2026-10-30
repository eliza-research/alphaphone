// The compatibility writer now delegates to the same controller as the visible editor.
// These are actual document CAS tests, without another optimistic renderer queue.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {resolve} from 'node:path';
import {loadBrowserModule} from './fixtures/browser-source.mjs';
const sdk=process.env.ALPHA_NOTES_TEST_SDK??'.eliza/client-features/plugins/plugin-notes/src/client';
const [{DocumentNotesStore,NotesDocumentConflict},{NotesController},{createDeviceNotesClient},{createNotesDraftSlot}]=await loadBrowserModule([sdk+'/notes-document-store.ts',sdk+'/notes-controller.ts',sdk+'/notes-device-client.ts',sdk+'/notes-draft.ts'],{alias:{'@elizaos/core/errors':resolve('.eliza/client-features/packages/core/src/errors.ts'),'@elizaos/core/unicode':resolve('.eliza/client-features/packages/core/src/utils/unicode.ts')}});
const source=readFileSync(new URL('../apps/app/src/prototype/agent-adapter.ts',import.meta.url),'utf8');
const start=source.indexOf('  p.vset = function ('),end=source.indexOf('  p.api = function',start);
assert.ok(start>=0&&end>start);
const assignment=stripTypeScriptTypes(source.slice(start,end),{mode:'transform'});
const makeWriter=new Function('originalSet','context',`const p={};${assignment};return p.vset;`);
async function fixture(){
 let saved,revision=0,blocked=false,blockedRead=false;
 const started=Promise.withResolvers(),gate=Promise.withResolvers();
 const port={initialize:async create=>saved??(saved={revision:'opaque-'+(++revision),raw:create(null,null)}),read:async()=>{if(blockedRead){started.resolve();await gate.promise;}return {...saved};},compareExchange:async(expected,raw)=>{
  if(blocked){started.resolve();await gate.promise;}
  if(saved.revision!==expected.revision||saved.raw!==expected.raw)throw new NotesDocumentConflict('Foreign revision');
  return saved={revision:'opaque-'+(++revision),raw};
 }};
 const store=await DocumentNotesStore.open(port,[{id:'fixture-note',kind:'text',title:'Initial',body:'Saved body'}]);
 const slots=new Map(),state={},toasts=[];
 const client=createDeviceNotesClient({current:()=>true,open:async()=>store,commit:(store,list,signal,authorized)=>store.replace(list,{signal,authorized}),drafts:createNotesDraftSlot({read:async key=>slots.get(key)??null,compareExchange:async(key,expected,value)=>{if(JSON.stringify(slots.get(key)??null)!==JSON.stringify(expected))return {status:'changed'};if(value===null)slots.delete(key);else slots.set(key,structuredClone(value));return {status:'saved'};}},'notes-draft:v1:device')});
 const controller=new NotesController(client,()=>true,{snapshot(){},phase(){}});await controller.refresh();
 const shell={canonicalNotesUi:{sourceMode:'legacy',writeRecords:(records,options)=>controller.writeRecords({records,expectedRevision:controller.revision,...options}),select(){}},toast:text=>toasts.push(text)};
 const writer=makeWriter(function(_key,patch){Object.assign(state,patch);},()=>{});
 return {shell,controller,slots,state,toasts,store,edit:(patch,options)=>writer.call(shell,'notes',{list:store.list.map(n=>({...n,...patch}))},options),hold:()=>{blocked=true;},holdRead:()=>{blockedRead=true;},started:started.promise,release:()=>gate.resolve(),saved:()=>JSON.parse(saved.raw),foreign:body=>{const value=JSON.parse(saved.raw);value.records[0].body=body;saved={revision:'opaque-'+(++revision),raw:JSON.stringify(value)};}};
}
test('compatibility writes share the visible controller and refuse a concurrent second writer',async()=>{
 const f=await fixture();f.hold();const first=f.edit({title:'Pending title'});await f.started;
 assert.equal(await f.edit({body:'Do not silently queue another writer'}),false);
 assert.deepEqual(f.state,{},'no optimistic list is published');f.release();assert.equal(await first,true);
 assert.equal(f.saved().records[0].title,'Pending title');assert.equal(f.saved().records[0].body,'Saved body');assert.equal(f.slots.size,0);
});
test('foreign durable CAS refuses a compatibility write and keeps its exact retained draft',async()=>{
 const f=await fixture();f.hold();const write=f.edit({body:'Exact unsaved recording text'});await f.started;
 f.foreign('Foreign committed body');f.release();assert.equal(await write,false);
 assert.equal(f.saved().records[0].body,'Foreign committed body');assert.deepEqual(f.state,{});
 assert.equal(f.slots.get('notes-draft:v1:device').records[0].body,'Exact unsaved recording text');
});
test('a queued compatibility restoration checks the same foreground guard at commit',async()=>{
 const f=await fixture();f.holdRead();let current=true;
 const write=f.edit({body:'Reviewed restored recording'},{exact:true,authorized:()=>{if(!current)throw new DOMException('Retired','AbortError');}});await f.started;
 current=false;f.release();assert.equal(await write,false);
 assert.equal(f.saved().records[0].body,'Saved body');assert.deepEqual(f.state,{});
 assert.equal(f.slots.has('notes-draft:v1:device'),false,'a refused pre-commit restore creates no replacement draft');
});
