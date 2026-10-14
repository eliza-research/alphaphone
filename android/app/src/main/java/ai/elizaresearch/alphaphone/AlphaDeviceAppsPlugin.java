package ai.elizaresearch.alphaphone;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Ordinary installed-app launching stays available; owned Phone shortcuts require image admission. */
@CapacitorPlugin(name="DeviceApps")
public final class AlphaDeviceAppsPlugin extends DeviceAppsPlugin {
 @Override @PluginMethod public void resolveDefault(PluginCall call){
  if(!AlphaImageCapabilities.defaultAppEnabled(getContext(),call.getString("role"))){JSObject result=new JSObject();result.put("role",call.getString("role"));result.put("available",false);call.resolve(result);return;}
  super.resolveDefault(call);
 }
 @Override @PluginMethod public void openDefault(PluginCall call){
  if(!AlphaImageCapabilities.defaultAppEnabled(getContext(),call.getString("role"))){call.reject("Default app unavailable in this product");return;}
  super.openDefault(call);
 }
 @PluginMethod public void platformCapabilities(PluginCall call){
  JSObject result=new JSObject();result.put("aospImage",AlphaImageCapabilities.aospImage(getContext()));
  result.put("phone",false);result.put("contacts",AlphaImageCapabilities.aospImage(getContext()));result.put("sms",false);call.resolve(result);
 }
}
