import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {load} from './fixtures/cloud-voice-view.mjs';

// The actual browser reading review in a closed DOM: a failed reading ends with no status text and
// Read locally ready again; a finished reading says so.
async function review(speak){
 const {window}=new JSDOM('<!doctype html><body></body>');window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 const box={document:window.document,window,getComputedStyle:window.getComputedStyle.bind(window),URL,AbortController,DOMException,console,layoutBrowserDialog(){},sensitiveReadingUrl:()=>false,sensitiveReadingText:()=>false,browserReadingSource:async()=>({text:'Public page text.',truncated:false}),speakLocalText:speak};
 load('browser/reading-review.ts',box,['reviewBrowserReading']);
 const closing=new AbortController(),done=box.reviewBrowserReading('https://example.test/page',closing.signal,()=>{});
 const tick=async()=>{for(let count=0;count<10;count++)await new Promise(resolve=>setTimeout(resolve,0));};await tick();
 const button=name=>[...window.document.querySelectorAll('button')].find(item=>item.textContent===name);
 return {tick,button,status:()=>window.document.querySelector('[role="status"]').textContent,close:async()=>{closing.abort();await done;}};
}
test('a reading that fails leaves no status text and Read locally ready again',async()=>{
 let reads=0;const f=await review(async()=>{reads++;if(reads===1)throw Error('PRIVATE_ENGINE_TEXT');});
 try{
  f.button('Read locally').click();await f.tick();
  assert.equal(f.status(),'');assert.equal(f.button('Read locally').disabled,false);assert.equal(f.button('Stop reading').disabled,true);
  f.button('Read locally').click();await f.tick();assert.equal(reads,2);assert.equal(f.status(),'Reading finished.');
 }finally{await f.close();}
});
test('a reading that plays reports its progress and its end',async()=>{
 let finish;const f=await review((text,signal,started)=>new Promise(resolve=>{started();finish=resolve;}));
 try{
  f.button('Read locally').click();await f.tick();assert.equal(f.status(),'Reading locally…');assert.equal(f.button('Stop reading').disabled,false);
  finish();await f.tick();assert.equal(f.status(),'Reading finished.');assert.equal(f.button('Read locally').disabled,false);
 }finally{await f.close();}
});
