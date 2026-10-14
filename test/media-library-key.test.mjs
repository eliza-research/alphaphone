import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

test('media identities distinguish volumes and kinds and refuse ambiguous or cross-user inputs',()=>{
 const temporary=mkdtempSync(join(tmpdir(),'alpha-media-keys-'));
 try{
  execFileSync('javac',['--release','11','-d',temporary,'android/app/src/main/java/ai/elizaresearch/alphaphone/MediaLibraryKey.java','test/fixtures/MediaLibraryKeyTest.java'],{timeout:30000,stdio:'pipe'});
  assert.equal(execFileSync('java',['-cp',temporary,'ai.elizaresearch.alphaphone.MediaLibraryKeyTest'],{encoding:'utf8',timeout:30000}).trim(),'PASS media library keys');
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
