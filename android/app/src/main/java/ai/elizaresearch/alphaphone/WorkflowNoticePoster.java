package ai.elizaresearch.alphaphone;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationChannelGroup;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;

/** Uses only this app's channels; private contents are hidden on the lock screen. Only pending approvals use a high-importance channel. */
final class WorkflowNoticePoster implements WorkflowNoticeDelivery.Poster {
 static final String CHANNEL="alpha_workflow_steps",APPROVAL_CHANNEL="alpha_workflow_approvals";
 private final Context context;
 WorkflowNoticePoster(Context context){
  this.context=context.getApplicationContext();
  NotificationChannel channel=new NotificationChannel(CHANNEL,"Approved workflow notifications",NotificationManager.IMPORTANCE_DEFAULT);channel.setDescription("Notifications explicitly approved in Alpha Phone workflows");channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);manager().createNotificationChannel(channel);
  NotificationChannel approvals=new NotificationChannel(APPROVAL_CHANNEL,"Workflow approval requests",NotificationManager.IMPORTANCE_HIGH);approvals.setDescription("A workflow step is waiting for your approval on this phone");approvals.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);manager().createNotificationChannel(approvals);
 }
 private NotificationManager manager(){return context.getSystemService(NotificationManager.class);}
 private String tag(String id){return "alpha-workflow-"+id;}
 private static String channelFor(String id){return WorkflowNoticeDelivery.approvalId(id)?APPROVAL_CHANNEL:CHANNEL;}
 private boolean allowed(String name){
  if(Build.VERSION.SDK_INT>=33&&context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return false;
  NotificationChannel channel=manager().getNotificationChannel(name);if(!manager().areNotificationsEnabled()||channel==null||channel.getImportance()==NotificationManager.IMPORTANCE_NONE)return false;
  NotificationChannelGroup group=channel.getGroup()==null?null:manager().getNotificationChannelGroup(channel.getGroup());return group==null||!group.isBlocked();
 }
 public boolean allowed(){return allowed(CHANNEL);}
 @Override public boolean approvalsAllowed(){return allowed(APPROVAL_CHANNEL);}
 private PendingIntent tap(String id)throws Exception{
  Intent launch=context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
  String token=WorkflowNoticeTapsFactory.create(context).token(id);
  if(launch==null||token==null)throw new IllegalStateException("Workflow notification route unavailable");
  launch.setAction(WorkflowNoticeTaps.ACTION).setData(android.net.Uri.parse(WorkflowNoticeTaps.PREFIX+token));
  return PendingIntent.getActivity(context,0,launch,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
 }
 private Notification redacted(String channel,String title){return new Notification.Builder(context,channel).setSmallIcon(R.drawable.notification_icon).setContentTitle(title).setContentText("Unlock to review this notification.").build();}
 /** Visible for builder tests. An unopened step notice times out after a day; opening it cancels it. */
 Notification.Builder step(String title,String body,PendingIntent tap){
  return new Notification.Builder(context,CHANNEL).setSmallIcon(R.drawable.notification_icon).setContentTitle(title).setContentText(body).setStyle(new Notification.BigTextStyle().bigText(body)).setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(redacted(CHANNEL,"Alpha Phone workflow")).setOnlyAlertOnce(true).setAutoCancel(false).setTimeoutAfter(WorkflowNoticeDelivery.STEP_NOTICE_TIMEOUT_MS).setCategory(Notification.CATEGORY_STATUS).setContentIntent(tap);
 }
 /** Visible for builder tests. Redacted approval request that disappears when the approval expires; tapping only opens the run. */
 Notification.Builder approval(String title,String body,long timeoutMs,PendingIntent tap){
  if(timeoutMs<=0)throw new IllegalArgumentException("Approval already expired");
  return new Notification.Builder(context,APPROVAL_CHANNEL).setSmallIcon(R.drawable.notification_icon).setContentTitle(title).setContentText(body).setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(redacted(APPROVAL_CHANNEL,"Alpha Phone")).setOnlyAlertOnce(true).setAutoCancel(false).setTimeoutAfter(timeoutMs).setCategory(Notification.CATEGORY_REMINDER).setContentIntent(tap);
 }
 public void post(String id,String title,String body)throws Exception{
  if(!allowed())throw new SecurityException("Notification delivery is disabled");
  manager().notify(tag(id),0,step(title,body,tap(id)).build());awaitListed(id);
 }
 /** notify() hands the notice to the system asynchronously, so an immediate read of the active list
  * can miss it and the receipt would record "unknown" for a notice Android is about to show. Wait
  * briefly (callers are never on the main thread); a notice still missing afterwards stays "unknown". */
 private void awaitListed(String id){
  long end=SystemClock.elapsedRealtime()+2000;
  while(SystemClock.elapsedRealtime()<end){
   for(StatusBarNotification row:manager().getActiveNotifications())if(row.getId()==0&&tag(id).equals(row.getTag()))return;
   try{Thread.sleep(20);}catch(InterruptedException interrupted){Thread.currentThread().interrupt();return;}
  }
 }
 @Override public void postApproval(String id,String title,String body,long timeoutMs)throws Exception{
  if(!WorkflowNoticeDelivery.approvalId(id)||!approvalsAllowed())throw new SecurityException("Approval notifications are disabled");
  manager().notify(tag(id),0,approval(title,body,timeoutMs,tap(id)).build());awaitListed(id);
 }
 @Override public void postApprovalQuiet(String id,String title,String body,long timeoutMs)throws Exception{
  if(!WorkflowNoticeDelivery.approvalId(id)||!approvalsAllowed())throw new SecurityException("Approval notifications are disabled");
  // Group children with SUMMARY-only alert behavior cannot sound/vibrate, even on the high channel.
  manager().notify(tag(id),0,approval(title,body,timeoutMs,tap(id)).setGroup("alpha_quiet_approvals").setGroupAlertBehavior(Notification.GROUP_ALERT_SUMMARY).build());awaitListed(id);
 }
 @Override public void cancel(String id){
  manager().cancel(tag(id),0);
  try{String token=WorkflowNoticeTapsFactory.create(context).token(id);Intent launch=context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());if(token!=null&&launch!=null){launch.setAction(WorkflowNoticeTaps.ACTION).setData(android.net.Uri.parse(WorkflowNoticeTaps.PREFIX+token));PendingIntent pending=PendingIntent.getActivity(context,0,launch,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_NO_CREATE);if(pending!=null)pending.cancel();}}catch(Exception failure){throw new IllegalStateException("Stale workflow tap could not be invalidated",failure);}
 }
 public boolean matches(String id,String title,String body){for(StatusBarNotification row:manager().getActiveNotifications())if(row.getId()==0&&tag(id).equals(row.getTag())){Notification notice=row.getNotification();return channelFor(id).equals(notice.getChannelId())&&title.contentEquals(notice.extras.getCharSequence(Notification.EXTRA_TITLE,""))&&body.contentEquals(notice.extras.getCharSequence(Notification.EXTRA_BIG_TEXT,notice.extras.getCharSequence(Notification.EXTRA_TEXT,"")));}return false;}
}
