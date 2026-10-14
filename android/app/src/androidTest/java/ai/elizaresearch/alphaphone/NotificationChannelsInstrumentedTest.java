package ai.elizaresearch.alphaphone;
import android.app.*;
import android.content.*;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;
/** Real channel Settings mutation; isolated channel only, never a user's reminder channel. */
public final class NotificationChannelsInstrumentedTest {
 private String fixtureChannel;
 private String lastSwitchState="not-selected";
 private String nativeDiagnostic(){Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();NotificationManager m=c.getSystemService(NotificationManager.class);NotificationChannel row=fixtureChannel==null?null:m.getNotificationChannel(fixtureChannel);AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();return "appEnabled="+m.areNotificationsEnabled()+",importance="+(row==null?"missing":row.getImportance())+",foreground="+(root==null?"none":root.getPackageName());}
 private void until(String expression)throws Exception{for(int i=0;i<200;i++){if("true".equals(WebViewTestDriver.evaluate("Boolean("+expression+")")))return;SystemClock.sleep(100);}fail("Notification channel condition: "+expression+"; native="+nativeDiagnostic()+"; safe UI="+WebViewTestDriver.evaluate("JSON.stringify({view:document.documentElement.dataset.activeView,blocked:document.body.textContent.includes(\"Channel blocked\"),summary:document.body.textContent.includes(\"Some channels blocked\"),allowed:document.body.textContent.includes(\"Channel allowed\"),appOff:document.body.textContent.includes(\"App notifications off\"),unavailable:document.body.textContent.includes(\"Unavailable\")})"));}
 private void click(String label)throws Exception{String q="[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&b.textContent.trim()==="+JSONObject.quote(label)+")";until(q);WebViewTestDriver.evaluate("("+q+").click()");}
 private void back()throws Exception{UiAutomation ui=InstrumentationRegistry.getInstrumentation().getUiAutomation();long t=SystemClock.uptimeMillis();for(int action:new int[]{KeyEvent.ACTION_DOWN,KeyEvent.ACTION_UP})assertTrue(ui.injectInputEvent(new KeyEvent(t,SystemClock.uptimeMillis(),action,KeyEvent.KEYCODE_BACK,0),true));
  String app=InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName();for(int i=0;i<150;i++){AccessibilityNodeInfo root=ui.getRootInActiveWindow();if(root!=null&&app.contentEquals(root.getPackageName()))return;SystemClock.sleep(100);}fail("Android Back did not return to Alpha: "+nativeDiagnostic());}
 private AccessibilityNodeInfo labeledSwitchRow(AccessibilityNodeInfo node,AccessibilityNodeInfo root){
  // Settings nests its label below a sibling layout on some images. Require a
  // bounded row with exactly one switch, never a page containing other controls.
  for(int depth=0;node!=null&&depth<4;depth++,node=node.getParent()){
   if(node.equals(root))return null;
   boolean exactLabel=false;
   for(String label:new String[]{"Allow notifications","Show notifications"})for(AccessibilityNodeInfo match:node.findAccessibilityNodeInfosByText(label))if(label.contentEquals(match.getText()==null?"":match.getText()))exactLabel=true;
   if(!exactLabel)continue;
   java.util.ArrayDeque<AccessibilityNodeInfo> queue=new java.util.ArrayDeque<>();queue.add(node);int switches=0,seen=0;
   while(!queue.isEmpty()&&seen++<40){AccessibilityNodeInfo child=queue.remove();if(child.isCheckable()&&String.valueOf(child.getClassName()).contains("Switch"))switches++;for(int i=0;i<child.getChildCount();i++){AccessibilityNodeInfo next=child.getChild(i);if(next!=null)queue.add(next);}}
   // MainSwitchBar is the clickable parent of the frame holding label/switch.
   // Keep climbing past a nonclickable frame; never accept the page itself.
   if(queue.isEmpty()&&switches==1&&node.isEnabled()&&node.isVisibleToUser()&&node.isClickable())return node;
  }
  return null;
 }
 private void toggle(boolean checked,String name)throws Exception{
  UiAutomation ui=InstrumentationRegistry.getInstrumentation().getUiAutomation();String switches="none";
  for(int i=0;i<150;i++){AccessibilityNodeInfo root=ui.getRootInActiveWindow();if(root!=null&&"com.android.settings".contentEquals(root.getPackageName())&&!root.findAccessibilityNodeInfosByText(name).isEmpty()){
   switches="";java.util.ArrayDeque<AccessibilityNodeInfo> queue=new java.util.ArrayDeque<>();queue.add(root);
   while(!queue.isEmpty()){AccessibilityNodeInfo node=queue.remove();if(node.isCheckable()&&node.isEnabled()&&node.isVisibleToUser()&&String.valueOf(node.getClassName()).contains("Switch")){
    AccessibilityNodeInfo row=labeledSwitchRow(node,root);
    switches+="[id="+node.getViewIdResourceName()+",checked="+node.isChecked()+",uniqueLabeledRow="+(row!=null)+",parentId="+(node.getParent()==null?"none":node.getParent().getViewIdResourceName())+"]";
    if(row==null)continue;
    NotificationChannel nativeRow=InstrumentationRegistry.getInstrumentation().getTargetContext().getSystemService(NotificationManager.class).getNotificationChannel(fixtureChannel);
    if(nativeRow==null)fail("Exact fixture channel disappeared");
    boolean nativeEnabled=nativeRow.getImportance()!=NotificationManager.IMPORTANCE_NONE;
    java.util.ArrayList<String> labels=new java.util.ArrayList<>();
    for(String label:new String[]{"Allow notifications","Show notifications"})for(AccessibilityNodeInfo match:row.findAccessibilityNodeInfosByText(label)){
     String value=String.valueOf(match.getText());labels.add(value.substring(0,Math.min(80,value.length())));
    }
    android.os.Bundle candidate=new android.os.Bundle();candidate.putString("notificationCandidate","switch="+node.getViewIdResourceName()+",checked="+node.isChecked()+",nativeEnabled="+nativeEnabled+",rowClass="+row.getClassName()+",labels="+labels);InstrumentationRegistry.getInstrumentation().sendStatus(0,candidate);
    // A different/decorative control must not stand in for this native channel.
    if(node.isChecked()!=nativeEnabled)continue;
    // An accessibility-only decorative switch can report unchecked even when
    // the native channel is enabled. Require an actionable exact row before
    // accepting either its checked state or a click target.
    AccessibilityNodeInfo actionable=null,target=node;
    for(int depth=0;depth<4&&target!=null;depth++,target=target.getParent()){
     // A clickable frame can contain only the switch while the label is
     // its sibling. The enclosing row was already proven uniquely labeled;
     // every ancestor examined here stays inside that exact row.
     if(!target.equals(root)&&target.isEnabled()&&target.isClickable()){actionable=target;break;}
     if(target.equals(row))break;
    }
    if(actionable==null)continue;
    lastSwitchState="switch="+node.getViewIdResourceName()+",checked="+node.isChecked()+",desired="+checked+",row="+row.getViewIdResourceName()+",actionable="+actionable.getViewIdResourceName();
    android.os.Bundle observation=new android.os.Bundle();observation.putString("notificationSwitch",lastSwitchState);InstrumentationRegistry.getInstrumentation().sendStatus(0,observation);
    if(node.isChecked()!=checked)assertTrue("Actual clickable ancestor of exact channel Allow/Show row",actionable.performAction(AccessibilityNodeInfo.ACTION_CLICK));
    return;
   }for(int j=0;j<node.getChildCount();j++){AccessibilityNodeInfo child=node.getChild(j);if(child!=null)queue.add(child);}}
  }SystemClock.sleep(100);}fail("Exact channel Settings switch unavailable: "+switches+"; "+nativeDiagnostic());
 }
 private void channelState(NotificationManager manager,String id,boolean enabled)throws Exception{
  for(int i=0;i<150;i++){NotificationChannel channel=manager.getNotificationChannel(id);if(channel!=null&&(channel.getImportance()!=NotificationManager.IMPORTANCE_NONE)==enabled){assertTrue("Global app setting must remain allowed",manager.areNotificationsEnabled());return;}SystemClock.sleep(100);}
  NotificationChannel channel=manager.getNotificationChannel(id);AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
  String dialog="none";if(root!=null){dialog="turnOff="+!root.findAccessibilityNodeInfosByText("Turn off").isEmpty()+",cancel="+!root.findAccessibilityNodeInfosByText("Cancel").isEmpty()+",ok="+!root.findAccessibilityNodeInfosByText("OK").isEmpty();}
  fail("Exact fixture channel write not observed: appEnabled="+manager.areNotificationsEnabled()+", importance="+(channel==null?"missing":channel.getImportance())+"; "+lastSwitchState+"; dialog="+dialog);
 }
 @Test public void blockedChannelReadbackUserRecoveryAndRealNotification()throws Exception{
  org.junit.Assume.assumeTrue("Permission-restoring runner required","1".equals(InstrumentationRegistry.getArguments().getString("notificationChannels")));
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();NotificationManager manager=context.getSystemService(NotificationManager.class);String token=java.util.UUID.randomUUID().toString(),id="alpha-channel-fixture-"+token,name="Fixture channel "+token,title="Channel recovery "+token;
  fixtureChannel=id;assertTrue("Runner granted app permission",manager.areNotificationsEnabled());manager.createNotificationChannel(new NotificationChannel(id,name,NotificationManager.IMPORTANCE_DEFAULT));
  String action="alpha.channel.fixture."+token;java.util.concurrent.atomic.AtomicBoolean delivered=new java.util.concurrent.atomic.AtomicBoolean();BroadcastReceiver receiver=new BroadcastReceiver(){@Override public void onReceive(Context ignored,Intent intent){if(action.equals(intent.getAction()))delivered.set(true);}};
  if(android.os.Build.VERSION.SDK_INT>=33)context.registerReceiver(receiver,new IntentFilter(action),Context.RECEIVER_NOT_EXPORTED);else context.registerReceiver(receiver,new IntentFilter(action));
  PendingIntent tap=PendingIntent.getBroadcast(context,token.hashCode(),new Intent(action).setPackage(context.getPackageName()),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();WebViewTestDriver.evaluate(AppNavigation.request("Settings"));until("window.__alphaTestNavigation?.status==='complete'");
   // The Settings row, not the "Notifications" handle that Home has had since round 8: Home stays laid out under Settings and its handle comes first in the document.
   String row="[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&!b.matches('[data-alpha-shade-handle]')&&b.textContent.trim().startsWith('Notifications'))";until(row);WebViewTestDriver.evaluate("("+row+").click()");click("Manage "+name);toggle(false,name);channelState(manager,id,false);back();
   until("document.body.textContent.includes('Channel blocked')&&document.body.textContent.includes('Some channels blocked')");assertTrue("Global app permission still allowed",manager.areNotificationsEnabled());assertEquals(NotificationManager.IMPORTANCE_NONE,manager.getNotificationChannel(id).getImportance());
   click("Manage "+name);toggle(true,name);channelState(manager,id,true);back();until("document.body.textContent.includes("+JSONObject.quote(name)+")&&document.body.textContent.includes('Channel allowed')");assertEquals(NotificationManager.IMPORTANCE_DEFAULT,manager.getNotificationChannel(id).getImportance());
   manager.notify(id,1,new Notification.Builder(context,id).setSmallIcon(android.R.drawable.ic_popup_reminder).setContentTitle(title).setContentText("Synthetic channel recovery body").setContentIntent(tap).setAutoCancel(true).build());
   // The notice is shown and tapped in Android's own shade; Alpha draws none (#416, docs/gesture-zones.md).
   WebViewTestDriver.evaluate(AppNavigation.request("Home"));until(AppNavigation.selected("Home"));until(AndroidShade.ALPHA_SHADE_ABSENT);
   // Android's own action on both flavors: channel recovery does not depend on the launcher button.
   assertTrue("Android's own action opens its shade",AndroidShade.openWithoutAlpha());
   android.view.accessibility.AccessibilityNodeInfo notice=AndroidShade.waitText(title,10000);assertNotNull("Android's shade shows the recovered channel's notice",notice);assertTrue("The notice row is tappable",AndroidShade.tap(notice));
   for(int i=0;i<100&&java.util.Arrays.stream(manager.getActiveNotifications()).anyMatch(n->id.equals(n.getTag()));i++)SystemClock.sleep(100);
   for(int i=0;i<100&&!delivered.get();i++)SystemClock.sleep(100);assertTrue("Exact owned synthetic notification target received real tap",delivered.get());
   assertFalse("Actual auto-cancel",java.util.Arrays.stream(manager.getActiveNotifications()).anyMatch(n->id.equals(n.getTag())));
   WebViewTestDriver.evaluate("window.__unknownChannel=null;Capacitor.Plugins.AlphaNotifications.openChannelSettings({id:'not-a-capability'}).then(()=>window.__unknownChannel=false,()=>window.__unknownChannel=true)");until("window.__unknownChannel===true");
  }finally{if(AndroidShade.isOpen())AndroidShade.collapse();manager.cancel(id,1);tap.cancel();context.unregisterReceiver(receiver);manager.deleteNotificationChannel(id);assertNull("Only disposable channel removed",manager.getNotificationChannel(id));}
 }
}
