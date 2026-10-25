// Alpha notes section state: the real AgentNotes with the projected stock notes client and Alpha's
// notes transport, over a synthetic owner-route client. No network, agent or phone storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {prepareClientFeatures} from '../scripts/prepare-client-features.mjs';

prepareClientFeatures();
const bundle=await build({entryPoints:['apps/app/src/prototype/agent-notes-adapter.ts'],bundle:true,write:false,format:'esm',platform:'neutral',logLevel:'silent',plugins:[{name:'connection-stub',setup(builder){
 builder.onResolve({filter:/\/connection-ui$/},()=>({path:'connection-ui',namespace:'stub'}));
 builder.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const connectionController={getNotesClient:()=>globalThis.notesConnection.getNotesClient(),getSnapshot:()=>globalThis.notesConnection.getSnapshot()};',loader:'js'}));
}}]});
const conflictText='The notes changed since this edit was prepared. Read the note again and reconcile the requested edit; nothing changed.';
const note=(id,title,body='')=>({id,title,body,color:'yellow',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z'});
/** Synthetic agent: stock route envelopes, with per-call overrides. */
function agent(notes=[note('a','Milk','\nBuy oat milk')]){
 const server={notes,revision:3,calls:[],next:[]};
 const state=()=>({notes:structuredClone(server.notes),revision:server.revision});
 const ok=result=>({requestId:'request',success:true,result:{success:true,text:'Done.',state:state(),...result}});
 server.request=async(path,method,body)=>{
  server.calls.push({path,method,body});const override=server.next.shift();if(override)return override(body);
  if(path==='/api/notes/state')return {success:true,data:state()};
  const {capability,params}=body;
  if(capability==='create-note'){const existing=server.notes.find(item=>item.title+item.body===params.content);if(existing)return ok({data:{replayed:true}});const [title,...rest]=params.content.split('\n');server.notes.push(note('n'+server.revision,title,rest.length?'\n'+rest.join('\n'):''));server.revision++;return ok();}
  if(capability==='update-note'){if(params.expectedRevision!==server.revision)return {requestId:'request',success:false,result:{success:false,text:conflictText,error:{code:'NOTES_EDIT_CONFLICT',message:conflictText}}};const target=server.notes.find(item=>item.id===params.id),[title,...rest]=params.content.split('\n');Object.assign(target,{title,body:rest.length?'\n'+rest.join('\n'):''});server.revision++;return ok();}
  if(capability==='delete-note'){server.notes=server.notes.filter(item=>item.id!==params.id);server.revision++;return ok();}
  throw Error('unexpected capability');
 };
 return server;
}
async function fixture(server,{connected=true}={}){
 globalThis.notesConnection={getNotesClient:()=>connected?{sessionId:'session',request:server.request}:null,getSnapshot:()=>({kind:connected?'resident':'starting',name:'On this device',session:connected?{}:null})};
 const {AgentNotes}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
 let published=0;const notes=new AgentNotes(()=>published++,()=>true);
 return {notes,get published(){return published;},interacts:()=>server.calls.filter(call=>call.method==='POST').map(call=>call.body)};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));

test('mutations run one at a time and each reads the revision when it starts',async()=>{
 const server=agent([note('a','One'),note('b','Two')]),f=await fixture(server);await f.notes.refresh();
 const [first,second]=await Promise.all([f.notes.update('a','One edited'),f.notes.update('b','Two edited')]);
 assert.deepEqual([first,second],[true,true]);
 assert.deepEqual(f.interacts().map(body=>body.params.expectedRevision),[3,4]);
 assert.deepEqual(f.notes.view().notes.map(item=>item.text),['One edited','Two edited']);f.notes.dispose();
});
test('the returned state replaces the snapshot wholesale, so consolidated and replayed notes never linger or duplicate',async()=>{
 const server=agent([note('a','Same'),note('b','Same')]),f=await fixture(server);await f.notes.refresh();
 server.next.push(()=>{server.notes=[note('a','Same',' kept')];server.revision=9;return {requestId:'request',success:true,result:{success:true,text:'Updated note and consolidated 2 identical copies.',state:{notes:server.notes,revision:9},data:{consolidatedIds:['b']}}};});
 assert.equal(await f.notes.update('a','Same kept'),true);
 assert.deepEqual(f.notes.view().notes.map(item=>item.id),['a']);assert.equal(f.notes.snapshot.revision,9);
 assert.equal(await f.notes.create('Same kept'),true);
 assert.deepEqual(f.notes.view().notes.map(item=>item.id),['a'],'a replayed create adds no card');f.notes.dispose();
});
test('an HTTP 200 edit conflict keeps the editor text, refreshes and never resends',async()=>{
 const server=agent(),f=await fixture(server);await f.notes.refresh();
 server.notes[0].body='\nBuy soy milk';server.revision=4;
 assert.equal(await f.notes.update('a','Milk\nBuy oat milk and bread'),false);
 assert.equal(f.notes.error,'Changed by your agent. Review and save again.');
 assert.deepEqual(server.calls.map(call=>call.method),['GET','POST','GET']);
 assert.equal(f.notes.view().notes[0].text,'Milk\nBuy soy milk','the refreshed agent text is shown; the caller still holds the typed text');
 assert.equal(f.interacts().length,1);f.notes.dispose();
});
test('a missing route is starting and retried, never an empty list; a missing view client is never resent',async()=>{
 const server=agent(),f=await fixture(server);
 server.next.push(()=>{throw Object.assign(Error('Not found'),{status:404});});
 await f.notes.refresh();assert.equal(f.notes.status,'starting');assert.equal(f.notes.view().notes.length,0);
 await new Promise(resolve=>setTimeout(resolve,1200));assert.equal(f.notes.status,'ready');assert.equal(f.notes.view().notes.length,1);
 server.next.push(()=>({requestId:'request',success:false,error:'Missing client id for frontend view interaction. Provide X-ElizaOS-Client-Id or clientId.'}));
 assert.equal(await f.notes.create('Bread'),false);assert.match(f.notes.error,/starting/);assert.equal(f.interacts().length,1);
 server.next.push(()=>{throw Object.assign(Error('Service unavailable'),{status:503});});
 await f.notes.refresh();assert.equal(f.notes.status,'unavailable');f.notes.dispose();
});
test('without a verified session the section is starting only while the agent starts',async()=>{
 const f=await fixture(agent(),{connected:false});await f.notes.refresh();assert.equal(f.notes.status,'starting');f.notes.dispose();
});
test('blank content is never sent and Undo recreates the deleted content exactly',async()=>{
 const server=agent(),f=await fixture(server);await f.notes.refresh();
 assert.equal(await f.notes.create('  \n '),false);assert.equal(await f.notes.update('a',' \n'),false);assert.equal(f.interacts().length,0);
 const content=await f.notes.remove(f.notes.view().notes[0].note);
 assert.equal(content,'Milk\nBuy oat milk');assert.equal(f.notes.view().notes.length,0);
 assert.equal(await f.notes.create(content),true);
 assert.deepEqual(f.interacts().map(body=>[body.capability,body.params]),[['delete-note',{id:'a'}],['create-note',{content:'Milk\nBuy oat milk'}]]);f.notes.dispose();
});
test('the single text editor round-trips stock content byte for byte',async()=>{
 const server=agent([note('a','','only body'),note('b','Title\n',''),note('c','Title only',''),note('d','Title','\n\nspaced  ')]),f=await fixture(server);await f.notes.refresh();
 assert.deepEqual(f.notes.view().notes.map(item=>item.text),['only body','Title\n','Title only','Title\n\nspaced  ']);
 for(const item of f.notes.view().notes)assert.equal(await f.notes.update(item.id,item.text),true);
 assert.equal(f.interacts().length,0,'unchanged text is not resaved');
 await f.notes.update('d','Title\n\nspaced  !');await settle();
 assert.deepEqual(f.interacts()[0].params,{id:'d',content:'Title\n\nspaced  !',expectedRevision:3});f.notes.dispose();
});
