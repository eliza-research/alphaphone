import test from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
test('owner return requires current workflow revision, pending exact proposal, expiry and stable session',()=>{
 const script=`
 import assert from 'node:assert/strict';
 import {revalidateApprovalNotice as check} from './apps/app/src/runtime/workflow-notice-return.ts';
 import {workflowApprovalNotice} from './apps/app/src/runtime/workflow-device-contract.ts';
 const route={scope:'a'.repeat(64),origin:'https://agent.invalid',ownerId:'owner',agentId:'agent',workflowId:'flow',runId:'run',versionId:'v1'};
 const bound=await workflowApprovalNotice(route,'proposal'),notice={...bound,route,expiresAt:200};
 function fixture(){let live=true;return {valid:()=>live,stop:()=>live=false,client:{detail:async()=>({versionId:'v1'}),receipt:async()=>({id:'run',workflowId:'flow',versionId:'v1',finished:false}),phoneReview:async()=>({finished:false,cancellationRequestedAt:null})},actions:async()=>[{id:'proposal',expiresAt:200}]};}
 const run=(f,n=notice)=>check(n,f.client,f.actions,f.valid,new AbortController().signal,()=>100);
 assert.equal(await run(fixture()),'resume');
 for(const change of [f=>f.client.detail=async()=>({versionId:'v2'}),f=>f.client.detail=async()=>({versionId:'v1',removed:true}),f=>f.client.receipt=async()=>({versionId:'v2'}),f=>f.client.receipt=async()=>({versionId:'v1',finished:true}),f=>f.client.phoneReview=async()=>({cancellationRequestedAt:'now'}),f=>f.actions=async()=>[],f=>f.actions=async()=>[{id:'different',expiresAt:200}],f=>f.actions=async()=>[{id:'proposal',expiresAt:201}]]){const f=fixture();change(f);assert.equal(await run(f),'withdraw');}
 assert.equal(await run(fixture(),{...notice,expiresAt:99}),'withdraw');
 assert.equal(await run(fixture(),{...notice,bindingHash:'b'.repeat(64)}),'withdraw');
 const stale=fixture();stale.client.detail=async()=>{stale.stop();return {versionId:'v1'}};assert.equal(await run(stale),'stale');
 const offline=fixture();offline.client.detail=async()=>{throw Error('offline')};await assert.rejects(()=>run(offline),/offline/);
 console.log('PASS');`;
 assert.match(execFileSync(process.execPath,['--import=tsx','--input-type=module','-e',script],{cwd:new URL('../',import.meta.url),encoding:'utf8'}),/PASS/);
});
