package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.agent.connection.ConnectionTransport;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import androidx.core.content.IntentCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;

/**
 * One-tap update of this app (Settings, Software update; renderer policy in app-update.ts). check()
 * fetches the one configured manifest (app.config.json updateManifestUrl, as BuildConfig). install(),
 * from the owner's tap only, downloads the HTTPS APK to the cache, admits it by size and SHA-256
 * (AppUpdateTransfer) and hands it to Android's PackageInstaller for this package only. Android
 * shows its own confirmation and installs only an APK signed like the installed app. Nothing is
 * privileged, silent or in the background; a failure settles quietly and the next check or tap retries.
 */
@CapacitorPlugin(name="AlphaUpdate")
public final class AlphaUpdatePlugin extends Plugin {
 private static final int MANIFEST_LIMIT=64*1024;
 private static final String STATUS_ACTION="ai.elizaresearch.alphaphone.UPDATE_STATUS";
 private final ExecutorService worker=Executors.newSingleThreadExecutor();
 /** Android's install status: only its request for the owner's confirmation is acted on. */
 private final BroadcastReceiver status=new BroadcastReceiver(){
  @Override public void onReceive(Context context,Intent intent){
   Intent confirm=IntentCompat.getParcelableExtra(intent,Intent.EXTRA_INTENT,Intent.class);Activity activity=getActivity();
   if(confirm==null||activity==null||intent.getIntExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_FAILURE)!=PackageInstaller.STATUS_PENDING_USER_ACTION)return;
   try{activity.startActivity(confirm);}catch(RuntimeException unavailable){/* The next tap asks again. */}
  }
 };
 @Override public void load(){super.load();ContextCompat.registerReceiver(getContext(),status,new IntentFilter(STATUS_ACTION),ContextCompat.RECEIVER_NOT_EXPORTED);}
 @Override protected void handleOnDestroy(){getContext().unregisterReceiver(status);worker.shutdownNow();super.handleOnDestroy();}
 private void work(PluginCall call,Runnable task){PluginWorkers.submit(worker,task,()->call.reject("Update unavailable"));}
 /** HTTPS only: a redirect never changes protocol, and the network security config refuses cleartext. */
 private static HttpsURLConnection open(String url)throws IOException{
  HttpsURLConnection connection=(HttpsURLConnection)new URL(url).openConnection();
  connection.setConnectTimeout(20000);connection.setReadTimeout(60000);connection.setUseCaches(false);
  if(connection.getResponseCode()!=200){connection.disconnect();throw new IOException("Update unavailable");}
  return connection;
 }

 @PluginMethod public void check(PluginCall call){
  work(call,()->{
   try{
    HttpsURLConnection connection=open(BuildConfig.ALPHA_UPDATE_MANIFEST_URL);
    try(InputStream in=connection.getInputStream()){call.resolve(new JSObject().put("manifest",new String(ConnectionTransport.readBounded(in,MANIFEST_LIMIT),StandardCharsets.UTF_8)));}
    finally{connection.disconnect();}
   }catch(Exception unavailable){call.reject("Update unavailable");}
  });
 }
 @PluginMethod public void install(PluginCall call){
  if(!getContext().getPackageManager().canRequestPackageInstalls()){
   getActivity().runOnUiThread(()->{
    try{getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getContext().getPackageName())));call.resolve(new JSObject().put("status","settings"));}
    catch(RuntimeException unavailable){call.reject("Update unavailable");}
   });
   return;
  }
  final String apkUrl=call.getString("apkUrl"),sha256=call.getString("sha256");final long size=call.getData().optLong("sizeBytes");
  work(call,()->{
   File apk=new File(getContext().getCacheDir(),"alpha-update.apk");
   try{
    HttpsURLConnection connection=open(apkUrl);
    try(InputStream in=connection.getInputStream();OutputStream out=new FileOutputStream(apk)){AppUpdateTransfer.copyVerified(in,out,size,sha256);}
    finally{connection.disconnect();}
    PackageInstaller installer=getContext().getPackageManager().getPackageInstaller();
    PackageInstaller.SessionParams params=new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
    // Android refuses an APK of any other package; the same-signer rule and the confirmation are its own.
    params.setAppPackageName(getContext().getPackageName());params.setSize(size);
    int id=installer.createSession(params);
    try(PackageInstaller.Session session=installer.openSession(id)){
     try(OutputStream out=session.openWrite("base.apk",0,size)){Files.copy(apk.toPath(),out);session.fsync(out);}
     session.commit(PendingIntent.getBroadcast(getContext(),id,new Intent(STATUS_ACTION).setPackage(getContext().getPackageName()),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_MUTABLE).getIntentSender());
    }catch(Exception failed){installer.abandonSession(id);throw failed;}
    call.resolve(new JSObject().put("status","installing"));
   }catch(Exception unavailable){call.reject("Update unavailable");}
   finally{apk.delete();}
  });
 }
}
