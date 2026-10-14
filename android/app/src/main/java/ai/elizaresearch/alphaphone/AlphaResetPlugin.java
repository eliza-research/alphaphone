package ai.elizaresearch.alphaphone;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.KeyguardManager;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Native confirmation + fresh device credential; renderer arguments cannot authorize deletion. */
@CapacitorPlugin(name="AlphaReset")
public final class AlphaResetPlugin extends Plugin {
 private final ResetAuthorization authorization=new ResetAuthorization();
 private long token, authenticationToken; private PluginCall authenticationCall; private AlertDialog review; private boolean destroyed;
 private void result(PluginCall call,String status,String message){JSObject value=new JSObject();value.put("status",status);value.put("message",message);call.resolve(value);}
 @PluginMethod public void review(PluginCall call){getActivity().runOnUiThread(()->{
  if(destroyed||getActivity().isFinishing()){result(call,"cancelled","Reset review closed. Nothing reset.");return;}
  try{token=authorization.begin();}catch(IllegalStateException busy){result(call,"unavailable","A reset review is already open.");return;}
  final long owner=token;
  review=new AlertDialog.Builder(getActivity()).setTitle("Reset Alpha data?")
   .setMessage("Permanently delete Alpha's local conversations, Notes and drafts, passwords, settings, downloads in Alpha's private storage, and sign-ins. Stop its agent and pending work. There is no backup or undo.\n\nAlpha also asks Eliza Cloud to revoke this phone's sign-in when Cloud can be reached. Device-wide photos and files, remote Gmail and Cloud data, and your Eliza Cloud plan are not deleted or cancelled. Other apps are not reset. Alpha will close; open it again to start fresh.\n\nConfirm, then unlock your device to continue.")
   .setNegativeButton("Cancel",(dialog,which)->{authorization.retire();result(call,"cancelled","Nothing reset.");})
   .setOnCancelListener(dialog->{authorization.retire();result(call,"cancelled","Nothing reset.");})
   .setPositiveButton("Continue to unlock",(dialog,which)->{
    if(destroyed||!authorization.confirm(owner)){result(call,"cancelled","Reset review expired. Nothing reset.");return;}
    KeyguardManager keyguard=getContext().getSystemService(KeyguardManager.class);
    Intent unlock=keyguard==null?null:keyguard.createConfirmDeviceCredentialIntent("Reset Alpha data","Unlock to permanently erase Alpha's local data.");
    if(unlock==null){authorization.retire();result(call,"unavailable","Set a device screen lock in Android before resetting Alpha data.");return;}
    try{authenticationToken=owner;authenticationCall=call;startActivityForResult(call,unlock,"authenticated");}catch(RuntimeException unavailable){authorization.retire();result(call,"unavailable","Device authentication is unavailable. Nothing reset.");}
   }).create();review.show();
 });}
 @ActivityCallback private void authenticated(PluginCall call,ActivityResult response){
  if(call==null||call!=authenticationCall||destroyed||!authorization.authenticate(authenticationToken,response.getResultCode()==Activity.RESULT_OK)){if(call!=null)result(call,"cancelled","Reset cancelled. Nothing reset.");return;}
  authenticationCall=null;
  try{AlphaDataReset.record(getContext());}
  catch(Exception failure){result(call,"unavailable","Reset could not be prepared. Close and reopen Alpha before trying again.");if(AlphaDataReset.pending(getContext()))AlphaDataReset.dispatchAndExit(getContext());return;}
  // The reset is recorded first, so it completes on the next launch whatever happens below.
  revokeCloudKeysThenReset(getContext().getApplicationContext());
 }
 /** Best effort, bounded and off the main thread: revoke this phone's Eliza Cloud sign-in key(s),
  * then reset. A failed, slow or offline revocation never blocks or cancels the local reset. */
 private static void revokeCloudKeysThenReset(android.content.Context context){
  final java.util.concurrent.atomic.AtomicBoolean dispatched=new java.util.concurrent.atomic.AtomicBoolean(false);
  final Runnable reset=()->{if(dispatched.compareAndSet(false,true))AlphaDataReset.dispatchAndExit(context);};
  final android.os.Handler main=new android.os.Handler(android.os.Looper.getMainLooper());
  main.postDelayed(reset,REVOCATION_DEADLINE_MS);
  Thread revocation=new Thread(()->{
   try{
    AlphaCredentialStore store=new AlphaCredentialStore(context);
    for(String environment:CloudKeyRevocation.environments(BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS)){
     if(dispatched.get())break;
     try{String saved=store.readCredentialSlot("cloud:"+environment);if(saved!=null)CloudKeyRevocation.revoke(environment,new org.json.JSONObject(saved).optString("token",null),BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);}
     catch(Exception ignored){/* Unreadable or absent: nothing to revoke. */}
    }
   }finally{main.post(reset);}
  },"alpha-reset-cloud-revocation");
  revocation.setDaemon(true);revocation.start();
 }
 static final long REVOCATION_DEADLINE_MS=8000;
 @Override protected void handleOnDestroy(){destroyed=true;authenticationCall=null;authorization.retire();if(review!=null)review.dismiss();super.handleOnDestroy();}
}
