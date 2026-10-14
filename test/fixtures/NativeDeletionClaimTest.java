package ai.elizaresearch.alphaphone;
import org.json.*;
import ai.eliza.plugins.actionjournal.*;
import java.util.*;
public final class NativeDeletionClaimTest {
 static void check(boolean value){if(!value)throw new AssertionError();}
 interface Work{void run()throws Exception;}
 static void refuses(Work work)throws Exception{try{work.run();throw new AssertionError("Expected refusal");}catch(SecurityException|ActionJournal.Refused expected){}}
 public static void main(String[] args)throws Exception{
  Map<String,String> memory=new HashMap<>();ActionJournal journal=new ActionJournal(ActionJournalConfiguration.standard("fixture"),new ActionJournal.Storage(){public String read(String key){return memory.get(key);}public void write(String key,String value){memory.put(key,value);}},(entry,status,result)->{});
  String scope="a".repeat(64),hash="b".repeat(64);JSONObject identity=new JSONObject().put("scope",scope).put("proposalId","proposal");
  JSONObject operation=new JSONObject().put("type","calendar_delete").put("target",new JSONObject().put("revision","exact"));
  JSONObject owner=new JSONObject().put("kind","agent").put("identity",new JSONObject().put("subjectUserId","owner").put("agentId","agent").put("installationId","install").put("enrollmentId","enrollment"));
  JSONObject record=new JSONObject().put("operation",operation).put("expiresAt",System.currentTimeMillis()+60000).put("context",new JSONObject().put("sensitive",false)).put("ownerId","owner").put("agentId","agent").put("installationId","install").put("enrollmentId","enrollment");
  journal.reserve(scope,"proposal","operation",hash,record);refuses(()->NativeDeletionClaim.check(journal,identity,"operation",operation,owner,false));
  journal.markApplying(scope,"proposal","attempt");JSONObject stale=journal.get(scope,"proposal");
  JSONObject foreign=new JSONObject(owner.toString());foreign.getJSONObject("identity").put("subjectUserId","other");refuses(()->NativeDeletionClaim.check(journal,identity,"operation",operation,foreign,false));
  NativeDeletionClaim.check(journal,identity,"operation",operation,owner,false);check(!journal.get(scope,"proposal").has("nativeDispatchClaim"));
  NativeDeletionClaim.check(journal,identity,"operation",operation,owner,true);
  refuses(()->NativeDeletionClaim.check(journal,identity,"operation",operation,owner,true));
  refuses(()->journal.update(scope,"proposal",current->stale));
  refuses(()->journal.update(scope,"proposal",current->{current.getJSONObject("nativeDispatchClaim").put("operationId","replacement");return current;}));
  // Rich deletion history can be bounded without making an old agent operation reusable.
  String[] deletionData={null};DeferredDeletionJournal deletions=new DeferredDeletionJournal(new DeferredDeletionJournal.Store(){public String read(){return deletionData[0];}public void save(String value){deletionData[0]=value;}});
  JSONObject target=operation.getJSONObject("target");
  deletions.stage("operation",owner,target,new DeletionDeadline("boot",0,0));deletions.undo("operation",owner,"boot",1);
  for(int n=0;n<600;n++){String id="recent_"+n;deletions.stage(id,owner,target,new DeletionDeadline("boot",n+1,n+1));deletions.undo(id,owner,"boot",n+2);}
  JSONArray retained=deletions.list("boot",10000);check(retained.length()<=128);
  for(int n=0;n<retained.length();n++)check(!retained.getJSONObject(n).getString("id").equals("operation"));
  refuses(()->NativeDeletionClaim.check(journal,identity,"operation",operation,owner,true));
  JSONObject stagedTarget=new JSONObject(target.toString()).put("sourceId","calendar").put("eventId","event").put("journalBinding",NativeDeletionClaim.binding(journal,identity));
  JSONObject receipt=new JSONObject().put("id","operation").put("owner",owner).put("target",stagedTarget).put("phase","deleted").put("outcome",new JSONObject().put("status","deleted"));
  JSONObject claimed=journal.get(scope,"proposal");
  for(String field:new String[]{"scope","proposalId","operationHash"}){JSONObject wrong=new JSONObject(receipt.toString());wrong.getJSONObject("target").getJSONObject("journalBinding").put(field,"wrong");check(NativeDeletionRecovery.recover(claimed,wrong,null)==claimed);}
  JSONObject wrongClaim=new JSONObject(claimed.toString());wrongClaim.getJSONObject("nativeDispatchClaim").put("operationId","wrong");check(NativeDeletionRecovery.recover(wrongClaim,receipt,null)==wrongClaim);
  JSONObject recovered=NativeDeletionRecovery.recover(claimed,receipt,null);check(recovered.getString("status").equals("succeeded"));check(NativeDeletionRecovery.recover(recovered,receipt,null)==recovered);
  JSONObject undone=new JSONObject(receipt.toString()).put("phase","undone");JSONObject retainedResult=NativeDeletionRecovery.recover(claimed,undone,null);check(retainedResult.getString("status").equals("failed"));check(!retainedResult.getJSONObject("result").has("calendarResult"));
  JSONObject uncertain=new JSONObject(receipt.toString()).put("phase","unknown");check(NativeDeletionRecovery.recover(claimed,uncertain,null)==claimed);
  // Renderer-facing finish reads current durable data rather than a cached entry.
  journal.finish(scope,"proposal","unknown","Lost staging response",null);check(journal.get(scope,"proposal").has("nativeDispatchClaim"));
  journal.reserve(scope,"proposal","operation",hash,record);check(journal.get(scope,"proposal").has("nativeDispatchClaim"));
  refuses(()->NativeDeletionClaim.check(journal,identity,"operation",operation,owner,false));
  System.out.println("PASS native deletion claim survives stale recovery and renderer settlement");
 }
}
