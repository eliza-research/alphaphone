import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
// ResetCloudRevocation with Alpha's registration (the shared CloudSignInConfig) and a stub of the shared
// one-attempt revocation. Host JVM only: no Android, Cloud request or credential.
test('pending reset revocation is authorized, best effort, and bounded even when transport blocks',()=>{
 const root=resolve(import.meta.dirname,'..'),dir=mkdtempSync(join(tmpdir(),'alpha-reset-revoke-')),files=[];
 const put=(name,text)=>{const file=join(dir,name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);files.push(file);};
 const bin=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name):name;
 const shared=join(root,'vendor/eliza/packages/auth/android/src/main/java/ai/eliza/auth/cloud/');
 try{
  put('android/content/Context.java','package android.content; public class Context {}');
  put('org/json/JSONObject.java','package org.json; public class JSONObject {public JSONObject(String s){} public String optString(String k,String fallback){return "synthetic";}}');
  put('ai/eliza/auth/cloud/CloudKeyRevocation.java','package ai.eliza.auth.cloud; public final class CloudKeyRevocation {public static volatile int calls;public static boolean block;public static java.util.List<String> slots=new java.util.ArrayList<>();public static boolean revoke(CloudSignInConfig config,CloudSignInEnvironment environment,String token){calls++;if(block)try{Thread.sleep(10000);}catch(InterruptedException expected){}return false;}}');
  put('ai/elizaresearch/alphaphone/Fixture.java',`package ai.elizaresearch.alphaphone;
import ai.eliza.auth.cloud.*;
class AlphaDataReset {static final Reset RESET=new Reset();static final class Reset {boolean pending;boolean pending(android.content.Context c){return pending;}}}
class AlphaCredentialStore {static boolean unreadable;static String readSlotBeforeAttach(android.content.Context c,String n)throws Exception{if(unreadable)throw new Exception();CloudKeyRevocation.slots.add(n);return "synthetic";}}
class AlphaCloudSignInPlugin {static CloudSignInConfig REGISTRATION=registration(false);
 static CloudSignInConfig registration(boolean mocks){CloudSignInConfig.Builder b=CloudSignInConfig.builder().clientId("ai.elizaresearch.alphaphone").deviceName("Alpha Phone").productName("Alpha Phone").googleClientId("alpha-phone").environment(new CloudSignInEnvironment("production","api.eliza.app","eliza.app","elizacloud","Eliza Cloud","/alphaphone/auth/callback"));if(mocks)b.environment(new CloudSignInEnvironment("staging","api-staging.eliza.app","staging.eliza.app","elizacloud-staging","Eliza Cloud","/alphaphone/auth/callback"));return b.build();}}
public class Fixture {public static void main(String[] args){android.content.Context c=new android.content.Context();ResetCloudRevocation.revoke(c,100);check(CloudKeyRevocation.calls==0);AlphaDataReset.RESET.pending=true;ResetCloudRevocation.revoke(c,1000);check(CloudKeyRevocation.calls==1&&CloudKeyRevocation.slots.equals(java.util.List.of("cloud:production")));AlphaCloudSignInPlugin.REGISTRATION=AlphaCloudSignInPlugin.registration(true);ResetCloudRevocation.revoke(c,1000);check(CloudKeyRevocation.calls==3&&CloudKeyRevocation.slots.contains("cloud:staging"));AlphaCredentialStore.unreadable=true;ResetCloudRevocation.revoke(c,1000);check(CloudKeyRevocation.calls==3);AlphaCredentialStore.unreadable=false;CloudKeyRevocation.block=true;long start=System.nanoTime();ResetCloudRevocation.revoke(c,30);check((System.nanoTime()-start)/1000000<2000);Thread.currentThread().interrupt();ResetCloudRevocation.revoke(c,1000);check(Thread.interrupted());System.out.println("PASS bounded reset revocation");}static void check(boolean ok){if(!ok)throw new AssertionError();}}
`);
  execFileSync(bin('javac'),['--release','11','-d',dir,...files,join(shared,'CloudSignInConfig.java'),join(shared,'CloudSignInEnvironment.java'),join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/ResetCloudRevocation.java')],{timeout:60000});
  assert.match(execFileSync(bin('java'),['-cp',dir,'ai.elizaresearch.alphaphone.Fixture'],{encoding:'utf8',timeout:15000}),/PASS bounded reset revocation/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
