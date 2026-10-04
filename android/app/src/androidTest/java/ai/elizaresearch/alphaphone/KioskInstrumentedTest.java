package ai.elizaresearch.alphaphone;

import android.app.ActivityManager;
import android.content.Context;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Opt-in checks on the actually enrolled dedicated image. No system-setting escape expected. */
@RunWith(AndroidJUnit4.class)
public final class KioskInstrumentedTest {
 private String js(String code)throws Exception{return WebViewTestDriver.evaluate(code);}
 private void until(String code)throws Exception{for(int i=0;i<300;i++){if("true".equals(js("Boolean("+code+")")))return;SystemClock.sleep(100);}fail(code);}
 private void click(String label)throws Exception{String q="[...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith("+JSONObject.quote(label)+")&&e.getClientRects().length)";until(q);js("("+q+").click()");}
 @Test public void lockedShellOwnsStatusSettingsAndTheme()throws Exception{
  org.junit.Assume.assumeTrue("Explicit kiosk lane only","1".equals(InstrumentationRegistry.getArguments().getString("kiosk")));
  Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();assertTrue(AlphaKioskAdmin.enabled(c));
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   try {
   AppNavigation.liveMode();until("document.querySelector('.alpha-device-status')?.textContent.includes('%')");
   assertEquals(ActivityManager.LOCK_TASK_MODE_LOCKED,c.getSystemService(ActivityManager.class).getLockTaskModeState());
   js("window.__kioskRejected=false;Capacitor.Plugins.DeviceApps.launch({packageName:'com.android.settings'}).catch(()=>window.__kioskRejected=true)");until("window.__kioskRejected");
   js("window.__invalidControlRejected=false;Capacitor.Plugins.AlphaDevice.setManagedSetting({field:'alpha_launcher_lock',value:0}).catch(()=>window.__invalidControlRejected=true)");until("window.__invalidControlRejected");
   js(AppNavigation.request("Settings"));until(AppNavigation.selected("Settings"));click("Display");click("Dark");
   until("localStorage.getItem('alpha.appearance.v1')==='dark'");
   until("getComputedStyle(document.querySelector('.alpha-device-status')).backgroundColor==='rgb(0, 0, 0)'");
   click("Light");until("localStorage.getItem('alpha.appearance.v1')==='light'");
   until("getComputedStyle(document.querySelector('.alpha-device-status')).backgroundColor==='rgb(255, 255, 255)'");
   click("Manage brightness");until("document.querySelector('dialog[open] input[aria-label=Brightness]')");
   assertEquals(ActivityManager.LOCK_TASK_MODE_LOCKED,c.getSystemService(ActivityManager.class).getLockTaskModeState());
   int brightness=android.provider.Settings.System.getInt(c.getContentResolver(),android.provider.Settings.System.SCREEN_BRIGHTNESS);
   try {
    js("(()=>{const e=document.querySelector('dialog[open] input[aria-label=Brightness]');e.value='50';e.dispatchEvent(new Event('change',{bubbles:true}));})()");
    for(int i=0;i<100&&Math.abs(android.provider.Settings.System.getInt(c.getContentResolver(),android.provider.Settings.System.SCREEN_BRIGHTNESS)-128)>1;i++)SystemClock.sleep(100);
    assertTrue("Alpha slider changes the actual Android setting",Math.abs(android.provider.Settings.System.getInt(c.getContentResolver(),android.provider.Settings.System.SCREEN_BRIGHTNESS)-128)<=1);
   } finally { c.getSystemService(android.app.admin.DevicePolicyManager.class).setSystemSetting(AlphaKioskAdmin.component(c),android.provider.Settings.System.SCREEN_BRIGHTNESS,String.valueOf(brightness)); }
   click("Done");
   } finally { WebViewTestDriver.withActivity(MainActivity.class,activity->activity.stopLockTask()); }
  }
 }
}
