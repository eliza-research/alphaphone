package ai.elizaresearch.alphaphone;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.*;

@CapacitorPlugin(name = "DeviceApps")
public class DeviceAppsPlugin extends Plugin {
 @PluginMethod public void buildInfo(PluginCall call) {
  JSObject value = new JSObject(); value.put("launcher", BuildConfig.IS_LAUNCHER); value.put("version", BuildConfig.VERSION_NAME); call.resolve(value);
 }
 @PluginMethod public void list(PluginCall call) {
  Intent query = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
  List<ResolveInfo> resolved = getContext().getPackageManager().queryIntentActivities(query, 0);
  resolved.sort(new ResolveInfo.DisplayNameComparator(getContext().getPackageManager()));
  Set<String> seen = new HashSet<>(); JSArray apps = new JSArray();
  for (ResolveInfo item : resolved) {
   String name = item.activityInfo.packageName;
   if (!item.activityInfo.exported || name.equals(getContext().getPackageName()) || !seen.add(name)) continue;
   JSObject app = new JSObject(); app.put("packageName", name); app.put("label", item.loadLabel(getContext().getPackageManager()).toString()); apps.put(app);
  }
  JSObject result = new JSObject(); result.put("apps", apps); call.resolve(result);
 }
 @PluginMethod public void launch(PluginCall call) {
  if(AlphaKioskAdmin.enabled(getContext())){call.reject("External apps are disabled while launcher lock is enabled");return;}
  String name = call.getString("packageName");
  if (name == null || name.equals(getContext().getPackageName())) { call.reject("Choose an installed app"); return; }
  Intent intent = getContext().getPackageManager().getLaunchIntentForPackage(name);
  if (intent == null) { call.reject("App is unavailable"); return; }
  try { getActivity().startActivity(intent); call.resolve(); }
  catch (android.content.ActivityNotFoundException | SecurityException error) { call.reject("App could not be opened", error); }
 }
}
