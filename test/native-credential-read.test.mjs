import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';

// Compiles the actual Alpha method bodies against the exact shared abstract
// signature. Android, credential storage and network are outside this fixture.
const root=process.env.ALPHA_CREDENTIAL_READ_SOURCE_ROOT||resolve(import.meta.dirname,'..');
const overlays=process.env.ALPHA_CREDENTIAL_READ_OVERLAYS?JSON.parse(readFileSync(process.env.ALPHA_CREDENTIAL_READ_OVERLAYS,'utf8')):{};
const read=path=>readFileSync(overlays[path]?.file||join(root,path),'utf8');
const native='android/app/src/main/java/ai/elizaresearch/alphaphone/';
const plugin=read(native+'AlphaCloudSignInPlugin.java');
const host=read(native+'AlphaLocalAgentPlugin.java');
const shared=readFileSync(process.env.ALPHA_SHARED_SIGN_IN_PLUGIN||join(root,'vendor/eliza/packages/auth/android/src/main/java/ai/eliza/auth/cloud/CloudSignInPlugin.java'),'utf8');
const signature=shared.match(/protected abstract <T> T withCredentialRead\(java\.util\.concurrent\.Callable<T> read\) throws Exception;/)?.[0];
assert.ok(signature,'canonical shared read hook signature must match');
function method(text,start){
 const begin=text.indexOf(start);assert.ok(begin>=0,start);
 const brace=text.indexOf('{',begin);let depth=0;
 for(let i=brace;i<text.length;i++){
  if(text[i]==='{')depth++;
  if(text[i]==='}'&&--depth===0)return text.slice(begin,i+1);
 }
 throw Error('Unclosed method');
}
test('actual shared read hook and Alpha authority bodies preserve locks, mutation and owner boundaries',()=>{
 const directory=mkdtempSync(join(tmpdir(),'alpha-read-hook-'));
 try{
  const bridge=method(plugin,'@Override protected <T> T withCredentialRead(');
  const epoch=method(host,'static long credentialAuthorityEpoch(');
  const authority=method(host,'static <T> T withCredentialAuthority(');
  const readHook=method(host,'static <T> T withCredentialRead(');
  writeFileSync(join(directory,'JsonCredentialSlots.java'),`package ai.eliza.plugins.securestore.nativeonly; public final class JsonCredentialSlots {public static final Object LOCK=new Object();}`);
  writeFileSync(join(directory,'ReadHookHarness.java'),`package ai.elizaresearch.alphaphone;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots;
abstract class SharedContract { ${signature} }
final class Bridge extends SharedContract { ${bridge} }
final class AlphaLocalAgentPlugin {
 static final Object lifecycleLock=new Object();
 static long powerAuthorizationMutationEpoch;
 static long credentialMutationEpoch=-1;
 ${epoch}
 ${authority}
 ${readHook}
}
public final class ReadHookHarness {
 static void check(boolean value,String why){if(!value)throw new AssertionError(why);}
 public static void main(String[] args)throws Exception{
  Bridge bridge=new Bridge();AtomicInteger calls=new AtomicInteger();Object value=new Object();
  Object result=bridge.withCredentialRead(()->{
   check(Thread.holdsLock(AlphaLocalAgentPlugin.lifecycleLock),"lifecycle lock held");
   check(Thread.holdsLock(JsonCredentialSlots.LOCK),"vault lock held");
   calls.incrementAndGet();return value;
  });
  check(result==value&&calls.get()==1,"exact result once");
  AlphaLocalAgentPlugin.credentialMutationEpoch=7;
  try{bridge.withCredentialRead(()->{calls.incrementAndGet();return null;});throw new AssertionError("mutation read admitted");}
  catch(IllegalStateException expected){}
  check(calls.get()==1,"no callable during mutation");
  AlphaLocalAgentPlugin.credentialMutationEpoch=-1;
  long stale=AlphaLocalAgentPlugin.credentialAuthorityEpoch();
  AlphaLocalAgentPlugin.powerAuthorizationMutationEpoch++;
  try{AlphaLocalAgentPlugin.withCredentialAuthority(stale,()->{calls.incrementAndGet();return null;});throw new AssertionError("stale owner admitted");}
  catch(SecurityException expected){}
  check(calls.get()==1,"stale authority never executes");
  Exception cause=new Exception("fixture read failure");
  try{bridge.withCredentialRead(()->{throw cause;});throw new AssertionError("failure lost");}
  catch(Exception actual){check(actual==cause,"same exception propagates");}
  CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1),mutatorStarted=new CountDownLatch(1);
  AtomicBoolean changed=new AtomicBoolean();AtomicReference<Throwable> failure=new AtomicReference<>();
  Thread reader=new Thread(()->{try{bridge.withCredentialRead(()->{entered.countDown();check(release.await(2,TimeUnit.SECONDS),"release received");check(!changed.get(),"owner stable through delivery");return null;});}catch(Throwable e){failure.set(e);}});
  reader.start();check(entered.await(2,TimeUnit.SECONDS),"reader entered");
  Thread writer=new Thread(()->{mutatorStarted.countDown();synchronized(AlphaLocalAgentPlugin.lifecycleLock){synchronized(JsonCredentialSlots.LOCK){changed.set(true);}}});
  writer.start();check(mutatorStarted.await(2,TimeUnit.SECONDS),"writer attempted");check(!changed.get(),"writer cannot pass lifecycle lock");
  release.countDown();reader.join(3000);writer.join(3000);
  check(!reader.isAlive()&&!writer.isAlive(),"threads terminated");check(failure.get()==null,"reader succeeded");check(changed.get(),"writer proceeds after delivery");
  System.out.println("PASS actual credential read hook: shared signature, exact result, locks, mutation, stale owner, exception and delivery race");
 }
}`);
  const javaHome=process.env.JAVA_HOME||'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
  execFileSync(join(javaHome,'bin/javac'),['-J-Xmx256m','--release','11','-d',directory,join(directory,'JsonCredentialSlots.java'),join(directory,'ReadHookHarness.java')],{timeout:30000});
  const output=execFileSync(join(javaHome,'bin/java'),['-Xmx128m','-cp',directory,'ai.elizaresearch.alphaphone.ReadHookHarness'],{encoding:'utf8',timeout:15000});
  assert.match(output,/PASS actual credential read hook/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
