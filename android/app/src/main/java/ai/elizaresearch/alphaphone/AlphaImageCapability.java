package ai.elizaresearch.alphaphone;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;

/**
 * Whether this install is Alpha Phone inside the Alpha AOSP image (owner decision P-36, issue #420).
 *
 * Phone, Contacts and SMS exist only there. The launcher flavor alone is not proof: the same APK can
 * be sideloaded onto any phone. The canonical production image admission (system install, release build and product RRO)
 * is required first. Telephony additionally requires all of:
 * <ul>
 *  <li>the launcher build, without the test-mocks switch (a test-mocks build is never an image build,
 *      and scripts/stage-aosp.mjs refuses one);</li>
 *  <li>FLAG_SYSTEM: the APK is installed from a system partition (the image stages it as a product
 *      app), or is an update of that preinstalled app, which Android accepts only with the same
 *      signer. A sideloaded or Play-style install never has it;</li>
 *  <li>the image system feature {@code <package>.aosp_image}, version {@link #FEATURE_VERSION} or later,
 *      declared by the permissions file scripts/stage-aosp.mjs writes into the image product.</li>
 * </ul>
 * MainActivity registers {@link AlphaTelephonyPlugin} only when this holds, and every telephony method
 * checks it again. Nothing the renderer, a URL, saved state or an agent sends can turn it on.
 */
final class AlphaImageCapability {
 /** Version of the image capability contract carried by the feature declaration. */
 static final int FEATURE_VERSION = 1;
 static final String UNAVAILABLE = "Phone, Contacts and Messages are available only on the Alpha Phone system image.";
 private static Boolean verified;
 private AlphaImageCapability() {}

 static String featureName(String packageName) { return packageName + ".aosp_image"; }

 /** The decision over the observed facts. Every fact is required; none implies another. */
 static boolean admitted(boolean launcherBuild, boolean testMocks, boolean systemInstalled, boolean imageFeature) {
  return launcherBuild && !testMocks && systemInstalled && imageFeature;
 }

 /** Read once per process: installation flags and system features do not change while it runs. */
 static synchronized boolean verified(Context context) {
  if (!AlphaImageCapabilities.aospImage(context)) return false;
  if (verified == null) {
   Context app = context.getApplicationContext() == null ? context : context.getApplicationContext();
   ApplicationInfo info = app.getApplicationInfo();
   boolean system = info != null && (info.flags & ApplicationInfo.FLAG_SYSTEM) != 0;
   boolean feature;
   try {
    PackageManager packages = app.getPackageManager();
    feature = packages != null && packages.hasSystemFeature(featureName(app.getPackageName()), FEATURE_VERSION);
   } catch (RuntimeException unreadable) {
    feature = false;
   }
   verified = admitted(BuildConfig.IS_LAUNCHER, BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS, system, feature);
  }
  return verified;
 }
}
