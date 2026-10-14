import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
test('external page admission rejects privileged/self/unsafe handlers and passkeys stay disabled with broken providers',()=>{
 const root=resolve(import.meta.dirname,'..'),temporary=mkdtempSync(join(tmpdir(),'alpha-browser-external-'));
 const binary=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name):name;
 try{
  execFileSync(binary('javac'),['--release','11','-d',temporary,...['BrowserExternalPage','BrowserPasskeys'].map(name=>join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/'+name+'.java')),join(root,'test/fixtures/BrowserExternalPageTest.java')],{timeout:60000});
  assert.match(execFileSync(binary('java'),['-cp',temporary,'ai.elizaresearch.alphaphone.BrowserExternalPageTest'],{encoding:'utf8',timeout:10000}),/PASS external page and deferred passkey policy/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
