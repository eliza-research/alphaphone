import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const cache=join(homedir(),'.gradle/caches/modules-2/files-2.1/org.json/json/20250517');
const cached=existsSync(cache)?readdirSync(cache).flatMap(hash=>readdirSync(join(cache,hash)).filter(name=>name==='json-20250517.jar').map(name=>join(cache,hash,name)))[0]:undefined;
const jsonJar=process.env.ALPHA_JSON_JAR||cached;
test('native digest consent and source reads remain bounded across persistence and revocation',{skip:!jsonJar?'Pinned JVM JSON dependency unavailable':false},()=>{
 const root=resolve(import.meta.dirname,'..'),temporary=mkdtempSync(join(tmpdir(),'native-digest-'));
 const java=process.env.JAVA_HOME||(process.platform==='darwin'?'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home':'');const binary=name=>java?join(java,'bin',name):name;
 try{
  execFileSync(binary('javac'),['--release','11','-cp',jsonJar,'-d',temporary,join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/NoticeOwner.java'),join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/NativeDigestSources.java'),join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/HostedResultNotices.java'),join(root,'test/fixtures/NativeDigestSourcesTest.java')],{timeout:20000});
  assert.match(execFileSync(binary('java'),['-cp',temporary+':'+jsonJar,'ai.elizaresearch.alphaphone.NativeDigestSourcesTest'],{encoding:'utf8',timeout:20000}),/^PASS native digest sources/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
