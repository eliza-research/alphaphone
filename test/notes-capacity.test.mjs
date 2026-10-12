import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tsImport} from 'tsx/esm/api';
import {notesValueFits,NOTES_SLOT_MAX_BYTES} from '../apps/app/src/runtime/notes-capacity.ts';
const {SecureNotesStore,capacityAware,NotesStorageFull,SECURE_NOTES_SLOT,SECURE_NOTES_DRAFT_SLOT}=await tsImport('../apps/app/src/runtime/notes-secure-store.ts',import.meta.url);

test('Notes capacity uses exact JSON UTF-8 bytes, including escaping and surrogate pairs',()=>{
 for(const value of [null,{},'ascii','é','漢字','😀','a😀é漢\n"\\', '\ud800', '\udc00',{body:'é😀\n'.repeat(200)}]){
  const bytes=new TextEncoder().encode(JSON.stringify(value)).length;
  assert.equal(notesValueFits(value,bytes),true);
  assert.equal(notesValueFits(value,bytes-1),false);
 }
 assert.equal(NOTES_SLOT_MAX_BYTES,32*1024*1024);
 assert.match(fs.readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaCredentialStore.java','utf8'),/if\(NOTES_RECORDS.equals\(name\)\)return 32\*1024\*1024/);
});

test('oversized Notes records and drafts are refused before crossing the native bridge',async()=>{
 let calls=0;const vault={read:async()=>null,compareExchange:async()=>{calls++;return {status:'saved'};}};
 const bounded=capacityAware(vault),large={body:'x'.repeat(NOTES_SLOT_MAX_BYTES)};
 for(const key of [SECURE_NOTES_SLOT,SECURE_NOTES_DRAFT_SLOT])await assert.rejects(bounded.compareExchange(key,null,large),error=>error instanceof NotesStorageFull&&error.code==='storage-full');
 assert.equal(calls,0);
 assert.deepEqual(await bounded.compareExchange(SECURE_NOTES_SLOT,null,{body:'kept'}),{status:'saved'});
 assert.equal(calls,1);
});

test('native capacity errors stay definite; other failures retain their identity',async()=>{
 const failure=new Error('native failure');
 for(const error of [{code:'storage-full'},failure]){
  const bounded=capacityAware({read:async()=>null,compareExchange:async()=>{throw error;}});
  await assert.rejects(bounded.compareExchange(SECURE_NOTES_SLOT,null,{}),actual=>error===failure?actual===failure:actual instanceof NotesStorageFull);
 }
});

test('an oversized collection stays a definite refusal through the shared document store',async()=>{
 const data=new Map();let writes=0;
 const vault={read:async key=>data.get(key)??null,compareExchange:async(key,expected,value)=>{
  assert.deepEqual(data.get(key)??null,expected);writes++;data.set(key,value);return {status:'saved'};
 }};
 const legacy={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
 const kept={id:'kept',title:'kept',body:'original',kind:'text',pinned:false,when:'Saved on this device'};
 const store=await SecureNotesStore.open(vault,legacy,[kept]);
 const before=JSON.stringify(data.get(SECURE_NOTES_SLOT)),count=writes;
 await assert.rejects(store.replace([{...kept,body:'x'.repeat(NOTES_SLOT_MAX_BYTES)}]),error=>error instanceof NotesStorageFull);
 assert.equal(writes,count,'No attempted native write for an oversized collection');
 assert.equal(JSON.stringify(data.get(SECURE_NOTES_SLOT)),before,'The saved record remains byte-identical');
});
