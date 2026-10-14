package ai.elizaresearch.alphaphone;

import android.app.UiAutomation;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.ArrayDeque;

/**
 * Android's own notification shade, as instrumented tests observe it (#416, #417). Alpha draws no
 * shade: its notices are Android notifications and are opened, tapped and cleared in SystemUI.
 * The shade counts as open while SystemUI holds the active window, the same signal
 * RealClockInstrumentedTest uses for an expanded shade (measured on API 35/36 emulators only).
 */
final class AndroidShade {
 private AndroidShade() {}
 static final String SYSTEM_UI = "com.android.systemui";
 /** The page draws no Alpha notification shade at all (no stand-in outside a browser). */
 static final String ALPHA_SHADE_ABSENT = "document.querySelector('[data-alpha-layer=\"shade\"]')===null";

 private static UiAutomation ui() { return InstrumentationRegistry.getInstrumentation().getUiAutomation(); }
 private static boolean systemUi(AccessibilityNodeInfo node) { return node != null && SYSTEM_UI.contentEquals(node.getPackageName() == null ? "" : node.getPackageName()); }

 static boolean isOpen() { return systemUi(ui().getRootInActiveWindow()); }

 /** Polls for the expanded shade; false when it did not open within the time given. */
 static boolean waitOpen(long millis) {
  long end = SystemClock.uptimeMillis() + millis;
  do { if (isOpen()) return true; SystemClock.sleep(100); } while (SystemClock.uptimeMillis() < end);
  return false;
 }

 /** Polls until SystemUI no longer holds the active window. */
 static boolean waitClosed(long millis) {
  long end = SystemClock.uptimeMillis() + millis;
  do { if (!isOpen()) return true; SystemClock.sleep(100); } while (SystemClock.uptimeMillis() < end);
  return false;
 }

 /** Opens the shade the way a person would without Alpha: Android's own global action. */
 static boolean openWithoutAlpha() {
  return ui().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS) && waitOpen(5000);
 }

 /** Collapses the shade (Back, then the shell's statusbar command) and waits for Alpha's window. */
 static void collapse() throws Exception {
  for (int attempt = 0; attempt < 3 && isOpen(); attempt++) {
   ui().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);
   SystemClock.sleep(250);
  }
  if (isOpen()) ui().executeShellCommand("cmd statusbar collapse").close();
  if (!waitClosed(5000)) throw new AssertionError("Android's notification shade did not close");
 }

 /** The first visible SystemUI node whose text is exactly this, or null. */
 static AccessibilityNodeInfo text(String value) {
  AccessibilityNodeInfo root = ui().getRootInActiveWindow();
  if (!systemUi(root)) return null;
  ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
  queue.add(root);
  for (int seen = 0; !queue.isEmpty() && seen < 2000; seen++) {
   AccessibilityNodeInfo node = queue.remove();
   if (node.isVisibleToUser() && value.contentEquals(node.getText() == null ? "" : node.getText())) return node;
   for (int i = 0; i < node.getChildCount(); i++) { AccessibilityNodeInfo child = node.getChild(i); if (child != null) queue.add(child); }
  }
  return null;
 }

 static AccessibilityNodeInfo waitText(String value, long millis) {
  long end = SystemClock.uptimeMillis() + millis;
  do { AccessibilityNodeInfo found = text(value); if (found != null) return found; SystemClock.sleep(150); } while (SystemClock.uptimeMillis() < end);
  return null;
 }

 /** Taps the notification row that shows this text, as a person tapping it in the shade. */
 static boolean tap(AccessibilityNodeInfo node) {
  for (int i = 0; node != null && i < 8; i++, node = node.getParent())
   if (node.isClickable() && node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true;
  return false;
 }
}
