import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
test('workflow tap identity survives the durable-write/UI-clear gap without suppressing new OS taps',()=>{
 const root=resolve(import.meta.dirname,'..'),directory=mkdtempSync(join(tmpdir(),'workflow-intent-'));
 const java=process.env.JAVA_HOME||(process.platform==='darwin'?'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home':'');
 const binary=name=>java?join(java,'bin',name):name;
 try{
  execFileSync(binary('javac'),['--release','11','-d',directory,join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/WorkflowNoticeIntentDedup.java'),join(root,'test/fixtures/WorkflowNoticeIntentDedupTest.java')],{timeout:20000});
  assert.match(execFileSync(binary('java'),['-cp',directory,'ai.elizaresearch.alphaphone.WorkflowNoticeIntentDedupTest'],{encoding:'utf8',timeout:20000}),/^PASS workflow Intent identity dedup/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
