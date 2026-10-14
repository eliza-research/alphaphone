import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {preparePatchedNative} from '../scripts/prepare-patched-native.mjs';
const cache=join(homedir(),'.gradle/caches/modules-2/files-2.1/org.json/json/20250517');
const jar=process.env.ALPHA_JSON_JAR||(existsSync(cache)?readdirSync(cache).flatMap(hash=>readdirSync(join(cache,hash)).filter(n=>n==='json-20250517.jar').map(n=>join(cache,hash,n)))[0]:undefined);
test('native claim cannot be repeated, removed by cached recovery or replaced by renderer settlement',{skip:!jar?'Pinned JVM JSON dependency unavailable':false},()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-delete-claim-')),root=resolve(import.meta.dirname,'..'),prepared=preparePatchedNative({root});
 try{
  const source=join(prepared.root,'plugins/plugin-native-action-journal/android/src/main/java/ai/eliza/plugins/actionjournal');
  execFileSync('javac',['--release','17','-cp',jar,'-d',dir,join(source,'ActionJournal.java'),join(source,'ActionJournalConfiguration.java'),...['NativeDeletionClaim.java','DeferredDeletionJournal.java','DeletionDeadline.java','NativeDeletionRecovery.java'].map(name=>join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone',name)),join(root,'test/fixtures/NativeDeletionClaimTest.java')]);
  assert.match(execFileSync('java',['-cp',dir+':'+jar,'ai.elizaresearch.alphaphone.NativeDeletionClaimTest'],{encoding:'utf8'}),/^PASS native deletion claim/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
