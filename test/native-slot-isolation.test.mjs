import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
test('actual digest inbox fallback stores only renderer namespace while native-ready uses validated transport',async()=>{
 const context={crypto:globalThis.crypto,AbortController};
 const digest=readFileSync(new URL('apps/app/src/runtime/hosted-digests.ts',root),'utf8').replace(/export /g,'');
 const factory=readFileSync(new URL('apps/app/src/runtime/digest-inbox.ts',root),'utf8').replace(/^import .*\n/gm,'').replace(/export /g,'');
 vm.runInNewContext(stripTypeScriptTypes(digest+'\n'+factory,{mode:'transform'})+'\nglobalThis.create=createDigestInbox;',context);
 for(const android of [true,false]){
  const reads=[],writes=[],saved=new Map(),storage={read:async k=>{reads.push(k);return saved.get(k)||null;},write:async(k,v)=>{writes.push(k);saved.set(k,v);},remove:async k=>{throw Error('Unexpected remove '+k);}};
  const input={android,nativeReady:false,storage,scope:'hosted-digests:v1:scope',native:()=>{throw Error('Unverified native use');}};
  const inbox=context.create(input);await inbox.history();await inbox.sync({results:async()=>[]},new AbortController().signal);
  assert.ok(writes.length>0);assert.ok([...reads,...writes].every(k=>k===(android?'renderer-hosted-digests:v1:scope':'hosted-digests:v1:scope')));
  const native={history:async()=>['native']};assert.equal(context.create({...input,android:true,nativeReady:true,native:()=>native}),native);
 }
});
