package ai.elizaresearch.alphaphone;

import android.content.Context;
import ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import org.json.*;

/** Native owner admission and narrow managed-service reads using the existing encrypted Cloud key. */
final class GmailDelivery {
 private static GmailDelivery instance;
 static synchronized GmailDelivery get(Context context){if(instance==null)instance=new GmailDelivery(context.getApplicationContext());return instance;}
 interface Connections {HttpURLConnection open(URL url)throws Exception;}
 private final Connections connections;
 private final Context context;private final AlphaCredentialStore store;private final GmailNoticePoster poster;private final AtomicLong attempts=new AtomicLong();private long admittedAttempt;
 private GmailDelivery(Context context){this(context,url->(HttpURLConnection)url.openConnection());}
 GmailDelivery(Context context,Connections connections){this.connections=connections;this.context=context;store=new AlphaCredentialStore(context);poster=new GmailNoticePoster(context);AlphaCredentialStore.observeCloudChanges(()->withdraw(null));}
 private JSONObject saved()throws Exception{String raw=store.readCredentialSlot(GmailReconciliation.SLOT);return raw==null?null:new JSONObject(raw);}
 long begin(){synchronized(JsonCredentialSlots.LOCK){return attempts.incrementAndGet();}}
 private JSONObject admission(String credentialId,String grant)throws Exception{
  JSONObject snapshot=store.providerAdmissionSnapshot();if(!"elizacloud".equals(snapshot.getString("provider")))throw new SecurityException("Cloud provider required");
  String raw=store.readCredentialSlot("cloud:production");if(raw==null)throw new SecurityException("Cloud sign-in required");JSONObject credential=new JSONObject(raw);if(!credentialId.equals(credential.getString("credentialId")))throw new SecurityException("Cloud credential changed");
  JSONArray account=new JSONArray(snapshot.getString("accountRef"));String user=account.getString(2),organization=account.getString(3);if(organization.isEmpty())throw new SecurityException("Cloud organization required");
  return new JSONObject().put("generation",UUID.randomUUID().toString()).put("credentialId",credentialId).put("credentialDigest",GmailReconciliation.hash(raw)).put("accountRef",snapshot.getString("accountRef")).put("providerGeneration",snapshot.getString("sessionGeneration")).put("userId",user).put("organizationId",organization).put("grantId",GmailReconciliation.id(grant));
 }
 private void admitted(JSONObject binding)throws Exception{
  if(AlphaDataReset.RESET.pending(context))throw new SecurityException("Reset pending");
  JSONObject live=admission(binding.getString("credentialId"),binding.getString("grantId"));
  for(String field:new String[]{"credentialDigest","accountRef","providerGeneration","userId","organizationId"})if(!live.getString(field).equals(binding.getString(field)))throw new SecurityException("Gmail owner changed");
 }
 private void current(JSONObject binding)throws Exception{if(admittedAttempt!=attempts.get())throw new SecurityException("Gmail selection being revalidated");admitted(binding);JSONObject s=saved();if(s==null||!s.getJSONObject("binding").getString("generation").equals(binding.getString("generation")))throw new SecurityException("Gmail selection changed");}
 private GmailReconciliation engine(JSONObject binding){return new GmailReconciliation(new GmailReconciliation.Store(){public String read()throws Exception{return store.readCredentialSlot(GmailReconciliation.SLOT);}public void write(String value)throws Exception{current(binding);store.writeCredentialSlot(GmailReconciliation.SLOT,value);}},()->current(binding),poster);}
 /** Called only from a foreground account selection; native independently revalidates owner and grant. */
 JSONObject configure(long attempt,String credentialId,String grant)throws Exception{
  JSONObject binding; synchronized(JsonCredentialSlots.LOCK){binding=admission(credentialId,grant);}
  GmailReconciliation.Guard guard=()->{if(attempts.get()!=attempt)throw new SecurityException("Mail selection superseded");synchronized(JsonCredentialSlots.LOCK){admitted(binding);}};
  verify(binding,guard);
  synchronized(JsonCredentialSlots.LOCK){guard.check();JSONObject previous=saved();if(previous!=null){JSONObject before=previous.getJSONObject("binding");boolean same=true;for(String field:new String[]{"grantId","credentialDigest","providerGeneration","accountRef"})same&=before.getString(field).equals(binding.getString(field));if(same){admittedAttempt=attempt;GmailDeliveryWorker.schedule(context,before.getString("generation"));return engine(before).status();}}
   poster.cancelAll();GmailDeliveryWorker.cancel(context);store.writeCredentialSlot(GmailReconciliation.SLOT,GmailReconciliation.initial(binding).toString());admittedAttempt=attempt;GmailDeliveryWorker.schedule(context,binding.getString("generation"));return engine(binding).status();}
 }
 void withdraw(String grant)throws Exception{synchronized(JsonCredentialSlots.LOCK){JSONObject s=saved();if(grant!=null&&s!=null&&!grant.equals(s.getJSONObject("binding").getString("grantId")))return;admittedAttempt=begin();store.removeCredentialSlot(GmailReconciliation.SLOT);poster.cancelAll();GmailDeliveryWorker.cancel(context);}}
 /** Credential mutation invalidates old durable callbacks before replacing the Cloud slot. */
 static void credentialsChanged(Context context)throws Exception{get(context).withdraw(null);}
 void resume(){try{synchronized(JsonCredentialSlots.LOCK){if(admittedAttempt!=attempts.get())return;JSONObject s=saved();if(s==null)return;JSONObject binding=s.getJSONObject("binding");current(binding);GmailDeliveryWorker.schedule(context,binding.getString("generation"));}}catch(Exception stale){try{withdraw(null);}catch(Exception ignored){/* Existing callback guards still fail closed. */}}}
 /** Background admission is bound to the Cloud inference provider's owner snapshot; report that coupling instead of an unreachable setup step. */
 private String unconfiguredStatus(){try{return "elizacloud".equals(store.providerAdmissionSnapshot().optString("provider"))?"disabled":"provider-unsupported";}catch(Exception unavailable){return "disabled";}}
 JSONObject status()throws Exception{synchronized(JsonCredentialSlots.LOCK){JSONObject s=saved();if(s==null)return new JSONObject().put("status",unconfiguredStatus());return engine(s.getJSONObject("binding")).status().put("notificationsAllowed",poster.allowed());}}
 private static final class HttpFailure extends IOException {final int status;HttpFailure(int status){super("Gmail service unavailable");this.status=status;}}
 private JSONObject get(JSONObject binding,String path,GmailReconciliation.Guard guard)throws Exception{
  // Constructed paths only, with a fixed service authority. No remote-agent host or redirect.
  if(!(path.equals("/api/v1/user")||path.equals("/api/v1/eliza/google/accounts?side=owner")||path.startsWith("/api/v1/eliza/google/gmail/history?grantId=")))throw new SecurityException("Gmail route denied");
  guard.check();String raw=store.readCredentialSlot("cloud:production");JSONObject credential=new JSONObject(raw);if(credential.has("expiresAt")&&credential.getDouble("expiresAt")<=System.currentTimeMillis())throw new SecurityException("Cloud key expired");
  HttpURLConnection connection=connections.open(new URL(CloudDeployment.PRODUCTION_API+path));
  try{connection.setInstanceFollowRedirects(false);connection.setUseCaches(false);connection.setConnectTimeout(15000);connection.setReadTimeout(30000);connection.setRequestMethod("GET");connection.setRequestProperty("Accept","application/json");connection.setRequestProperty("Authorization","Bearer "+credential.getString("token"));guard.check();int status=connection.getResponseCode();if(status<200||status>=300)throw new HttpFailure(status);ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(InputStream in=connection.getInputStream()){byte[] buffer=new byte[8192];for(int n;(n=in.read(buffer))!=-1;){guard.check();if(bytes.size()+n>1100000)throw new IOException("Gmail response exceeds bound");bytes.write(buffer,0,n);}}guard.check();return new JSONObject(bytes.toString(StandardCharsets.UTF_8.name()));}finally{connection.disconnect();}
 }
 private void verify(JSONObject binding,GmailReconciliation.Guard guard)throws Exception{
  JSONObject me=get(binding,"/api/v1/user",guard);if(!me.getBoolean("success"))throw new SecurityException("Cloud identity unavailable");JSONObject user=LocalAgentProviderAdmission.verifiedCloudIdentity(me.getJSONObject("data"));if(!user.getString("userId").equals(binding.getString("userId"))||!user.getString("organizationId").equals(binding.getString("organizationId")))throw new SecurityException("Cloud owner changed");
  JSONObject response=get(binding,"/api/v1/eliza/google/accounts?side=owner",guard);if(!response.getBoolean("success"))throw new SecurityException("Google account unavailable");JSONArray accounts=response.getJSONArray("data");if(accounts.length()>128)throw new IOException("Too many Google accounts");boolean found=false;
  for(int i=0;i<accounts.length();i++){JSONObject account=accounts.getJSONObject(i);if(!binding.getString("grantId").equals(account.optString("connectionId"))||!account.optBoolean("connected"))continue;JSONArray caps=account.getJSONArray("grantedCapabilities");for(int j=0;j<caps.length();j++)if("google.gmail.triage".equals(caps.getString(j)))found=true;}
  guard.check();if(!found)throw new SecurityException("Gmail grant unavailable");
 }
 /** At most four pages per job. Continuations remain durable for a subsequent retry. */
 synchronized boolean sync(String generation,GmailReconciliation.Guard stopped)throws Exception{
  final long epoch=attempts.get();JSONObject binding;synchronized(JsonCredentialSlots.LOCK){JSONObject s=saved();if(s==null||!s.getJSONObject("binding").getString("generation").equals(generation))throw new SecurityException("Gmail job stale");binding=s.getJSONObject("binding");}
  GmailReconciliation.Guard guard=()->{stopped.check();synchronized(JsonCredentialSlots.LOCK){if(attempts.get()!=epoch)throw new SecurityException("Gmail check superseded");current(binding);}};
  try{verify(binding,guard);for(int i=0;i<4;i++){
    publishNotices(binding,guard);JSONObject query;synchronized(JsonCredentialSlots.LOCK){guard.check();query=engine(binding).query();}
    String start=GmailReconciliation.optional(query,"startHistoryId"),token=GmailReconciliation.optional(query,"pageToken");String path="/api/v1/eliza/google/gmail/history?grantId="+URLEncoder.encode(binding.getString("grantId"),"UTF-8")+"&maxResults=50";
    if(start!=null)path+="&startHistoryId="+GmailReconciliation.revision(start);if(token!=null)path+="&pageToken="+URLEncoder.encode(token,"UTF-8");JSONObject page=get(binding,path,guard);
    // Recheck the remote grant before a page can cause a durable notice; local epoch fences every write.
    verify(binding,guard);synchronized(JsonCredentialSlots.LOCK){guard.check();GmailReconciliation engine=engine(binding);engine.accept(page,System.currentTimeMillis());}
    publishNotices(binding,guard);synchronized(JsonCredentialSlots.LOCK){GmailReconciliation engine=engine(binding);if(!"reset-required".equals(page.getString("status"))&&GmailReconciliation.optional(engine.query(),"pageToken")==null)return !engine.hasPending();}
   }return false;
  }catch(HttpFailure error){synchronized(JsonCredentialSlots.LOCK){guard.check();if(error.status==401||error.status==403||error.status==409){engine(binding).failure("grant-unavailable");poster.cancelAll();return true;}if(error.status==404||error.status==405||error.status==501){engine(binding).failure("unsupported");return true;}engine(binding).failure("retrying");}return false;
  }catch(SecurityException revoked){try{synchronized(JsonCredentialSlots.LOCK){guard.check();engine(binding).failure("grant-unavailable");poster.cancelAll();}}catch(Exception stale){}throw revoked;
  }catch(Exception failure){synchronized(JsonCredentialSlots.LOCK){guard.check();engine(binding).failure(failure instanceof IllegalStateException?"capacity-reached":"retrying");}return false;}
 }
 private void publishNotices(JSONObject binding,GmailReconciliation.Guard guard)throws Exception{for(int i=0;i<25;i++){synchronized(JsonCredentialSlots.LOCK){guard.check();GmailReconciliation e=engine(binding);e.publish();if(!e.hasPending())return;}}}
 void capture(String key)throws Exception{capture(key,false);}
 void capture(String key,boolean question)throws Exception{synchronized(JsonCredentialSlots.LOCK){JSONObject s=saved();if(s!=null)engine(s.getJSONObject("binding")).capture(key,question);}}
 JSONObject pending(GmailReconciliation.Guard foreground)throws Exception{foreground.check();JSONObject binding;synchronized(JsonCredentialSlots.LOCK){JSONObject s=saved();if(s==null)return new JSONObject();binding=s.getJSONObject("binding");if(!engine(binding).pending().has("token"))return new JSONObject();}verify(binding,()->{foreground.check();synchronized(JsonCredentialSlots.LOCK){current(binding);}});foreground.check();synchronized(JsonCredentialSlots.LOCK){foreground.check();return engine(binding).pending();}}
 void releaseQuestion(String token,GmailReconciliation.Guard foreground)throws Exception{foreground.check();synchronized(JsonCredentialSlots.LOCK){foreground.check();JSONObject s=saved();if(s==null)throw new SecurityException();engine(s.getJSONObject("binding")).releaseQuestion(token);}}
 void consume(String token,GmailReconciliation.Guard foreground)throws Exception{foreground.check();synchronized(JsonCredentialSlots.LOCK){foreground.check();JSONObject s=saved();if(s==null)throw new SecurityException();engine(s.getJSONObject("binding")).consume(token);}}
}
