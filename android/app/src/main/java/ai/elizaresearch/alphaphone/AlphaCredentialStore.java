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
 /** Reminder-to-note back-references: identity only, at most 200 links (runtime/note-origin.ts). */
 static final String NOTE_ORIGINS="note-origins:v1:device";
 interface CloudChangeObserver {void changed()throws Exception;}
 private static CloudChangeObserver cloudChange=()->{};
 static void observeCloudChanges(CloudChangeObserver observer){synchronized(JsonCredentialSlots.LOCK){cloudChange=observer;}}
 private final JsonCredentialSlots slots;
 private final Context context;
 private final Runnable assertOwner;
 private final ai.eliza.plugins.agent.runtime.ResidentCredentialStore resident;
 AlphaCredentialStore(Context context){this(context,()->{});}
 AlphaCredentialStore(Context context,Runnable assertOwner){
  this.context=context.getApplicationContext();this.assertOwner=assertOwner;
  slots=new JsonCredentialSlots(new File(context.getApplicationContext().getNoBackupFilesDir(),"connection-credentials"),"alpha.connection.aes.v1",AlphaCredentialStore::slotLimit,AlphaCredentialStore::retainedLimit);
  resident=new ai.eliza.plugins.agent.runtime.ResidentCredentialStore(
   new ai.eliza.plugins.agent.runtime.ResidentCredentialStore.Slots(){
    public String read(String name)throws Exception{return slots.read(CloudDeployment.storageSlot(name));}
    public void write(String name,String value)throws Exception{slots.write(CloudDeployment.storageSlot(name),value);}
    public void remove(String name)throws Exception{slots.remove(CloudDeployment.storageSlot(name));}
   },new ai.eliza.plugins.agent.runtime.ResidentCredentialStore.Authority(){
    public Object credentialLock(){return JsonCredentialSlots.LOCK;}
    public void assertCurrent(){assertOwner.run();}
    public <T>T mutate(Runnable guard,ai.eliza.plugins.securestore.nativeonly.CredentialMutationConductor.Mutation<T> change)throws Exception{return AlphaLocalAgentPlugin.mutateCredentials(AlphaCredentialStore.this.context,()->{assertOwner.run();guard.run();},change);}
    public long epoch(){return AlphaLocalAgentPlugin.credentialAuthorityEpoch();}
    public long intent(){return AlphaLocalAgentPlugin.currentCredentialIntent();}
    public <T>T withEpoch(long expected,java.util.concurrent.Callable<T> action)throws Exception{return AlphaLocalAgentPlugin.withCredentialAuthority(expected,action);}
    public void changed(){AlphaLocalAgentPlugin.powerAuthorizationChanged();}
    public boolean admissionReadable(){return AlphaLocalAgentPlugin.providerAdmissionReadable();}
   },new ai.eliza.plugins.agent.runtime.ResidentCredentialStore.Compatibility(){
    public void beforeMutation()throws Exception{legacyRecovery().block();}
    public void cloudChanged()throws Exception{cloudChange.changed();}
    public void clearPendingReturn()throws Exception{slots.remove(CloudDeployment.storageSlot(GoogleWorkspaceReturn.SLOT));}
   },LocalAgentProviderAdmission.PROVIDER_SLOT,"cloud:production","cloud:staging");
 }
 static int slotLimit(String name){
  if("sms-send-ledger:v1:device".equals(name))return 1024*1024;
  if("gmail-background:v1".equals(name))return 2*1024*1024;
  if("native-delete-journal:v1".equals(name)||"native-calendar-sync:v1".equals(name))return 4*1024*1024;
  if("notes-audio-deletions:v1:device".equals(name))return 1024*1024;
  if(name!=null&&name.matches("note-audio-metadata:v1:[A-Za-z0-9_-]{1,100}"))return 512*1024;
  if(NOTES_RECORDS.equals(name))return 32*1024*1024;
  // Restorable copies of deleted notes, purged three days after deletion. The cap is the Trash
  // policy's byte limit (runtime/notes-trash-policy.ts NOTES_TRASH_MAX_BYTES); a document written
  // under the earlier 32 MiB cap stays readable and shrinkable through retainedLimit.
  if(NOTES_TRASH.equals(name))return NOTES_TRASH_BYTES;
  if(NOTES_DRAFT.equals(name))return 32*1024*1024;
  // 200 links of bounded ids and a hash stay well under this; a larger value is not a valid index.
  if(NOTE_ORIGINS.equals(name))return 512*1024;
  if(name!=null&&(name.startsWith("inbox-drafts:v1:")||name.matches("inbox-operation:v1:[a-f0-9]{64}")))return 8*1024*1024;
  if(name!=null&&name.matches("calendar-linked-sync:v1:[a-f0-9]{64}"))return 4*1024*1024;
  if(name!=null&&name.matches("connected-read-cache:v1:[a-f0-9]{64}"))return 4*1024*1024;
  return 256*1024;
 }
 /** Notes Trash policy limit (30 MiB), now also its slot cap. */
 static final int NOTES_TRASH_BYTES=30*1024*1024;
 /** The cap a slot had before it was lowered. Data stored under it stays readable, and a write
  * that does not grow it is accepted, until it fits the current cap (JsonCredentialSlots,
  * elizaOS/eliza#35910). Never below slotLimit. */
 static int retainedLimit(String name){
  if(NOTES_TRASH.equals(name))return 32*1024*1024;
  return slotLimit(name);
 }
 /** Refuses only what no stored value can admit (above the retained cap) before any shutdown or
  * write. Values between the cap and the retained cap are decided by the shared slot, whose
  * CapacityException mutateSlot reports as StorageFullException. */
 private static void requireCapacity(String name,String value)throws StorageFullException{
  if(value==null)return;
  // UTF-8 never encodes a char in fewer than 1 byte, so a short string cannot exceed the cap.
  if(value.length()<=retainedLimit(name)/3)return;
  if(value.getBytes(StandardCharsets.UTF_8).length>retainedLimit(name))throw new StorageFullException();
 }
 String slotHash(String name)throws Exception{return slots.slotHash(CloudDeployment.storageSlot(name));}
 AtomicFile slotFile(String hash)throws Exception{return slots.slotFile(hash);}
 String readCredentialSlot(String name)throws Exception{return slots.read(CloudDeployment.storageSlot(name));}
 /** Reads a saved slot before Application startup during pending reset recovery. */
 static String readSlotBeforeAttach(Context base,String name)throws Exception{
  return new JsonCredentialSlots(new File(base.getNoBackupFilesDir(),"connection-credentials"),"alpha.connection.aes.v1",AlphaCredentialStore::slotLimit).read(CloudDeployment.storageSlot(name));
 }
 /** Critical credential changes cannot leave a child process using the old environment. */
 void writeCredentialSlot(String name,String value)throws Exception{if(value==null)throw new IllegalArgumentException("Credential value required");requireCapacity(name,value);mutateSlot(name,null,value,false);}
 void removeCredentialSlot(String name)throws Exception{mutateSlot(name,null,null,false);}
 boolean compareExchangeCredentialSlot(String name,String expected,String value)throws Exception{requireCapacity(name,value);return mutateSlot(name,expected,value,true);}
 private boolean mutateSlot(String name,String expected,String value,boolean compare)throws Exception{
  // The shared slot refuses an oversized value before writing any byte; that is a full slot.
  try{return mutateSlotOnce(name,expected,value,compare);}
  catch(JsonCredentialSlots.CapacityException full){throw new StorageFullException();}
 }
 private boolean mutateSlotOnce(String name,String expected,String value,boolean compare)throws Exception{
  // Native sign-in metadata carries the same intent guard as its credential. Acquire
  // that authority before the vault; unrelated background slots retain their existing locks.
  if(name!=null&&name.startsWith("cloud-signin:"))return AlphaLocalAgentPlugin.withCredentialAuthority(
   AlphaLocalAgentPlugin.credentialAuthorityEpoch(),()->resident.mutateSlot(name,expected,value,compare));
  return resident.mutateSlot(name,expected,value,compare);
 }
 private LegacyCloudRecovery legacyRecovery(){return new LegacyCloudRecovery(slots,CloudDeployment.STORAGE_NAMESPACE,assertOwner);}
 /** Reads and commits use the SAME lifecycle→vault order as all credential mutations. */
 private <T>T recoveryStep(java.util.concurrent.Callable<T> step)throws Exception{
  return AlphaLocalAgentPlugin.mutateCredentials(context,assertOwner,new AlphaLocalAgentPlugin.CredentialMutation<T>(){
   public boolean requiresShutdown(){return false;}
   public T commit()throws Exception{return step.call();}
  });
 }
 /** Automatic startup unbind is a no-op when native confirms there is no provider.
  * Explicit clear still uses removeCredentialSlot and durably blocks legacy recovery. */
 void removeProviderIfPresent()throws Exception{
  String before=recoveryStep(()->slots.read(CloudDeployment.storageSlot(LocalAgentProviderAdmission.PROVIDER_SLOT)));
  if(before==null)return;
  if(!compareExchangeCredentialSlot(LocalAgentProviderAdmission.PROVIDER_SLOT,before,null))throw new IllegalStateException("Provider changed");
 }
 /** Opaque cleanup authority for the exact binding and existing intent, never a credential. */
 String providerBindingGuard(String expected)throws Exception{return resident.bindingGuard(expected);}
 boolean removeProviderIfCurrent(String guard)throws Exception{return resident.removeIfCurrent(guard,AlphaLocalAgentPlugin::reserveCredentialIntent,AlphaLocalAgentPlugin::requireCredentialIntent);}
 boolean legacyCloudRecoveryEligible()throws Exception{return recoveryStep(()->legacyRecovery().eligible());}
 boolean restoreLegacyCloudCredential()throws Exception{
  LegacyCloudRecovery.Snapshot before=recoveryStep(()->legacyRecovery().snapshot());
  if(before==null)return false;
  // Never hold lifecycle or vault locks across HTTP. The second critical section rechecks
  // intent/owner, exact old bytes, journal and absent targets before committing.
  AlphaConnectionPlugin.readCloudIdentity(before.token());
  return recoveryStep(()->{boolean restored=legacyRecovery().commit(before);if(restored)AlphaLocalAgentPlugin.powerAuthorizationChanged();return restored;});
 }
 void assertCurrent(){assertOwner.run();}
 /** Only explicit, validated native provider configuration may establish admission identity. */
 String compareExchangeProviderAdmission(String expected,String selection,String credentialSlot,String expectedCredential,org.json.JSONObject verifiedIdentity)throws Exception{return resident.compareExchangeAdmission(expected,selection,credentialSlot,expectedCredential,verifiedIdentity);}
 void rollbackProviderAdmission(String admitted,String previous)throws Exception{resident.rollbackAdmission(admitted,previous);}
 String providerAdmissionGeneration()throws Exception{return resident.admissionGeneration();}
 org.json.JSONObject providerAdmissionSnapshot()throws Exception{return resident.admissionSnapshot();}

}
