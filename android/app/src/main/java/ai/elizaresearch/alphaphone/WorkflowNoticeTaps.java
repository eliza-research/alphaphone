package ai.elizaresearch.alphaphone;

import java.util.*;
import org.json.*;

/** Encrypted, bounded notification routes. A tap is a read request, never approval. */
final class WorkflowNoticeTaps {
 static final class UnknownTap extends Exception {}
 static final String SLOT="workflow-notice-taps:v1", OWNER_SLOT="workflow-notice-owner:v1";
 static final String ACTION="ai.elizaresearch.alphaphone.OPEN_WORKFLOW_NOTICE", PREFIX="alpha-workflow-notice:";
 private static final Object LOCK=new Object();
 private final WorkflowNoticeDelivery.Storage storage;
 WorkflowNoticeTaps(WorkflowNoticeDelivery.Storage storage){this.storage=storage;}
 private JSONObject ledger()throws Exception{
  String raw=storage.read(SLOT);JSONObject rows=raw==null?new JSONObject():new JSONObject(raw);
  if(rows.length()>512)throw new IllegalStateException("Notification route capacity exceeded");
  Set<String> tokens=new HashSet<>();Set<Long> orders=new HashSet<>();
  for(String id:keys(rows)){
   JSONObject row=rows.getJSONObject(id);
   if(!id.matches("[A-Za-z0-9_-]{1,128}")||!keys(row).equals(Set.of("binding","route","token","state","order"))||!row.getString("binding").matches("[a-f0-9]{64}")||!row.getString("token").matches("[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}")||!tokens.add(row.getString("token"))||!Set.of("new","pending","consumed").contains(row.getString("state")))throw new IllegalStateException("Invalid notification route ledger");
   route(row.getJSONObject("route"));Object rawOrder=row.get("order");long order=row.getLong("order");
   if(!(rawOrder instanceof Integer||rawOrder instanceof Long)||order<0||order==0&&!row.getString("state").equals("new")||order>0&&!orders.add(order))throw new IllegalStateException("Invalid notification tap order");
  }
  return rows;
 }
 private static Set<String> keys(JSONObject value){Set<String> result=new HashSet<>();Iterator<String> iterator=value.keys();while(iterator.hasNext())result.add(iterator.next());return result;}
 static JSONObject route(JSONObject input)throws Exception{
  Set<String> fields=Set.of("scope","origin","ownerId","agentId","workflowId","runId","versionId");
  if(input==null||!keys(input).equals(fields))throw new IllegalArgumentException("Invalid workflow route");
  JSONObject result=new JSONObject();
  for(String key:fields){Object raw=input.get(key);if(!(raw instanceof String))throw new IllegalArgumentException();String value=(String)raw;
   if(value.isBlank()||value.length()>(key.equals("origin")?2048:128)||value.indexOf('\0')>=0)throw new IllegalArgumentException();
   if(key.equals("scope")&&!value.matches("[a-f0-9]{64}"))throw new IllegalArgumentException();
   if(Set.of("workflowId","runId","versionId").contains(key)&&!value.matches("[A-Za-z0-9][A-Za-z0-9_-]*"))throw new IllegalArgumentException();
   result.put(key,value);
  }return result;
 }
 private boolean same(JSONObject a,JSONObject b)throws Exception{if(!keys(a).equals(keys(b)))return false;for(String k:keys(a))if(!a.get(k).equals(b.get(k)))return false;return true;}
 String prepare(String id,String binding,JSONObject input)throws Exception{synchronized(LOCK){
  if(id==null||!id.matches("[A-Za-z0-9_-]{1,128}")||binding==null||!binding.matches("[a-f0-9]{64}"))throw new IllegalArgumentException();
  JSONObject exact=route(input);if(!ownerMatches(exact))throw new IllegalStateException("Notification owner changed");JSONObject rows=ledger(),row=rows.optJSONObject(id);
  if(row!=null){if(!binding.equals(row.getString("binding"))||!same(exact,route(row.getJSONObject("route"))))throw new IllegalStateException("Notification route changed");return row.getString("token");}
  if(rows.has(id)||rows.length()>=512)throw new IllegalStateException("Notification routes full");
  String token=UUID.randomUUID().toString();rows.put(id,new JSONObject().put("binding",binding).put("route",exact).put("token",token).put("state","new").put("order",0));storage.write(SLOT,rows.toString());return token;
 }}
 String token(String id)throws Exception{synchronized(LOCK){JSONObject row=ledger().optJSONObject(id);return row==null?null:row.getString("token");}}
 void owner(JSONObject owner)throws Exception{synchronized(LOCK){storage.write(OWNER_SLOT,new JSONObject().put("owner",owner==null?JSONObject.NULL:NoticeOwner.identity(owner)).toString());}}
 boolean ownerMatches(JSONObject route)throws Exception{String raw=storage.read(OWNER_SLOT);if(raw==null)return true;return NoticeOwner.matches(new JSONObject(raw).optJSONObject("owner"),route);}
 void fresh(String id)throws Exception{synchronized(LOCK){JSONObject rows=ledger(),row=rows.getJSONObject(id);row.put("token",UUID.randomUUID().toString()).put("state","new").put("order",0);storage.write(SLOT,rows.toString());}}
 JSONArray suspendedApprovals(JSONObject owner,long now)throws Exception{synchronized(LOCK){
  JSONArray out=new JSONArray();JSONObject rows=ledger();String raw=storage.read(WorkflowNoticeDelivery.APPROVAL_SLOT);JSONObject receipts=raw==null?new JSONObject():new JSONObject(raw);
  for(String id:keys(rows)){JSONObject row=rows.getJSONObject(id),receipt=receipts.optJSONObject(id);if(!WorkflowNoticeDelivery.approvalId(id)||!NoticeOwner.matches(owner,row.getJSONObject("route"))||receipt==null||!"suspended".equals(receipt.optString("status"))||receipt.getLong("expiresAt")<=now)continue;out.put(new JSONObject().put("id",id).put("bindingHash",row.getString("binding")).put("expiresAt",receipt.getLong("expiresAt")).put("route",row.getJSONObject("route")));}return out;
 }}
 private boolean confirmed(String id,JSONObject row)throws Exception{
  if(!ownerMatches(row.getJSONObject("route")))return false;
  if(WorkflowNoticeDelivery.approvalId(id)){
   // An approval notice opens its run only while its receipt is posted; a decision or expiry withdraws it.
   String raw=storage.read(WorkflowNoticeDelivery.APPROVAL_SLOT);if(raw==null)return false;
   JSONObject receipt=new JSONObject(raw).optJSONObject(id);
   return receipt!=null&&receipt.length()==4&&row.getString("binding").equals(receipt.getString("binding"))&&receipt.getString("digest").matches("[a-f0-9]{64}")&&"succeeded".equals(receipt.getString("status"));
  }
  String raw=storage.read(WorkflowNoticeDelivery.SLOT);if(raw==null)return false;
  JSONObject receipt=new JSONObject(raw).optJSONObject(id);
  return receipt!=null&&receipt.length()==3&&row.getString("binding").equals(receipt.getString("binding"))&&receipt.getString("digest").matches("[a-f0-9]{64}")&&"succeeded".equals(receipt.getString("status"));
 }
 void capture(String token)throws Exception{synchronized(LOCK){
  if(token==null||!token.matches("[a-f0-9-]{36}"))throw new IllegalArgumentException();
  JSONObject rows=ledger();for(String id:keys(rows)){JSONObject row=rows.getJSONObject(id);if(!token.equals(row.getString("token")))continue;
   if(!confirmed(id,row))throw new IllegalStateException("Notification receipt unconfirmed");
   if(!row.getString("state").equals("consumed")){long order=0;for(String key:keys(rows))order=Math.max(order,rows.getJSONObject(key).getLong("order"));row.put("state","pending").put("order",Math.addExact(order,1));storage.write(SLOT,rows.toString());}
   return;
  }throw new UnknownTap();
 }}
 JSONObject pending()throws Exception{synchronized(LOCK){
  JSONObject rows=ledger(),selected=null;String selectedId=null;long order=-1;
  for(String id:keys(rows)){JSONObject row=rows.getJSONObject(id);if(ownerMatches(row.getJSONObject("route"))&&"pending".equals(row.getString("state"))&&row.getLong("order")>order){selected=row;selectedId=id;order=row.getLong("order");}}
  if(selected==null)return new JSONObject();
  return route(selected.getJSONObject("route")).put("token",selected.getString("token")).put("operationId",selectedId).put("bindingHash",selected.getString("binding")).put("retained",confirmed(selectedId,selected));
 }}
 void consume(String token)throws Exception{synchronized(LOCK){
  JSONObject rows=ledger();for(String id:keys(rows)){JSONObject row=rows.getJSONObject(id);if(!Objects.equals(token,row.getString("token")))continue;
   if(!"pending".equals(row.getString("state"))||!confirmed(id,row))throw new IllegalStateException("Notification tap changed");
   row.put("state","consumed");storage.write(SLOT,rows.toString());return;
  }throw new UnknownTap();
 }}
 /** All owner-specific routes, in stable order: results share the same privacy boundary. */
 List<String> noticesOfOtherOwners(JSONObject owner)throws Exception{synchronized(LOCK){
  NoticeOwner.identity(owner);
  JSONObject rows=ledger();List<String> result=new ArrayList<>();
  for(String id:keys(rows))if(!NoticeOwner.matches(owner,rows.getJSONObject(id).getJSONObject("route")))result.add(id);
  Collections.sort(result);return result;
 }}
 /** Frees a withdrawn or expired approval route. Its receipt is no longer posted, so even a captured tap could never open. */
 void forget(String id)throws Exception{synchronized(LOCK){
  if(!WorkflowNoticeDelivery.approvalId(id))throw new IllegalArgumentException("Only approval routes are released");
  JSONObject rows=ledger(),row=rows.optJSONObject(id);if(row==null||confirmed(id,row))return;
  rows.remove(id);storage.write(SLOT,rows.toString());
 }}
}
