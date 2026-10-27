package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots;
import java.util.Objects;
import org.json.JSONObject;

/** Explicit recovery of this product's pre-deployment production sign-in. Never a read fallback. */
final class LegacyCloudRecovery {
 static final String LEGACY_NAMESPACE="cloud-deployment:897efc6f09b9d4db345c61226d8301a9f1257ad98f0491e8591f63d4f4515874:";
 static final String JOURNAL="cloud:legacy-recovery:v1";
 static final String CLOUD="cloud:production";
 static final String PROVIDER="local-agent-provider:v1";
 interface IdentityCheck {void verify(String token)throws Exception;}
 private final JsonCredentialSlots slots;
 private final String namespace;
 private final Runnable current;
 LegacyCloudRecovery(JsonCredentialSlots slots,String namespace,Runnable current){this.slots=slots;this.namespace=namespace;this.current=current;}
 private String scoped(String slot){return namespace+slot;}
 private boolean compatible(){return LEGACY_NAMESPACE.equals(namespace);}
 /** Explicit sign-out/configuration wins even if no scoped credential was ever written. */
 void block()throws Exception {synchronized(JsonCredentialSlots.LOCK){current.run();slots.write(scoped(JOURNAL),"{\"status\":\"blocked\"}");}}
 private boolean pending(String journal)throws Exception {
  if(journal==null)return true;
  return "pending".equals(new JSONObject(journal).getString("status"));
 }
 /** Metadata only. Missing journal is not consent: restore() must be explicitly invoked. */
 boolean eligible()throws Exception {
  synchronized(JsonCredentialSlots.LOCK){
   current.run();
   return compatible()&&slots.read(scoped(CLOUD))==null&&slots.read(scoped(PROVIDER))==null
     &&pending(slots.read(scoped(JOURNAL)))&&slots.read(CLOUD)!=null;
  }
 }
 /** No OAuth attempts/provider proof are copied. Failed verification/writes keep the old slot. */
 boolean restore(IdentityCheck identity)throws Exception {
  final String legacy,journal;
  synchronized(JsonCredentialSlots.LOCK){
   if(!eligible())return false;
   legacy=slots.read(CLOUD);journal=slots.read(scoped(JOURNAL));
  }
  JSONObject saved=new JSONObject(legacy);
  // Reuse current credential parsing/expiry checks before the canonical identity read.
  String token=LocalAgentProviderAdmission.cloudProviderToken(legacy,saved.getString("credentialId"),System.currentTimeMillis());
  identity.verify(token);
  synchronized(JsonCredentialSlots.LOCK){
   current.run();
   if(!eligible()||!Objects.equals(legacy,slots.read(CLOUD))||!Objects.equals(journal,slots.read(scoped(JOURNAL))))return false;
   LocalAgentProviderAdmission.cloudProviderToken(legacy,saved.getString("credentialId"),System.currentTimeMillis());
   // Journal first. A failed credential write remains explicitly retryable; a committed target
   // always wins, even if the final marker write fails. The old encrypted copy is never removed.
   slots.write(scoped(JOURNAL),"{\"status\":\"pending\"}");
   current.run();
   slots.write(scoped(CLOUD),legacy);
   slots.write(scoped(JOURNAL),"{\"status\":\"complete\"}");
   return true;
  }
 }
}
