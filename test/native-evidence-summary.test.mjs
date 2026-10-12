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


test('CLI refuses excluded test artifacts in flat and nested archives before writing a report',async()=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
 const {createHash}=await import('node:crypto'),{spawnSync}=await import('node:child_process');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-summary-admission-'));
 try{
  for(const layout of ['flat','nested','nested-local']){
   const dir=path.join(root,layout),appDir=path.join(dir,'app'),testDir=path.join(dir,'test');
   fs.mkdirSync(appDir,{recursive:true});fs.mkdirSync(path.join(testDir,'instrumentation'),{recursive:true});
   const app=path.join(appDir,'standalone-debug.apk'),apk=path.join(testDir,...(layout==='flat'?[]:['instrumentation']),'standalone-androidTest.apk');
   fs.writeFileSync(app,'app fixture');fs.writeFileSync(apk,'test fixture');
   const receipt=run().record;
   receipt.apks=receipt.apks.map(row=>{const file=row.role==='app'?app:apk;return {...row,file,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')};});
   fs.writeFileSync(path.join(dir,'inventory.json'),JSON.stringify(inventory));fs.writeFileSync(path.join(dir,'receipt.json'),JSON.stringify(receipt));
   const limit=path.join(layout==='nested-local'?path.dirname(apk):testDir,'qualification-limit.json');
   fs.writeFileSync(limit,JSON.stringify({evidenceUsable:false}));
   const output=path.join(dir,'report.json');
   const args=['scripts/summarize-native-evidence.mjs',path.join(dir,'inventory.json'),output,path.join(dir,'receipt.json')];
   const refused=spawnSync(process.execPath,args,{encoding:'utf8'});
   assert.notEqual(refused.status,0,layout);assert.match(refused.stderr,/Archive excluded from evidence/);assert.equal(fs.existsSync(output),false);
   fs.writeFileSync(limit,JSON.stringify({evidenceUsable:true}));
   const admitted=spawnSync(process.execPath,args,{encoding:'utf8'});
   assert.equal(admitted.status,0,admitted.stderr);assert.equal(JSON.parse(fs.readFileSync(output)).counts.observedClasses,1);
  }
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('same fingerprint with different boot metadata or historical unknown metadata stays separate',()=>{
 const withDigest=digest=>run('passed',{emulator:{kind:'cuttlefish',image:{fingerprint:'image-A',vbmetaDigest:digest},abi:'x86_64',sdk:'37'}});
 const r=summarizeNativeEvidence(inventory,[run(),withDigest('a'.repeat(64)),withDigest('b'.repeat(64)),withDigest('a'.repeat(64))]);
 assert.equal(r.classes[0].cohorts.length,3);
 assert.equal(r.classes[0].cohorts[1].attempts.length,2);
 assert.equal(r.classes[0].cohorts[0].target.vbmetaDigest,null);
 assert.throws(()=>summarizeNativeEvidence(inventory,[withDigest('malformed')]),/Malformed image digest/);
});
