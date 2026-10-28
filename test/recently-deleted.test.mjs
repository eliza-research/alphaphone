import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transform} from 'esbuild';

// Execute the production review/delete methods with a synthetic transactional media store.
// No personal media, DOM, provider or Android device is touched by this host test.
const source=readFileSync('apps/app/src/prototype/browser-camera.ts','utf8');
const selection=source.slice(source.indexOf('function selectedMedia('),source.indexOf('async function selectedMediaRows('));
const methods=source.slice(source.indexOf(' async prepareDeleteTrash('),source.indexOf('\n};',source.indexOf(' async prepareDeleteTrash(')));
async function fixture(){
 const records=new Map(['a','b','c'].map(id=>[id,{id,kind:'image',trashed:id!=='c',mutationRevision:'r-'+id}]));
 const transaction=async(mode,action)=>{let result;const pending=[];action({get(id){const request={result:records.get(id)};pending.push(()=>request.onsuccess());return request;},delete(id){records.delete(id);}},value=>result=value);for(const finish of pending)finish();return result;};
 const code=await transform('const prepared=new Map();'+selection+'globalThis.library={'+methods+'};',{loader:'ts'});
 const context=vm.createContext({rows:async()=>[...records.values()],revision:()=>crypto.randomUUID(),transaction});vm.runInContext(code.code,context);
 return {records,library:context.library};
}
test('selected permanent deletion affects only the exact reviewed revisions',async()=>{
 const {records,library}=await fixture();const review=await library.prepareDeleteTrash({items:[{id:'a',revision:'r-a'}]});assert.equal(review.count,1);assert.equal(records.size,3,'review does not delete');
 const result=await library.deletePreparedTrash(review);assert.deepEqual([...result.deletedIds],['a']);assert.ok(records.has('b'));assert.ok(records.has('c'));await assert.rejects(library.deletePreparedTrash(review),/Review/);
});
test('restore or revision changes after review are skipped; new trash is excluded',async()=>{
 const {records,library}=await fixture();const review=await library.prepareDeleteTrash();records.get('a').trashed=false;records.get('b').mutationRevision='changed';records.get('c').trashed=true;
 const result=await library.deletePreparedTrash(review);assert.deepEqual([...result.deletedIds],[]);assert.deepEqual([...result.skippedIds].sort(),['a','b']);assert.equal(records.size,3);
});
test('invalid, duplicate and stale selection refuses preparation; cancel consumes review',async()=>{
 const {records,library}=await fixture();for(const items of [[],[{id:'a',revision:'old'}],[{id:'c',revision:'r-c'}],[{id:'a',revision:'r-a'},{id:'a',revision:'r-a'}]])await assert.rejects(library.prepareDeleteTrash({items}));
 const review=await library.prepareDeleteTrash({items:[{id:'b',revision:'r-b'}]});await library.cancelDeleteTrash(review);await assert.rejects(library.deletePreparedTrash(review));assert.equal(records.size,3);
});
test('native prepareDeleteTrash refuses a present but unusable items value instead of preparing all trash',()=>{
 // The shared OwnedMediaLibrary reads null as every trashed item, so {items:"x"} or {items:null} must be refused first.
 const java=readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaPhotosPlugin.java','utf8');
 const method=java.slice(java.indexOf('public void prepareDeleteTrash('),java.indexOf('public void cancelDeleteTrash('));
 assert.doesNotMatch(method,/has\("items"\)\?call\.getArray\("items"\):null/,'an unusable items value never becomes the all-trash null');
 assert.match(method,/if\(call\.getData\(\)\.has\("items"\)\)\{Object raw=call\.getData\(\)\.opt\("items"\);items=raw instanceof org\.json\.JSONArray\?call\.getArray\("items"\):null;if\(items==null\)\{call\.reject\("[^"]+"\);return;\}\}/);
 assert.ok(method.indexOf('call.reject("Select deleted items again.')<method.indexOf('owned.prepareDeleteTrash(items)'),'refusal happens before the shared library is asked');
});
