package ai.elizaresearch.alphaphone;

import android.content.Context;
import android.content.pm.PackageManager;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/**
 * journeys-12: with RECORD_AUDIO revoked, starting a recording rejects with
 * "permission-denied" and the recorder shows the denied state with Open app settings.
 *
 * Revoking a runtime permission kills the target process, so the revoke step runs before
 * this instrumentation starts. The runner owns it, in a temporary emulator user it removes:
 *   node scripts/test-native-permissions.mjs voice APP.apk TEST.apk NEW_OUTPUT
 * (pm revoke RECORD_AUDIO, then this method with -e voicePermissionDenied 1). Revoking while a
 * recording is running and granting again is VoicePermissionRevokeInstrumentedTest (voice-revoke).
 * The system permission prompt, if Android shows one, is dismissed with Back (a denial).
 * No audio is captured and nothing is uploaded; typing in the conversation composer still works.
 * This proves the emulator/device renderer and plugin path only, not a user's acceptance.
 */
@RunWith(AndroidJUnit4.class)
public final class VoicePermissionDeniedInstrumentedTest {
 private static void until(String expression,long timeout)throws Exception{long end=SystemClock.elapsedRealtime()+timeout;while(SystemClock.elapsedRealtime()<end){if("true".equals(eval("Boolean("+expression+")")))return;SystemClock.sleep(100);}fail("Voice permission UI condition timed out: "+expression);}
 private static String button(String label){return "[...document.querySelectorAll('button')].find(e=>(e.getAttribute('aria-label')==="+JSONObject.quote(label)+"||e.textContent.trim()==="+JSONObject.quote(label)+")&&e.getClientRects().length&&!e.disabled)";}
 private static void click(String label)throws Exception{until(button(label),20000);eval(button(label)+".click()");}
 /** The live production activity, without an injected Cloud or agent transport. */
 private static MainActivity activity()throws Exception{
  java.util.concurrent.atomic.AtomicReference<MainActivity> out=new java.util.concurrent.atomic.AtomicReference<>();
  BoundedActivityScenario.main(()->{for(androidx.test.runner.lifecycle.Stage stage:new androidx.test.runner.lifecycle.Stage[]{androidx.test.runner.lifecycle.Stage.RESUMED,androidx.test.runner.lifecycle.Stage.STARTED,androidx.test.runner.lifecycle.Stage.PAUSED,androidx.test.runner.lifecycle.Stage.STOPPED})for(android.app.Activity a:androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(stage))if(out.get()==null&&a instanceof MainActivity&&!a.isFinishing())out.set((MainActivity)a);});
  return out.get();
 }
 private static String eval(String script)throws Exception{
  MainActivity a=null;long end=SystemClock.elapsedRealtime()+20000;while((a=activity())==null&&SystemClock.elapsedRealtime()<end)SystemClock.sleep(50);
  assertNotNull("Live activity for WebView evaluation",a);MainActivity target=a;
  java.util.concurrent.CountDownLatch done=new java.util.concurrent.CountDownLatch(1);java.util.concurrent.atomic.AtomicReference<String> out=new java.util.concurrent.atomic.AtomicReference<>();
  BoundedActivityScenario.main(()->target.getBridge().getWebView().evaluateJavascript(script,value->{out.set(value);done.countDown();}));
  assertTrue("WebView responds",done.await(10,java.util.concurrent.TimeUnit.SECONDS));return out.get();
 }
 private static boolean appFocused()throws Exception{MainActivity a=activity();AtomicBoolean focused=new AtomicBoolean();if(a!=null)BoundedActivityScenario.main(()->focused.set(a.hasWindowFocus()));return focused.get();}
 @Test public void deniedMicrophoneShowsSettingsRecoveryAndKeyboard()throws Exception {
  org.junit.Assume.assumeTrue("Run after revoking RECORD_AUDIO (see class documentation)","1".equals(InstrumentationRegistry.getArguments().getString("voicePermissionDenied")));
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  assertEquals("RECORD_AUDIO must be revoked before this instrumentation starts",PackageManager.PERMISSION_DENIED,context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO));
  try{
   BoundedActivityScenario.main(()->context.startActivity(new android.content.Intent(context,MainActivity.class).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK|android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK)));
   until("window.Capacitor?.Plugins?.AlphaVoiceCloud&&document.querySelector('.os')",60000);
   AppNavigation.liveMode();eval(AppNavigation.request("Notes"));until(AppNavigation.selected("Notes"),30000);until("window.__alphaTestNavigation?.status==='complete'",30000);
   eval("window.__deniedCloudSpeech=0;window.__deniedNativePromise=Capacitor.nativePromise;Capacitor.nativePromise=function(plugin,method,input){if(plugin==='AlphaVoiceCloud'&&['synthesize','transcribeRecording'].includes(method))window.__deniedCloudSpeech++;return window.__deniedNativePromise.apply(this,arguments);}");
   click("Record and transcribe");
   // Local recording is available while signed out. Manual mode avoids requiring
   // speech models for this permission-denial test; it still uses the real recorder.
   click("Record without transcription");
   click("Start recording");
   long end=SystemClock.elapsedRealtime()+20000;boolean dismissed=false;String denied="document.querySelector('[data-alpha-subview=\"notes-recording\"]')?.dataset.voiceState==='denied'";
   while(SystemClock.elapsedRealtime()<end&&!"true".equals(eval("Boolean("+denied+")"))){
    // The permission prompt takes window focus; Back dismisses it as a denial.
    if(!dismissed&&!appFocused()){SystemClock.sleep(500);if(!appFocused()){WebViewTestDriver.pressBack();dismissed=true;}}
    SystemClock.sleep(200);
   }
   until(denied,5000);
   String text=eval("document.querySelector('[data-alpha-subview=\"notes-recording\"]').textContent");
   assertTrue("Denied guidance names app settings",text.contains("Open app settings"));
   assertTrue("Denied guidance offers the keyboard",text.contains("keyboard"));
   assertTrue("Nothing was recorded",text.contains("Nothing was recorded"));
   until(button("Open app settings"),5000);
   assertEquals("Start recording stays available for a retry","true",eval("Boolean("+button("Start recording")+")"));
   assertEquals("Denial must not grant the permission",PackageManager.PERMISSION_DENIED,context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO));
   // Open app settings leaves Alpha for Android's app details page; Back returns.
   click("Open app settings");
   long left=SystemClock.elapsedRealtime()+10000;while(SystemClock.elapsedRealtime()<left&&appFocused())SystemClock.sleep(200);
   assertFalse("Android app settings opened",appFocused());
   WebViewTestDriver.pressBack();
   long back=SystemClock.elapsedRealtime()+10000;while(SystemClock.elapsedRealtime()<back&&!appFocused())SystemClock.sleep(200);
   assertTrue("Back returns to Alpha",appFocused());
   // No capture started: the native recorder never created its raw audio file.
   java.io.File[] captures=context.getCacheDir().listFiles((dir,name)->name.startsWith("alpha-cloud-voice-")&&name.endsWith(".m4a"));
   assertEquals("A denied request records nothing",0,captures==null?0:captures.length);
   // Typing stays usable: leave the recorder and write in the conversation composer.
   eval(AppNavigation.request("Home"));until(AppNavigation.selected("Home"),30000);until("window.__alphaTestNavigation?.status==='complete'",30000);
   eval(AppNavigation.type());until(AppNavigation.composer(),20000);
   String typed="Typed while the microphone is denied";
   eval("(()=>{const e=("+AppNavigation.composer()+");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,"+JSONObject.quote(typed)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
   until("("+AppNavigation.composer()+")?.value==="+JSONObject.quote(typed),10000);
   // Leave no draft behind for the next phase or user.
   eval("(()=>{const e=("+AppNavigation.composer()+");if(!e)return;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));})()");
   assertEquals("No Cloud speech was requested","0",eval("window.__deniedCloudSpeech"));
   assertEquals("Typing must not grant the permission",PackageManager.PERMISSION_DENIED,context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO));

  }finally{
   MainActivity live=activity();if(live!=null)BoundedActivityScenario.main(live::finish);
  }
 }
}
