import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {embeddingBuildRemap,SDK_PROVENANCE_RECEIPT} from '../scripts/embedding-build-remap.mjs';
const root=path.resolve(import.meta.dirname,'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const run=(...args)=>spawnSync(process.execPath,['scripts/prepare-embedding-host.mjs',...args],{cwd:root,encoding:'utf8'});
test('remapping authenticates the reviewed SDK root and covers NDK header debug paths',()=>{
 const env=embeddingBuildRemap(root,{sdk:'/different/android-sdk',staging:'/isolated/source',fork:'/isolated/engine',build:'/isolated/jni'});
 const receipt=JSON.parse(fs.readFileSync(path.join(root,SDK_PROVENANCE_RECEIPT),'utf8'));
 assert.ok(receipt.env.CCC_OVERRIDE_OPTIONS.includes(`+-ffile-prefix-map=${receipt.env.ANDROID_HOME}=/work/android-sdk`));
 assert.ok(env.CCC_OVERRIDE_OPTIONS.includes('+-ffile-prefix-map=/different/android-sdk=/work/android-sdk'));
 assert.ok(env.CCC_OVERRIDE_OPTIONS.includes('+-ffile-prefix-map=/isolated/jni=/alphaphone-embedding-host/jni-build'));
 assert.throws(()=>embeddingBuildRemap(root,{sdk:'/sdk with spaces',staging:'/source',fork:'/engine',build:'/build'}),/absolute paths without whitespace/);
});
test('an edited provenance receipt cannot choose another canonical SDK path',()=>{
 const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'alpha-sdk-provenance-')));
 try{
  const receipt=path.join(temp,SDK_PROVENANCE_RECEIPT),manifest=path.join(temp,'android/embedding-host/qualified-host.json');
  fs.mkdirSync(path.dirname(receipt),{recursive:true});fs.mkdirSync(path.dirname(manifest),{recursive:true});
  const reviewed=fs.readFileSync(path.join(root,SDK_PROVENANCE_RECEIPT));
  fs.writeFileSync(manifest,JSON.stringify({qualificationReceiptSha256:createHash('sha256').update(reviewed).digest('hex')}));
  fs.writeFileSync(receipt,reviewed.toString().replace('/work/android-sdk','/unreviewed/sdk'));
  assert.throws(()=>embeddingBuildRemap(temp,{sdk:'/sdk',staging:'/source',fork:'/engine',build:'/build'}),/provenance receipt is missing or changed/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('native preparation refuses writes into vendor or prepared runtime source',()=>{
 for(const output of ['vendor/eliza/.forbidden-embedding-host','artifacts/forbidden-embedding-host']){
  const result=run('--fork',root,'--output',path.join(root,output));
  assert.notEqual(result.status,0);assert.match(result.stderr,/Output must be outside|Output must not traverse a symlink/);assert.equal(fs.existsSync(path.join(root,output)),false);
 }
});
test('native preparation preserves an existing artifact and rejects symlink output parents',()=>{
 const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'alpha-embed-prepare-')));
 try{
  const existing=path.join(temp,'retained');fs.mkdirSync(existing);fs.writeFileSync(path.join(existing,'receipt'),'retained');
  const retained=run('--fork',root,'--output',existing);assert.notEqual(retained.status,0);assert.match(retained.stderr,/Output already exists/);assert.equal(fs.readFileSync(path.join(existing,'receipt'),'utf8'),'retained');
  fs.symlinkSync(existing,path.join(temp,'link'),'dir');
  const linked=run('--fork',root,'--output',path.join(temp,'link','new'));assert.notEqual(linked.status,0);assert.match(linked.stderr,/must not traverse a symlink/);assert.equal(fs.existsSync(path.join(existing,'new')),false);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('wrong engine revision is refused before creating output or running a build',()=>{
 const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'alpha-embed-pin-'))),output=path.join(temp,'output');
 try{const result=run('--fork',root,'--output',output,'--build');assert.notEqual(result.status,0);assert.match(result.stderr,/Engine checkout must be clean at the exact Eliza gitlink/);assert.equal(fs.existsSync(output),false);}finally{fs.rmSync(temp,{recursive:true,force:true});}
});

// Exercise historical/component schemas independently of the product's current engine.
function componentFixture() {
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'android/embedding-host/qualified-host.json'),'utf8'));
 const legacyBytes=fs.readFileSync(path.join(root,SDK_PROVENANCE_RECEIPT));
 const legacy=JSON.parse(legacyBytes);
 delete manifest.sdkProvenance;
 for(const key of ['pin','forkPin','identity','abi','inputs','jniBinding'])manifest[key]=legacy[key];
 manifest.libraries=legacy.libraries.map(row=>({name:path.basename(row.path),sha256:row.sha256,bytes:row.bytes,alignment16KiB:row.alignment16KiB}));
 const engine=manifest.libraries.find(row=>row.name==='libelizainference.so');
 const receipt={schemaVersion:1,nativeCommit:manifest.forkPin,engine:{sha256:engine.sha256,bytes:engine.bytes,abi:manifest.abi},previousEngineSha256:engine.sha256,toolchain:{pathRemap:legacy.env.CCC_OVERRIDE_OPTIONS}};
 const currentBytes=Buffer.from(JSON.stringify(receipt)),currentPath='docs/evidence/synthetic-component.json';
 manifest.newArm64EngineQualification={receipt:currentPath,sourceCommit:manifest.forkPin,engineSha256:engine.sha256};
 manifest.previousQualification={receipt:sha(legacyBytes),engineSha256:engine.sha256};
 manifest.qualificationReceiptSha256=sha(currentBytes);
 return {manifest,currentPath,currentBytes,legacyBytes};
}
test('current component provenance and historical provenance retain the same authenticated SDK remap', t => {
 const {manifest,currentPath,currentBytes,legacyBytes}=componentFixture();
 const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-remap-current-'));
 t.after(()=>fs.rmSync(fixture,{recursive:true,force:true}));
 const write=(name,value)=>{const file=path.join(fixture,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));};
 write('android/embedding-host/qualified-host.json',manifest);write(currentPath,currentBytes);write(SDK_PROVENANCE_RECEIPT,legacyBytes);
 const inputs={sdk:'/different/android-sdk',staging:'/isolated/source',fork:'/isolated/engine',build:'/isolated/jni'};
 const current=embeddingBuildRemap(fixture,inputs);
 assert.ok(current.CCC_OVERRIDE_OPTIONS.includes('+-ffile-prefix-map=/different/android-sdk=/work/android-sdk'));
 const historical={...manifest,qualificationReceiptSha256:sha(legacyBytes)};
 delete historical.newArm64EngineQualification;
 write('android/embedding-host/qualified-host.json',historical);
 assert.deepEqual(embeddingBuildRemap(fixture,inputs),current);
 assert.equal(fs.existsSync(path.join(root,currentPath)),false);
 assert.deepEqual(fs.readFileSync(path.join(root,SDK_PROVENANCE_RECEIPT)),legacyBytes);
});

test('current provenance refuses mismatched admission, redirected receipts and malformed remaps', t => {
 const {manifest:admitted,currentPath,currentBytes,legacyBytes}=componentFixture();
 const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-remap-refuse-'));
 t.after(()=>fs.rmSync(fixture,{recursive:true,force:true}));
 const write=(name,value)=>{const file=path.join(fixture,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));};
 const inputs={sdk:'/different/android-sdk',staging:'/isolated/source',fork:'/isolated/engine',build:'/isolated/jni'};
 const cases=[
  ['wrong digest',m=>{m.qualificationReceiptSha256='0'.repeat(64);}],
  ['wrong identity',m=>{m.identity='foreign.app';}],
  ['wrong fork',m=>{m.forkPin='0'.repeat(40);}],
  ['wrong previous digest',m=>{m.previousQualification.receipt='0'.repeat(64);}],
  ['wrong engine',(_m,r)=>{r.engine.sha256='0'.repeat(64);}],
  ['missing engine',(_m,r)=>{delete r.engine;}],
  ['wrong native source',(_m,r)=>{r.nativeCommit='0'.repeat(40);}],
  ['wrong previous engine',(_m,r)=>{r.previousEngineSha256='0'.repeat(64);}],
  ['malformed remap',(_m,r)=>{r.toolchain.pathRemap='# -not-a-remap';}],
  ['relative remap',(_m,r)=>{r.toolchain.pathRemap='# +-ffile-prefix-map=relative=/work/android-sdk';}],
  ['noncanonical remap',(_m,r)=>{r.toolchain.pathRemap='# +-ffile-prefix-map=/host/../sdk=/work/android-sdk';}],
  ['conflicting source',(_m,r)=>{r.toolchain.pathRemap='# +-ffile-prefix-map=/sdk=/work/android-sdk +-ffile-prefix-map=/sdk=/other';}],
  ['ambiguous SDK target',(_m,r)=>{r.toolchain.pathRemap='# +-ffile-prefix-map=/sdk-a=/work/android-sdk +-ffile-prefix-map=/sdk-b=/work/android-sdk';}],
  ['changed SDK target',(_m,r)=>{r.toolchain.pathRemap='# +-ffile-prefix-map=/sdk=/unreviewed-sdk';}],
  ['redirected receipt',m=>{m.newArm64EngineQualification.receipt='../outside.json';}],
  ['missing receipt',m=>{m.newArm64EngineQualification.receipt='docs/absent.json';}],
 ];
 for(const [label,change] of cases){
  const manifest=structuredClone(admitted),receipt=JSON.parse(currentBytes);
  change(manifest,receipt);
  const bytes=Buffer.from(JSON.stringify(receipt));
  if(label!=='wrong digest')manifest.qualificationReceiptSha256=sha(bytes);
  write('android/embedding-host/qualified-host.json',manifest);write(currentPath,bytes);write(SDK_PROVENANCE_RECEIPT,legacyBytes);
  assert.throws(()=>embeddingBuildRemap(fixture,inputs),undefined,label);
 }
 write('android/embedding-host/qualified-host.json',admitted);write(SDK_PROVENANCE_RECEIPT,legacyBytes);
 fs.rmSync(path.join(fixture,currentPath));fs.symlinkSync(path.join(root,currentPath),path.join(fixture,currentPath));
 assert.throws(()=>embeddingBuildRemap(fixture,inputs),/symlink/);
});

function fullFixture() {
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'android/embedding-host/qualified-host.json'),'utf8'));
 const receiptPath=manifest.sdkProvenance.receipt;
 const bytes=fs.readFileSync(path.join(root,receiptPath));
 assert.equal(sha(bytes),manifest.qualificationReceiptSha256);
 return {manifest,receiptPath,bytes};
}
test('full Alpha JNI qualification authenticates the current SDK mapping without a historical engine identity',()=>{
 const {manifest,receiptPath,bytes}=fullFixture(),fixture=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-remap-full-'));
 try{
  for(const [name,value] of [['android/embedding-host/qualified-host.json',JSON.stringify(manifest)],[receiptPath,bytes]]){const file=path.join(fixture,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);}
  const env=embeddingBuildRemap(fixture,{sdk:'/different/android-sdk',staging:'/isolated/source',fork:'/isolated/engine',build:'/isolated/jni'});
  assert.match(env.CCC_OVERRIDE_OPTIONS,/\+-ffile-prefix-map=\/different\/android-sdk=\/work\/android-sdk/);
  assert.equal(fs.existsSync(path.join(fixture,SDK_PROVENANCE_RECEIPT)),false,'the full receipt needs no old engine receipt');
 }finally{fs.rmSync(fixture,{recursive:true,force:true});}
});
test('full qualification rejects changed source, native identity, library, receipt and SDK paths',()=>{
 const {manifest:admitted,receiptPath,bytes}=fullFixture(),fixture=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-remap-full-refuse-'));
 const write=(name,value)=>{const file=path.join(fixture,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));};
 const inputs={sdk:'/different/android-sdk',staging:'/isolated/source',fork:'/isolated/engine',build:'/isolated/jni'};
 try{
  const cases=[
   ['hash',m=>{m.qualificationReceiptSha256='0'.repeat(64);}],
   ['source',(_m,r)=>{r.pin='0'.repeat(40);}],['fork',(_m,r)=>{r.forkPin='0'.repeat(40);}],
   ['identity',(_m,r)=>{r.identity='foreign.app';}],['abi',(_m,r)=>{r.abi='x86_64';}],
   ['input',(_m,r)=>{r.inputs[0].generatedSha256='0'.repeat(64);}],
   ['jni',(_m,r)=>{r.jniBinding.className='foreign/app/ElizaVoiceNative';}],
   ['library',(_m,r)=>{r.libraries[0].sha256='0'.repeat(64);}],
   ['duplicate library',(_m,r)=>{r.libraries[1]=r.libraries[0];}],
   ['unbuilt',(_m,r)=>{r.built=false;}],['unqualified',(_m,r)=>{r.qualification.passed=false;}],
   ['schema',m=>{m.sdkProvenance.schema='unknown';}],
   ['mixed schemas',m=>{m.newArm64EngineQualification={};}],
   ['outside receipt',m=>{m.sdkProvenance.receipt='../outside.json';}],
   ['absolute receipt',m=>{m.sdkProvenance.receipt='/outside.json';}],
   ['missing receipt',m=>{m.sdkProvenance.receipt='docs/absent.json';}],
   ['SDK target',(_m,r)=>{r.env.CCC_OVERRIDE_OPTIONS=r.env.CCC_OVERRIDE_OPTIONS.replace('/work/android-sdk','/unreviewed/sdk');}],
   ['relative mapping',(_m,r)=>{r.env.CCC_OVERRIDE_OPTIONS='# +-ffile-prefix-map=relative=/work/android-sdk';}],
   ['conflicting source',(_m,r)=>{r.env.CCC_OVERRIDE_OPTIONS=`# +-ffile-prefix-map=${r.env.ANDROID_HOME}=/work/android-sdk +-ffile-prefix-map=${r.env.ANDROID_HOME}=/other`;}],
   ['ambiguous SDK target',(_m,r)=>{r.env.CCC_OVERRIDE_OPTIONS+=` +-ffile-prefix-map=/another-sdk=/work/android-sdk`;}],
  ];
  for(const [label,change] of cases){const manifest=structuredClone(admitted),receipt=JSON.parse(bytes);change(manifest,receipt);const changed=Buffer.from(JSON.stringify(receipt));if(label!=='hash')manifest.qualificationReceiptSha256=sha(changed);write('android/embedding-host/qualified-host.json',manifest);write(receiptPath,changed);assert.throws(()=>embeddingBuildRemap(fixture,inputs),undefined,label);}
  write('android/embedding-host/qualified-host.json',admitted);fs.rmSync(path.join(fixture,receiptPath));fs.symlinkSync(path.join(root,receiptPath),path.join(fixture,receiptPath));assert.throws(()=>embeddingBuildRemap(fixture,inputs),/symlink/);
 }finally{fs.rmSync(fixture,{recursive:true,force:true});}
});
