package ai.elizaresearch.alphaphone;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import android.os.SystemClock;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Read-only device facts and an allowlisted handoff to Android-owned settings. */
@CapacitorPlugin(name="AlphaDevice")
public final class AlphaDevicePlugin extends Plugin {
 static int textScalePercent(Context context){int value=context.getSharedPreferences("alpha-appearance",Context.MODE_PRIVATE).getInt("text-scale-percent",100);return value>=75&&value<=150?value:100;}
 static int effectiveTextZoom(Context context,int percent){float scale=context.getResources().getConfiguration().fontScale;if(!Float.isFinite(scale)||scale<=0)scale=1;return Math.max(1,Math.round(percent*scale));}
 static void applyTextScale(MainActivity activity){activity.getBridge().getWebView().getSettings().setTextZoom(effectiveTextZoom(activity,textScalePercent(activity)));}
 @PluginMethod public void setTextScale(PluginCall call){
  Integer percent=call.getInt("percent");if(percent==null||percent<75||percent>150){call.reject("Text size must be between75 and150 percent");return;}
  getActivity().runOnUiThread(()->{
   if(!(getActivity() instanceof MainActivity)||getActivity().isFinishing()){call.reject("Alpha view is unavailable");return;}
   if(!getContext().getSharedPreferences("alpha-appearance",Context.MODE_PRIVATE).edit().putInt("text-scale-percent",percent).commit()){call.reject("Text size could not be saved");return;}
   applyTextScale((MainActivity)getActivity());JSObject out=new JSObject();out.put("textScalePercent",textScalePercent(getContext()));out.put("effectiveTextZoom",getBridge().getWebView().getSettings().getTextZoom());call.resolve(out);
  });
 }
 @PluginMethod public void snapshot(PluginCall call) {
  JSObject out=new JSObject();
  AlphaManagedDevice.snapshot(getContext(),out);
  Intent battery=getContext().registerReceiver(null,new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
  if(battery!=null){
   int level=battery.getIntExtra(BatteryManager.EXTRA_LEVEL,-1),scale=battery.getIntExtra(BatteryManager.EXTRA_SCALE,-1);
   if(level>=0&&scale>0)out.put("batteryPercent",Math.max(0,Math.min(100,Math.round(level*100f/scale))));
   int status=battery.getIntExtra(BatteryManager.EXTRA_STATUS,-1);
   out.put("charging",status==BatteryManager.BATTERY_STATUS_CHARGING||status==BatteryManager.BATTERY_STATUS_FULL);
  }
  PowerManager power=(PowerManager)getContext().getSystemService(Context.POWER_SERVICE);
  if(power!=null)out.put("powerSave",power.isPowerSaveMode());
  ConnectivityManager connectivity=(ConnectivityManager)getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
  NetworkCapabilities network=connectivity==null?null:connectivity.getNetworkCapabilities(connectivity.getActiveNetwork());
  out.put("wifiActive",network!=null&&network.hasTransport(NetworkCapabilities.TRANSPORT_WIFI));
  out.put("cellularActive",network!=null&&network.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR));
  out.put("internetValidated",network!=null&&network.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED));
  out.put("model",Build.MODEL);out.put("manufacturer",Build.MANUFACTURER);
  out.put("androidRelease",Build.VERSION.RELEASE);out.put("securityPatch",Build.VERSION.SECURITY_PATCH);
  out.put("build",Build.DISPLAY);out.put("appVersion",BuildConfig.VERSION_NAME);
  out.put("uptimeMs",SystemClock.elapsedRealtime());out.put("readAt",System.currentTimeMillis());
  out.put("textScalePercent",textScalePercent(getContext()));out.put("effectiveTextZoom",effectiveTextZoom(getContext(),textScalePercent(getContext())));
  NotificationManager notifications=(NotificationManager)getContext().getSystemService(Context.NOTIFICATION_SERVICE);
  out.put("notificationsEnabled",notifications!=null&&notifications.areNotificationsEnabled());
  JSObject grants=new JSObject();
  boolean fine=getContext().checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED,coarse=getContext().checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED;
  out.put("locationAccess",fine?"precise":coarse?"approximate":"denied");
  String[][] permissions={{"Microphone",Manifest.permission.RECORD_AUDIO},{"Location",Manifest.permission.ACCESS_FINE_LOCATION},{"Camera",Manifest.permission.CAMERA},{"Contacts",Manifest.permission.READ_CONTACTS}};
  for(String[] p:permissions)grants.put(p[0],getContext().checkSelfPermission(p[1])==PackageManager.PERMISSION_GRANTED);
  grants.put("Location",fine||coarse);out.put("permissions",grants);
  out.put("passwordProvider",PasswordProviderSupport.status(getContext()));call.resolve(out);
 }
 @PluginMethod public void setManagedSetting(PluginCall call) { AlphaManagedDevice.change(getContext(),call); }
 @PluginMethod public void openPasswordProvider(PluginCall call) {
  String action=call.getString("action","");
  getActivity().runOnUiThread(()->{
   try {
    Intent target=PasswordProviderSupport.intent(getContext(),action);
    String destination=Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE.equals(target.getAction())?"provider-picker":"external";
    try { getActivity().startActivity(target); }
    catch(android.content.ActivityNotFoundException missing) {
     if(!"settings".equals(action)||!Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE.equals(target.getAction()))throw missing;
     getActivity().startActivity(new Intent(Settings.ACTION_SETTINGS));destination="system-settings";
    }
    if(Settings.ACTION_SETTINGS.equals(target.getAction()))destination="system-settings";
    JSObject out=new JSObject();out.put("status","opened");out.put("destination",destination);call.resolve(out);
   } catch(RuntimeException unavailable) { call.reject("Password provider setup could not be opened. No provider change is confirmed."); }
  });
 }
 @PluginMethod public void openSettings(PluginCall call) {
  if(AlphaKioskAdmin.enabled(getContext())){call.reject("Use Alpha device controls while launcher lock is enabled");return;}
  String page=call.getString("page","");String action;
  switch(page){
   case "accounts":action=Settings.ACTION_SYNC_SETTINGS;break;
   case "wifi":action=Settings.ACTION_WIFI_SETTINGS;break;
   case "bluetooth":action=Settings.ACTION_BLUETOOTH_SETTINGS;break;
   case "mobile":action=Settings.ACTION_WIRELESS_SETTINGS;break;
   case "display":action=Settings.ACTION_DISPLAY_SETTINGS;break;
   case "sound":action=Settings.ACTION_SOUND_SETTINGS;break;
   case "battery":action=Settings.ACTION_BATTERY_SAVER_SETTINGS;break;
   case "about":action=Settings.ACTION_DEVICE_INFO_SETTINGS;break;
   case "developer":action=Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS;break;
   case "notifications":action=Settings.ACTION_APP_NOTIFICATION_SETTINGS;break;
   case "privacy":action=Settings.ACTION_APPLICATION_DETAILS_SETTINGS;break;
   default:call.reject("Unsupported settings page");return;
  }
  Intent intent=new Intent(action);
  if(page.equals("privacy"))intent.setData(Uri.parse("package:"+getContext().getPackageName()));
  if(page.equals("notifications"))intent.putExtra(Settings.EXTRA_APP_PACKAGE,getContext().getPackageName());
  getActivity().runOnUiThread(()->{
   try{getActivity().startActivity(intent);JSObject out=new JSObject();out.put("status","opened");call.resolve(out);}
   catch(RuntimeException error){call.reject("This Android settings page is unavailable");}
  });
 }
}
