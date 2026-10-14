package ai.elizaresearch.alphaphone;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Rect;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import java.util.Arrays;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Android's shade is the one notification and quick-settings surface (#416, #417). On the launcher
 * flavor launcher Home asks Android to open it (button and pull on empty Home, EXPAND_STATUS_BAR);
 * the standalone app is an ordinary app and never asks. Alpha draws no shade of its own.
 *
 * Emulator evidence when run; no run of this class is recorded yet. It is not AOSP-image, Pixel 10a
 * or TalkBack acceptance.
 */
@RunWith(AndroidJUnit4.class)
public class SystemShadeInstrumentedTest {
 private static String js(String code) throws Exception { return WebViewTestDriver.evaluate(code); }
 private static void until(String code) throws Exception {
  for (int i = 0; i < 200; i++) { if ("true".equals(js("Boolean(" + code + ")"))) return; SystemClock.sleep(100); }
  fail("System shade condition: " + code);
 }
 private static Context context() { return InstrumentationRegistry.getInstrumentation().getTargetContext(); }

 /** A status bar stand-in with Android's method name, for the outcome mapping only. */
 public static final class FakeStatusBar { public int calls; public void expandNotificationsPanel() { calls++; } }
 public static final class RefusingStatusBar { public void expandNotificationsPanel() { throw new SecurityException("refused"); } }
 private static SystemShade.Platform platform(boolean granted, Object service) {
  return new SystemShade.Platform() {
   @Override public boolean granted(String permission) { return granted && SystemShade.PERMISSION.equals(permission); }
   @Override public Object statusBar() { return service; }
  };
 }

 @Test public void everyOutcomeIsReportedAndOnlyAnAcceptedCallIsOpened() {
  FakeStatusBar bar = new FakeStatusBar();
  assertEquals(SystemShade.STANDALONE, SystemShade.expand(platform(true, bar), false));
  assertEquals("The standalone app never reaches the status bar", 0, bar.calls);
  assertEquals(SystemShade.PERMISSION_MISSING, SystemShade.expand(platform(false, bar), true));
  assertEquals(0, bar.calls);
  assertEquals(SystemShade.UNSUPPORTED, SystemShade.expand(platform(true, null), true));
  assertEquals("A service without the method", SystemShade.UNSUPPORTED, SystemShade.expand(platform(true, new Object()), true));
  assertEquals("A refused call", SystemShade.UNSUPPORTED, SystemShade.expand(platform(true, new RefusingStatusBar()), true));
  assertEquals(SystemShade.OPENED, SystemShade.expand(platform(true, bar), true));
  assertEquals(1, bar.calls);
 }

 @Test public void onlyTheLauncherFlavorDeclaresAndHoldsExpandStatusBar() throws Exception {
  PackageInfo info = context().getPackageManager().getPackageInfo(context().getPackageName(), PackageManager.GET_PERMISSIONS);
  boolean declared = info.requestedPermissions != null && Arrays.asList(info.requestedPermissions).contains(SystemShade.PERMISSION);
  assertEquals("EXPAND_STATUS_BAR is declared by the launcher flavor only", BuildConfig.IS_LAUNCHER, declared);
  boolean granted = context().checkSelfPermission(SystemShade.PERMISSION) == PackageManager.PERMISSION_GRANTED;
  assertEquals("An install-time permission is held exactly when declared", BuildConfig.IS_LAUNCHER, granted);
 }

 @Test public void homeAsksAndroidForItsShadeOnTheLauncherOnly() throws Exception {
  UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
  try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
   AppNavigation.liveMode(); js(AppNavigation.request("Home")); until(AppNavigation.selected("Home")); AppNavigation.declineStartupAccess();
   until(AndroidShade.ALPHA_SHADE_ABSENT);
   // The plugin call the button makes, with Alpha in front.
   js("window.__shadeOutcome=null;Capacitor.Plugins.AlphaDevice.openNotificationShade().then(r=>window.__shadeOutcome=r.status,()=>window.__shadeOutcome='rejected')");
   until("window.__shadeOutcome!==null");
   String outcome = js("window.__shadeOutcome");
   if (BuildConfig.IS_LAUNCHER) {
    assertEquals("\"opened\"", outcome);
    assertTrue("Android expanded its shade", AndroidShade.waitOpen(5000));
    AndroidShade.collapse();
   } else {
    assertEquals("\"standalone\"", outcome);
    SystemClock.sleep(1000);
    assertFalse("The standalone app does not open Android's shade", AndroidShade.isOpen());
   }
   assertTrue(device.wait(androidx.test.uiautomator.Until.hasObject(By.pkg(BuildConfig.APPLICATION_ID).depth(0)), 5000));
   until(AppNavigation.selected("Home"));

   // A pull down on empty Home, whether Home fits the screen (vertical drags go to the page) or
   // overflows it (Alpha takes a downward drag at Home's top from the WebView). Never skipped:
   // which case ran is in the assertion message.
   js("document.querySelector('[data-alpha-layer=\"home\"]').scrollTop=0");
   String fits = js("document.querySelector('[data-alpha-layer=\"home\"]')?.dataset.alphaHomeFits??'unknown'");
   Rect web = device.findObject(By.clazz("android.webkit.WebView")).getVisibleBounds();
   int x = web.centerX(), y = web.top + Math.round(web.height() * 0.45f);
   device.swipe(x, y, x, y + web.height() / 3, 20);
   if (BuildConfig.IS_LAUNCHER) {
    assertTrue("A pull down on empty launcher Home opens Android's shade (Home fits: " + fits + ")", AndroidShade.waitOpen(5000));
    assertEquals("No Alpha panel behind it", "true", js(AndroidShade.ALPHA_SHADE_ABSENT));
    AndroidShade.collapse();
    until(AppNavigation.selected("Home"));
    // With the composer focused (the keyboard may be up) the same pull belongs to the text field.
    js("document.querySelector('textarea[data-alpha-composer]')?.focus()");
    until("document.activeElement?.matches?.('textarea[data-alpha-composer]')");
    device.swipe(x, web.top + Math.round(web.height() * 0.3f), x, web.top + Math.round(web.height() * 0.3f) + web.height() / 4, 20);
    SystemClock.sleep(1500);
    assertFalse("A pull with the composer focused does not open Android's shade", AndroidShade.isOpen());
   } else {
    SystemClock.sleep(1500);
    assertFalse("The standalone app answers no pull on Home with Android's shade", AndroidShade.isOpen());
   }
  } finally {
   if (AndroidShade.isOpen()) AndroidShade.collapse();
  }
 }
}
