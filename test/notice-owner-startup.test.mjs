import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {EntitlementError} from '../apps/app/src/runtime/subscription-entitlement.ts';
const coordinatorSource=stripTypeScriptTypes(readFileSync('apps/app/src/runtime/notice-owner-coordinator.ts','utf8'),{mode:'transform'}).replace(/export /g,'');
const controllerSource=stripTypeScriptTypes(readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8').split('export function ConnectionChooser()')[0].replace(/^import .*;\n/gm,'').replace(/export /g,''),{mode:'transform'});
function fixture({offline=false,credential=null,fail=false}={}){
 let release;const read=new Promise(resolve=>release=resolve),transitions=[];
 const memory=new Map(offline?[['alpha.connection.selection.v1',JSON.stringify({kind:'offline',localApps:true})]]:[]);
 const box={EntitlementError,devSurfacesEnabled:false,devProfileQuery:false,testMocksEnabled:false,isAndroid:true,browserLocalAgentEnabled:false,registerPlugin:()=>({}),CloudProtocol:class{},nativeCloudRequest:()=>{throw Error('No provider request');},openConnectionBrowser:()=>{throw Error('No browser');},cloudCredentialStore:{read:async()=>{await read;return credential;}},localStorage:{getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},URL,URLSearchParams,AbortController,DOMException,console,transitions,fail};
 // Only resident transport admission is synthetic. Real initialize/work/update/subscribe and the
 // real coordinator run together; no live credential or provider is involved.
 vm.runInNewContext(coordinatorSource+'\n'+controllerSource+`\nconnectResident=async()=>{if(fail)throw Error('revoked');update({session:{sessionId:'A',origin:'https://a.invalid',ownerId:'A',agentId:'agent'}});};
 let queue=Promise.resolve();const notices=new NoticeOwnerCoordinator({transition:async s=>{transitions.push(s.owner?.ownerId??null);return{};},enqueue:work=>queue=queue.then(work),available:()=>true,restore:async()=>{}});
 const changed=()=>{const s=connectionController.getSnapshot(),a=s.session;notices.update({identity:a?.sessionId??'',owner:a?{origin:a.origin,ownerId:a.ownerId,agentId:a.agentId}:null,hasSession:!!a,startupResolved:s.startupResolved,busy:s.busy});};connectionController.subscribe(changed);changed();globalThis.controller=connectionController;globalThis.drain=()=>queue;`,box);
 return{...box,release,transitions,memory};
}
test('cold restoration keeps the old fence until the real controller resolves its identity',async()=>{
 const f=fixture({credential:{credentialId:'synthetic'}}),pending=f.controller.initialize();await Promise.resolve();assert.deepEqual(f.transitions,[]);assert.equal(f.controller.getSnapshot().startupResolved,false);
 f.release();await pending;await f.drain();assert.deepEqual(f.transitions,['A']);assert.equal(f.controller.getSnapshot().startupResolved,true);
 await f.controller.initialize();await f.drain();assert.deepEqual(f.transitions,['A'],'settled initialize does not repeat the fence');
});
for(const [name,options] of [['no credential',{}],['revoked restoration',{credential:{credentialId:'revoked'},fail:true}]])test('cold '+name+' retires the persisted owner after initialization settles',async()=>{
 const f=fixture(options),pending=f.controller.initialize();await Promise.resolve();assert.deepEqual(f.transitions,[]);f.release();await pending;await f.drain();assert.deepEqual(f.transitions,[null]);assert.equal(f.controller.getSnapshot().session,null);assert.equal(f.controller.getSnapshot().startupResolved,true);
});

test('cold retired local-only choice migrates to the plan gate and restores the kept sign-in',async()=>{
 const f=fixture({offline:true,credential:{credentialId:'kept'}}),pending=f.controller.initialize();await Promise.resolve();assert.deepEqual(f.transitions,[]);f.release();await pending;await f.drain();
 assert.deepEqual(f.transitions,['A']);
 assert.deepEqual(JSON.parse(f.memory.get('alpha.connection.selection.v1')),{kind:'none'},'only the retired preference is replaced');
});
test('reconnects retire the session while busy, and the notice owner update carries that state',()=>{
 // The real controller marks the connection busy before Continue / Check plan again / pairing
 // retires the session; the coordinator (tested directly) defers a null owner until it settles.
 const controller=readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8'),adapter=readFileSync('apps/app/src/prototype/workflow-adapter.ts','utf8');
 assert.match(controller,/update\(\{ busy: true, open: true, message, error: '' \}\);\s*try \{ await action\(controller\.signal\); \}/);
 assert.match(controller,/async startLocal\(\) \{ await work\('Starting the local agent…', signal => \{ retire\(\);/);
 assert.match(adapter,/startupResolved:connectionController\.getSnapshot\(\)\.startupResolved,busy:connectionController\.getSnapshot\(\)\.busy\}\)/);
});
