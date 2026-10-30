package ai.elizaresearch.alphaphone;

import android.Manifest;
import android.content.Intent;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/** Product policy stays in Alpha; shared System behavior is unchanged for other hosts. */
@CapacitorPlugin(name="ElizaSystem",permissions={@Permission(alias="camera",strings={Manifest.permission.CAMERA})})
public final class AlphaSystemPlugin extends ai.eliza.plugins.system.SystemPlugin {
 @Override @PluginMethod public void requestPermissions(PluginCall call){LateLaunch.ask(call,()->super.requestPermissions(call));}
 @Override @PluginMethod public void requestRole(PluginCall call){LateLaunch.ask(call,()->super.requestRole(call));}
 @Override @PluginMethod public void setFlashlight(PluginCall call){LateLaunch.ask(call,()->super.setFlashlight(call));}
 @Override protected boolean isRoleEnabled(String role){return AlphaImageCapabilities.roleEnabled(role);}
 /** The dial hand-off exists only in the launcher build on an admitted image: the HOME role keeps a
  * path to the stock dialer and emergency calls; a standalone APK shows no Phone entry (P-36). */
 @Override protected boolean isDefaultAppEnabled(String role){return BuildConfig.IS_LAUNCHER&&AlphaImageCapabilities.defaultAppEnabled(getContext(),role);}
 @Override protected boolean isLauncherBuild(){return BuildConfig.IS_LAUNCHER;}
 @Override protected String buildVersion(){return BuildConfig.VERSION_NAME;}
 /** ACTION_ASSIST, or AlphaAssistActivity's own marker extra. */
 @Override protected boolean isAssistantLaunch(Intent intent){return super.isAssistantLaunch(intent)||(intent!=null&&intent.getBooleanExtra(AlphaAssistActivity.EXTRA_ASSISTANT,false));}
 /** Only the launcher flavor drives Android's shade (#416, #417); the standalone app never asks. */
 @Override protected boolean canExpandNotificationShade(){return BuildConfig.IS_LAUNCHER;}
}
