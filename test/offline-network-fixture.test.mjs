import test from 'node:test';
import assert from 'node:assert/strict';
import {OfflineNetworkFixture} from '../scripts/offline-network-fixture.mjs';
import {parseInstrumentationArgs} from '../scripts/android-instrumentation.mjs';
function device({airplane='disabled',wifi='1',connected=false,fail=()=>false}={}) {
 const calls=[];
 const adb=args=>{
  const command=args.join(' ');calls.push(command);
  if(fail(command))throw Error('injected command failure');
  if(command==='shell cmd connectivity airplane-mode')return airplane;
  if(command==='shell settings get global wifi_on')return wifi;
  if(command==='shell dumpsys connectivity')return `Active default network: ${connected?'100':'none'}`;
  if(command.startsWith('shell cmd connectivity airplane-mode '))airplane=args.at(-1)==='enable'?'enabled':'disabled';
  else if(command.startsWith('shell cmd wifi set-wifi-enabled '))wifi=args.at(-1)==='enabled'?'1':'0';
  else throw Error('Unexpected command '+command);
  return '';
 };
 return {adb,calls};
}
const timing={sleep:async()=>{}};
test('unknown original state refuses mutation',()=>{
 const d=device({wifi:'null'});assert.throws(()=>new OfflineNetworkFixture(d.adb,timing),/Unknown/);
 assert.equal(d.calls.length,2);
});
test('offline observation and exact original settings restoration',async()=>{
 for(const airplane of ['enabled','disabled'])for(const wifi of ['0','1']){
  const d=device({airplane,wifi}),f=new OfflineNetworkFixture(d.adb,timing);
  await f.enter();f.restore();assert.equal(f.receipt.offlineObserved,true);
  assert.equal(f.receipt.restored,true);assert.deepEqual(f.receipt.after,{airplane,wifi});
 }
});
test('partial setup failure still restores both settings',async()=>{
 let injected=false;const d=device({fail:c=>{if(!injected&&c.endsWith('set-wifi-enabled disabled')){injected=true;return true;}return false;}});
 const f=new OfflineNetworkFixture(d.adb,timing);
 try{await assert.rejects(f.enter(),/injected/);}finally{f.restore();}
 assert.equal(f.receipt.restored,true);assert.equal(f.receipt.offlineObserved,false);
 assert.ok(d.calls.includes('shell cmd wifi set-wifi-enabled enabled'));
});
test('persistent network times out and restores before tests can run',async()=>{
 const d=device({connected:true}),f=new OfflineNetworkFixture(d.adb,timing);
 try{await assert.rejects(f.enter(),/no test started/);}finally{f.restore();}
 assert.equal(d.calls.filter(c=>c==='shell dumpsys connectivity').length,20);
 assert.equal(f.receipt.restored,true);assert.equal(f.receipt.offlineObserved,false);
});
test('restoration failure attempts remaining settings and cannot claim restored',async()=>{
 const d=device({fail:c=>c==='shell cmd connectivity airplane-mode disable'}),f=new OfflineNetworkFixture(d.adb,timing);
 await f.enter();assert.throws(()=>f.restore(),/not proven restored/);
 assert.equal(f.receipt.restored,false);assert.ok(d.calls.includes('shell cmd wifi set-wifi-enabled enabled'));
});
test('offline Cuttlefish speech is explicit and cannot mix online classes',()=>{
 const base=['--owned-cuttlefish','--serial','127.0.0.1:6529','--image-fingerprint','owned-test-image'];
 assert.throws(()=>parseInstrumentationArgs([...base,'--classes','LocalSpeechBridge']),/requires --offline-speech/);
 assert.throws(()=>parseInstrumentationArgs([...base,'--offline-speech','--classes','LocalSpeechBridge,Shell']),/dedicated/);
 assert.throws(()=>parseInstrumentationArgs(['--offline-speech']),/requires an owned/);
 assert.equal(parseInstrumentationArgs([...base,'--offline-speech','--classes','LocalSpeechBridge,VoiceNoteReadAloud,SpeechSentenceCancellation']).offlineSpeech,true);
});

test('passing methods cannot override missing offline or restoration evidence',async()=>{
 const {writeInstrumentationRecord}=await import('../scripts/instrumentation-result.mjs');
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-offline-'));
 try{
  for(const offlineObserved of [true,false])for(const restored of [true,false]){
   const record=writeInstrumentationRecord(path.join(dir,`${offlineObserved}-${restored}.json`),{
    commit:'a'.repeat(40),apks:[{role:'app',variant:'standalone',sha256:'b'.repeat(64)}],
    classes:[{class:'ai.elizaresearch.alphaphone.LocalSpeechBridgeInstrumentedTest',variant:'standalone',status:'passed'}],
    offlineNetwork:{offlineObserved,restored}
   });
   assert.equal(record.passed,offlineObserved&&restored);
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
