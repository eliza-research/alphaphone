import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const cache=join(homedir(),'.gradle/caches/modules-2/files-2.1/org.json/json/20250517');
const jar=process.env.ALPHA_JSON_JAR||(existsSync(cache)?readdirSync(cache).flatMap(hash=>readdirSync(join(cache,hash)).filter(n=>n==='json-20250517.jar').map(n=>join(cache,hash,n)))[0]:undefined);
test('durable native deletion journal keeps exact targets, refuses owner/clock drift and never replays an uncertain write',{skip:!jar?'Pinned JVM JSON dependency unavailable':false},()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-delete-journal-')),root=resolve(import.meta.dirname,'..');
 try{
  execFileSync('javac',['--release','17','-cp',jar,'-d',dir,...['DeletionDeadline','DeferredDeletionJournal'].map(n=>join(root,`android/app/src/main/java/ai/elizaresearch/alphaphone/${n}.java`)),join(root,'test/fixtures/DeferredDeletionJournalTest.java')]);
  assert.match(execFileSync('java',['-cp',dir+':'+jar,'ai.elizaresearch.alphaphone.DeferredDeletionJournalTest'],{encoding:'utf8'}),/^PASS durable deletion/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
