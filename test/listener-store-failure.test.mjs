import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
test('listener persistence failures disable capture and stale disk consent cannot restart it',()=>{
 const root=resolve(import.meta.dirname,'..'),dir=mkdtempSync(join(tmpdir(),'alpha-listener-store-'));
 const java=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name):name;
 try{
  const files=[];
  for(const [name,source] of Object.entries(JSON.parse(readFileSync(join(root,'test/fixtures/listener-store-stubs.json'),'utf8')))) {const path=join(dir,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,source);files.push(path);}
  for(const name of ['ListenerStore','ListenerPolicy','CrashLoopBreaker','ListeningEpoch'])files.push(join(root,'android/sense/src/main/java/ai/elizaresearch/alphaphone/sense/'+name+'.java'));
  execFileSync(java('javac'),['--release','11','-d',dir,...files],{timeout:60000});
  assert.match(execFileSync(java('java'),['-cp',dir,'ai.elizaresearch.alphaphone.sense.ListenerStoreFailureTest'],{encoding:'utf8',timeout:15000}),/PASS listener persistence failures/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
