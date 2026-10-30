package ai.eliza.plugins.calendar;
import org.json.*;
public final class CalendarSyncReceiptRecoveryTest {
 static void check(boolean value){if(!value)throw new AssertionError();}
 static JSONObject row(String scope,String kind,String id,String hash)throws Exception{return new JSONObject().put("scope",scope).put("kind",kind).put("eventId",id).put("semanticHash",hash).put("phase","dispatching");}
 public static void main(String[] args)throws Exception{
  JSONObject operations=new JSONObject().put("owned",row("owner-scope","apply","42","desired"))
   .put("other-owner",row("other-scope","apply","42","desired")).put("other-event",row("owner-scope","apply","43","desired"))
   .put("other-body",row("owner-scope","apply","42","different")).put("deletion",row("owner-scope","delete","42","desired"))
   .put("acknowledged",row("owner-scope","apply","42","desired").put("acknowledged",true));
  JSONObject document=new JSONObject().put("operations",operations),event=new JSONObject().put("title","Observed target");
  String retainedOther=operations.getJSONObject("other-owner").toString();JSONArray recovered=CalendarSyncReceiptRecovery.observe(document,"owner-scope","42","fresh-revision","desired",event);
  check(recovered.length()==1&&recovered.getString(0).equals("owned"));JSONObject receipt=operations.getJSONObject("owned").getJSONObject("outcome");check(receipt.getString("status").equals("saved")&&receipt.getBoolean("recovered"));check(receipt.getJSONObject("snapshot").getString("revision").equals("fresh-revision"));check(operations.getJSONObject("other-owner").toString().equals(retainedOther));
  check(operations.getJSONObject("other-body").getString("phase").equals("dispatching"));check(operations.getJSONObject("deletion").getString("phase").equals("dispatching"));
  event.put("title","Changed after observation");check(receipt.getJSONObject("snapshot").getJSONObject("event").getString("title").equals("Observed target"));
  operations.getJSONObject("owned").put("acknowledged",true);check(CalendarSyncReceiptRecovery.observe(document,"owner-scope","42","new-revision","desired",event).length()==0);
  operations.put("conflict",row("owner-scope","apply","42","desired").put("outcome",new JSONObject().put("status","conflict")));check(CalendarSyncReceiptRecovery.observe(document,"owner-scope","42","new-revision","desired",event).length()==0);
  System.out.println("PASS native Calendar readback-only receipt recovery and owner isolation");
 }
}
