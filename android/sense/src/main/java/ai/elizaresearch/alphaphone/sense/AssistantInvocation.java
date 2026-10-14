package ai.elizaresearch.alphaphone.sense;

import android.app.ActivityOptions;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;

/**
 * Opens Alpha's existing user-facing assistant surface (its ACTION_ASSIST activity) when the user
 * addresses it. The intent carries no transcript, audio or other content: Alpha starts its own
 * foreground voice turn. The listener shares its identity so Alpha can record the invocation as
 * coming from the listener, and refuses to invoke an Alpha package not signed like this one.
 */
final class AssistantInvocation {
 private AssistantInvocation(){}
 static final String ASSIST_ACTIVITY=Listener.ALPHA_PACKAGE+".AlphaAssistActivity";

 static boolean start(Context context){
  PackageManager packages=context.getPackageManager();
  if(packages.checkSignatures(context.getPackageName(),Listener.ALPHA_PACKAGE)!=PackageManager.SIGNATURE_MATCH)return false;
  Intent intent=new Intent(Intent.ACTION_ASSIST).setComponent(new ComponentName(Listener.ALPHA_PACKAGE,ASSIST_ACTIVITY))
   .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
  ActivityOptions options=ActivityOptions.makeBasic().setShareIdentityEnabled(true);
  try{context.startActivity(intent,options.toBundle());return true;}
  catch(ActivityNotFoundException|SecurityException refused){return false;}
 }
}
