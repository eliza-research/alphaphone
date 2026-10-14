import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {collectConversationAudio} from '../scripts/conversation-audio-artifacts.mjs';
const bytes=Buffer.from('synthetic capture'),entry={path:'files/conversation-audio-evidence/12345678-1234-4234-8234-123456789abc/22345678-1234-4234-8234-123456789abc.wav',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
const receipt=entries=>'INSTRUMENTATION_RESULT: conversationAudioFixture='+JSON.stringify(entries)+'\n';
test('copies the exact stopped capture under its disposable user and checks its digest',()=>{
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'conversation-evidence-'));
 try{const result=collectConversationAudio(receipt([entry]),output,args=>{assert.deepEqual(args,['shell','run-as','ai.elizaresearch.alphaphone','--user','12','base64',entry.path]);return bytes.toString('base64')+'\n';},'12');assert.equal(result.count,1);assert.deepEqual(fs.readFileSync(path.join(result.directory,path.basename(entry.path))),bytes);assert.throws(()=>collectConversationAudio(receipt([entry]),output,()=>assert.fail('No overwrite'),'12'),/exists/);}finally{fs.rmSync(output,{recursive:true,force:true});}
});
test('rejects owner-user access, traversal, mixed runs and duplicate paths before device reads',()=>{
 const noRead=()=>assert.fail('Must not read device');
 for(const user of [undefined,'0','-1','all','01'])assert.throws(()=>collectConversationAudio(receipt([entry]),'/unused',noRead,user),/user/);
 for(const entries of [[{...entry,path:'files/credentials'}],[{...entry,path:entry.path.replace('conversation-audio-evidence','../conversation-audio-evidence')}],[entry,entry],[entry,{...entry,path:entry.path.replace('/12345678-','/32345678-')}],[{...entry,bytes:5*1024*1024}]])assert.throws(()=>collectConversationAudio(receipt(entries),'/unused',noRead,'12'));
 assert.throws(()=>collectConversationAudio(receipt([entry])+receipt([entry]),'/unused',noRead,'12'),/ambiguous/);
});
test('a successful adb response does not excuse corrupt or mismatched capture bytes',()=>{
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'conversation-evidence-'));
 try{for(const response of ['not base64!',Buffer.from('wrong').toString('base64')])assert.throws(()=>collectConversationAudio(receipt([entry]),output,()=>response,'12'));assert.equal(fs.existsSync(path.join(output,'conversation-audio')),false);}finally{fs.rmSync(output,{recursive:true,force:true});}
});
