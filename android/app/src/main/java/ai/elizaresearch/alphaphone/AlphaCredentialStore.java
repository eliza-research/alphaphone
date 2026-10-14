package ai.elizaresearch.alphaphone;

import android.content.Context;
import android.util.AtomicFile;
import ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots;
import java.io.File;
import java.nio.charset.StandardCharsets;

/** Product identity and limits for the installed shared JSON-slot format. */
final class AlphaCredentialStore {
 /** Definite refusal before any byte is written: the value exceeds its slot's cap. */
 static final class StorageFullException extends Exception {
  StorageFullException(){super("Secure storage slot is full");}
 }
 static final String NOTES_RECORDS="notes-records:v1:device";
 static final String NOTES_TRASH="notes-trash:v1:device";
 /** Encrypted copy of Notes edits whose collection commit failed or is uncertain. */
 static final String NOTES_DRAFT="notes-draft:v1:device";
 private final JsonCredentialSlots slots;
 private final Context context;
 private final Runnable assertOwner;
 AlphaCredentialStore(Context context){this(context,()->{});}
 AlphaCredentialStore(Context context,Runnable assertOwner){
  this.context=context.getApplicationContext();this.assertOwner=assertOwner;
  slots=new JsonCredentialSlots(new File(context.getApplicationContext().getNoBackupFilesDir(),"connection-credentials"),"alpha.connection.aes.v1",AlphaCredentialStore::slotLimit);
 }
 static int slotLimit(String name){
  if("native-delete-journal:v1".equals(name))return 4*1024*1024;
  if("notes-audio-deletions:v1:device".equals(name))return 1024*1024;
  if(name!=null&&name.matches("note-audio-metadata:v1:[A-Za-z0-9_-]{1,100}"))return 512*1024;
  if(NOTES_RECORDS.equals(name))return 32*1024*1024;
  // Restorable copies of deleted notes, purged three days after deletion.
  if(NOTES_TRASH.equals(name))return 32*1024*1024;
  if(NOTES_DRAFT.equals(name))return 32*1024*1024;
  if(name!=null&&(name.startsWith("inbox-drafts:v1:")||name.matches("inbox-operation:v1:[a-f0-9]{64}")))return 8*1024*1024;
  return 256*1024;
 }
 /** The shared slot rejects oversized values with a generic error; report the cap distinctly. */
 private static void requireCapacity(String name,String value)throws StorageFullException{
  if(value==null)return;
  // UTF-8 never encodes a char in fewer than 1 byte, so a short string cannot exceed the cap.
  if(value.length()<=slotLimit(name)/3)return;
  if(value.getBytes(StandardCharsets.UTF_8).length>slotLimit(name))throw new StorageFullException();
 }
 String slotHash(String name)throws Exception{return slots.slotHash(name);}
 AtomicFile slotFile(String hash)throws Exception{return slots.slotFile(hash);}
 String readCredentialSlot(String name)throws Exception{return slots.read(name);}
 /** Critical credential changes cannot leave a child process using the old environment. */
 void writeCredentialSlot(String name,String value)throws Exception{if(value==null)throw new IllegalArgumentException("Credential value required");requireCapacity(name,value);mutateSlot(name,null,value,false);}
 void removeCredentialSlot(String name)throws Exception{mutateSlot(name,null,null,false);}
 boolean compareExchangeCredentialSlot(String name,String expected,String value)throws Exception{requireCapacity(name,value);return mutateSlot(name,expected,value,true);}
 private boolean mutateSlot(String name,String expected,String value,boolean compare)throws Exception{
  if(!"cloud:production".equals(name)&&!"cloud:staging".equals(name)&&!LocalAgentProviderAdmission.PROVIDER_SLOT.equals(name)){
   synchronized(JsonCredentialSlots.LOCK){
    assertOwner.run();if(compare&&!java.util.Objects.equals(slots.read(name),expected))return false;
    if(value==null)slots.remove(name);else slots.write(name,value);return true;
   }
  }
  return AlphaLocalAgentPlugin.mutateCredentials(context,assertOwner,new AlphaLocalAgentPlugin.CredentialMutation<Boolean>(){
   String before,provider;boolean conflict;
   public boolean requiresShutdown()throws Exception{
    before=slots.read(name);provider=slots.read(LocalAgentProviderAdmission.PROVIDER_SLOT);
    conflict=compare&&!java.util.Objects.equals(before,expected);
    if(conflict)return false;
    if(LocalAgentProviderAdmission.PROVIDER_SLOT.equals(name))return before!=null||value!=null;
    if(java.util.Objects.equals(before,value))return false;
    String environment=provider==null?"production":new org.json.JSONObject(provider).optString("environment","production");
    return name.equals("cloud:"+environment)&&!LocalAgentProviderAdmission.sameCloudCredential(before,value);
   }
   public Boolean commit()throws Exception{
    if(conflict)return false;
    if(!LocalAgentProviderAdmission.PROVIDER_SLOT.equals(name)&&java.util.Objects.equals(before,value))return true;
    if(!java.util.Objects.equals(before,slots.read(name))||!java.util.Objects.equals(provider,slots.read(LocalAgentProviderAdmission.PROVIDER_SLOT)))throw new IllegalStateException("Credential changed");
    invalidateProviderAdmission(name,value);
    if(value==null)slots.remove(name);
    else slots.write(name,LocalAgentProviderAdmission.PROVIDER_SLOT.equals(name)?LocalAgentProviderAdmission.withoutAdmission(value):value);
    return true;
   }
  });
 }
 void assertCurrent(){assertOwner.run();}
 private void invalidateProviderAdmission(String changedSlot,String replacement)throws Exception{
  if(!"cloud:production".equals(changedSlot)&&!"cloud:staging".equals(changedSlot))return;
  String saved=slots.read(LocalAgentProviderAdmission.PROVIDER_SLOT);
  if(saved==null)return;
  org.json.JSONObject provider=new org.json.JSONObject(saved);
  if(!changedSlot.equals("cloud:"+provider.optString("environment","production")))return;
  String previous=slots.read(changedSlot);
  if(replacement!=null&&LocalAgentProviderAdmission.currentGeneration(saved,previous)!=null
     &&LocalAgentProviderAdmission.sameCloudCredential(previous,replacement))return;
  slots.write(LocalAgentProviderAdmission.PROVIDER_SLOT,LocalAgentProviderAdmission.withoutAdmission(saved));
 }
 /** Only explicit, validated native provider configuration may establish admission identity. */
 String compareExchangeProviderAdmission(String expected,String selection,String credentialSlot,String expectedCredential,org.json.JSONObject verifiedIdentity)throws Exception{
  return AlphaLocalAgentPlugin.mutateCredentials(context,assertOwner,new AlphaLocalAgentPlugin.CredentialMutation<String>(){
   String admitted;boolean conflict;
   public boolean requiresShutdown()throws Exception{
    conflict=credentialSlot!=null&&!java.util.Objects.equals(slots.read(credentialSlot),expectedCredential)
      ||!java.util.Objects.equals(slots.read(LocalAgentProviderAdmission.PROVIDER_SLOT),expected);
    if(conflict)return false;
    org.json.JSONObject requested=new org.json.JSONObject(selection);
    boolean cloud="elizacloud".equals(requested.optString("provider"));
    if(cloud?!"cloud:production".equals(credentialSlot):credentialSlot!=null||expectedCredential!=null||verifiedIdentity!=null)throw new IllegalArgumentException();
    admitted=LocalAgentProviderAdmission.admit(expected,selection,expectedCredential,verifiedIdentity);
    String oldGeneration=expected==null?null:LocalAgentProviderAdmission.currentGeneration(expected,expectedCredential);
    return oldGeneration==null||!oldGeneration.equals(LocalAgentProviderAdmission.currentGeneration(admitted,expectedCredential));
   }
   public String commit()throws Exception{
    if(conflict)return null;
    if(credentialSlot!=null&&!java.util.Objects.equals(slots.read(credentialSlot),expectedCredential)
      ||!java.util.Objects.equals(slots.read(LocalAgentProviderAdmission.PROVIDER_SLOT),expected))throw new IllegalStateException("Provider changed");
    if(LocalAgentProviderAdmission.currentGeneration(admitted,expectedCredential)==null)throw new IllegalStateException("Provider credential expired");
    slots.write(LocalAgentProviderAdmission.PROVIDER_SLOT,admitted);return admitted;
   }
  });
 }
 /** Account invalidation may strip this admission, but never overwrite a newer CAS revision. */
 void rollbackProviderAdmission(String admitted,String previous)throws Exception{
  AlphaLocalAgentPlugin.mutateCredentials(context,assertOwner,new AlphaLocalAgentPlugin.CredentialMutation<Void>(){
   String current;boolean owned;
   public boolean requiresShutdown()throws Exception{
    current=slots.read(LocalAgentProviderAdmission.PROVIDER_SLOT);
    if(current==null)return false;
    org.json.JSONObject held=new org.json.JSONObject(current);
    owned=java.util.Objects.equals(current,admitted)
      ||!held.has("admissionGeneration")&&!held.has("admissionFingerprint")
       &&LocalAgentProviderAdmission.withoutAdmission(admitted).equals(held.toString());
    return owned;
   }
   public Void commit()throws Exception{
    if(!owned)return null;
    if(!java.util.Objects.equals(current,slots.read(LocalAgentProviderAdmission.PROVIDER_SLOT)))throw new IllegalStateException("Provider changed");
    if(previous==null)slots.remove(LocalAgentProviderAdmission.PROVIDER_SLOT);
    else slots.write(LocalAgentProviderAdmission.PROVIDER_SLOT,LocalAgentProviderAdmission.withoutAdmission(previous));
    return null;
   }
  });
 }
 /** Read-only correlation, not an authorization or migration API. Legacy selections remain unavailable. */
 String providerAdmissionGeneration()throws Exception{
  synchronized(JsonCredentialSlots.LOCK){
   String saved=slots.read(LocalAgentProviderAdmission.PROVIDER_SLOT);
   if(saved==null||!AlphaLocalAgentPlugin.providerAdmissionReadable())return null;
   org.json.JSONObject selected=new org.json.JSONObject(saved);
   String credential="elizacloud".equals(selected.optString("provider"))?slots.read("cloud:production"):null;
   return LocalAgentProviderAdmission.currentGeneration(saved,credential);
  }
 }
 /** Private whitelist only; neither the logical fingerprint nor billing credentials leave the store. */
 org.json.JSONObject providerAdmissionSnapshot()throws Exception{
  synchronized(JsonCredentialSlots.LOCK){
   String saved=slots.read(LocalAgentProviderAdmission.PROVIDER_SLOT);
   if(saved==null||!AlphaLocalAgentPlugin.providerAdmissionReadable())throw new SecurityException("Native provider binding unavailable");
   org.json.JSONObject selected=new org.json.JSONObject(saved);
   String kind=selected.optString("provider","cerebras");
   String cloud="elizacloud".equals(kind)?slots.read("cloud:production"):null;
   String generation=LocalAgentProviderAdmission.currentGeneration(saved,cloud);
   if(generation==null)throw new SecurityException("Native provider binding unavailable");
   String accountRef="elizacloud".equals(kind)?LocalAgentProviderAdmission.cloudAccountRef(selected):"native-local";
   return new org.json.JSONObject().put("provider",kind).put("environment","production").put("accountRef",accountRef).put("sessionGeneration",generation);
  }
 }

}
