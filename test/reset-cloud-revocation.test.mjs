import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
test('pending reset revocation is authorized, best effort, and bounded even when transport blocks',()=>{
 const root=resolve(import.meta.dirname,'..'),dir=mkdtempSync(join(tmpdir(),'alpha-reset-revoke-')),files=[];
 const put=(name,text)=>{const file=join(dir,name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);files.push(file);};
 const bin=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name):name;
 try{
  put('android/content/Context.java','package android.content; public class Context {}');
  put('org/json/JSONObject.java','package org.json; public class JSONObject {public JSONObject(String s){} public String optString(String k,String fallback){return "synthetic";}}');
  put('ai/elizaresearch/alphaphone/Fixture.java',`package ai.elizaresearch.alphaphone;
class BuildConfig {static boolean ELIZA_DEV_ALLOW_TEST_MOCKS;}
class AlphaDataReset {static final Reset RESET=new Reset();static final class Reset {boolean pending;boolean pending(android.content.Context c){return pending;}}}
class AlphaCredentialStore {static boolean unreadable;static String readSlotBeforeAttach(android.content.Context c,String n)throws Exception{if(unreadable)throw new Exception();return "synthetic";}}
class CloudKeyRevocation {static volatile int calls;static boolean block;static String[] environments(boolean mock){return mock?new String[]{"production","staging"}:new String[]{"production"};}static boolean revoke(String env,String token,boolean mock){calls++;if(block)try{Thread.sleep(10000);}catch(InterruptedException expected){}return false;}}
public class Fixture {public static void main(String[] args){android.content.Context c=new android.content.Context();ResetCloudRevocation.revoke(c,100);check(CloudKeyRevocation.calls==0);AlphaDataReset.RESET.pending=true;ResetCloudRevocation.revoke(c,1000);check(CloudKeyRevocation.calls==1);BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS=true;ResetCloudRevocation.revoke(c,1000);check(CloudKeyRevocation.calls==3);AlphaCredentialStore.unreadable=true;ResetCloudRevocation.revoke(c,1000);check(CloudKeyRevocation.calls==3);AlphaCredentialStore.unreadable=false;CloudKeyRevocation.block=true;long start=System.nanoTime();ResetCloudRevocation.revoke(c,30);check((System.nanoTime()-start)/1000000<2000);Thread.currentThread().interrupt();ResetCloudRevocation.revoke(c,1000);check(Thread.interrupted());System.out.println("PASS bounded reset revocation");}static void check(boolean ok){if(!ok)throw new AssertionError();}}
`);
  execFileSync(bin('javac'),['--release','11','-d',dir,...files,join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/ResetCloudRevocation.java')],{timeout:60000});
  assert.match(execFileSync(bin('java'),['-cp',dir,'ai.elizaresearch.alphaphone.Fixture'],{encoding:'utf8',timeout:15000}),/PASS bounded reset revocation/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
