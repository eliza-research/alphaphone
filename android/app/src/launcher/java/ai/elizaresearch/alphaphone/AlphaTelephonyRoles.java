package ai.elizaresearch.alphaphone;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;

/**
 * The dialer-role components exist in the launcher manifest disabled. They are enabled only while
 * {@link AlphaImageCapability} verifies the Alpha AOSP image, so a sideloaded launcher APK can never
 * be offered the dialer role, and an install that stops verifying (for example an image update that
 * drops the overlay) disables them again. The owner still chooses the role in Android's own dialog.
 */
final class AlphaTelephonyRoles {
 private AlphaTelephonyRoles() {}
 static final Class<?>[] DIALER = { AlphaInCallService.class, AlphaCallActivity.class, AlphaDialPadActivity.class };
 static void sync(Context context) {
  boolean image = AlphaImageCapability.verified(context);
  PackageManager packages = context.getPackageManager();
  int wanted = image ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DEFAULT;
  for (Class<?> component : DIALER) {
   ComponentName name = new ComponentName(context, component);
   try {
    if (packages.getComponentEnabledSetting(name) != wanted) packages.setComponentEnabledSetting(name, wanted, PackageManager.DONT_KILL_APP);
   } catch (RuntimeException refused) {
    android.util.Log.w("AlphaTelephonyRoles", "Dialer component state unchanged for " + component.getSimpleName());
   }
  }
 }
}
