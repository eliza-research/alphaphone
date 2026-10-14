import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
// Production byte-copy helper on JVM; fake source is not Android MediaStore acceptance.
test('Photos attachment source keeps exact readable bytes and rejects changed or revoked sources',()=>{
 const root=resolve(import.meta.dirname,'..'),temp=mkdtempSync(join(tmpdir(),'photo-attachment-'));
 const java=process.env.JAVA_HOME||(process.platform==='darwin'?'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home':'');const binary=name=>java?join(java,'bin',name):name;
 try{
  execFileSync(binary('javac'),['--release','11','-d',temp,join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/PhotoAttachmentSource.java'),join(root,'test/fixtures/PhotoAttachmentSourceTest.java')],{timeout:120000,stdio:'pipe'});
  assert.match(execFileSync(binary('java'),['-cp',temp,'ai.elizaresearch.alphaphone.PhotoAttachmentSourceTest'],{encoding:'utf8',timeout:30000}),/^PASS photo attachment source/);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
