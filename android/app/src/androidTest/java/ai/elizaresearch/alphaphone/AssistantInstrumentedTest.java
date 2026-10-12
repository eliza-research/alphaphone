package ai.elizaresearch.alphaphone;

import android.app.role.RoleManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.SystemClock;
import androidx.lifecycle.Lifecycle;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Actual Android assist activity and task boundary; does not silently change the user's role. */
@RunWith(AndroidJUnit4.class)
public class AssistantInstrumentedTest {
 /** Agent.launchSurface() as the renderer sees it: "true", "false" or "error". */
 private static String launchSurfaceAssistant(Class<? extends MainActivity> type) throws Exception {
  for (int i = 0; i < 100 && !"true".equals(WebViewTestDriver.evaluate(type, "Boolean(window.Capacitor?.Plugins?.Agent)")); i++) SystemClock.sleep(100);
  WebViewTestDriver.evaluate(type, "window.__launchSurface=null;Capacitor.Plugins.Agent.launchSurface().then(v=>window.__launchSurface=String(v.assistant===true),()=>window.__launchSurface='error')");
  for (int i = 0; i < 200; i++) {
   String raw = WebViewTestDriver.evaluate(type, "window.__launchSurface");
   if (raw != null && !"null".equals(raw)) return raw.replace("\"", "");
   SystemClock.sleep(50);
  }
  throw new AssertionError("launchSurface did not complete");
 }
 @Test public void assistantCandidateIsExportedAndHasSeparateTask() throws Exception {
  Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
  PackageManager packages = context.getPackageManager();
  Intent assist = new Intent(Intent.ACTION_ASSIST).setPackage(context.getPackageName());
  android.content.pm.ResolveInfo resolved = packages.resolveActivity(assist, PackageManager.MATCH_DEFAULT_ONLY);
  assertNotNull("ACTION_ASSIST resolves for user role selection", resolved);
  assertEquals(AlphaAssistActivity.class.getName(), resolved.activityInfo.name);
  assertTrue(resolved.activityInfo.exported);
  assertEquals(context.getPackageName() + ".assistant", resolved.activityInfo.taskAffinity);
  assertNotEquals(packages.getActivityInfo(new ComponentName(context, MainActivity.class), 0).taskAffinity, resolved.activityInfo.taskAffinity);
  assertTrue("Phone system offers the opt-in assistant role", context.getSystemService(RoleManager.class).isRoleAvailable(RoleManager.ROLE_ASSISTANT));
 }
 @Test public void explicitAssistDropsCallerContextAndCanFinish() throws Exception {
  Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
  Intent intent = new Intent(context, AlphaAssistActivity.class).setAction(Intent.ACTION_ASSIST)
   .setData(Uri.parse("https://example.com/private-context"))
   .putExtra(Intent.EXTRA_TEXT, "Never automatically forward caller content")
   .putExtra("query", "Never automatically execute caller instructions");
  try (BoundedActivityScenario<AlphaAssistActivity> scenario = BoundedActivityScenario.launch(intent)) {
   assertEquals("The renderer learns it is the assistant surface", "true", launchSurfaceAssistant(AlphaAssistActivity.class));
   WebViewTestDriver.withActivity(AlphaAssistActivity.class, activity -> {
    // Only Alpha's own launch flag survives; caller text, query and data are dropped.
    android.os.Bundle extras = activity.getIntent().getExtras();
    assertNotNull(extras);
    assertEquals(java.util.Set.of(AlphaAssistActivity.EXTRA_ASSISTANT), extras.keySet());
    assertTrue(extras.getBoolean(AlphaAssistActivity.EXTRA_ASSISTANT));
    assertNull(activity.getIntent().getData());
    assertTrue(activity.isAssistantSurface());
    assertNotNull(activity.getBridge());
    activity.finish();
   });
   for (int i = 0; i < 50 && scenario.getState() != Lifecycle.State.DESTROYED; i++) SystemClock.sleep(100);
   assertEquals("Assistant closes normally in both distribution variants", Lifecycle.State.DESTROYED, scenario.getState());
  }
 }
 /** Closing the assistant surface must not interrupt work owned by the main surface or clear the
  * shared owner enrollment. The in-flight stream here is a synthetic handle registered on the
  * MainActivity plugin instance; it proves ownership, not a live runtime stream. */
 @Test public void finishingAssistantKeepsMainStreamAndEnrollment() throws Exception {
  Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
  java.util.concurrent.atomic.AtomicBoolean mainInvalidated = new java.util.concurrent.atomic.AtomicBoolean(), assistInvalidated = new java.util.concurrent.atomic.AtomicBoolean();
  java.util.concurrent.atomic.AtomicReference<AlphaLocalAgentPlugin> mainPlugin = new java.util.concurrent.atomic.AtomicReference<>();
  try (BoundedActivityScenario<MainActivity> main = BoundedActivityScenario.launch(MainActivity.class)) {
   assertEquals("The main surface is not the assistant", "false", launchSurfaceAssistant(MainActivity.class));
   WebViewTestDriver.withActivity(MainActivity.class, activity -> {
    AlphaLocalAgentPlugin plugin = (AlphaLocalAgentPlugin) activity.getBridge().getPlugin("Agent").getInstance();
    mainPlugin.set(plugin);
    AlphaLocalAgentPlugin.enrollForTest("synthetic-root", "synthetic-owner-token", "synthetic-owner", System.currentTimeMillis() + 600_000);
    plugin.adoptStreamForTest("main-stream-000001", new ElizaAgentService.LocalStreamHandle(), () -> mainInvalidated.set(true));
   });
   assertEquals(1, mainPlugin.get().ownedWorkCount());
   Intent assist = new Intent(context, AlphaAssistActivity.class).setAction(Intent.ACTION_ASSIST);
   try (BoundedActivityScenario<AlphaAssistActivity> scenario = BoundedActivityScenario.launch(assist)) {
    assertEquals("The active assistant selects its own WebView", "true", launchSurfaceAssistant(AlphaAssistActivity.class));
    assertEquals("The driver still selects the exact main WebView", "false", launchSurfaceAssistant(MainActivity.class));
    WebViewTestDriver.withActivity(AlphaAssistActivity.class, activity -> {
     AlphaLocalAgentPlugin plugin = (AlphaLocalAgentPlugin) activity.getBridge().getPlugin("Agent").getInstance();
     assertNotSame("Each surface has its own plugin instance", mainPlugin.get(), plugin);
     plugin.adoptStreamForTest("assist-stream-0001", new ElizaAgentService.LocalStreamHandle(), () -> assistInvalidated.set(true));
     activity.finish();
    });
    for (int i = 0; i < 50 && scenario.getState() != Lifecycle.State.DESTROYED; i++) SystemClock.sleep(100);
    assertEquals(Lifecycle.State.DESTROYED, scenario.getState());
   }
   assertTrue("The assistant's own stream is cancelled with its surface", assistInvalidated.get());
   assertFalse("The main surface stream continues", mainInvalidated.get());
   assertEquals("The main surface still owns its stream", 1, mainPlugin.get().ownedWorkCount());
   assertTrue("Closing the assistant keeps the shared enrollment", AlphaLocalAgentPlugin.enrollmentPresent());
  } finally {
   AlphaLocalAgentPlugin.enrollForTest(null, null, null, 0);
  }
 }
}
