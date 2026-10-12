import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {collectClockArtifacts} from '../scripts/clock-artifacts.mjs';
const remote='/storage/emulated/0/Android/data/ai.elizaresearch.alphaphone/files/real-clock-12345678-1234-1234-1234-123456789abc';
const raw=`INSTRUMENTATION_RESULT: realClockFixture=${remote}\n`;
test('copies only the explicit synthetic clock fixture and verifies events exist',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'clock-evidence-'));
 try{const receipt=collectClockArtifacts(raw,root,args=>{
  assert.deepEqual(args,['pull',remote,path.join(root,'real-clock-artifacts')]);
  const dest=path.join(args[2],path.basename(args[1]));fs.mkdirSync(dest);fs.writeFileSync(path.join(dest,'events.jsonl'),'{}\n');
 });assert.equal(receipt.copied,true);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('rejects missing, duplicate and escaped paths before copying',()=>{
 for(const output of ['',raw+raw,raw.replace('real-clock-','../real-clock-'),raw.replace('alphaphone','other')])assert.throws(()=>collectClockArtifacts(output,'/unused',()=>assert.fail('must not pull')),/path/);
});
test('a successful adb return without fixture events is not collection evidence',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'clock-evidence-'));
 try{assert.throws(()=>collectClockArtifacts(raw,root,()=>{}),/not copied/);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
