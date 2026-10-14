import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyEmbeddingHost, verifyEmbeddingInputs} from '../scripts/stage-embedding-host.mjs';
const root=path.resolve(import.meta.dirname,'..');
const git=(directory,...args)=>execFileSync('git',['-C',directory,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const qualified=JSON.parse(fs.readFileSync(path.join(root,'android/embedding-host/qualified-host.json'),'utf8'));
function fixture({currentOnly=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-embed-admission-'));
 for(const name of ['upstream.lock.json','app.config.json','android/embedding-host/qualified-host.json']){fs.mkdirSync(path.dirname(path.join(dir,name)),{recursive:true});fs.copyFileSync(path.join(root,name),path.join(dir,name));}
 const vendor=path.join(dir,'vendor/eliza');fs.mkdirSync(path.dirname(vendor),{recursive:true});
 if(currentOnly){
  fs.mkdirSync(vendor);git(vendor,'init');
  for(const row of qualified.inputs){const file=path.join(vendor,row.path);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,execFileSync('git',['-C',path.join(root,'vendor/eliza'),'show','HEAD:'+row.path]));}
 }else{
  fs.mkdirSync(vendor);git(vendor,'init');
  // Borrow only the checked-out objects; cloning a partial source can fetch unrelated history.
  const objects=git(path.join(root,'vendor/eliza'),'rev-parse','--path-format=absolute','--git-path','objects');
  fs.writeFileSync(path.join(vendor,'.git/objects/info/alternates'),objects+'\n');
  git(vendor,'sparse-checkout','init','--no-cone');
  git(vendor,'sparse-checkout','set','--no-cone',...qualified.inputs.map(row=>'/'+row.path),'/plugins/plugin-local-inference/native/llama.cpp');
  git(vendor,'checkout','--detach',JSON.parse(fs.readFileSync(path.join(dir,'upstream.lock.json'),'utf8')).commit);
 }
 git(vendor,'config','user.name','Embedding fixture');git(vendor,'config','user.email','embedding-fixture@example.invalid');
 if(currentOnly){
  fs.mkdirSync(path.join(vendor,'plugins/plugin-local-inference/native/llama.cpp'),{recursive:true});
  git(vendor,'add',...qualified.inputs.map(row=>row.path));git(vendor,'update-index','--add','--cacheinfo','160000,'+qualified.forkPin+',plugins/plugin-local-inference/native/llama.cpp');git(vendor,'commit','-m','Current native input fixture');
  const commit=git(vendor,'rev-parse','HEAD'),file=path.join(dir,'upstream.lock.json'),lock=JSON.parse(fs.readFileSync(file,'utf8'));lock.commit=commit;fs.writeFileSync(file,JSON.stringify(lock));fs.writeFileSync(path.join(vendor,'.git/shallow'),commit+'\n');
 }
 // Tiny content fixtures retain the production manifest shape; the known BGE hash is checked last.
 for(const row of qualified.libraries){const file=path.join(dir,'android/app/src/main/jniLibs/arm64-v8a',row.name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'fixture-'+row.name);}
 const manifest=structuredClone(qualified);for(const row of manifest.libraries){row.sha256=createHash('sha256').update('fixture-'+row.name).digest('hex');row.bytes=Buffer.byteLength('fixture-'+row.name);}
 fs.writeFileSync(path.join(dir,'android/embedding-host/qualified-host.json'),JSON.stringify(manifest));
 return {dir,vendor,manifest,lock(commit){const file=path.join(dir,'upstream.lock.json'),lock=JSON.parse(fs.readFileSync(file,'utf8'));lock.commit=commit;fs.writeFileSync(file,JSON.stringify(lock));},write(){fs.writeFileSync(path.join(dir,'android/embedding-host/qualified-host.json'),JSON.stringify(manifest));},close(){fs.rmSync(dir,{recursive:true,force:true});}};
}
test('missing and corrupted native host bytes fail before APK packaging',()=>{
 for(const name of qualified.libraries.map(row=>row.name)){
  const f=fixture();try{const file=path.join(f.dir,'android/app/src/main/jniLibs/arm64-v8a',name);fs.unlinkSync(file);assert.throws(()=>verifyEmbeddingHost(f.dir),/missing or changed/);fs.writeFileSync(file,'tampered');assert.throws(()=>verifyEmbeddingHost(f.dir),/missing or changed/);}finally{f.close();}
 }
});
test('partial native set, changed identity and wrong model dimensions are refused',()=>{
 for(const mutation of [m=>m.libraries.pop(),m=>m.identity='other.product',m=>m.model.dimensions=1536,m=>m.pin='0'.repeat(40)]){
  const f=fixture();try{mutation(f.manifest);f.write();assert.throws(()=>verifyEmbeddingHost(f.dir),/admission changed|Incomplete/);}finally{f.close();}
 }
});
test('a valid native set does not bypass the pinned local model admission',()=>{
 const f=fixture();try{assert.throws(()=>verifyEmbeddingHost(f.dir),/BGE384 model missing/);const model=path.join(f.dir,qualified.model.path);fs.mkdirSync(path.dirname(model),{recursive:true});fs.writeFileSync(model,'incorrect model');assert.throws(()=>verifyEmbeddingHost(f.dir),/BGE384 model missing or changed/);}finally{f.close();}
});

test('text-only pin change reuses exact reviewed native bytes without relabeling the built pin',()=>{
 const f=fixture();try{
  git(f.vendor,'commit','--allow-empty','-m','Advance runtime without changing native inputs');
  f.lock(git(f.vendor,'rev-parse','HEAD'));
  const current=JSON.parse(fs.readFileSync(path.join(f.dir,'upstream.lock.json'),'utf8')).commit;
  assert.notEqual(current,qualified.pin);assert.doesNotThrow(()=>verifyEmbeddingInputs(f.dir,qualified));
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'android/embedding-host/qualified-host.json'),'utf8')).pin,qualified.pin);
 }finally{f.close();}
});
test('every changed committed native build input is refused even when the runtime lock matches',()=>{
 for(const input of qualified.inputs){
  const f=fixture();try{
   fs.appendFileSync(path.join(f.vendor,input.path),'\n// changed native build input\n');git(f.vendor,'add',input.path);git(f.vendor,'commit','-m','Change native input');f.lock(git(f.vendor,'rev-parse','HEAD'));
   assert.throws(()=>verifyEmbeddingHost(f.dir),/Native build input changed/);
  }finally{f.close();}
 }
});
test('changed engine gitlink, dirty JNI and mismatched locked vendor checkout are refused',()=>{
 const fork='plugins/plugin-local-inference/native/llama.cpp';
 for(const mutation of [
  f=>{git(f.vendor,'update-index','--cacheinfo','160000,'+'1'.repeat(40)+','+fork);git(f.vendor,'commit','-m','Change engine pin');f.lock(git(f.vendor,'rev-parse','HEAD'));},
  f=>fs.appendFileSync(path.join(f.vendor,qualified.inputs.at(-1).path),'\n// dirty JNI\n'),
  f=>{git(f.vendor,'commit','--allow-empty','-m','Advance checkout without updating runtime lock');},
 ]){const f=fixture();try{mutation(f);assert.throws(()=>verifyEmbeddingHost(f.dir),/source admission changed/);}finally{f.close();}}
});
test('missing, incomplete or altered native qualification cannot admit a new source pin',()=>{
 for(const mutation of [
  m=>delete m.inputs,m=>m.inputs.pop(),m=>m.inputs.push(m.inputs[0]),
  m=>m.inputs[0].sourceSha256='0'.repeat(64),m=>m.inputs.at(-1).generatedSha256='0'.repeat(64),
  m=>m.forkPin='0'.repeat(40),m=>delete m.qualificationReceiptSha256,m=>m.jniIdentityRelocated=false,
 ]){const f=fixture();try{mutation(f.manifest);f.write();assert.throws(()=>verifyEmbeddingHost(f.dir),/qualification missing or changed|admission changed|Native build input changed/);}finally{f.close();}}
});

test('current-only shallow native inputs admit reviewed bytes without fetching the historical build pin',()=>{
 const f=fixture({currentOnly:true});try{
  assert.equal(git(f.vendor,'rev-parse','--is-shallow-repository'),'true');
  assert.throws(()=>git(f.vendor,'cat-file','-e',qualified.pin));
  assert.doesNotThrow(()=>verifyEmbeddingInputs(f.dir,qualified));
 }finally{f.close();}
});

test('explicit unpackaged builds admit absence, never a partial resident payload or host',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-embed-unpackaged-'));
 try{
  assert.deepEqual(verifyEmbeddingHost(dir,{allowAbsentRuntime:true}),{status:'not-packaged',distributable:false});
  assert.throws(()=>verifyEmbeddingHost(dir));
  for(const relative of ['android/app/src/main/assets/agent/alpha-source.json','android/app/src/main/assets/agent/agent-bundle.js','android/app/src/main/assets/agent/workflow-worker/manifest.json','android/app/src/main/jniLibs/arm64-v8a/libelizainference.so','android/app/src/main/jniLibs/x86_64/libelizavoicejni.so']){
   const file=path.join(dir,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'partial');
   assert.throws(()=>verifyEmbeddingHost(dir,{allowAbsentRuntime:true}));fs.unlinkSync(file);
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
