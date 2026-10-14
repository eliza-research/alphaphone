import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const source=fs.readFileSync('apps/app/src/runtime/device-speech.ts','utf8').replace(/^import .*;\n/gm,'').replace('export async function','async function');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(){
 const f={session:null,account:null,hidden:false,locked:false,open:false,ready:true,available:true,checks:0,calls:[],started:0,ended:0};
 const subscriptions=new Set(),events=new Map();
 const listen=(name,fn)=>{if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);};
 const remove=(name,fn)=>events.get(name)?.delete(fn);
 const box={JSON,Array,Error,Promise,AbortController,DOMException,
  Capacitor:{isNativePlatform:()=>true},
  connectionController:{getSnapshot:()=>({session:f.session?{sessionId:f.session}:null,open:f.open}),getCloudEnvironment:()=>f.account?'production':null,getCloudClient:()=>f.account?{sessionId:f.account,credentialId:'synthetic-handle'}:null,subscribe:fn=>{subscriptions.add(fn);return()=>subscriptions.delete(fn);}},
  document:{get hidden(){return f.hidden;},documentElement:{dataset:{connectionMode:'live'}},querySelectorAll:()=>f.locked?[{getClientRects:()=>[{}]}]:[],addEventListener:listen,removeEventListener:remove},window:{addEventListener:listen,removeEventListener:remove},
  createOnDeviceVoice:()=>f.available?{ready:async signal=>{signal.throwIfAborted();f.checks++;return f.ready;}}:null,
  speakLocalText:async(text,signal,onStarted,queue,requirements)=>{f.calls.push({text,signal,queue,execution:requirements.execution});requirements.assertCurrent();onStarted();if(f.playback)await f.playback(signal);signal.throwIfAborted();requirements.assertCurrent();},
  markTtsPlaybackStarted:()=>f.started++,markTtsPlaybackEnded:()=>f.ended++,
 };
 vm.runInNewContext(stripTypeScriptTypes(source,{mode:'transform'})+'\nglobalThis.run=speakDeviceText;',box);
 return Object.assign(f,{run:box.run,emit:name=>{for(const fn of events.get(name)||[])fn();},changed:()=>{for(const fn of subscriptions)fn();},listeners:()=>subscriptions.size+[...events.values()].reduce((n,s)=>n+s.size,0)});
}
test('signed-out app speech uses local execution and preserves queued playback and start acknowledgment',async()=>{
 const f=fixture();let began=0;await f.run('Turn left',new AbortController().signal,()=>began++,true);
 assert.equal(f.checks,1);assert.equal(f.calls.length,1);assert.equal(f.calls[0].execution,'device');assert.equal(f.calls[0].queue,true);
 assert.equal(began,1);assert.equal(f.started,1);assert.equal(f.ended,1);assert.equal(f.listeners(),0);
});
test('missing local plugin or models refuse speech without a network fallback',async()=>{
 for(const key of ['available','ready']){const f=fixture();f[key]=false;await assert.rejects(f.run('Read this',new AbortController().signal),/On-device speech/);assert.equal(f.calls.length,0);assert.equal(f.listeners(),0);}
});
test('hidden, locked and already-cancelled requests do not initialize speech',async()=>{
 for(const mode of ['hidden','locked','aborted']){const f=fixture(),controller=new AbortController();if(mode==='aborted')controller.abort();else f[mode]=true;await assert.rejects(f.run('Private text',controller.signal));assert.equal(f.checks,0);assert.equal(f.calls.length,0);}
});
test('owner change cancels audio but waits for its native drain before another utterance',async()=>{
 const f=fixture(),drain=deferred();f.session='owner-a';f.playback=()=>drain.promise;
 let settled=false;const first=f.run('First text',new AbortController().signal).finally(()=>{settled=true;});const rejected=assert.rejects(first,{name:'AbortError'});
 await tick();f.session='owner-b';f.changed();assert.equal(f.calls[0].signal.aborted,true);await tick();assert.equal(settled,false);
 const second=f.run('New owner text',new AbortController().signal);await tick();assert.equal(f.calls.length,1);
 f.playback=null;drain.resolve();await rejected;await second;assert.equal(f.calls.length,2);assert.equal(f.started,f.ended);assert.equal(f.listeners(),0);
});
test('unconfirmed native drain rejects queued and later app speech',async()=>{
 const f=fixture(),drain=deferred(),failure=Object.assign(Error('Unconfirmed stop'),{code:'speech-cleanup-unconfirmed'});f.playback=()=>drain.promise;
 const first=f.run('First',new AbortController().signal),firstRejected=assert.rejects(first,error=>error===failure);await tick();
 const second=f.run('Queued',new AbortController().signal),secondRejected=assert.rejects(second,error=>error===failure);await tick();assert.equal(f.calls.length,1);
 drain.reject(failure);await firstRejected;await secondRejected;await assert.rejects(f.run('Later',new AbortController().signal),error=>error===failure);assert.equal(f.calls.length,1);assert.equal(f.listeners(),0);
});
test('cancelling a queued request settles promptly and never starts it after the prior drain',async()=>{
 const f=fixture(),drain=deferred();f.playback=()=>drain.promise;const first=f.run('First',new AbortController().signal);await tick();
 const controller=new AbortController(),second=f.run('Cancelled queue',controller.signal),rejected=assert.rejects(second,{name:'AbortError'});controller.abort();await rejected;assert.equal(f.calls.length,1);
 drain.resolve();await first;await tick();assert.equal(f.calls.length,1);assert.equal(f.listeners(),0);
});
