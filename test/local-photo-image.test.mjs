import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=readFileSync('apps/app/src/prototype/local-photo-image.ts','utf8');
const {readLocalPhotoImage}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source,{mode:'transform'})).toString('base64'));
const unavailable=()=>{throw Error('The native fetch bridge rejects data URLs');};
test('inline photo bytes survive without using native fetch',async()=>{
 const bytes=Uint8Array.of(255,216,0,128,255,217);
 const image=await readLocalPhotoImage('data:image/jpeg;base64,'+Buffer.from(bytes).toString('base64'),new AbortController().signal,unavailable);
 assert.equal(image.type,'image/jpeg');assert.deepEqual(new Uint8Array(await image.arrayBuffer()),bytes);
});
test('external, active and malformed image URLs never reach fetch',async()=>{
 let calls=0;const load=()=>{calls++;throw Error('Unexpected fetch');};
 for(const uri of ['https://example.com/a.jpg','file:///photo.jpg','data:image/svg+xml;base64,PHN2Zz4=','data:image/jpeg;base64,','data:image/jpeg;base64,%%%','data:image/jpeg;base64,A'])await assert.rejects(readLocalPhotoImage(uri,new AbortController().signal,load));
 assert.equal(calls,0);
});
test('blob images retain cancellation before and after reading',async()=>{
 const stopped=new AbortController();stopped.abort();await assert.rejects(readLocalPhotoImage('data:image/jpeg;base64,/9j/2Q==',stopped.signal,unavailable),{name:'AbortError'});
 const controller=new AbortController();const original=new Blob(['fixture'],{type:'image/png'});
 const read=async(uri,options)=>{assert.equal(uri,'blob:owned');assert.equal(options.signal,controller.signal);return new Response(original);};
 assert.equal(await(await readLocalPhotoImage('blob:owned',controller.signal,read)).text(),'fixture');
 await assert.rejects(readLocalPhotoImage('blob:owned',controller.signal,async()=>{controller.abort();return new Response(original);}),{name:'AbortError'});
});
