import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
test('reset requires an activity-owned confirmation and fresh single-use authentication',()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-reset-auth-')),bin=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name):name;
 try{execFileSync(bin('javac'),['--release','11','-d',dir,join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/ResetAuthorization.java'),join(root,'test/fixtures/ResetAuthorizationTest.java')],{timeout:60000});assert.match(execFileSync(bin('java'),['-cp',dir,'ai.elizaresearch.alphaphone.ResetAuthorizationTest'],{encoding:'utf8',timeout:10000}),/PASS fresh confirmation/);}finally{rmSync(dir,{recursive:true,force:true});}
});
