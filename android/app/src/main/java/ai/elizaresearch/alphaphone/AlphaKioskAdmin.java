package ai.elizaresearch.alphaphone;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.admin.DeviceAdminReceiver;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

/** Explicitly enrolled launcher only. Ordinary APK installation never enrolls a device. */
public final class AlphaKioskAdmin extends DeviceAdminReceiver {
 static ComponentName component(Context c) { return new ComponentName(c, AlphaKioskAdmin.class); }
 static boolean enrolled(Context c) {
  return BuildConfig.IS_LAUNCHER && c.getSystemService(DevicePolicyManager.class).isDeviceOwnerApp(c.getPackageName());
 }
 static boolean enabled(Context c) { return enrolled(c) && android.provider.Settings.Global.getInt(c.getContentResolver(),"alpha_launcher_lock",1)==1; }
 static void configure(Context c) {
  if (!enabled(c)) return;
  DevicePolicyManager d = c.getSystemService(DevicePolicyManager.class);
  ComponentName admin = component(c);
  d.setLockTaskPackages(admin, new String[]{c.getPackageName()});
  d.setLockTaskFeatures(admin, android.os.Build.VERSION.SDK_INT>=30 ? DevicePolicyManager.LOCK_TASK_FEATURE_BLOCK_ACTIVITY_START_IN_TASK : DevicePolicyManager.LOCK_TASK_FEATURE_NONE);
  d.setStatusBarDisabled(admin, true);
  IntentFilter home = new IntentFilter(Intent.ACTION_MAIN);
  home.addCategory(Intent.CATEGORY_HOME); home.addCategory(Intent.CATEGORY_DEFAULT);
  d.addPersistentPreferredActivity(admin, home, new ComponentName(c, MainActivity.class));
 }
 static void enter(Activity activity) {
  if (!enrolled(activity)) return;
  if (!enabled(activity)) {
   activity.stopLockTask();
   DevicePolicyManager d=activity.getSystemService(DevicePolicyManager.class);
   d.setLockTaskPackages(component(activity),new String[0]);
   d.setStatusBarDisabled(component(activity),false);
   WindowCompat.getInsetsController(activity.getWindow(),activity.getWindow().getDecorView()).show(WindowInsetsCompat.Type.systemBars());
   return;
  }
  configure(activity);
  WindowCompat.getInsetsController(activity.getWindow(), activity.getWindow().getDecorView()).hide(WindowInsetsCompat.Type.systemBars());
  if (activity.getSystemService(ActivityManager.class).getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_LOCKED) activity.startLockTask();
 }
 @Override public void onEnabled(Context c, Intent i) { configure(c); }
 @Override public void onReceive(Context c, Intent i) {
  super.onReceive(c,i);
  if (Intent.ACTION_BOOT_COMPLETED.equals(i.getAction()) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(i.getAction())) configure(c);
 }
}
