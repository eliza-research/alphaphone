import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const cache=join(homedir(),'.gradle/caches/modules-2/files-2.1/org.json/json/20250517');
const cached=existsSync(cache)?readdirSync(cache).flatMap(hash=>readdirSync(join(cache,hash)).filter(name=>name==='json-20250517.jar').map(name=>join(cache,hash,name)))[0]:undefined;
const jsonJar=process.env.ALPHA_JSON_JAR||cached;
const root=resolve(import.meta.dirname,'..');
test('bounded native Notes fixture fills the real 32 MiB collection and a small edit exceeds it',{skip:!jsonJar?'Pinned JVM JSON dependency unavailable':false},()=>{
 const temporary=mkdtempSync(join(tmpdir(),'notes-capacity-fixture-'));
 const binary=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name):name;
 try{
  execFileSync(binary('javac'),['--release','11','-cp',jsonJar,'-d',temporary,join(root,'android/app/src/androidTest/java/ai/elizaresearch/alphaphone/NotesCapacityFixture.java'),join(root,'test/fixtures/NotesCapacityFixtureTest.java')],{timeout:60000,stdio:'pipe'});
  assert.equal(execFileSync(binary('java'),['-Xmx512m','-cp',temporary+':'+jsonJar,'ai.elizaresearch.alphaphone.NotesCapacityFixtureTest'],{timeout:60000,encoding:'utf8'}).trim(),'PASS bounded Notes capacity fixture');
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
