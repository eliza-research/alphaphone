package ai.elizaresearch.alphaphone;

import android.app.*;
import android.content.*;
import android.os.Build;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import android.system.Os;
import android.system.OsConstants;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import static org.junit.Assert.*;

/** A pending phone-step approval notice across the death of the app's main process. Runs only in the
 * separate instrumentation host (WorkflowNoticeProcessRunner), so main dies while the test stays alive.
 * Test-mocks restores an explicitly synthetic loopback owner through real initialize; the post and the repeated request go through the ledger code the AlphaHostedResults bridge calls
 * (WorkflowNoticeTapsFactory), from this helper process; the tap is captured by the restarted main's
 * own AlphaNotifications plugin. Synthetic route: no real account, review or device action.
 * Exact workflow review remains outside this native capture test. */
public final class WorkflowApprovalNoticeProcessDeathInstrumentedTest {
 private static final String APP="ai.elizaresearch.alphaphone";
 private static List<StatusBarNotification> approvals(NotificationManager manager){
  List<StatusBarNotification> found=new ArrayList<>();
  for(StatusBarNotification row:manager.getActiveNotifications())if(WorkflowNoticePoster.APPROVAL_CHANNEL.equals(row.getNotification().getChannelId()))found.add(row);
  return found;
 }
 /** Exactly one OS notice exists for this approval and no other approval notice does. */
 private static StatusBarNotification notice(NotificationManager manager,String id){
  List<StatusBarNotification> rows=approvals(manager);
  assertEquals("Exactly one approval notice",1,rows.size());StatusBarNotification row=rows.get(0);
  assertEquals("alpha-workflow-"+id,row.getTag());assertEquals(0,row.getId());return row;
 }
 @Test public void pendingApprovalNoticeSurvivesProcessDeathAndOpensItsExactApprovalOnce()throws Exception {
  org.junit.Assume.assumeTrue("Explicit isolated process-death campaign","1".equals(InstrumentationRegistry.getArguments().getString("workflowApprovalNoticeProcessDeath")));
  if(WorkflowNoticeOwnerFixture.preparing()){WorkflowNoticeOwnerFixture.prepare();return;}
  assertEquals(APP+":workflowNoticeTest",Application.getProcessName());assertTrue("Owned secondary user required",android.os.Process.myUid()/100000>0);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();AlphaCredentialStore store=new AlphaCredentialStore(context);
  assertNull("Fresh route ledger required",store.readCredentialSlot(WorkflowNoticeTaps.SLOT));assertNull("Fresh approval ledger required",store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT));
  NotificationManager manager=context.getSystemService(NotificationManager.class);
  WorkflowNoticeTaps taps=WorkflowNoticeTapsFactory.create(context);WorkflowNoticeDelivery delivery=WorkflowNoticeTapsFactory.delivery(context);
  String id="approval-"+(UUID.randomUUID().toString()+UUID.randomUUID()).replace("-",""),binding="b".repeat(64),run="fixture-run-"+UUID.randomUUID();
  assertTrue(WorkflowNoticeDelivery.approvalId(id));
  long expiresAt=System.currentTimeMillis()+10*60000L;
  try(WorkflowNoticeOwnerFixture fixture=new WorkflowNoticeOwnerFixture(context)){
   JSONObject route=new JSONObject().put("scope","a".repeat(64)).put("origin",fixture.origin).put("ownerId",fixture.identity.getString("ownerId")).put("agentId",fixture.identity.getString("agentId")).put("workflowId","fixture-flow").put("runId",run).put("versionId","fixture-version");
   Intent initial=context.getPackageManager().getLaunchIntentForPackage(APP);assertNotNull(initial);context.startActivity(initial);
   WorkflowNoticeProcessDeathInstrumentedTest.Identity before=WorkflowNoticeProcessDeathInstrumentedTest.awaitMain(context);fixture.awaitOwner(true);
   // One OS dispatch only. An unconfirmed post is reconciled from the actual OS notice by the same request, never reposted.
   String publication=delivery.postApproval(taps,id,binding,route,expiresAt,System.currentTimeMillis());
   long publicationEnd=SystemClock.elapsedRealtime()+10000;
   while(!"succeeded".equals(publication)){
    assertEquals("OS publication failed or returned an invalid status","unknown",publication);
    assertTrue("OS publication receipt remained unconfirmed",SystemClock.elapsedRealtime()<publicationEnd);
    SystemClock.sleep(50);
    publication=delivery.postApproval(taps,id,binding,route,expiresAt,System.currentTimeMillis());
   }
   String token=taps.token(id);assertNotNull(token);
   String receipt=store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT),prepared=store.readCredentialSlot(WorkflowNoticeTaps.SLOT);
   JSONObject ledger=new JSONObject(receipt),record=ledger.getJSONObject(id);
   assertEquals("One receipt",1,ledger.length());assertEquals(4,record.length());assertEquals("succeeded",record.getString("status"));assertEquals(binding,record.getString("binding"));assertEquals(expiresAt,record.getLong("expiresAt"));assertTrue(record.getString("digest").matches("[a-f0-9]{64}"));
   assertFalse("The receipt holds no route",receipt.contains(run)||receipt.contains("fixture-flow"));
   assertNull("Approval notices never use the step ledger",store.readCredentialSlot(WorkflowNoticeDelivery.SLOT));
   StatusBarNotification original=notice(manager,id);PendingIntent pending=original.getNotification().contentIntent;assertNotNull(pending);
   assertFalse("Redacted: no route identity in the notice",original.getNotification().extras.toString().contains(run)||original.getNotification().extras.toString().contains("fixture-flow"));
   assertFalse(taps.pending().has("token"));
   // Remove only this package's tasks before ordinary death, preventing foreground task recovery.
   for(ActivityManager.AppTask task:context.getSystemService(ActivityManager.class).getAppTasks()){
    ActivityManager.RecentTaskInfo info=task.getTaskInfo();assertNotNull(info.baseIntent.getComponent());assertEquals(APP,info.baseIntent.getComponent().getPackageName());task.finishAndRemoveTask();
   }
   long taskEnd=SystemClock.elapsedRealtime()+10000;
   while(!context.getSystemService(ActivityManager.class).getAppTasks().isEmpty()&&SystemClock.elapsedRealtime()<taskEnd)SystemClock.sleep(50);
   assertTrue("Main tasks still active",context.getSystemService(ActivityManager.class).getAppTasks().isEmpty());
   int verifiedBeforeDeath=fixture.verified.get(),agentsBeforeDeath=fixture.agents.get();
   before.exact();Os.kill(before.pid,OsConstants.SIGKILL);
   long deathEnd=SystemClock.elapsedRealtime()+10000;
   while((Files.exists(Path.of("/proc/"+before.pid))||!WorkflowNoticeProcessDeathInstrumentedTest.mainPids(context).isEmpty())&&SystemClock.elapsedRealtime()<deathEnd)SystemClock.sleep(50);
   assertFalse("Original process did not die",Files.exists(Path.of("/proc/"+before.pid)));
   assertTrue("Main restarted before notification tap",WorkflowNoticeProcessDeathInstrumentedTest.mainPids(context).isEmpty());
   // The pending notice and both ledgers survive the death unchanged.
   assertEquals(prepared,store.readCredentialSlot(WorkflowNoticeTaps.SLOT));assertEquals(receipt,store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT));
   StatusBarNotification retained=notice(manager,id);assertEquals(original.getKey(),retained.getKey());assertEquals(original.getPostTime(),retained.getPostTime());assertEquals(pending,retained.getNotification().contentIntent);
   // The only launch after proven absence: the original OS-owned PendingIntent, once. Android's shade
   // sends a tapped notice with the sender's activity-start allowance; the same is stated here.
   ActivityOptions options=ActivityOptions.makeBasic();
   if(Build.VERSION.SDK_INT>=34)options.setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
   pending.send(context,0,null,null,null,null,options.toBundle());
   WorkflowNoticeProcessDeathInstrumentedTest.Identity after=WorkflowNoticeProcessDeathInstrumentedTest.awaitMain(context);assertTrue(before.pid!=after.pid||!before.start.equals(after.start));
   fixture.awaitOwner(true,verifiedBeforeDeath+1,agentsBeforeDeath+1);
   JSONObject captured=null;long captureEnd=SystemClock.elapsedRealtime()+15000;
   do{captured=taps.pending();if(token.equals(captured.optString("token")))break;SystemClock.sleep(50);}while(SystemClock.elapsedRealtime()<captureEnd);
   assertEquals("Restarted main must capture the original token",token,captured.getString("token"));assertTrue("The posted receipt still confirms the tap",captured.getBoolean("retained"));
   // The exact approval: its opaque ID, binding and the whole route it was posted for.
   assertEquals(id,captured.getString("operationId"));assertEquals(binding,captured.getString("bindingHash"));
   for(String key:List.of("scope","origin","ownerId","agentId","workflowId","runId","versionId"))assertEquals(route.getString(key),captured.getString(key));
   JSONObject rows=new JSONObject(store.readCredentialSlot(WorkflowNoticeTaps.SLOT)),row=rows.getJSONObject(id);
   assertEquals("One route",1,rows.length());assertEquals("pending",row.getString("state"));assertEquals(1,row.getLong("order"));assertEquals(token,row.getString("token"));
   String captureLedger=store.readCredentialSlot(WorkflowNoticeTaps.SLOT);
   assertEquals("The capture rewrites no receipt",receipt,store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT));
   // The request is repeated after the restart (as the next review of the run repeats it), through new
   // ledger instances: nothing is posted again and neither ledger is rewritten.
   assertEquals("succeeded",WorkflowNoticeTapsFactory.delivery(context).postApproval(WorkflowNoticeTapsFactory.create(context),id,binding,route,expiresAt,System.currentTimeMillis()));
   StatusBarNotification finalNotice=notice(manager,id);assertEquals(original.getKey(),finalNotice.getKey());assertEquals("No duplicate post",original.getPostTime(),finalNotice.getPostTime());assertEquals(pending,finalNotice.getNotification().contentIntent);
   assertEquals(receipt,store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT));assertEquals(captureLedger,store.readCredentialSlot(WorkflowNoticeTaps.SLOT));assertEquals(token,WorkflowNoticeTapsFactory.create(context).token(id));
   // A request for the same approval with another binding or expiry is refused, not posted.
   assertThrows(IllegalStateException.class,()->WorkflowNoticeTapsFactory.delivery(context).postApproval(WorkflowNoticeTapsFactory.create(context),id,"c".repeat(64),route,expiresAt,System.currentTimeMillis()));
   assertThrows(IllegalStateException.class,()->WorkflowNoticeTapsFactory.delivery(context).postApproval(WorkflowNoticeTapsFactory.create(context),id,binding,route,expiresAt+60000L,System.currentTimeMillis()));
   assertEquals(original.getPostTime(),notice(manager,id).getPostTime());assertEquals(receipt,store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT));assertEquals(captureLedger,store.readCredentialSlot(WorkflowNoticeTaps.SLOT));
   android.os.Bundle evidence=new android.os.Bundle();evidence.putString("workflowApprovalNoticeProcessDeath",new JSONObject().put("beforePid",before.pid).put("beforeStart",before.start).put("afterPid",after.pid).put("afterStart",after.start).put("uid",after.uid).put("postTime",original.getPostTime()).toString());InstrumentationRegistry.getInstrumentation().addResults(evidence);
  }finally{
   manager.cancel("alpha-workflow-"+id,0);
   // The runner removes this entire fresh user; do not race main's encrypted ledger with cleanup writes.
  }
 }
 @Test public void definitiveSignedOutColdStartWithdrawsApprovalAndInvalidatesOriginalTap()throws Exception {
  org.junit.Assume.assumeTrue("Explicit isolated process-death campaign","1".equals(InstrumentationRegistry.getArguments().getString("workflowApprovalNoticeProcessDeath")));
  if(WorkflowNoticeOwnerFixture.preparing()){WorkflowNoticeOwnerFixture.prepare();return;}
  assertEquals(APP+":workflowNoticeTest",Application.getProcessName());assertTrue(android.os.Process.myUid()/100000>0);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();AlphaCredentialStore store=new AlphaCredentialStore(context);
  NotificationManager manager=context.getSystemService(NotificationManager.class);WorkflowNoticeTaps taps=WorkflowNoticeTapsFactory.create(context);WorkflowNoticeDelivery delivery=WorkflowNoticeTapsFactory.delivery(context);
  String id="approval-"+(UUID.randomUUID().toString()+UUID.randomUUID()).replace("-","");
  try(WorkflowNoticeOwnerFixture fixture=new WorkflowNoticeOwnerFixture(context)){
   Intent launch=context.getPackageManager().getLaunchIntentForPackage(APP);assertNotNull(launch);context.startActivity(launch);
   WorkflowNoticeProcessDeathInstrumentedTest.Identity before=WorkflowNoticeProcessDeathInstrumentedTest.awaitMain(context);fixture.awaitOwner(true);
   JSONObject route=new JSONObject().put("scope","a".repeat(64)).put("origin",fixture.origin).put("ownerId",fixture.identity.getString("ownerId")).put("agentId",fixture.identity.getString("agentId")).put("workflowId","fixture-flow").put("runId","signedout-fixture").put("versionId","fixture-version");
   long expires=System.currentTimeMillis()+600000,end=SystemClock.elapsedRealtime()+10000;String published;
   do{published=delivery.postApproval(taps,id,"b".repeat(64),route,expires,System.currentTimeMillis());if("succeeded".equals(published))break;assertEquals("unknown",published);SystemClock.sleep(50);}while(SystemClock.elapsedRealtime()<end);
   assertEquals("succeeded",published);PendingIntent original=notice(manager,id).getNotification().contentIntent;
   store.removeCredentialSlot("remote:"+fixture.origin);
   for(ActivityManager.AppTask task:context.getSystemService(ActivityManager.class).getAppTasks()){assertEquals(APP,task.getTaskInfo().baseIntent.getComponent().getPackageName());task.finishAndRemoveTask();}
   end=SystemClock.elapsedRealtime()+10000;while(!context.getSystemService(ActivityManager.class).getAppTasks().isEmpty()&&SystemClock.elapsedRealtime()<end)SystemClock.sleep(50);assertTrue(context.getSystemService(ActivityManager.class).getAppTasks().isEmpty());
   before.exact();Os.kill(before.pid,OsConstants.SIGKILL);end=SystemClock.elapsedRealtime()+10000;
   while((Files.exists(Path.of("/proc/"+before.pid))||!WorkflowNoticeProcessDeathInstrumentedTest.mainPids(context).isEmpty())&&SystemClock.elapsedRealtime()<end)SystemClock.sleep(50);
   assertFalse(Files.exists(Path.of("/proc/"+before.pid)));assertTrue(WorkflowNoticeProcessDeathInstrumentedTest.mainPids(context).isEmpty());
   int authBefore=fixture.verified.get();context.startActivity(launch);WorkflowNoticeProcessDeathInstrumentedTest.Identity after=WorkflowNoticeProcessDeathInstrumentedTest.awaitMain(context);assertTrue(before.pid!=after.pid||!before.start.equals(after.start));fixture.awaitOwner(false);
   end=SystemClock.elapsedRealtime()+10000;while(!approvals(manager).isEmpty()&&SystemClock.elapsedRealtime()<end)SystemClock.sleep(50);assertTrue("Signed-out startup withdraws OS approval",approvals(manager).isEmpty());
   assertEquals("No credential means no authentication dispatch",authBefore,fixture.verified.get());assertFalse(taps.pending().has("token"));
   assertEquals("suspended",new JSONObject(store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT)).getJSONObject(id).getString("status"));
   assertThrows("Old OS tap cannot launch signed-out state",PendingIntent.CanceledException.class,()->original.send());
  }finally{manager.cancel("alpha-workflow-"+id,0);}
 }

}
