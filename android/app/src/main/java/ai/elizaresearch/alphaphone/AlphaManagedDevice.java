package ai.elizaresearch.alphaphone;

import android.app.admin.DevicePolicyManager;
import android.bluetooth.BluetoothManager;
import android.content.Context;
import android.media.AudioManager;
import android.net.wifi.WifiConfiguration;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.provider.Settings;
import android.telephony.TelephonyManager;
import android.telephony.SignalStrength;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;

/** Small, typed device-owner surface; never executes arbitrary settings, shell or intents. */
final class AlphaManagedDevice {
 @SuppressWarnings("deprecation")
 static void snapshot(Context c, JSObject out) {
  boolean managed = AlphaKioskAdmin.enabled(c); out.put("kioskEnabled", managed);
  out.put("timeZone",java.util.TimeZone.getDefault().getID());
  out.put("developerEnabled",Settings.Global.getInt(c.getContentResolver(),Settings.Global.DEVELOPMENT_SETTINGS_ENABLED,0)==1);
  out.put("adbEnabled",Settings.Global.getInt(c.getContentResolver(),Settings.Global.ADB_ENABLED,0)==1);
  out.put("brightness",Math.round(Settings.System.getInt(c.getContentResolver(),Settings.System.SCREEN_BRIGHTNESS,128)*100f/255));
  AudioManager audio=c.getSystemService(AudioManager.class);
  for(String name:new String[]{"media","ring","alarm"}) {int stream=stream(name);out.put(name+"Volume",Math.round(audio.getStreamVolume(stream)*100f/audio.getStreamMaxVolume(stream)));}
  WifiManager wifi=c.getApplicationContext().getSystemService(WifiManager.class);
  out.put("wifiEnabled",wifi!=null&&wifi.isWifiEnabled());
  if(wifi!=null) {
   WifiInfo info=wifi.getConnectionInfo();
   if(info!=null&&info.getNetworkId()!=-1)out.put("wifiSignal",WifiManager.calculateSignalLevel(info.getRssi(),5));
   if(managed)try {
    JSArray saved=new JSArray(); java.util.List<WifiConfiguration> configs=wifi.getConfiguredNetworks();
    if(configs!=null)for(WifiConfiguration config:configs){JSObject row=new JSObject();row.put("id",config.networkId);row.put("name",config.SSID==null?"Saved network":config.SSID.replace("\"",""));saved.put(row);}
    out.put("savedNetworks",saved);
   }catch(SecurityException ignored){out.put("savedNetworksUnavailable",true);}
  }
  try {
   BluetoothManager manager=c.getSystemService(BluetoothManager.class);android.bluetooth.BluetoothAdapter adapter=manager==null?null:manager.getAdapter();
   out.put("bluetoothAvailable",adapter!=null);out.put("bluetoothEnabled",adapter!=null&&adapter.isEnabled());
   JSArray paired=new JSArray();if(adapter!=null&&adapter.isEnabled())for(android.bluetooth.BluetoothDevice device:adapter.getBondedDevices())paired.put(device.getName()==null?"Paired device":device.getName());out.put("pairedDevices",paired);
  }catch(SecurityException ignored){out.put("bluetoothPermission",false);}
  try {
   TelephonyManager phone=c.getSystemService(TelephonyManager.class);
   if(phone!=null&&phone.getSimState()==TelephonyManager.SIM_STATE_READY){
    SignalStrength signal=phone.getSignalStrength();if(signal!=null)out.put("cellularSignal",signal.getLevel());
    int type=phone.getDataNetworkType();String label=switch(type){case TelephonyManager.NETWORK_TYPE_NR->"5G";case TelephonyManager.NETWORK_TYPE_LTE->"4G";case TelephonyManager.NETWORK_TYPE_UNKNOWN->"Cellular";default->"Mobile";};out.put("cellularType",label);
   }
  }catch(SecurityException ignored){out.put("cellularType","Cellular");}
 }
 private static int stream(String name){return switch(name){case "media"->AudioManager.STREAM_MUSIC;case "ring"->AudioManager.STREAM_RING;case "alarm"->AudioManager.STREAM_ALARM;default->throw new IllegalArgumentException("Unknown volume stream");};}
 @SuppressWarnings("deprecation")
 static void change(Context c, PluginCall call) {
  if(!AlphaKioskAdmin.enabled(c)){call.reject("Device controls require an enrolled Alpha launcher");return;}
  try {
   String field=call.getString("field","");DevicePolicyManager policy=c.getSystemService(DevicePolicyManager.class);
   switch(field) {
    case "brightness": {int value=percent(call);policy.setSystemSetting(AlphaKioskAdmin.component(c),Settings.System.SCREEN_BRIGHTNESS_MODE,"0");policy.setSystemSetting(AlphaKioskAdmin.component(c),Settings.System.SCREEN_BRIGHTNESS,String.valueOf(Math.max(5,Math.round(value*255f/100))));break;}
    case "media": case "ring": case "alarm": {int value=percent(call);AudioManager audio=c.getSystemService(AudioManager.class);int s=stream(field);audio.setStreamVolume(s,Math.round(value*audio.getStreamMaxVolume(s)/100f),0);break;}
    case "wifi": {Boolean value=call.getBoolean("enabled");if(value==null)throw new IllegalArgumentException();WifiManager wifi=c.getApplicationContext().getSystemService(WifiManager.class);if(wifi==null||!wifi.setWifiEnabled(value))throw new IllegalStateException();break;}
    case "wifiNetwork": {Integer id=call.getInt("networkId");WifiManager wifi=c.getApplicationContext().getSystemService(WifiManager.class);if(id==null||wifi==null||wifi.getConfiguredNetworks()==null||wifi.getConfiguredNetworks().stream().noneMatch(n->n.networkId==id)||!wifi.enableNetwork(id,true))throw new IllegalArgumentException();break;}
    case "bluetooth": {Boolean value=call.getBoolean("enabled");BluetoothManager manager=c.getSystemService(BluetoothManager.class);android.bluetooth.BluetoothAdapter adapter=manager==null?null:manager.getAdapter();if(value==null||adapter==null||!(value?adapter.enable():adapter.disable()))throw new IllegalStateException();break;}
    case "timeZone": {String zone=call.getString("value","");if(!java.util.Set.of(java.util.TimeZone.getAvailableIDs()).contains(zone))throw new IllegalArgumentException();if(android.os.Build.VERSION.SDK_INT>=30)policy.setAutoTimeZoneEnabled(AlphaKioskAdmin.component(c),false);else policy.setGlobalSetting(AlphaKioskAdmin.component(c),Settings.Global.AUTO_TIME_ZONE,"0");if(!policy.setTimeZone(AlphaKioskAdmin.component(c),zone))throw new IllegalStateException();break;}
    default:throw new IllegalArgumentException();
   }
   JSObject out=new JSObject();out.put("status","requested");call.resolve(out);
  }catch(SecurityException denied){call.reject("Device permission was denied");}
  catch(RuntimeException failure){call.reject("Device setting was rejected or unavailable. Refresh to check its current state.");}
 }
 private static int percent(PluginCall call){Integer value=call.getInt("percent");if(value==null||value<0||value>100)throw new IllegalArgumentException();return value;}
}
