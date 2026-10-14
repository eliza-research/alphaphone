package ai.elizaresearch.alphaphone;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.LauncherApps;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.UserHandle;
import android.util.Base64;
import ai.eliza.plugins.system.SystemLauncherApps;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;

/** Installed-app discovery and launch for Alpha Home. Resolution never launches; a launch
 * or default-handler hand-off happens only from an explicit renderer call. */
@CapacitorPlugin(name = "DeviceApps")
public class DeviceAppsPlugin extends Plugin {
 /** Launcher icon edge in pixels; small enough that a full drawer stays well under 1 MB. */
 static final int ICON_PX = 96;

 @PluginMethod public void buildInfo(PluginCall call) {
  JSObject value = new JSObject(); value.put("launcher", BuildConfig.IS_LAUNCHER); value.put("version", BuildConfig.VERSION_NAME); call.resolve(value);
 }
 /** Intent extra set when the Activity was opened for ACTION_ASSIST (AlphaAssistActivity). */
 static final String EXTRA_ASSISTANT = "alpha.assistant";
 /** How this Activity was opened: `assistant` is true only for the ACTION_ASSIST entry. */
 @PluginMethod public void launchInfo(PluginCall call) {
  android.app.Activity activity = getActivity();
  Intent intent = activity == null ? null : activity.getIntent();
  boolean assistant = intent != null && (Intent.ACTION_ASSIST.equals(intent.getAction()) || intent.getBooleanExtra(EXTRA_ASSISTANT, false));
  JSObject value = new JSObject(); value.put("assistant", assistant); call.resolve(value);
 }
 @PluginMethod public void localeInfo(PluginCall call) {
  JSObject value = new JSObject();
  value.put("locale", java.util.Locale.getDefault().toLanguageTag());
  value.put("hour24", android.text.format.DateFormat.is24HourFormat(getContext()));
  call.resolve(value);
 }
 /** One entry per launcher activity, across the current user and its profiles. Legacy callers that
  * launch by package only still work; the drawer launches the exact listed component. */
 @PluginMethod public void list(PluginCall call) {
  boolean icons = Boolean.TRUE.equals(call.getBoolean("icons", false));
  PackageManager packages = getContext().getPackageManager();
  JSArray apps = new JSArray();
  try {
   for (LauncherLibrary.Entry item : LauncherLibrary.list(getContext())) {
    JSObject app = new JSObject(); app.put("packageName", item.packageName); app.put("activityName", item.activityName); app.put("label", item.label);
    if (item.user != null) { app.put("user", item.user); app.put("profile", item.profile); app.put("locked", item.locked); }
    if (icons) { String icon = iconFor(item.icon(packages)); if (icon == null && item.user == null) icon = iconFor(packages, item.packageName); if (icon != null) app.put("icon", icon); }
    apps.put(app);
   }
  } catch (RuntimeException error) {
   // An unreadable inventory is reported, never a partial list and never a crash of Home.
   call.reject("Installed apps could not be read", LauncherLibrary.FAILED, error); return;
  }
  JSObject result = new JSObject(); result.put("apps", apps); call.resolve(result);
 }
 /** A component or profile given as anything but text is refused: read as absent it would open the
  * package's default activity, or the personal copy of a work app, instead of the entry asked for. */
 static boolean malformed(JSObject data, String key) {
  return data != null && data.has(key) && !data.isNull(key) && !(data.opt(key) instanceof String);
 }
 @PluginMethod public void launch(PluginCall call) {
  if (malformed(call.getData(), "activityName") || malformed(call.getData(), "user")) { call.reject("Choose an installed app"); return; }
  String name = call.getString("packageName"), activityName = call.getString("activityName"), user = call.getString("user");
  if (activityName != null || user != null) { launchComponent(call, name, activityName, user); return; }
  Intent intent;
  try { intent = SystemLauncherApps.launchIntent(getContext(), name); }
  catch (IllegalArgumentException error) { call.reject("Choose an installed app"); return; }
  if (intent == null) { LauncherLibrary.Refusal why = LauncherLibrary.explain(getContext().getPackageManager(), name); call.reject(why.getMessage(), why.code); return; }
  try { getActivity().startActivity(intent); call.resolve(); }
  catch (RuntimeException error) { call.reject("App could not be opened", LauncherLibrary.FAILED, error); }
 }
 /** Opens exactly the listed component in its profile, re-resolved now; a stale entry is refused. */
 private void launchComponent(PluginCall call, String packageName, String activityName, String user) {
  LauncherLibrary.Target target;
  try { target = LauncherLibrary.resolve(getContext(), packageName, activityName, user); }
  catch (IllegalArgumentException error) { call.reject("Choose an installed app"); return; }
  catch (LauncherLibrary.Refusal refusal) { call.reject(refusal.getMessage(), refusal.code); return; }
  catch (RuntimeException error) { call.reject("App could not be opened", LauncherLibrary.FAILED, error); return; }
  try {
   if (target.user == null) getActivity().startActivity(LauncherLibrary.launchIntent(target.component));
   else getContext().getSystemService(LauncherApps.class).startMainActivity(target.component, target.user, null, null);
   call.resolve();
  } catch (RuntimeException error) {
   // Gone between resolve and start, refused by Android, or no Activity to start from.
   call.reject("App could not be opened", LauncherLibrary.FAILED, error);
  }
 }

 // Installs, removals, enable/disable and profile pause/unlock happen outside Alpha. The renderer
 // is told that something changed and re-reads the list itself; no inventory is pushed.
 private LauncherApps.Callback packageCallback;
 private BroadcastReceiver profileReceiver;
 @Override public void load() {
  Context context = getContext();
  LauncherApps launcher = context.getSystemService(LauncherApps.class);
  if (launcher != null) {
   packageCallback = new LauncherApps.Callback() {
    @Override public void onPackageRemoved(String packageName, UserHandle user) { appsChanged(packageName, "removed"); }
    @Override public void onPackageAdded(String packageName, UserHandle user) { appsChanged(packageName, "added"); }
    @Override public void onPackageChanged(String packageName, UserHandle user) { appsChanged(packageName, "changed"); }
    @Override public void onPackagesAvailable(String[] packageNames, UserHandle user, boolean replacing) { appsChanged(null, "available"); }
    @Override public void onPackagesUnavailable(String[] packageNames, UserHandle user, boolean replacing) { appsChanged(null, "unavailable"); }
    @Override public void onPackagesSuspended(String[] packageNames, UserHandle user) { appsChanged(null, "suspended"); }
    @Override public void onPackagesUnsuspended(String[] packageNames, UserHandle user) { appsChanged(null, "unsuspended"); }
   };
   try { launcher.registerCallback(packageCallback, new Handler(Looper.getMainLooper())); }
   catch (RuntimeException error) { packageCallback = null; }
  }
  IntentFilter profiles = new IntentFilter();
  profiles.addAction(Intent.ACTION_MANAGED_PROFILE_AVAILABLE); profiles.addAction(Intent.ACTION_MANAGED_PROFILE_UNAVAILABLE);
  profiles.addAction(Intent.ACTION_MANAGED_PROFILE_UNLOCKED); profiles.addAction(Intent.ACTION_MANAGED_PROFILE_ADDED); profiles.addAction(Intent.ACTION_MANAGED_PROFILE_REMOVED);
  // Other profile kinds (clone, private) announce themselves with these on newer Android; older releases never send them.
  profiles.addAction(Intent.ACTION_PROFILE_ACCESSIBLE); profiles.addAction(Intent.ACTION_PROFILE_INACCESSIBLE);
  profiles.addAction(Intent.ACTION_PROFILE_ADDED); profiles.addAction(Intent.ACTION_PROFILE_REMOVED);
  profiles.addAction(Intent.ACTION_PROFILE_AVAILABLE); profiles.addAction(Intent.ACTION_PROFILE_UNAVAILABLE);
  profileReceiver = new BroadcastReceiver() { @Override public void onReceive(Context context, Intent intent) { appsChanged(null, "profile"); } };
  try {
   // System profile broadcasts only; no other app can send to this receiver.
   androidx.core.content.ContextCompat.registerReceiver(context, profileReceiver, profiles, androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED);
  } catch (RuntimeException error) { profileReceiver = null; }
 }
 @Override protected void handleOnDestroy() {
  Context context = getContext();
  LauncherApps launcher = context.getSystemService(LauncherApps.class);
  if (launcher != null && packageCallback != null) try { launcher.unregisterCallback(packageCallback); } catch (RuntimeException ignored) {}
  if (profileReceiver != null) try { context.unregisterReceiver(profileReceiver); } catch (RuntimeException ignored) {}
  packageCallback = null; profileReceiver = null;
 }
 private void appsChanged(String packageName, String reason) {
  JSObject change = new JSObject(); change.put("reason", reason);
  // Alpha's own updates never change the list it shows.
  if (packageName != null) { if (packageName.equals(getContext().getPackageName())) return; change.put("packageName", packageName); }
  notifyListeners("appsChanged", change);
 }
 @PluginMethod public void resolveDefault(PluginCall call) {
  String role = call.getString("role");
  Intent intent = roleIntent(role);
  if (intent == null) { call.reject("Choose a supported default app"); return; }
  PackageManager packages = getContext().getPackageManager();
  JSObject value = new JSObject(); value.put("role", role);
  DefaultHandler handler = resolve(packages, intent, getContext().getPackageName());
  value.put("available", handler.available);
  if (handler.packageName != null) {
   value.put("packageName", handler.packageName);
   value.put("label", handler.label);
   String icon = iconFor(packages, handler.packageName);
   if (icon != null) value.put("icon", icon);
  }
  call.resolve(value);
 }
 @PluginMethod public void openDefault(PluginCall call) {
  Intent intent = roleIntent(call.getString("role"));
  if (intent == null) { call.reject("Choose a supported default app"); return; }
  if (!resolve(getContext().getPackageManager(), intent, getContext().getPackageName()).available) { call.reject("No app on this phone handles this"); return; }
  try { getActivity().startActivity(intent); call.resolve(); }
  catch (android.content.ActivityNotFoundException | SecurityException error) { call.reject("App could not be opened", error); }
 }

 /** The role's hand-off intent carries no number, contact or other data. The dial hand-off exists
  * only in the launcher build (the HOME role keeps a path to the stock dialer and emergency calls);
  * a standalone APK shows no Phone entry (owner decision P-36). */
 static Intent roleIntent(String role) {
  if ("dial".equals(role) && BuildConfig.IS_LAUNCHER) return new Intent(Intent.ACTION_DIAL, Uri.parse("tel:"));
  return null;
 }

 static final class DefaultHandler {
  final boolean available; final String packageName; final String label;
  DefaultHandler(boolean available, String packageName, String label) { this.available = available; this.packageName = packageName; this.label = label; }
 }
 /** A chooser (several handlers, no default) is available but has no single package. Alpha itself
  * never counts as the handler. */
 static DefaultHandler resolve(PackageManager packages, Intent intent, String self) {
  ResolveInfo preferred = packages.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY);
  java.util.List<ResolveInfo> all = packages.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY);
  boolean other = false;
  for (ResolveInfo item : all) if (item.activityInfo != null && item.activityInfo.exported && !self.equals(item.activityInfo.packageName)) other = true;
  if (preferred == null || preferred.activityInfo == null || !other) return new DefaultHandler(false, null, null);
  String name = preferred.activityInfo.packageName;
  boolean single = false;
  for (ResolveInfo item : all) if (item.activityInfo != null && name.equals(item.activityInfo.packageName)) single = true;
  if (!single || self.equals(name)) return new DefaultHandler(true, null, null);
  CharSequence label = preferred.loadLabel(packages);
  return new DefaultHandler(true, name, label == null ? name : label.toString());
 }

 static String iconFor(PackageManager packages, String packageName) {
  try { return iconFor(packages.getApplicationIcon(packageName)); }
  catch (PackageManager.NameNotFoundException | RuntimeException error) { return null; }
 }
 /** The drawable as a small PNG data URL, or null when it is missing or cannot be rendered. */
 static String iconFor(Drawable source) {
  if (source == null) return null;
  Bitmap bitmap = null;
  try {
   // A copy: the package manager may share one Drawable, and its bounds must not change for others.
   Drawable drawable = source.mutate();
   bitmap = Bitmap.createBitmap(ICON_PX, ICON_PX, Bitmap.Config.ARGB_8888);
   Canvas canvas = new Canvas(bitmap);
   drawable.setBounds(0, 0, ICON_PX, ICON_PX);
   drawable.draw(canvas);
   ByteArrayOutputStream out = new ByteArrayOutputStream();
   if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)) return null;
   return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
  } catch (RuntimeException error) {
   // A removed package or an unrenderable drawable keeps its label-only entry.
   return null;
  } finally {
   if (bitmap != null) bitmap.recycle();
  }
 }
}
