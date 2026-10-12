import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {materializeNativePatches} from '../scripts/prepare-patched-native.mjs';
import {sha} from '../scripts/upstream-native-source.mjs';
const module='plugins/plugin-native-test/android',target=module+'/src/main/java/Test.java';
function fixture(run){const root=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-patch-test-'));try{const before=Buffer.from('old\n'),after=Buffer.from('new\n'),patch=`--- a/${target}\n+++ b/${target}\n@@ -1 +1 @@\n-old\n+new\n`,patchRoot=path.join(root,'patches'),temporary=path.join(root,'stage');fs.mkdirSync(patchRoot);fs.mkdirSync(temporary);fs.writeFileSync(path.join(patchRoot,'test.patch'),patch);const manifest={schema:1,baseCommit:'pin',patches:[{module,file:'test.patch',sha256:sha(patch),targets:[{path:target,beforeSha256:sha(before),afterSha256:sha(after)}]}]};const source={pin:'pin',read:()=>new Map([[target,{bytes:before,mode:'100644',sha256:sha(before)}]])};run({root,manifest,source,patchRoot,temporary});}finally{fs.rmSync(root,{recursive:true,force:true});}}
test('admission materializes only authenticated declared source',()=>fixture(args=>{const result=materializeNativePatches(args);assert.equal(result.files[target],sha('new\n'));assert.equal(fs.readFileSync(path.join(args.temporary,target),'utf8'),'new\n');}));
for(const [name,mutate,error] of [
 ['wrong pin',a=>a.manifest.baseCommit='other',/pin/],
 ['patch drift',a=>fs.appendFileSync(path.join(a.patchRoot,'test.patch'),'x'),/digest/],
 ['wrong source',a=>a.manifest.patches[0].targets[0].beforeSha256='0'.repeat(64),/source/],
 ['wrong output',a=>a.manifest.patches[0].targets[0].afterSha256='0'.repeat(64),/output/],
 ['unsafe patch path',a=>a.manifest.patches[0].file='../test.patch',/descriptor/],
 ['undeclared patch target',a=>{const p=a.manifest.patches[0];const text=fs.readFileSync(path.join(a.patchRoot,p.file),'utf8').replaceAll(target,module+'/src/main/java/Other.java');fs.writeFileSync(path.join(a.patchRoot,p.file),text);p.sha256=sha(text);},/headers/],
 ['symlink patch',a=>{fs.renameSync(path.join(a.patchRoot,'test.patch'),path.join(a.root,'real.patch'));fs.symlinkSync(path.join(a.root,'real.patch'),path.join(a.patchRoot,'test.patch'));},/Nonregular/]
])test(`admission rejects ${name}`,()=>fixture(a=>{mutate(a);assert.throws(()=>materializeNativePatches(a),error);}));
