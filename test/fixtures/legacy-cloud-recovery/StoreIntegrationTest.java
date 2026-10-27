package ai.elizaresearch.alphaphone;
import java.io.File;
import ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots;
public final class StoreIntegrationTest {
 static void check(boolean value,String why){if(!value)throw new AssertionError(why);}
 public static void main(String[] args)throws Exception{
  for(String operation:new String[]{"restore","remove","same-remove","write","provider","explicit-provider-clear"}){
   android.content.Context context=new android.content.Context(new File(args[0],operation));
   JsonCredentialSlots raw=new JsonCredentialSlots(new File(context.getNoBackupFilesDir(),"connection-credentials"),"alpha.connection.aes.v1",name->262144);
   raw.write("cloud:production",LegacyCloudRecoveryTest.SAVED);
   AlphaCredentialStore store=new AlphaCredentialStore(context);
   check(store.readCredentialSlot("cloud:production")==null,"original scoped lookup preserves isolation");
   if(operation.equals("restore")){
    check(store.restoreLegacyCloudCredential(),"actual store restore");check(AlphaConnectionPlugin.verified==1,"canonical native identity route invoked");
    check(LegacyCloudRecoveryTest.SAVED.equals(store.readCredentialSlot("cloud:production")),"actual store readback");
    check(store.readCredentialSlot("local-agent-provider:v1")==null,"existing normal admission still required");
    AlphaLocalAgentPlugin.bindCloudProvider(store,LegacyCloudRecoveryTest.ID,LocalAgentProviderAdmission.CLOUD_PROVIDER_MODEL);
    String selected=store.readCredentialSlot("local-agent-provider:v1");
    check(LocalAgentProviderAdmission.currentGeneration(selected,store.readCredentialSlot("cloud:production"))!=null,"absent provider receives fresh canonical admission");
    check(LocalAgentProviderAdmission.providerStatus(selected,store.readCredentialSlot("cloud:production"),System.currentTimeMillis()).optBoolean("configured"),"normal Cloud provider configured");
    check(AlphaConnectionPlugin.verified==2,"normal admission rechecks canonical identity instead of reusing old proof");
   }else{
    if(operation.equals("remove")||operation.equals("same-remove"))store.removeCredentialSlot("cloud:production");
    else if(operation.equals("explicit-provider-clear"))AlphaLocalAgentPlugin.clearProviderSlot(store,false);
    else if(operation.equals("write"))store.writeCredentialSlot("cloud:production",LegacyCloudRecoveryTest.SAVED);
    else store.writeCredentialSlot("local-agent-provider:v1","{\"provider\":\"cerebras\",\"model\":\"qwen-3.8-27b\"}");
    check(!store.legacyCloudRecoveryEligible(),"actual explicit mutation suppresses future restore: "+operation);
    check(raw.read(CloudDeployment.STORAGE_NAMESPACE+LegacyCloudRecovery.JOURNAL).contains("blocked"),"durable tombstone");
   }
   check(LegacyCloudRecoveryTest.SAVED.equals(raw.read("cloud:production")),"legacy copy preserved");
  }
  android.content.Context context=new android.content.Context(new File(args[0],"failed-tombstone"));
  JsonCredentialSlots raw=new JsonCredentialSlots(new File(context.getNoBackupFilesDir(),"connection-credentials"),"alpha.connection.aes.v1",name->262144);
  raw.write(CloudDeployment.STORAGE_NAMESPACE+"cloud:production",LegacyCloudRecoveryTest.SAVED);
  android.util.AtomicFile.failAfterStarts=0;
  try{new AlphaCredentialStore(context).removeCredentialSlot("cloud:production");throw new AssertionError("failed tombstone allowed removal");}catch(java.io.IOException expected){}
  check(LegacyCloudRecoveryTest.SAVED.equals(raw.read(CloudDeployment.STORAGE_NAMESPACE+"cloud:production")),"failed tombstone keeps current key");
  android.content.Context startup=new android.content.Context(new File(args[0],"passive-startup"));
  JsonCredentialSlots startupRaw=new JsonCredentialSlots(new File(startup.getNoBackupFilesDir(),"connection-credentials"),"alpha.connection.aes.v1",name->262144);
  startupRaw.write("cloud:production",LegacyCloudRecoveryTest.SAVED);
  AlphaCredentialStore startupStore=new AlphaCredentialStore(startup);
  check(!AlphaLocalAgentPlugin.clearProviderSlot(startupStore,true).optBoolean("configured"),"startup confirms genuinely empty provider");
  check(startupStore.legacyCloudRecoveryEligible()&&startupRaw.read(CloudDeployment.STORAGE_NAMESPACE+LegacyCloudRecovery.JOURNAL)==null,"automatic empty unbind preserves recovery instead of manufacturing signout");
  startupRaw.write(CloudDeployment.STORAGE_NAMESPACE+"local-agent-provider:v1","{}");
  AlphaLocalAgentPlugin.clearProviderSlot(startupStore,true);
  check(startupStore.readCredentialSlot("local-agent-provider:v1")==null&&!startupStore.legacyCloudRecoveryEligible(),"present provider removal still clears and tombstones even if malformed");
  // Hold the REAL lifecycle lock while recovery starts. Correct code waits before acquiring
  // the vault. The previous Json→intent path occupies the vault and fails this bounded test.
  android.content.Context contention=new android.content.Context(new File(args[0],"lock-order"));
  JsonCredentialSlots retained=new JsonCredentialSlots(new File(contention.getNoBackupFilesDir(),"connection-credentials"),"alpha.connection.aes.v1",name->262144);
  retained.write("cloud:production",LegacyCloudRecoveryTest.SAVED);
  java.util.concurrent.CountDownLatch lifecycleHeld=new java.util.concurrent.CountDownLatch(1),releaseLifecycle=new java.util.concurrent.CountDownLatch(1),recoveryStarted=new java.util.concurrent.CountDownLatch(1),vaultAvailable=new java.util.concurrent.CountDownLatch(1);
  java.util.concurrent.atomic.AtomicReference<Throwable> problem=new java.util.concurrent.atomic.AtomicReference<>();
  Thread normal=new Thread(()->{synchronized(AlphaLocalAgentPlugin.lifecycleLock){lifecycleHeld.countDown();try{releaseLifecycle.await();synchronized(JsonCredentialSlots.LOCK){}}catch(Exception failure){problem.set(failure);}}});normal.setDaemon(true);normal.start();check(lifecycleHeld.await(2,java.util.concurrent.TimeUnit.SECONDS),"lifecycle fixture held");
  Thread recoveryThread=new Thread(()->{recoveryStarted.countDown();try{new AlphaCredentialStore(contention,()->AlphaLocalAgentPlugin.requireCredentialIntent(1)).legacyCloudRecoveryEligible();}catch(Throwable failure){problem.set(failure);}});recoveryThread.setDaemon(true);recoveryThread.start();check(recoveryStarted.await(2,java.util.concurrent.TimeUnit.SECONDS),"recovery fixture started");
  // Wait for recovery either to acquire the vault (old bug) or block on lifecycle (fixed).
  long deadline=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(2);
  while(recoveryThread.getState()!=Thread.State.BLOCKED&&System.nanoTime()<deadline)Thread.yield();
  check(recoveryThread.getState()==Thread.State.BLOCKED,"recovery reached real lock boundary");
  Thread vaultProbe=new Thread(()->{synchronized(JsonCredentialSlots.LOCK){vaultAvailable.countDown();}});vaultProbe.setDaemon(true);vaultProbe.start();
  boolean ordered=vaultAvailable.await(1,java.util.concurrent.TimeUnit.SECONDS);releaseLifecycle.countDown();
  check(ordered,"recovery must not hold vault while waiting for lifecycle");normal.join(2000);recoveryThread.join(2000);check(!normal.isAlive()&&!recoveryThread.isAlive()&&problem.get()==null,"concurrent signout/recovery completes");
  System.out.println("PASS actual AlphaCredentialStore restore, canonical identity, no-op clears and explicit writes");
 }
}
