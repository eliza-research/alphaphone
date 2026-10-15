import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyPixel10aSource} from '../scripts/pixel10a-source-contract.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
 const base=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'pixel-source-')));
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const source=path.join(base,'source'), factory=path.join(base,'factory.zip'), lock=path.join(base,'lock.json');
 function repo(relative) {
  const dir=path.join(source,relative);fs.mkdirSync(dir,{recursive:true});
  const git=(...args)=>execFileSync('git',['-C',dir,...args],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
  git('init');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  fs.writeFileSync(path.join(dir,'source.txt'),'original');git('add','.');git('commit','-m','fixture');
  return {git,dir,commit:git('rev-parse','HEAD')};
 }
 const manifest=repo('.repo/manifests'), project=repo('framework');
 fs.writeFileSync(path.join(project.dir,'source.txt'),'reviewed override');
 const generated='vendor/google_devices/stallion/kernel';fs.mkdirSync(path.dirname(path.join(source,generated)),{recursive:true});fs.writeFileSync(path.join(source,generated),'kernel');
 fs.writeFileSync(factory,'factory');
 const record=name=>{const bytes=fs.readFileSync(path.join(source,name));return {path:name,sizeBytes:bytes.length,sha256:sha(bytes)}};
 const contract={schema:1,target:'pixel10a',device:{codename:'stallion',androidRelease:'17'},developmentOnly:true,releaseQualified:false,manifest:{commit:manifest.commit},factory:{sizeBytes:7,sha256:sha('factory')},projects:[{path:'framework',commit:project.commit}],overrides:[record('framework/source.txt')],generated:{root:'vendor/google_devices/stallion',files:[record(generated)]}};
 fs.writeFileSync(path.join(source,'.repo/manifest.xml'),'<manifest/>');fs.writeFileSync(path.join(source,'.repo/project.list'),'framework\n');
 contract.manifest.configuration=[record('.repo/manifest.xml'),record('.repo/project.list')];
 const save=()=>fs.writeFileSync(lock,JSON.stringify(contract));save();
 return {source,factory,lock,contract,save,project};
}
test('exact prepared source is development evidence only and inspection is read-only',async t=>{
 const f=fixture(t); const result=await verifyPixel10aSource(f);
 assert.equal(result.projectsChecked,1);assert.equal(result.generatedFilesChecked,1);
 assert.equal(result.releaseQualified,false);assert.equal(result.imageBuilt,false);assert.equal(result.deviceAcceptanceVerified,false);
 assert.equal(fs.readFileSync(path.join(f.project.dir,'source.txt'),'utf8'),'reviewed override');
});
test('wrong factory, source revision and generated kernel are rejected',async t=>{
 const f=fixture(t);fs.writeFileSync(f.factory,'changed');await assert.rejects(verifyPixel10aSource(f),/factory archive differs/);
 fs.writeFileSync(f.factory,'factory');f.contract.projects[0].commit='0'.repeat(40);f.save();await assert.rejects(verifyPixel10aSource(f),/Source revision differs/);
 f.contract.projects[0].commit=f.project.commit;f.save();fs.writeFileSync(path.join(f.source,'vendor/google_devices/stallion/kernel'),'other!');await assert.rejects(verifyPixel10aSource(f),/Source bytes differ/);
});
test('extra inputs and hidden index modifications cannot reuse the receipt',async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.project.dir,'extra.cpp'),'extra');await assert.rejects(verifyPixel10aSource(f),/Unrecorded source changes/);
 fs.unlinkSync(path.join(f.project.dir,'extra.cpp'));f.project.git('update-index','--assume-unchanged','source.txt');await assert.rejects(verifyPixel10aSource(f),/Hidden or unresolved/);
});
test('unrecorded generated file and changed reviewed override fail',async t=>{
 const f=fixture(t);const extra=path.join(f.source,'vendor/google_devices/stallion/extra');fs.writeFileSync(extra,'extra');await assert.rejects(verifyPixel10aSource(f),/inventory differs/);
 fs.unlinkSync(extra);fs.writeFileSync(path.join(f.project.dir,'source.txt'),'malicious override');await assert.rejects(verifyPixel10aSource(f),/Source bytes differ/);
});
test('wrong device and unsafe source paths fail without staging outputs',async t=>{
 const f=fixture(t);f.contract.device.codename='grizzly';f.save();await assert.rejects(verifyPixel10aSource(f),/Not the Pixel 10a/);
 f.contract.device.codename='stallion';f.contract.projects[0].path='../outside';f.save();await assert.rejects(verifyPixel10aSource(f),/Unsafe source path/);
});

test('changed manifest worktree and unlisted local manifests cannot retain source admission',async t=>{
 const f=fixture(t),file=path.join(f.source,'.repo/manifests/source.txt');
 fs.writeFileSync(file,'changed manifest');await assert.rejects(verifyPixel10aSource(f),/manifest working tree differs/);
 fs.writeFileSync(file,'original');fs.mkdirSync(path.join(f.source,'.repo/local_manifests'));fs.writeFileSync(path.join(f.source,'.repo/local_manifests/extra.xml'),'<manifest/>');await assert.rejects(verifyPixel10aSource(f),/Local manifest inventory differs/);
});
test('changing the selected manifest or registered project list fails',async t=>{
 const f=fixture(t);fs.appendFileSync(path.join(f.source,'.repo/project.list'),'extra\n');await assert.rejects(verifyPixel10aSource(f),/Source bytes differ/);
});

test('ignored build inputs cannot bypass project status verification',async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.project.dir,'.git/info/exclude'),'hidden.cpp\n');fs.writeFileSync(path.join(f.project.dir,'hidden.cpp'),'unreviewed');await assert.rejects(verifyPixel10aSource(f),/Ignored source inventory differs/);
});
