package ai.elizaresearch.alphaphone;

import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationManager;
import android.service.notification.StatusBarNotification;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.*;

/** Own notifications plus explicitly allowed, Android-authorized external rows. */
@CapacitorPlugin(name="AlphaNotifications")
public class AlphaNotificationsPlugin extends Plugin {
 private static final WorkflowNoticeIo NOTICE_IO=new WorkflowNoticeIo();
 private final android.os.Handler noticeMain=new android.os.Handler(android.os.Looper.getMainLooper());
 private volatile boolean noticeDestroyed;
 private interface NoticeWork {void run()throws Exception;}
 @Override protected void handleOnDestroy(){noticeDestroyed=true;super.handleOnDestroy();}
 private void requireNoticeForeground()throws Exception {
  if(android.os.Looper.myLooper()==android.os.Looper.getMainLooper())throw new IllegalStateException("Storage must not run on main thread");
  java.util.concurrent.CountDownLatch checked=new java.util.concurrent.CountDownLatch(1);
  java.util.concurrent.atomic.AtomicBoolean admitted=new java.util.concurrent.atomic.AtomicBoolean();
  Runnable check=()->{try{if(!noticeDestroyed){foreground();admitted.set(true);}}catch(Exception unavailable){}finally{checked.countDown();}};
  if(!noticeMain.post(check))throw new IllegalStateException("Activity unavailable");
  if(!checked.await(5,java.util.concurrent.TimeUnit.SECONDS)){noticeMain.removeCallbacks(check);throw new IllegalStateException("Activity check timed out");}
  if(!admitted.get()||noticeDestroyed)throw new IllegalStateException("Activity inactive");
 }
 private void noticeWork(PluginCall call,String failure,NoticeWork work){
  try{NOTICE_IO.execute(()->{try{requireNoticeForeground();work.run();}catch(InterruptedException interrupted){Thread.currentThread().interrupt();call.reject(failure);}catch(Exception unavailable){call.reject(failure);}});}
  catch(java.util.concurrent.RejectedExecutionException full){call.reject(failure);}
 }
 private void noticeChanged(){noticeMain.post(()->{if(!noticeDestroyed)notifyListeners("pendingWorkflowTap",new JSObject(),true);});}
 private final WorkflowNoticeIntentDedup<android.content.Intent> workflowIntentDedup=new WorkflowNoticeIntentDedup<>();
 private void clearCapturedIntent(android.content.Intent intent,String token){noticeMain.post(()->{if((WorkflowNoticeTaps.PREFIX+token).equals(intent.getDataString()))intent.setData(null);workflowIntentDedup.release(intent,token);});}
 private final LinkedHashMap<String,List<android.content.Intent>> uncapturedWorkflowTaps=new LinkedHashMap<>();
 private WorkflowNoticeTaps workflowTaps(){return WorkflowNoticeTapsFactory.create(getContext());}
 @Override public void load(){captureWorkflowTap(getActivity().getIntent());}
 @Override protected void handleOnNewIntent(android.content.Intent intent){captureWorkflowTap(intent);}
 @Override protected void handleOnResume(){try{NOTICE_IO.execute(()->{drainWorkflowTaps();noticeChanged();});}catch(java.util.concurrent.RejectedExecutionException full){/* Intents remain retained for retry. */}}
 private int drainWorkflowTaps(){
  int failed=0;Iterator<Map.Entry<String,List<android.content.Intent>>> entries=uncapturedWorkflowTaps.entrySet().iterator();
  while(entries.hasNext()){
   Map.Entry<String,List<android.content.Intent>> entry=entries.next();
   try{workflowTaps().capture(entry.getKey());for(android.content.Intent intent:entry.getValue())clearCapturedIntent(intent,entry.getKey());entries.remove();}
   catch(WorkflowNoticeTaps.UnknownTap unknown){for(android.content.Intent intent:entry.getValue())clearCapturedIntent(intent,entry.getKey());entries.remove();}
   catch(Exception unavailable){failed++;/* Retain this exact token; another confirmed tap may still progress. */}
  }
  return failed;
 }
 private void captureWorkflowTap(android.content.Intent intent){
  if(intent==null||!WorkflowNoticeTaps.ACTION.equals(intent.getAction())||intent.getData()==null)return;
  String value=intent.getData().toString();if(!value.startsWith(WorkflowNoticeTaps.PREFIX))return;
  String token=value.substring(WorkflowNoticeTaps.PREFIX.length());if(!token.matches("[a-f0-9-]{36}"))return;
  // Capacitor forwards warm intents without Activity.setIntent. Retain the actual
  // intent until its encrypted capture commits. OS notices do not auto-cancel,
  // so failed persistence plus process death still leaves an explicit retry.
  getActivity().setIntent(intent);
  // load(), resume and renderer polling may observe the same Intent before the
  // worker's successful capture is cleared on main. Queue that object only once.
  if(!workflowIntentDedup.retain(intent,token))return;
  try{NOTICE_IO.execute(()->{uncapturedWorkflowTaps.computeIfAbsent(token,key->new ArrayList<>()).add(intent);drainWorkflowTaps();noticeChanged();});}
  catch(java.util.concurrent.RejectedExecutionException full){workflowIntentDedup.release(intent,token);/* Intent and OS notice remain available for explicit retry. */}
 }
 @PluginMethod public void pendingWorkflowTap(PluginCall call){noticeMain.post(()->{try{foreground();captureWorkflowTap(getActivity().getIntent());noticeWork(call,"Workflow notification link unavailable; retry after unlocking.",()->{int failed=drainWorkflowTaps();org.json.JSONObject pending=workflowTaps().pending();if(failed>0&&!pending.has("token"))throw new IllegalStateException("Uncaptured workflow notice retained");call.resolve(new JSObject(pending.toString()));});}catch(Exception unavailable){call.reject("Workflow notification link unavailable; retry after unlocking.");}});}
 @PluginMethod public void consumeWorkflowTap(PluginCall call){noticeWork(call,"Workflow notification link was retained; retry.",()->consumePendingWorkflowTap(call));}
 private void consumePendingWorkflowTap(PluginCall call)throws Exception{
  org.json.JSONObject pending=workflowTaps().pending();String token=call.getString("token");
  if(token==null||!token.equals(pending.optString("token")))throw new IllegalStateException("Pending tap changed");
  requireNoticeForeground();workflowTaps().consume(token);manager().cancel("alpha-workflow-"+pending.getString("operationId"),0);call.resolve();
 }
 private final Map<String,String> ids=new java.util.concurrent.ConcurrentHashMap<>();
 private NotificationManager manager(){return getContext().getSystemService(NotificationManager.class);}
 private boolean locked(){return getContext().getSystemService(KeyguardManager.class).isDeviceLocked();}
 private synchronized String id(String key){return ids.computeIfAbsent(key,k->UUID.randomUUID().toString());}
 private String identity(StatusBarNotification row){return row.getKey()+"\n"+row.getPostTime();}
 private StatusBarNotification resolve(String id){if(id==null||id.isEmpty())return null;for(StatusBarNotification row:manager().getActiveNotifications())if(Objects.equals(ids.get(identity(row)),id))return row;return null;}
 private String bounded(CharSequence text,int limit){String value=text==null?"":text.toString();return value.length()>limit?value.substring(0,limit):value;}
 private final Map<String,String> channels=new java.util.concurrent.ConcurrentHashMap<>();
 @PluginMethod public void workflowPresentationCapabilities(PluginCall call){JSObject result=new JSObject();result.put("protocol",2);call.resolve(result);}
 @PluginMethod public void status(PluginCall call){try{
  NotificationManager manager=manager();JSObject out=new JSObject();JSArray values=new JSArray();Set<String> current=new HashSet<>();
  out.put("appEnabled",manager.areNotificationsEnabled());
  out.put("permissionGranted",android.os.Build.VERSION.SDK_INT<33||getContext().checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)==android.content.pm.PackageManager.PERMISSION_GRANTED);
  int filter=manager.getCurrentInterruptionFilter();out.put("interruption",filter==NotificationManager.INTERRUPTION_FILTER_ALL?"all":filter==NotificationManager.INTERRUPTION_FILTER_PRIORITY?"priority":filter==NotificationManager.INTERRUPTION_FILTER_ALARMS?"alarms":filter==NotificationManager.INTERRUPTION_FILTER_NONE?"none":"unknown");
  for(android.app.NotificationChannel channel:manager.getNotificationChannels()){
   String key=channel.getId();current.add(key);JSObject row=new JSObject();row.put("id",channels.computeIfAbsent(key,k->UUID.randomUUID().toString()));row.put("name",bounded(channel.getName(),120));row.put("importance",channel.getImportance());row.put("blocked",channel.getImportance()==NotificationManager.IMPORTANCE_NONE);
   android.app.NotificationChannelGroup group=channel.getGroup()==null?null:manager.getNotificationChannelGroup(channel.getGroup());row.put("groupBlocked",group!=null&&group.isBlocked());values.put(row);
  }
  channels.keySet().retainAll(current);out.put("channels",values);out.put("scope","alpha-phone");call.resolve(out);
 }catch(RuntimeException error){call.reject("Notification delivery settings could not be read");}}
 @PluginMethod public void openChannelSettings(PluginCall call){try{
  String requested=call.getString("id"),key=null;
  if(requested!=null)for(Map.Entry<String,String> entry:channels.entrySet())if(entry.getValue().equals(requested)){key=entry.getKey();break;}
  if(key==null||manager().getNotificationChannel(key)==null){call.reject("This notification channel is no longer available");return;}
  getActivity().startActivity(new android.content.Intent(android.provider.Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,getContext().getPackageName()).putExtra(android.provider.Settings.EXTRA_CHANNEL_ID,key));
  JSObject out=new JSObject();out.put("status","opened");call.resolve(out);
 }catch(RuntimeException error){call.reject("Android channel settings could not be opened");}}
 private void foreground(){if(getActivity()==null||getActivity().isFinishing()||!getActivity().hasWindowFocus()||locked())throw new IllegalStateException();}
 private WorkflowNoticeDelivery workflowNotices(){AlphaCredentialStore store=new AlphaCredentialStore(getContext());return new WorkflowNoticeDelivery(new WorkflowNoticeDelivery.Storage(){public String read(String key)throws Exception{return store.readCredentialSlot(key);}public void write(String key,String value)throws Exception{store.writeCredentialSlot(key,value);}},new WorkflowNoticePoster(getContext()));}
 @PluginMethod public void postWorkflow(PluginCall call){noticeWork(call,"Workflow notification could not be confirmed. It will not be repeated automatically.",()->{workflowTaps().prepare(call.getString("operationId"),call.getString("bindingHash"),call.getObject("route"));requireNoticeForeground();String status=workflowNotices().publish(call.getString("operationId"),call.getString("bindingHash"),call.getString("title"),call.getString("body"));JSObject result=new JSObject();result.put("status",status);call.resolve(result);});}
 @PluginMethod public void workflowReceipt(PluginCall call){noticeWork(call,"Workflow notification receipt is unavailable.",()->{String status=workflowNotices().receipt(call.getString("operationId"),call.getString("bindingHash"),call.getString("title"),call.getString("body"));JSObject result=new JSObject();result.put("status",status);call.resolve(result);});}
 @PluginMethod public void crossAppStatus(PluginCall call){try{call.resolve(NotificationAccess.status(getContext()));}catch(Exception failure){call.reject("Notification access status is unavailable. History may need clearing.");}}
 @PluginMethod public void notificationApps(PluginCall call){try{foreground();JSObject out=new JSObject();out.put("apps",NotificationAccess.apps(getContext()));call.resolve(out);}catch(Exception failure){call.reject("Notification app choices are unavailable");}}
 @PluginMethod public void setNotificationPolicy(PluginCall call){try{foreground();call.resolve(NotificationAccess.update(getContext(),call.getData()));}catch(Exception failure){call.reject("Notification settings changed or could not be saved. Refresh Settings.");}}
 @PluginMethod public void resumeCrossApp(PluginCall call){try{foreground();synchronized(NotificationAccess.LOCK){if(!NotificationAccess.status(getContext()).getString("revision").equals(call.getString("expectedRevision")))throw new IllegalStateException();NotificationAccess.pause(getContext(),false);call.resolve(NotificationAccess.status(getContext()));}}catch(Exception failure){call.reject("Notification collection could not be resumed");}}
 @PluginMethod public void openNotificationAccess(PluginCall call){try{foreground();android.content.Intent intent=android.os.Build.VERSION.SDK_INT>=30?new android.content.Intent(android.provider.Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS).putExtra(android.provider.Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,NotificationAccess.component(getContext()).flattenToString()):new android.content.Intent(android.provider.Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);try{getActivity().startActivity(intent);}catch(android.content.ActivityNotFoundException unavailable){getActivity().startActivity(new android.content.Intent(android.provider.Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));}JSObject out=new JSObject();out.put("status","opened");call.resolve(out);}catch(Exception failure){call.reject("Android notification access settings are unavailable");}}
 @PluginMethod public void notificationHistory(PluginCall call){try{foreground();JSObject out=new JSObject();out.put("items",NotificationAccess.history(getContext()));call.resolve(out);}catch(Exception failure){call.reject("Local notification history is unavailable");}}
 @PluginMethod public void clearNotificationHistory(PluginCall call){try{foreground();NotificationAccess.clearHistoryBoundary(getContext());call.resolve();}catch(Exception failure){call.reject("Local notification history could not be cleared");}}
 @Override protected void handleOnPause(){ids.clear();NotificationAccess.redact();super.handleOnPause();}
 @PluginMethod public void list(PluginCall call){try{
  JSArray items=new JSArray();Set<String> current=new HashSet<>();boolean locked=locked();
  StatusBarNotification[] rows=manager().getActiveNotifications();Arrays.sort(rows,Comparator.comparingLong(StatusBarNotification::getPostTime).reversed());
  for(StatusBarNotification row:rows){current.add(identity(row));if(items.length()>=100)continue;Notification n=row.getNotification();JSObject item=new JSObject();
   boolean hidden=locked||n.visibility==Notification.VISIBILITY_SECRET;
   item.put("id",id(identity(row)));item.put("revision",id(identity(row)));item.put("source","own");item.put("appLabel","Alpha Phone");item.put("title",hidden?"Alpha Phone notification":bounded(n.extras.getCharSequence(Notification.EXTRA_TITLE),200));
   item.put("text",hidden?(locked?"Unlock to view":"Content hidden"):bounded(n.extras.getCharSequence(Notification.EXTRA_BIG_TEXT,n.extras.getCharSequence(Notification.EXTRA_TEXT)),2000));
   item.put("at",row.getPostTime());item.put("clearable",row.isClearable());item.put("canOpen",!hidden&&n.contentIntent!=null);items.put(item);
  }
  synchronized(this){ids.keySet().retainAll(current);}JSArray external=NotificationAccess.list(getContext());for(int i=0;i<external.length()&&items.length()<100;i++)items.put(external.get(i));JSObject result=new JSObject();result.put("items",items);result.put("scope","alpha-phone");call.resolve(result);
 }catch(Exception error){call.reject("Notifications could not be read");}}
 @PluginMethod public void open(PluginCall call){try{foreground();if("external".equals(call.getString("source"))){NotificationAccess.action(getContext(),call.getString("id"),call.getString("revision"),true);call.resolve();return;}StatusBarNotification row=resolve(call.getString("id"));if(row==null||locked()||row.getNotification().visibility==Notification.VISIBILITY_SECRET||row.getNotification().contentIntent==null){call.reject("This notification is no longer available to open");return;}
  row.getNotification().contentIntent.send();if((row.getNotification().flags&Notification.FLAG_AUTO_CANCEL)!=0)manager().cancel(row.getTag(),row.getId());call.resolve();
 }catch(Exception error){call.reject("This notification could not be opened");}}
 @PluginMethod public void dismiss(PluginCall call){try{foreground();if("external".equals(call.getString("source"))){NotificationAccess.action(getContext(),call.getString("id"),call.getString("revision"),false);JSObject out=new JSObject();out.put("status","requested");call.resolve(out);return;}StatusBarNotification row=resolve(call.getString("id"));if(row==null){call.resolve();return;}if(!row.isClearable()){call.reject("This ongoing notification cannot be dismissed");return;}manager().cancel(row.getTag(),row.getId());call.resolve();}catch(Exception error){call.reject("Notification could not be dismissed");}}
 @PluginMethod public void clear(PluginCall call){try{foreground();org.json.JSONArray items=call.getArray("items");if(items==null||items.length()>100)throw new IllegalArgumentException();JSArray outcomes=new JSArray();for(int i=0;i<items.length();i++){org.json.JSONObject item=items.getJSONObject(i);JSObject outcome=new JSObject();outcome.put("id",item.getString("id"));try{if("external".equals(item.optString("source")))NotificationAccess.action(getContext(),item.getString("id"),item.getString("revision"),false);else{StatusBarNotification row=resolve(item.getString("id"));if(row==null||!row.isClearable())throw new IllegalStateException();manager().cancel(row.getTag(),row.getId());}outcome.put("status","requested");}catch(Exception unavailable){outcome.put("status","unavailable");}outcomes.put(outcome);}JSObject out=new JSObject();out.put("outcomes",outcomes);call.resolve(out);}catch(Exception error){call.reject("Notifications could not be cleared");}}
}
