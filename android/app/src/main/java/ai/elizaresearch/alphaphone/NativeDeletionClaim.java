package ai.elizaresearch.alphaphone;
import org.json.*;
import ai.eliza.plugins.actionjournal.ActionJournal;
/** A permanent claim in the existing exact action receipt, not renderer-owned recovery state. */
final class NativeDeletionClaim {
 static JSONObject binding(ActionJournal journal,JSONObject identity)throws Exception{JSONObject entry=journal.get(identity.getString("scope"),identity.getString("proposalId"));if(entry==null||!entry.has("nativeDispatchClaim"))throw new SecurityException("Deletion claim missing");return new JSONObject().put("scope",entry.getString("scope")).put("proposalId",entry.getString("proposalId")).put("operationHash",entry.getString("operationHash"));}
 static void check(ActionJournal journal,JSONObject identity,String operationId,JSONObject operation,JSONObject owner,boolean claim)throws Exception{
  if(identity==null||owner==null||!"agent".equals(owner.getString("kind")))throw new SecurityException("Native action identity required");
  String scope=ActionJournal.scope(identity.getString("scope")),proposal=ActionJournal.id(identity.getString("proposalId"));
  synchronized(journal.lock()){
   JSONObject entry=journal.get(scope,proposal);if(entry==null||!"applying".equals(entry.getString("phase"))||!operationId.equals(entry.getString("operationId"))||entry.has("nativeDispatchClaim"))throw new SecurityException("Action already claimed or retired");
   JSONObject record=entry.getJSONObject("record"),nativeOwner=owner.getJSONObject("identity");
   if(record.getLong("expiresAt")<=System.currentTimeMillis()||record.getJSONObject("context").optBoolean("sensitive")||!ActionJournal.sameJson(record.getJSONObject("operation"),operation))throw new SecurityException("Approved deletion changed");
   for(String field:new String[]{"agentId","installationId","enrollmentId"})if(!record.getString(field).equals(nativeOwner.getString(field)))throw new SecurityException("Action owner changed");
   if(!record.getString("ownerId").equals(nativeOwner.getString("subjectUserId")))throw new SecurityException("Action account changed");
   if(claim)journal.update(scope,proposal,current->{current.put("nativeDispatchClaim",new JSONObject().put("kind","deletion").put("operationId",operationId).put("owner",new JSONObject(owner.toString())));return current;});
  }
 }
 private NativeDeletionClaim(){}
}
