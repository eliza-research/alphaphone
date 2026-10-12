import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeNativeEvidence} from '../scripts/summarize-native-evidence.mjs';
const inventory={classes:[{name:'AlphaTest'},{name:'UnrunTest'}]};
function run(status='passed',extra={},row={}){return {file:extra.file||'receipt.json',record:{evidenceClass:'E',runId:'run',createdAt:'2026-10-12T00:00:00Z',commit:'a'.repeat(40),dirty:true,testMocks:false,emulator:{kind:'cuttlefish',image:{fingerprint:'image-A'},abi:'x86_64',sdk:'37'},apks:['app','test'].map(role=>({variant:'standalone',role,sha256:'b'.repeat(64)})),classes:[{class:'product.AlphaTest',variant:'standalone',status,passed:1,failed:[],ignored:[],...row}],...extra}};}
test('observed passes do not fill unexecuted classes or hide skipped methods',()=>{
 const r=summarizeNativeEvidence(inventory,[run('passed',{}, {ignored:['needsOwnCampaign']})]);
 assert.equal(r.counts.unobservedClasses,1);assert.equal(r.counts.latestCohorts.partial,1);
 assert.deepEqual(r.classes[0].cohorts[0].latest.skippedMethods,['needsOwnCampaign']);
});
test('later failure wins within its cohort; other images and mock runs stay separate',()=>{
 const r=summarizeNativeEvidence(inventory,[run(),run('failed',{createdAt:'2026-10-12T01:00:00Z'},{passed:0,failed:['broken']}),run('passed',{testMocks:true}),run('passed',{emulator:{kind:'cuttlefish',image:{fingerprint:'image-B'},abi:'arm64-v8a',sdk:'35'}})]);
 assert.equal(r.classes[0].cohorts.length,3);assert.equal(r.classes[0].cohorts[0].latest.status,'failed');assert.equal(r.classes[0].cohorts[0].attempts.length,2);
});
test('unbound and unknown evidence is refused instead of inflating coverage',()=>{
 assert.throws(()=>summarizeNativeEvidence(inventory,[run('passed',{apks:[]})]),/APK pair/);
 assert.throws(()=>summarizeNativeEvidence(inventory,[run('passed',{}, {class:'unknown.Test'})]),/absent/);
 assert.throws(()=>summarizeNativeEvidence(inventory,[run('passed',{evidenceClass:'physical'})]),/Malformed/);
 assert.throws(()=>summarizeNativeEvidence({classes:[{name:'AlphaTest',qualifiedName:'expected.AlphaTest'}]},[run()]),/absent/);
 assert.throws(()=>summarizeNativeEvidence({classes:[{name:'AlphaTest'},{name:'AlphaTest'}]},[]),/duplicate/);
});
test('provider identities and historical unknown providers remain separate',()=>{
 const provider={packageName:'com.android.webview',version:'145.0',apkSha256:['a'.repeat(64)]};
 const r=summarizeNativeEvidence(inventory,[run(),run('passed',{webView:provider}),run('failed',{webView:{...provider,apkSha256:['b'.repeat(64)]}})]);
 assert.equal(r.classes[0].cohorts.length,3);
 assert.equal(r.classes[0].cohorts[0].target.webView,null);
});
