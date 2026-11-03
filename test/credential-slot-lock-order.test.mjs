import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fixture,jsonJarSkip,nativeSource,root,runJvm} from './fixtures/jvm-tools.mjs';

function method(text,start){
 const begin=text.indexOf(start);assert.ok(begin>=0,start);let depth=0;
 for(let i=text.indexOf('{',begin);i<text.length;i++){
  if(text[i]==='{')depth++;
  if(text[i]==='}'&&--depth===0)return text.slice(begin,i+1);
 }
 throw Error('Unclosed actual method');
}
const java=name=>readFileSync(nativeSource(name),'utf8');
const access=()=>method(java('AlphaLocalAgentPlugin.java'),'static <T> T withCredentialSlotMutation(');
function noncriticalBranch(){
 const store=java('AlphaCredentialStore.java');
 const start=store.indexOf('  if(!"cloud:production".equals(name)'),end=store.indexOf('  return AlphaLocalAgentPlugin.mutateCredentials(',start);
 assert.ok(start>=0&&end>start,'actual noncritical branch located');
 return store.slice(start,end);
}
const slotStub=`package ai.eliza.plugins.securestore.nativeonly;
public class JsonCredentialSlots{public static final Object LOCK=new Object();public final java.util.Map<String,String> data=new java.util.HashMap<>();public String read(String n){synchronized(LOCK){return data.get(n);}}public void write(String n,String v){synchronized(LOCK){data.put(n,v);}}public void remove(String n){synchronized(LOCK){data.remove(n);}}}`;
test('noncritical slot commits keep lifecycle before vault, exact owner/CAS, and unrelated invocation authority',()=>{
 const directory=mkdtempSync(join(tmpdir(),'credential-slot-lock-'));
 const file=(name,text)=>{const path=join(directory,name);writeFileSync(path,text);return path;};
 try{
  const sources=[file('JsonCredentialSlots.java',slotStub),
   file('SlotLockHarness.java',`package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots;
import java.util.concurrent.atomic.*;
final class AlphaLocalAgentPlugin{
 static final Object lifecycleLock=new Object();
 static int invocationInvalidations,credentialIntents,processStops;
 ${access()}
}
final class LocalAgentProviderAdmission{static final String PROVIDER_SLOT="local-agent-provider:v1";}
final class CloudDeployment{static String storageSlot(String n){return "deployment:"+n;}}
final class Store{
 final JsonCredentialSlots slots=new JsonCredentialSlots();final Runnable assertOwner;
 Store(Runnable guard){assertOwner=guard;}
 boolean mutate(String name,String expected,String value,boolean compare)throws Exception{
 ${noncriticalBranch()}
 throw new AssertionError("critical slot must retain its separate shutdown path");
 }
}
public class SlotLockHarness{
 static void check(boolean b,String why){if(!b)throw new AssertionError(why);}
 public static void main(String[] args)throws Exception{
  AtomicInteger guardCalls=new AtomicInteger();AtomicBoolean owner=new AtomicBoolean(true);
  Store store=new Store(()->{check(Thread.holdsLock(AlphaLocalAgentPlugin.lifecycleLock),"owner checked under lifecycle");check(Thread.holdsLock(JsonCredentialSlots.LOCK),"owner checked under vault");guardCalls.incrementAndGet();if(!owner.get())throw new SecurityException("owner changed");});
  for(String slot:new String[]{"cloud-signin:v1:ack:production","cloud-signin:v1:pending","notes-draft:v1:device","connected-read-cache:v1:test"}){
   check(store.mutate(slot,null,"one",false),"write result");
   check("one".equals(store.slots.read(CloudDeployment.storageSlot(slot))),"namespace retained");
   check(!store.mutate(slot,"other","two",true),"CAS mismatch refused");
   check("one".equals(store.slots.read(CloudDeployment.storageSlot(slot))),"CAS refusal unchanged");
   check(store.mutate(slot,"one","two",true),"matching CAS");
   check(store.mutate(slot,null,null,false)&&store.slots.read(CloudDeployment.storageSlot(slot))==null,"remove result");
  }
  check(guardCalls.get()==16,"guard once per noncritical operation");
  AtomicReference<Throwable> error=new AtomicReference<>();
  Thread writer=new Thread(()->{try{store.mutate("cloud-signin:v1:ack:production",null,"late",false);}catch(Throwable e){error.set(e);}});
  boolean vaultAvailable;
  synchronized(AlphaLocalAgentPlugin.lifecycleLock){
   writer.start();
   for(long end=System.nanoTime()+2_000_000_000L;writer.getState()!=Thread.State.BLOCKED;Thread.sleep(1))check(writer.isAlive()&&System.nanoTime()<end,"writer waits for lifecycle");
   Thread attachment=new Thread(()->{synchronized(JsonCredentialSlots.LOCK){}});attachment.setDaemon(true);attachment.start();attachment.join(1000);vaultAvailable=!attachment.isAlive();
   owner.set(false);
  }
  writer.join(2000);check(!writer.isAlive(),"writer terminated");
  check(vaultAvailable,"waiting guarded slot writer never holds vault before lifecycle");
  check(error.get() instanceof SecurityException,"stale owner rejected inside protected commit");
  check(store.slots.read(CloudDeployment.storageSlot("cloud-signin:v1:ack:production"))==null,"late stale write absent");
  check(AlphaLocalAgentPlugin.invocationInvalidations==0&&AlphaLocalAgentPlugin.credentialIntents==0&&AlphaLocalAgentPlugin.processStops==0,"draft/cache and request authority unchanged");
  System.out.println("PASS actual noncritical slot branch: L-before-vault, ack/pending/draft/cache, owner/CAS/namespace, no authority invalidation");
 }
}`)];
  assert.match(runJvm(sources,'ai.elizaresearch.alphaphone.SlotLockHarness'),/^PASS actual noncritical slot branch/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

const notices=name=>join(root,'vendor/eliza/plugins/plugin-native-notifications/android/src/main/java/ai/eliza/plugins/notifications',name);
/** Shipped lock order, Gmail Host and plugin lifecycle over Android-free ports for GmailLockOrderTest. */
const shipped=()=>{
 const agent=java('AlphaLocalAgentPlugin.java');
 return {access:access(),tokens:agent.match(/ private static volatile String rootToken,ownerToken;/)?.[0],enrollment:method(agent,'static boolean enrollmentPresent()'),
  load:method(java('AlphaGmailPlugin.java'),'@Override public void load()'),onResume:method(java('AlphaGmailPlugin.java'),'@Override protected void handleOnResume()')};
};
function gmailLockOrder({access,tokens,enrollment,load,onResume}){
 const plugin=java('AlphaGmailPlugin.java');
 assert.ok(tokens,'enrollment tokens located');
 const directory=mkdtempSync(join(tmpdir(),'gmail-lock-order-'));
 const file=(name,text)=>{const path=join(directory,name);writeFileSync(path,text);return path;};
 try{
  return runJvm([file('JsonCredentialSlots.java',slotStub),file('Shipped.java',`package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.notifications.MailBackgroundDelivery;
import ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots;
import java.util.concurrent.*;
import org.json.JSONObject;
final class AlphaLocalAgentPlugin{
 static final Object lifecycleLock=new Object();
 ${tokens}
 ${enrollment}
 ${access}
 static void enroll(String root,String owner){synchronized(lifecycleLock){rootToken=root;ownerToken=owner;}}
}
final class LocalAgentProviderAdmission{static final String PROVIDER_SLOT="local-agent-provider:v1";static JSONObject verifiedCloudIdentity(JSONObject data)throws Exception{return new JSONObject().put("userId",data.getString("id")).put("organizationId",data.getString("organization_id"));}}
final class CloudDeployment{static String storageSlot(String n){return "deployment:"+n;}}
final class AlphaDataReset{static final AlphaDataReset RESET=new AlphaDataReset();boolean pending(Object app){return false;}}
final class AlphaCredentialStore{
 final JsonCredentialSlots slots=new JsonCredentialSlots();final Runnable assertOwner;
 AlphaCredentialStore(Runnable guard){assertOwner=guard;}
 String readCredentialSlot(String name)throws Exception{return slots.read(CloudDeployment.storageSlot(name));}
 void writeCredentialSlot(String name,String value)throws Exception{mutate(name,null,value,false);}
 void removeCredentialSlot(String name)throws Exception{mutate(name,null,null,false);}
 boolean mutate(String name,String expected,String value,boolean compare)throws Exception{
 ${noncriticalBranch()}
 throw new AssertionError("critical slot must retain its separate shutdown path");
 }
}
final class GmailBinding{
 static final String SLOT="gmail-background:v1";
 static MailBackgroundDelivery.Host host(AlphaCredentialStore store,Object app){return ${method(java('GmailBackground.java'),'new MailBackgroundDelivery.Host()')};}
}
final class Intent{String data;Intent(String data){this.data=data;}Intent setData(String value){data=value;return this;}}
final class JSObject{}
final class MailNoticePoster{
 static final class Tap{final String key;final boolean question=false;Tap(String key){this.key=key;}}
 Tap tap(Intent intent){return intent==null||intent.data==null?null:new Tap(intent.data);}
}
final class GmailBackground{
 static MailBackgroundDelivery delivery;
 static synchronized MailNoticePoster poster(Object context){return new MailNoticePoster();}
 static synchronized MailBackgroundDelivery get(Object context){return delivery;}
}
abstract class Plugin{
 final java.util.concurrent.atomic.AtomicInteger pendingNotices=new java.util.concurrent.atomic.AtomicInteger();
 Object getContext(){return this;}
 Plugin getActivity(){return this;}
 Intent getIntent(){return null;}
 void notifyListeners(String event,JSObject data,boolean retain){if("pendingMail".equals(event))pendingNotices.incrementAndGet();}
 public void load(){}
 protected void handleOnNewIntent(Intent intent){}
 protected void handleOnResume(){}
}
final class GmailLifecycle extends Plugin{
 ${plugin.match(/ private final ExecutorService io=.*;/)[0]}
 ${method(plugin,'private MailBackgroundDelivery delivery()')}
 ${method(plugin,'private void capture(Intent intent)')}
 ${method(plugin,'private void resume()')}
 ${load}
 ${method(plugin,'@Override protected void handleOnNewIntent(Intent intent)')}
 ${onResume}
 void afterListener(Runnable read){io.execute(read);}
 void drain()throws Exception{io.shutdown();if(!io.awaitTermination(20,TimeUnit.SECONDS))throw new AssertionError("Gmail io drained");}
}`),fixture('GmailLockOrderTest.java'),notices('MailBackgroundDelivery.java'),notices('MailHistoryReconciliation.java')],'ai.elizaresearch.alphaphone.GmailLockOrderTest',{json:true});
 }finally{rmSync(directory,{recursive:true,force:true});}
}
test('the ANR order: Gmail sync and a slot writer complete, stay atomic, and main never waits on them',{skip:jsonJarSkip},()=>{
 assert.match(gmailLockOrder(shipped()),/^PASS Gmail writes stay vault-only[^\n]*\n$/,'no main-thread or deadlock report');
});
test('control: the old lock order deadlocks the same threads and main blocks behind them',{skip:jsonJarSkip},()=>{
 const current=shipped(),old=current.access.replace(/^ *if\(Thread\.holdsLock.*\n/m,'');
 assert.notEqual(old,current.access,'vault-held branch located');
 const out=gmailLockOrder({access:old,tokens:' private static String rootToken,ownerToken;',
  enrollment:'static boolean enrollmentPresent(){synchronized(lifecycleLock){return rootToken!=null&&ownerToken!=null;}}',
  load:'@Override public void load(){delivery();capture(getActivity().getIntent());delivery().resume();}',
  onResume:'@Override protected void handleOnResume(){delivery().resume();notifyListeners("pendingMail",new JSObject(),true);}'});
 assert.match(out,/^MAIN-BLOCKED$/m);
 assert.match(out,/^ENROLLMENT-BLOCKED$/m);
 assert.match(out,/^DEADLOCKED 2 threads$/m);
 assert.doesNotMatch(out,/^PASS/m);
});
