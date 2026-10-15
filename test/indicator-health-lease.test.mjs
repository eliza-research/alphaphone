import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
test('indicator lease rejects replay, old binding, death, expiry and renewal-only restart',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'indicator-lease-'));
 try{
  const java=process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin'):'';
  execFileSync(path.join(java,'javac'),['--release','11','-d',temp,'android/sense/src/main/java/ai/elizaresearch/alphaphone/sense/IndicatorHealthLease.java','android/sense/src/main/java/ai/elizaresearch/alphaphone/sense/IndicatorHealthIdentity.java','test/fixtures/IndicatorHealthLeaseTest.java']);
  assert.match(execFileSync(path.join(java,'java'),['-cp',temp,'ai.elizaresearch.alphaphone.sense.IndicatorHealthLeaseTest'],{encoding:'utf8'}),/^PASS indicator health lease/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
