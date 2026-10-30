package ai.elizaresearch.alphaphone;

import android.content.Context;
import ai.eliza.plugins.agent.connection.NativeOwnerContext;
import org.json.JSONObject;

/** Installed storage/session adapters for the shared read-only owner projection. */
final class NativeOwnerReminderHost {
 interface Ports extends NativeOwnerContext.Ports {
  default String deviceSlot(String owner,String agent)throws Exception{return NativeOwnerReminderHost.deviceSlot(owner,agent);}
  default void ownerRead(String path,int status){NativeNotificationDiagnostics.ownerRead(path,status);}
 }
 private final NativeOwnerContext shared;
 NativeOwnerReminderHost(Ports ports){shared=new NativeOwnerContext(ports);}
 NativeOwnerReminderHost(Context context){
  AlphaCredentialStore store=new AlphaCredentialStore(context.getApplicationContext());
  shared=new NativeOwnerContext(new Ports(){
   public JSONObject provider()throws Exception{return store.providerAdmissionSnapshot();}
   public JSONObject ownerSession()throws Exception{return AlphaLocalAgentPlugin.captureReminderOwnerSession();}
   public String device(String slot)throws Exception{return store.readCredentialSlot(slot);}
   public JSONObject exchange(JSONObject session,String path,JSONObject headers)throws Exception{return AlphaLocalAgentPlugin.readReminderOwnerRoute(session,path,headers);}
  });
 }
 JSONObject read()throws Exception{return shared.read();}
 String reviewFence(JSONObject expected)throws Exception{return shared.reviewFence(expected);}
 static String deviceSlot(String owner,String agent)throws Exception{
  return NativeDeviceEnrollmentKey.local("https://device.alpha.invalid",owner,agent);
 }
 static JSONObject read(Ports ports)throws Exception{return NativeOwnerContext.read(ports);}
}
