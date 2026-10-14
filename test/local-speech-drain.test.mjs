import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture(overrides={}){
 const events=new Map(),calls=[];
 const native={
  async addListener(name,callback){events.set(name,callback);return {async remove(){events.delete(name);}};},
  async synthesizeLocal(){return {playbackId:'owned-fixture',execution:'device'};},
  async play(){queueMicrotask(()=>events.get('playbackEnded')?.({playbackId:'owned-fixture'}));},
  async cancel(){calls.push('cancel');},async stopPlayback(){calls.push('stop');},...overrides,
 };
 const source=fs.readFileSync('apps/app/src/local-speech-playback.ts','utf8').replace(/^import .*;\n/gm,'').replaceAll('export async function','async function');
 const box={Capacitor:{isNativePlatform:()=>true},registerPlugin:()=>native,planLocalSpeech:text=>[text],AbortController,DOMException,Promise,Error,setTimeout,clearTimeout,crypto:globalThis.crypto};
 vm.runInNewContext(stripTypeScriptTypes(source,{mode:'transform'})+'\nglobalThis.run=speakLocalText;',box);
 return {run:()=>box.run('synthetic passage',new AbortController().signal,undefined,false,{execution:'device',assertCurrent(){}}),calls};
}
test('native local playback waits beyond the former timeout for both cleanup acknowledgments',async()=>{
 const cancel=deferred(),stop=deferred(),entered=deferred();
 const f=fixture({cancel:()=>cancel.promise,stopPlayback:()=>{entered.resolve();return stop.promise;}});
 let settled=false;const pending=f.run().finally(()=>{settled=true;});
 await entered.promise;await new Promise(resolve=>setTimeout(resolve,650));assert.equal(settled,false);
 cancel.resolve();await Promise.resolve();assert.equal(settled,false);
 stop.resolve();await pending;assert.equal(settled,true);
});
for(const method of ['cancel','stopPlayback'])test(`native local ${method} failure cannot become successful playback cleanup`,async()=>{
 const f=fixture({[method]:async()=>{throw Error('synthetic native drain failure');}});
 await assert.rejects(f.run(),error=>error.code==='speech-cleanup-unconfirmed'&&error.cause.message==='synthetic native drain failure');
});
test('native local successful playback confirms cancellation and stop',async()=>{
 const f=fixture();await f.run();assert.deepEqual(f.calls,['cancel','stop']);
});

test('local voice wrapper waits for cancelled playback drain and preserves its failure',async()=>{
 const started=deferred(),drain=deferred();let playbackSignal;
 const source=fs.readFileSync('apps/app/src/runtime/local-voice.ts','utf8').replace(/^import .*;\n/gm,'').replaceAll('export function','function').replaceAll('export type','type');
 const box={Capacitor:{isNativePlatform:()=>true,isPluginAvailable:()=>true},registerPlugin:()=>({cancel:async()=>{},releaseLocalSpeech:async()=>{}}),planLocalSpeech:text=>[text],
  speakLocalText:async(_text,signal)=>{playbackSignal=signal;started.resolve();await drain.promise;},
  connectionController:{getSnapshot:()=>({open:false,session:{sessionId:'fixture'}}),getCloudClient:()=>null,subscribe:()=>()=>{}},
  document:{hidden:false,documentElement:{dataset:{connectionMode:'live'}},addEventListener(){},removeEventListener(){}},AbortController,DOMException,Promise,Error,crypto:globalThis.crypto};
 vm.runInNewContext(stripTypeScriptTypes(source,{mode:'transform'})+'\nglobalThis.voice=createOnDeviceVoice();',box);
 const controller=new AbortController();let settled=false;
 const pending=box.voice.speak('synthetic passage',controller.signal).finally(()=>{settled=true;});
 const rejection=assert.rejects(pending,error=>error.code==='speech-cleanup-unconfirmed');
 await started.promise;controller.abort();await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(playbackSignal.aborted,true);assert.equal(settled,false);
 drain.reject(Object.assign(Error('synthetic drain refusal'),{code:'speech-cleanup-unconfirmed'}));await rejection;
});
