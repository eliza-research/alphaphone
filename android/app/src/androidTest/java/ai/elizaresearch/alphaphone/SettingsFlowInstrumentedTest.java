package ai.elizaresearch.alphaphone;

import android.app.Instrumentation;
import android.content.Intent;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.InputDevice;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Actual battery service fixture -> native bridge -> reference UI -> settings -> resume. */
@RunWith(AndroidJUnit4.class)
public class SettingsFlowInstrumentedTest {
 private String shell(String command)throws Exception{
  try(var fd=InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command);var in=new java.io.FileInputStream(fd.getFileDescriptor())){return new String(in.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);}
 }
 private void until(String expression)throws Exception{
  long end=SystemClock.elapsedRealtime()+15000;
  while(SystemClock.elapsedRealtime()<end){if("true".equals(WebViewTestDriver.evaluate("Boolean("+expression+")")))return;SystemClock.sleep(100);}
  fail("Settings condition did not become true: "+expression);
 }
 private void click(String label)throws Exception{
  String selector="document.querySelector('button[aria-label='+"+JSONObject.quote(JSONObject.quote(label))+"+']')";
  until(selector);WebViewTestDriver.evaluate("("+selector+").click()");
 }
 private void tapBack()throws Exception{
  String value=WebViewTestDriver.evaluate("(()=>{const e=document.querySelector('button[aria-label=\"Back to Settings\"]');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()");
  JSONObject point=new JSONObject(value);
  assertTrue("Back button center must receive touch",point.getBoolean("hit"));
  float[] coordinates=new float[2];
  WebViewTestDriver.withActivity(MainActivity.class,activity->{
   android.webkit.WebView web=activity.getBridge().getWebView();int[] location=new int[2];web.getLocationOnScreen(location);
   float scale=(float)(web.getWidth()/point.optDouble("width"));
   coordinates[0]=location[0]+(float)point.optDouble("x")*scale;coordinates[1]=location[1]+(float)point.optDouble("y")*scale;
  });
  long down=SystemClock.uptimeMillis();
  for(int action:new int[]{MotionEvent.ACTION_DOWN,MotionEvent.ACTION_UP}){
   MotionEvent event=MotionEvent.obtain(down,SystemClock.uptimeMillis(),action,coordinates[0],coordinates[1],0);event.setSource(InputDevice.SOURCE_TOUCHSCREEN);
   try{assertTrue("Android accepted Back touch",InstrumentationRegistry.getInstrumentation().getUiAutomation().injectInputEvent(event,true));}finally{event.recycle();}
  }
  until("!document.querySelector('button[aria-label=\"Back to Settings\"]')");
 }
 private void aboutShowsThisDevice()throws Exception{
  click("About");
  until("document.querySelector('[data-screen]').textContent.includes("+JSONObject.quote(Build.MODEL)+") && document.querySelector('[data-screen]').textContent.includes("+JSONObject.quote(Build.DISPLAY)+")");
  assertEquals("No prototype hardware attestation", "false",WebViewTestDriver.evaluate("document.querySelector('[data-screen]').textContent.includes('4.2 · attested')"));
  assertEquals("No prototype local model", "false",WebViewTestDriver.evaluate("document.querySelector('[data-screen]').textContent.includes('Core 7B')"));
  tapBack();
 }
 @Test public void realBatteryAndDeviceInfoRefreshAfterNativeSettingsReturn()throws Exception{
  assertTrue("Battery fixtures require an emulator or explicitly admitted owned Cuttlefish",
   DisposableFixtureAdmission.allows(Build.FINGERPRINT, Build.MODEL, Build.HARDWARE, Build.DEVICE,
    InstrumentationRegistry.getArguments().getString("ownedCuttlefishFingerprint")));
  Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
  AtomicReference<String> action=new AtomicReference<>();
  Instrumentation.ActivityMonitor monitor=new Instrumentation.ActivityMonitor(){
   @Override public Instrumentation.ActivityResult onStartActivity(Intent intent){action.set(intent.getAction());return null;}
  };
  // Removing a monitor that was never added throws and would hide the first failure.
  boolean monitored=false;
  try{
   shell("dumpsys battery set level 37");
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    until("document.documentElement.dataset.activeView");
    WebViewTestDriver.evaluate(AppNavigation.request("Settings"));until(AppNavigation.selected("Settings"));AppNavigation.declineStartupAccess();
    if(!BuildConfig.IS_LAUNCHER){
     // The standalone app is not the phone's system shell: Settings lists no system-only rows
     // (settings-adapter systemOnly), so the battery handoff exists in the launcher flavor only.
     until("document.querySelector('button[aria-label=\"About\"]')");
     for(String systemOnly:new String[]{"Wi-Fi","Bluetooth","Mobile data","Battery","Sound & vibration"})assertEquals("Standalone Settings omits "+systemOnly,"false",WebViewTestDriver.evaluate("Boolean(document.querySelector('button[aria-label='+"+JSONObject.quote(JSONObject.quote(systemOnly))+"+']'))"));
     assertEquals("Standalone Settings shows no battery percentage","false",WebViewTestDriver.evaluate("document.querySelector('[data-screen]').textContent.includes('37%')"));
     aboutShowsThisDevice();return;
    }
    click("Battery");until("document.querySelector('[data-screen]').textContent.includes('37%')");
    assertEquals("No invented lifetime estimate", "false",WebViewTestDriver.evaluate("document.querySelector('[data-screen]').textContent.includes('About 1 day 6 hr')"));
    instrumentation.addMonitor(monitor);monitored=true;
    click("Manage battery in Android");
    long end=SystemClock.elapsedRealtime()+15000;boolean foreground=false;
    while(SystemClock.elapsedRealtime()<end){foreground=shell("dumpsys activity activities").lines().anyMatch(line->line.contains("topResumedActivity")&&line.contains("com.android.settings"));if(foreground)break;SystemClock.sleep(100);}
    assertTrue("Real Android settings is foreground",foreground);assertEquals(Settings.ACTION_BATTERY_SAVER_SETTINGS,action.get());
    shell("dumpsys battery set level 62");
    instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
    until("document.querySelector('[data-screen]').textContent.includes('62%') && !document.querySelector('[data-screen]').textContent.includes('37%')");
    tapBack();aboutShowsThisDevice();
   }
  }finally{if(monitored)instrumentation.removeMonitor(monitor);shell("dumpsys battery reset");}
 }
}
