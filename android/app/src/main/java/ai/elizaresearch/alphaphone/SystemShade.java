package ai.elizaresearch.alphaphone;

import android.content.Context;
import android.content.pm.PackageManager;

/**
 * Asks Android to expand its own notification shade (issues #416 and #417).
 *
 * Android's shade is the only notification and quick-settings surface: Alpha posts its notices as
 * ordinary Android notifications and draws no shade of its own. On the launcher flavor a downward
 * pull on empty Home, or the Home "Notifications" button, asks Android to open that shade, as
 * stock launchers do. The standalone app is an ordinary app and never asks.
 *
 * Android has no public SDK call for this. Launchers use StatusBarManager.expandNotificationsPanel,
 * which needs the install-time EXPAND_STATUS_BAR permission (declared only in the launcher
 * flavor's manifest) and is reached by reflection because the method is not in the public SDK.
 * Every way this can fail is reported as an outcome, never thrown and never reported as opened,
 * so the renderer can show its fallback: Android's own top-edge swipe still opens the shade.
 * The outcome "opened" means Android accepted the call; it is not a measurement that the shade
 * is on screen. Whether the call is accepted on the Pixel 10a AOSP image has not been measured.
 */
final class SystemShade {
 private SystemShade() {}

 static final String PERMISSION = "android.permission.EXPAND_STATUS_BAR";
 /** Android accepted the request to expand its notification shade. */
 static final String OPENED = "opened";
 /** The standalone app follows ordinary app behaviour and does not drive the system shade. */
 static final String STANDALONE = "standalone";
 /** The launcher flavor was installed without EXPAND_STATUS_BAR. */
 static final String PERMISSION_MISSING = "permission-missing";
 /** This Android build has no status bar service or refused the call. */
 static final String UNSUPPORTED = "unsupported";

 /** The status bar service Android registers under Context.STATUS_BAR_SERVICE (a hidden constant). */
 static final String STATUS_BAR_SERVICE = "statusbar";

 /** Small seam so the outcome mapping can be exercised without a device. */
 interface Platform {
  boolean granted(String permission);
  Object statusBar();
 }

 static String expand(Context context, boolean launcher) {
  return expand(new Platform() {
   @Override public boolean granted(String permission) { return context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED; }
   // The service name is a hidden Android constant; absence is handled as unsupported.
   @android.annotation.SuppressLint("WrongConstant")
   @Override public Object statusBar() { return context.getSystemService(STATUS_BAR_SERVICE); }
  }, launcher);
 }

 static String expand(Platform platform, boolean launcher) {
  if (!launcher) return STANDALONE;
  if (!platform.granted(PERMISSION)) return PERMISSION_MISSING;
  Object service;
  try { service = platform.statusBar(); }
  catch (RuntimeException unavailable) { return UNSUPPORTED; }
  if (service == null) return UNSUPPORTED;
  try {
   service.getClass().getMethod("expandNotificationsPanel").invoke(service);
   return OPENED;
  } catch (ReflectiveOperationException | RuntimeException refused) {
   // NoSuchMethodException on a build without the method, InvocationTargetException wrapping a
   // SecurityException when Android refuses it, or a hidden-API restriction.
   android.util.Log.w("AlphaShade", "Android did not expand its notification shade: " + refused.getClass().getSimpleName());
   return UNSUPPORTED;
  }
 }
}
