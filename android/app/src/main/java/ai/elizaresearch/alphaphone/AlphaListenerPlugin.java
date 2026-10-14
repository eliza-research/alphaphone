package ai.elizaresearch.alphaphone;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Alpha's view of the AOSP image's always-on listener (android/sense, issue #424). Alpha stays
 * nonprivileged: it can read the listener's status, pause it or turn it off, and open the
 * listener's own consent/settings screen. It cannot turn listening on or resume it; that happens
 * only in the listener's UI with the user present. On phones without the listener (the standalone
 * APK on ordinary Android) every method reports it unavailable.
 */
@CapacitorPlugin(name="AlphaListener")
public final class AlphaListenerPlugin extends Plugin {
 static final String LISTENER_PACKAGE="ai.elizaresearch.alphaphone.sense";
 static final String CONTROL_PERMISSION=LISTENER_PACKAGE+".permission.LISTENER_CONTROL";
 static final Uri CONTROL=Uri.parse("content://"+LISTENER_PACKAGE+".control");

 /** Installed, signed like Alpha and its control permission granted. */
 static boolean available(Context context){
  PackageManager packages=context.getPackageManager();
  try{packages.getPackageInfo(LISTENER_PACKAGE,0);}catch(PackageManager.NameNotFoundException absent){return false;}
  return packages.checkSignatures(context.getPackageName(),LISTENER_PACKAGE)==PackageManager.SIGNATURE_MATCH
   &&context.checkSelfPermission(CONTROL_PERMISSION)==PackageManager.PERMISSION_GRANTED;
 }

 /** Reset may proceed without the image listener, but never past an unacknowledged installed one. */
 static boolean resetForData(Context context){
  try{context.getPackageManager().getPackageInfo(LISTENER_PACKAGE,0);}
  catch(PackageManager.NameNotFoundException absent){return true;}
  if(!available(context))return false;
  try{
   Bundle result=context.getContentResolver().call(CONTROL,"reset",null,null);
   return result!=null&&result.getBoolean("saved",false)&&!result.getBoolean("consented",true)
    &&!result.getBoolean("listening",true);
  }catch(RuntimeException unavailable){return false;}
 }

 private void control(PluginCall call,String method){
  Context context=getContext();
  if(!available(context)){call.resolve(new JSObject().put("available",false));return;}
  try{
   Bundle result=context.getContentResolver().call(CONTROL,method,null,null);
   if(result==null){call.resolve(new JSObject().put("available",false));return;}
   JSObject out=new JSObject();
   out.put("available",true);
   out.put("state",result.getString("state","OFF"));
   out.put("label",result.getString("label",""));
   out.put("consented",result.getBoolean("consented",false));
   out.put("listening",result.getBoolean("listening",false));
   out.put("microphoneOpen",result.getBoolean("microphoneOpen",false));
   call.resolve(out);
  }catch(RuntimeException unavailable){call.resolve(new JSObject().put("available",false));}
 }

 @PluginMethod public void status(PluginCall call){control(call,"status");}
 @PluginMethod public void pause(PluginCall call){control(call,"pause");}
 @PluginMethod public void turnOff(PluginCall call){control(call,"turnOff");}

 /** Opens the listener's consent and settings screen (explicit component; no data passed). */
 @PluginMethod public void openSettings(PluginCall call){
  if(!available(getContext())){call.resolve(new JSObject().put("opened",false));return;}
  try{
   getActivity().startActivity(new Intent().setComponent(new ComponentName(LISTENER_PACKAGE,LISTENER_PACKAGE+".ConsentActivity")));
   call.resolve(new JSObject().put("opened",true));
  }catch(RuntimeException refused){call.resolve(new JSObject().put("opened",false));}
 }
}
