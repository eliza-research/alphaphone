import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {javaBinary,nativeSource} from './fixtures/jvm-tools.mjs';
const strip=text=>text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,'');
test('the listener owner is read once per credential state and never survives a provider or Cloud commit',()=>{
 const agent=strip(readFileSync(nativeSource('AlphaLocalAgentPlugin.java'),'utf8')),store=strip(readFileSync(nativeSource('AlphaCredentialStore.java'),'utf8'));
 assert.match(agent,/static String invocationOwner\(Context context\)\{return INVOCATION_OWNER\.get\(\(\)->readProviderGeneration\(new AlphaCredentialStore\(context\)\)\);\}/);
 assert.match(agent,/private static <T> T commitCredentials\(CredentialMutation<T> mutation\)throws Exception\{INVOCATION_OWNER\.invalidate\(\);try\{return mutation\.commit\(\);\}finally\{INVOCATION_OWNER\.invalidate\(\);\}\}/);
 // Every commit in mutateCredentials (the only path that writes the provider or Cloud slots) is wrapped.
 assert.equal(agent.match(/mutation\.commit\(\)/g).length,1);assert.equal(agent.match(/return commitCredentials\(mutation\);/g).length,2);
 // The store writes the provider and Cloud slots only inside a CredentialMutation commit.
 const fast=store.slice(store.indexOf('private boolean mutateSlotOnce('),store.indexOf('return AlphaLocalAgentPlugin.mutateCredentials('));
 assert.match(fast,/if\(!"cloud:production"\.equals\(name\)&&!"cloud:staging"\.equals\(name\)&&!LocalAgentProviderAdmission\.PROVIDER_SLOT\.equals\(name\)\)\{/);
 const temporary=mkdtempSync(join(tmpdir(),'invocation-owner-cache-'));
 try{
  writeFileSync(join(temporary,'Harness.java'),`package ai.elizaresearch.alphaphone;
public final class Harness {
 static String value="owner-a";static int reads;
 static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
 public static void main(String[] args)throws Exception{
  InvocationOwnerCache cache=new InvocationOwnerCache();
  InvocationOwnerCache.Reader reader=()->{reads++;return value;};
  check("owner-a".equals(cache.get(reader))&&"owner-a".equals(cache.get(reader))&&reads==1,"read once while unchanged");
  value="owner-b";cache.invalidate();
  check("owner-b".equals(cache.get(reader))&&reads==2,"a commit invalidates the owner");
  // A read that started before a commit finished is returned to its caller but never cached.
  cache.invalidate();String inFlight=cache.get(()->{reads++;String old=value;value="owner-c";cache.invalidate();return old;});
  check("owner-b".equals(inFlight),"in-flight read returns what it read");
  check("owner-c".equals(cache.get(reader)),"a read overlapping a commit is not cached");
  // A failed read is not cached as the owner.
  cache.invalidate();
  check(cache.get(()->{throw new Exception("locked");})==null,"failure is null");
  int before=reads;check("owner-c".equals(cache.get(reader))&&reads==before+1,"failure is not cached");
  // A stored null (invalid admission) is cached until the next commit.
  value=null;cache.invalidate();before=reads;
  check(cache.get(reader)==null&&cache.get(reader)==null&&reads==before+1,"null owner cached");
  value="owner-d";cache.invalidate();check("owner-d".equals(cache.get(reader)),"null replaced after commit");
  System.out.println("PASS invocation owner cache");
 }
}`);
  execFileSync(javaBinary('javac'),['-d',temporary,nativeSource('InvocationOwnerCache.java'),join(temporary,'Harness.java')]);
  assert.match(execFileSync(javaBinary('java'),['-cp',temporary,'ai.elizaresearch.alphaphone.Harness'],{encoding:'utf8'}),/PASS invocation owner cache/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
