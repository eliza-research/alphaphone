import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
test('listener stop and resume reject in-flight recognition and queued invocation',()=>{
 const root=resolve(import.meta.dirname,'..'),dir=mkdtempSync(join(tmpdir(),'alpha-listening-epoch-'));
 const java=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name):name;
 try{
  execFileSync(java('javac'),['--release','11','-d',dir,join(root,'android/sense/src/main/java/ai/elizaresearch/alphaphone/sense/ListeningEpoch.java'),join(root,'test/fixtures/ListeningEpochTest.java')],{timeout:60000});
  assert.match(execFileSync(java('java'),['-cp',dir,'ai.elizaresearch.alphaphone.sense.ListeningEpochTest'],{encoding:'utf8',timeout:15000}),/PASS listener session authority/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
