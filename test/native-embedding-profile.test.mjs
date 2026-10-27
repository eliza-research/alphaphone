import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
test('native Cloud text retains local embeddings; Cloud-only and missing assets stay gated',()=>{
 const source=fs.readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java','utf8');
 const start=source.indexOf(' static void configureLocalEmbeddings('),end=source.indexOf(' static void configureNativeViews(',start);assert(start>=0&&end>start);
 const method=source.slice(start,end),call=source.split('\n').find(line=>line.includes(')configureLocalEmbeddings(new File(context.getApplicationInfo()'));assert(call);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-embed-policy-'));
 try{fs.writeFileSync(path.join(dir,'EmbeddingProfileTest.java'),`
import java.io.*;import java.util.*;
class EmbeddingProfileTest {
 static class BuildConfig{static String ELIZA_RUNTIME_PROFILE;}
 static class Info{String nativeLibraryDir;Info(String x){nativeLibraryDir=x;}}
 static class Context{File files,libs;Context(File f,File l){files=f;libs=l;}File getFilesDir(){return files;}Info getApplicationInfo(){return new Info(libs.getPath());}}
 static class Provider{String optString(String a,String b){return "elizacloud";}}
 ${method}
 static void select(Context context,Map<String,String> env){Provider provider=new Provider();${call}}
 static Map<String,String> cloud(){Map<String,String> e=new HashMap<>();e.put("ELIZAOS_CLOUD_USE_EMBEDDINGS","true");e.put("ELIZA_DISABLE_LOCAL_EMBEDDINGS","true");e.put("ELIZA_LOCAL_EMBEDDING_ENABLED","0");return e;}
 static void check(boolean x){if(!x)throw new AssertionError();}
 public static void main(String[] args)throws Exception{
  File f=new File(args[0],"files"),l=new File(args[0],"libs");f.mkdirs();l.mkdirs();Context c=new Context(f,l);
  File engine=new File(l,"libelizainference.so"),jni=new File(l,"libelizavoicejni.so"),model=new File(f,".eliza/local-inference/models/bge-small-en-v1.5-f16.gguf");model.getParentFile().mkdirs();engine.createNewFile();jni.createNewFile();model.createNewFile();
  BuildConfig.ELIZA_RUNTIME_PROFILE="native";Map<String,String> e=cloud();select(c,e);check("1".equals(e.get("ELIZA_LOCAL_EMBEDDING_ENABLED")));check("false".equals(e.get("ELIZAOS_CLOUD_USE_EMBEDDINGS")));check("384".equals(e.get("ELIZA_LOCAL_EMBEDDING_DIMENSIONS")));
  BuildConfig.ELIZA_RUNTIME_PROFILE="cloud";e=cloud();select(c,e);check("0".equals(e.get("ELIZA_LOCAL_EMBEDDING_ENABLED")));check("true".equals(e.get("ELIZAOS_CLOUD_USE_EMBEDDINGS")));
  BuildConfig.ELIZA_RUNTIME_PROFILE="native";for(File asset:new File[]{model,engine,jni}){asset.delete();e=cloud();select(c,e);check("0".equals(e.get("ELIZA_LOCAL_EMBEDDING_ENABLED")));asset.createNewFile();}
  System.out.println("PASS native, cloud, and three missing asset gates");
 }
}`);const bin=n=>process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',n):n;execFileSync(bin('javac'),['--release','11','-d',dir,path.join(dir,'EmbeddingProfileTest.java')]);assert.match(execFileSync(bin('java'),['-cp',dir,'EmbeddingProfileTest',dir],{encoding:'utf8'}),/PASS native, cloud/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
