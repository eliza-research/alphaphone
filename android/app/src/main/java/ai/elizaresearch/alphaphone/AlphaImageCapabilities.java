package ai.elizaresearch.alphaphone;

import android.content.Context;
import android.content.pm.ApplicationInfo;

/** Provisioning capability, not an inference from HOME role or launcher flavor. */
final class AlphaImageCapabilities {
 private AlphaImageCapabilities(){}
 static boolean admitted(boolean debug,boolean testMocks,boolean launcher,boolean systemInstalled,boolean provisioned){
  return !debug&&!testMocks&&launcher&&systemInstalled&&provisioned;
 }
 static boolean aospImage(Context context){
  try{return admitted(BuildConfig.DEBUG,BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS,BuildConfig.IS_LAUNCHER,
   (context.getApplicationInfo().flags&ApplicationInfo.FLAG_SYSTEM)!=0,
   context.getResources().getBoolean(R.bool.alpha_aosp_image_capability));}
  catch(RuntimeException unavailable){return false;}
 }
 // Provisioning is necessary but not sufficient: Telecom/SMS roles remain unavailable.
 static boolean roleEnabled(String role){return "home".equals(role)||"assistant".equals(role);}
 static boolean defaultAppEnabled(Context context,String role){return "dial".equals(role)&&aospImage(context);}
}
