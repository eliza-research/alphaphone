import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
const shared='vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/NativeRuntimeEmbeddings.java';
test('Alpha selects embeddings only through the shared native runtime profile',()=>{
 const source=fs.readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java','utf8');
 // No Alpha copy of the embedding route: the build profile is passed to the shared class as-is.
 assert.doesNotMatch(source,/static void configureLocalEmbeddings\(/);
 assert.doesNotMatch(source,/bge-small-en-v1\.5-f16\.gguf/);
 const calls=source.split('\n').filter(line=>line.includes('NativeRuntimeEmbeddings.apply('));
 assert.equal(calls.length,1);
 assert.match(calls[0],/NativeRuntimeEmbeddings\.apply\(BuildConfig\.ELIZA_RUNTIME_PROFILE,new File\(context\.getApplicationInfo\(\)\.nativeLibraryDir\),context\.getFilesDir\(\),env\);/);
});
test('the shared profile keeps native embeddings local and Cloud QA on Cloud',()=>{
 assert.ok(fs.existsSync(shared),'The eliza pin must include NativeRuntimeEmbeddings (plugin-native-agent)');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-embed-policy-'));
 try{fs.writeFileSync(path.join(dir,'EmbeddingProfileTest.java'),`
import java.io.*;import java.util.*;import ai.eliza.plugins.agent.runtime.NativeRuntimeEmbeddings;
class EmbeddingProfileTest {
 static Map<String,String> cloud(){Map<String,String> e=new HashMap<>();e.put("ELIZAOS_CLOUD_USE_EMBEDDINGS","true");e.put("ELIZA_DISABLE_LOCAL_EMBEDDINGS","true");e.put("ELIZA_LOCAL_EMBEDDING_ENABLED","0");return e;}
 static void check(boolean x){if(!x)throw new AssertionError();}
 public static void main(String[] args)throws Exception{
  File f=new File(args[0],"files"),l=new File(args[0],"libs");f.mkdirs();l.mkdirs();
  File engine=new File(l,"libelizainference.so"),jni=new File(l,"libelizavoicejni.so"),model=new File(f,".eliza/local-inference/models/bge-small-en-v1.5-f16.gguf");model.getParentFile().mkdirs();engine.createNewFile();jni.createNewFile();model.createNewFile();
  Map<String,String> e=cloud();NativeRuntimeEmbeddings.apply("native",l,f,e);check("1".equals(e.get("ELIZA_LOCAL_EMBEDDING_ENABLED")));check("false".equals(e.get("ELIZAOS_CLOUD_USE_EMBEDDINGS")));check("384".equals(e.get("ELIZA_LOCAL_EMBEDDING_DIMENSIONS")));
  e=cloud();NativeRuntimeEmbeddings.apply("cloud",l,f,e);check("0".equals(e.get("ELIZA_LOCAL_EMBEDDING_ENABLED")));check("true".equals(e.get("ELIZAOS_CLOUD_USE_EMBEDDINGS")));
  for(File asset:new File[]{model,engine,jni}){asset.delete();e=cloud();e.put("ELIZA_LOCAL_EMBEDDING_MODEL_PATH","stale-model");NativeRuntimeEmbeddings.apply("native",l,f,e);check("0".equals(e.get("ELIZA_LOCAL_EMBEDDING_ENABLED")));check("false".equals(e.get("ELIZAOS_CLOUD_USE_EMBEDDINGS")));check(!e.containsKey("ELIZA_LOCAL_EMBEDDING_MODEL_PATH"));asset.createNewFile();}
  System.out.println("PASS native, cloud, and three missing asset gates");
 }
}`);const bin=n=>process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',n):n;execFileSync(bin('javac'),['--release','11','-d',dir,shared,path.join(dir,'EmbeddingProfileTest.java')]);assert.match(execFileSync(bin('java'),['-cp',dir,'EmbeddingProfileTest',dir],{encoding:'utf8'}),/PASS native, cloud/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
