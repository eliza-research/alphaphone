package ai.elizaresearch.alphaphone;

import org.json.*;

/** Native-only credential binding. The supplied store is the encrypted app credential store. */
final class ResidentResultSession {
 interface Runtime {
  String rootToken() throws Exception;
  JSONObject exchange(JSONObject request) throws Exception;
 }
 interface Guard {void check()throws Exception;}
 static JSONObject snapshot(String owner,String token,long expiry,String root)throws Exception {
  return ai.eliza.plugins.agent.connection.NativeOwnerTransport.snapshot(new ai.eliza.plugins.agent.connection.NativeOwnerTransport.Session(root,token,owner,expiry));
 }
 static ResidentResultTransport open(HostedInbox.Store store,JSONObject requested,Runtime runtime,Guard guard)throws Exception {
  // Copy the binding so later caller mutation cannot change authority mid-request.
  JSONObject binding=new JSONObject(requested.toString());
  String owner=HostedInbox.id(binding.getString("ownerId")),agent=HostedInbox.id(binding.getString("agentId"));
  class BoundChannel implements ResidentResultTransport.Channel {
   private JSONObject credential()throws Exception {
    guard.check();String raw=store.read(binding.getString("credentialSlot"));
    if(raw==null||!HostedResultNotices.hash(raw).equals(binding.getString("credentialDigest")))throw new SecurityException("Resident credential changed");
    JSONObject auth=new JSONObject(raw);String root=runtime.rootToken();
    if(auth.getInt("version")!=1||!owner.equals(auth.getString("ownerId"))||auth.getLong("expiresAt")<=System.currentTimeMillis()||
       root==null||root.isEmpty()||!HostedResultNotices.hash(root).equals(auth.getString("runtimeDigest")))throw new SecurityException("Resident runtime changed");
    String token=auth.getString("token");if(token.isEmpty()||token.length()>8192||token.contains("\r")||token.contains("\n"))throw new SecurityException("Invalid resident token");
    return auth;
   }
   private JSONObject device()throws Exception {
    String raw=store.read(binding.getString("deviceSlot"));if(raw==null)throw new SecurityException("Resident device binding missing");
    JSONObject value=new JSONObject(raw);
    if(!HostedResultNotices.hash(value.toString()).equals(binding.getString("deviceDigest"))||
       !value.getString("key").matches("[a-f0-9]{64}")||!value.getString("installationId").matches("[a-f0-9-]{36}"))throw new SecurityException("Resident device binding changed");
    HostedInbox.id(value.getString("enrollmentId"));return value;
   }
   public void check()throws Exception {credential();device();guard.check();}
   public JSONObject exchange(String path,String method,JSONObject body,int timeoutMs)throws Exception {
    check();JSONObject auth=credential(),device=device();
    JSONObject headers=new JSONObject().put("Accept","application/json").put("Content-Type","application/json").put("Authorization","Bearer "+auth.getString("token"));
    if(path.startsWith("/api/workflow/"))headers.put("X-Eliza-Device-Id",device.getString("installationId")).put("X-Eliza-Device-Key",device.getString("key")).put("X-Eliza-Device-Capabilities","calendar.local-event.v1,notes.local-record.v1");
    JSONObject input=new JSONObject().put("path",path).put("method",method).put("headers",headers).put("timeoutMs",timeoutMs);
    if(body!=null)input.put("body",body.toString());
    check();JSONObject response=runtime.exchange(input);check();return response;
   }
  }
  BoundChannel channel=new BoundChannel();channel.check();
  return new ResidentResultTransport(channel,owner,agent,channel.credential().getString("token"));
 }
}
