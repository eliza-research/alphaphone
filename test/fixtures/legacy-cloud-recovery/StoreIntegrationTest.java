package ai.elizaresearch.alphaphone;
import java.io.File;
import ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots;
public final class StoreIntegrationTest {
 static void check(boolean value,String why){if(!value)throw new AssertionError(why);}
 public static void main(String[] args)throws Exception{
  for(String operation:new String[]{"restore","remove","same-remove","write","provider"}){
   android.content.Context context=new android.content.Context(new File(args[0],operation));
   JsonCredentialSlots raw=new JsonCredentialSlots(new File(context.getNoBackupFilesDir(),"connection-credentials"),"alpha.connection.aes.v1",name->262144);
   raw.write("cloud:production",LegacyCloudRecoveryTest.SAVED);
   AlphaCredentialStore store=new AlphaCredentialStore(context);
   check(store.readCredentialSlot("cloud:production")==null,"original scoped lookup preserves isolation");
   if(operation.equals("restore")){
    check(store.restoreLegacyCloudCredential(),"actual store restore");check(AlphaConnectionPlugin.verified==1,"canonical native identity route invoked");
    check(LegacyCloudRecoveryTest.SAVED.equals(store.readCredentialSlot("cloud:production")),"actual store readback");
    check(store.readCredentialSlot("local-agent-provider:v1")==null,"existing normal admission still required");
   }else{
    if(operation.equals("remove")||operation.equals("same-remove"))store.removeCredentialSlot("cloud:production");
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
  System.out.println("PASS actual AlphaCredentialStore restore, canonical identity, no-op clears and explicit writes");
 }
}
