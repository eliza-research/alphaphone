import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import {runProviderConfiguration} from '../apps/app/src/runtime/abort-signal.ts';

test('native renderer propagates cancel before paused validation can commit',async()=>{
 let release,request,revoked=false,save=0,retire=0;
 const validation=new Promise(resolve=>release=resolve),controller=new AbortController();
 const pending=runProviderConfiguration(controller.signal,{
  async prepare(){return {requestId:"native-issued-request"};},
  async configure(id){request=id;await validation;if(revoked)throw Error('Credential request cancelled');save++;retire++;return {};},
  async cancel(id){assert.equal(id,request);revoked=true;},
 });
 await new Promise(resolve=>setImmediate(resolve));controller.abort(new DOMException('Back','AbortError'));await assert.rejects(pending,{name:'AbortError'});release();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(save,0);assert.equal(retire,0);
});
test('native renderer allows positive commit and refuses already cancelled setup before dispatch',async()=>{
 let save=0;
 const ports={async prepare(){return {requestId:"native-issued-positive"};},async configure(){save++;return {configured:true};},async cancel(){throw Error('unexpected cancellation');}};
 assert.deepEqual(await runProviderConfiguration(new AbortController().signal,ports),{configured:true});
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(runProviderConfiguration(cancelled.signal,ports),{name:'AbortError'});assert.equal(save,1);
});
test('provider cancellation is forwarded to each backend and checked before renderer state or retirement',()=>{
 const local=readFileSync(new URL('../apps/app/src/runtime/local-agent.ts',import.meta.url),'utf8');
 const host=readFileSync(new URL('../scripts/browser-cloud-dev-bridge.ts',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
 assert.match(local,/browserResidentCall\('residentOwn',[^;]+,signal\)/);
 assert.match(local,/prepare:\(\)=>native\.prepareProviderConfiguration/);
 assert.match(local,/cancel:requestId=>native\.cancelProviderConfiguration/);
 assert.match(host,/selectOwn\(\{apiKey:data\.apiKey,[^;]+controller\.signal\)/);
 assert.match(ui,/await configureLocalProvider\(apiKey,model,cartesiaKey,signal\);signal\.throwIfAborted\(\);const providerStatus=await localProviderStatus\(\);signal\.throwIfAborted\(\);update/);
});

test('cancelling before native reservation returns never dispatches keys or clear',async()=>{
 let reserved,cancelled=0,dispatched=0;const held=new Promise(resolve=>reserved=resolve);const controller=new AbortController();
 const pending=runProviderConfiguration(controller.signal,{prepare:()=>held,async configure(){dispatched++;},async cancel(id){assert.equal(id,'late-native-lease');cancelled++;}});
 controller.abort();reserved({requestId:'late-native-lease'});await assert.rejects(pending,{name:'AbortError'});assert.equal(cancelled,1);assert.equal(dispatched,0);
});
test('Cloud selection uses the same cancellation boundary on both backends',()=>{
 const local=readFileSync(new URL('../apps/app/src/runtime/local-agent.ts',import.meta.url),'utf8');
 const host=readFileSync(new URL('../scripts/browser-cloud-dev-bridge.ts',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
 assert.match(ui,/browserResidentCall\('residentCloud',undefined,undefined,undefined,signal\)/);assert.match(ui,/clearLocalProvider\(false,signal\)/);
 const clear=local.slice(local.indexOf('export async function clearLocalProvider('),local.indexOf('/** True only when native'));
 assert.match(clear,/runProviderConfiguration\(signal/);assert.match(host,/selectCloud\(controller\.signal\)/);
});

test('failed native dispatch releases its reserved lease',async()=>{
 let released=0;const problem=Error('invalid synthetic input');
 await assert.rejects(runProviderConfiguration(new AbortController().signal,{async prepare(){return {requestId:'rejected-native-lease'};},async configure(){throw problem;},async cancel(id){assert.equal(id,'rejected-native-lease');released++;}}),error=>error===problem);
 assert.equal(released,1);
});

// The real configureLocal and work() with native stubbed: Cancel stops waiting at once (as
// runProviderConfiguration does) and the status read after it answers whatever native reports.
function keyCheck(){
 const ui=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
 const part=(start,end)=>{const a=ui.indexOf(start),b=ui.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return ui.slice(a,b);};
 const source=`
  let state={open:true,purpose:'provider',busy:false,message:'',error:''},operation=null,operationGeneration=0,residentStartInBackground=false,signInReadinessOwner=null,active=null;
  const update=patch=>{state={...state,...patch};},residentRecoveryReason=()=>null,testMocksEnabled=false,expired=()=>false,errorMessage=e=>e.message,residentCloudFlow=()=>false,runQueuedResidentRebind=()=>{},runQueuedSignInReturn=()=>{},cloud={};
  const isAndroid=true,LOCAL_PROVIDER_MODEL='qwen-3.8-27b',OWN_KEYS_NOT_SET_UP='Own keys were not set up.',showPostSignInSetup=()=>{},retire=async()=>{},connectResident=async()=>{};
  const native={status:null,read:null};
  const configureLocalProvider=(apiKey,model,cartesiaKey,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  const localProviderStatus=()=>native.read?native.read():Promise.resolve(native.status);
  ${part('function ownProviderSelected(','\nfunction residentSignInRequired')}
  ${part('async function work(','/** Start (or restart) the resident.')}
  const controller={${part('  async configureLocal(','  /** Leaving the welcome own-key view')}${part('  async refreshProviderStatus()','  /** Stops the running agent')}cancel(){operation?.abort(new DOMException('Cancelled','AbortError'));}};
  return {controller,native,work,state:()=>state,seed:status=>{state={...state,providerStatus:status};native.status=status??null;},hold:value=>{operation=value;}};`;
 return new Function(transformSync(source,{loader:'ts',format:'cjs'}).code)();
}
const SAVED_BEFORE_CANCEL='The key was saved before Cancel. Own API keys are selected; switch back in Settings.';
const ownStatus=revision=>({provider:'cerebras',configured:true,selected:true,voiceConfigured:false,...(revision?{revision}:{})});
const cloudStatus={provider:'elizacloud',configured:false,selected:false,voiceConfigured:false};

test('a cancelled key check claims the save only on native evidence, never from a revision-less or unknown status',async()=>{
 for(const [before,after,claim,note] of [
  [ownStatus(),ownStatus(),false,'without revisions an earlier own key and this one look alike'],
  [ownStatus('a'),ownStatus('a'),false,'the same revision is the earlier key'],
  [undefined,ownStatus('b'),false,'status unknown before the check'],
  [cloudStatus,cloudStatus,false,'nothing was saved'],
  [cloudStatus,ownStatus(),true,'own keys where Cloud was selected'],
  [ownStatus('a'),ownStatus('b'),true,'a new native revision'],
 ]){
  const f=keyCheck();f.seed(before);
  const request=f.controller.configureLocal('synthetic-own-key');f.controller.cancel();f.native.status=after;await request;
  assert.deepEqual(f.state().providerStatus,after,note);assert.equal(f.state().message,claim?SAVED_BEFORE_CANCEL:'',note);assert.equal(f.state().busy,false,note);
 }
});

test('a cancelled key check drops its late status read once any newer operation began',async()=>{
 for(const newer of ['work','other']){
  const f=keyCheck();f.seed(cloudStatus);let answer,asked=false;f.native.read=()=>{asked=true;return new Promise(resolve=>answer=resolve);};
  const request=f.controller.configureLocal('synthetic-own-key');f.controller.cancel();
  while(!asked)await new Promise(resolve=>setImmediate(resolve));
  // A Cloud switch through work(), or an operation that owns the connection without it.
  let finish;if(newer==='work')void f.work('Switching to Cloud…',()=>new Promise(resolve=>finish=resolve));else f.hold(new AbortController());
  const current=f.state();answer(ownStatus('b'));await request;
  assert.equal(f.state(),current,`${newer}: the late read writes nothing`);assert.equal(f.state().providerStatus,cloudStatus,newer);
  if(newer==='work'){assert.equal(f.state().message,'Switching to Cloud…');finish();}
 }
});
