package ai.elizaresearch.alphaphone;

import android.Manifest;
import android.app.KeyguardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.provider.ContactsContract;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import androidx.activity.result.ActivityResult;

/** Alpha image-only address book. Android owns contact creation/edit account choice and save. */
@CapacitorPlugin(name="AlphaContacts",permissions={@Permission(alias="contacts",strings={Manifest.permission.READ_CONTACTS})})
public final class AlphaContactsPlugin extends Plugin {
 private final java.util.concurrent.ExecutorService worker=java.util.concurrent.Executors.newSingleThreadExecutor();
 private volatile boolean closed;
 private boolean admitted(){return !closed&&AlphaImageCapabilities.aospImage(getContext());}
 private boolean unlocked(){KeyguardManager lock=getContext().getSystemService(KeyguardManager.class);android.os.UserManager users=getContext().getSystemService(android.os.UserManager.class);return lock!=null&&users!=null&&!lock.isDeviceLocked()&&users.isUserUnlocked();}
 private boolean readable(){return admitted()&&unlocked()&&getContext().checkSelfPermission(Manifest.permission.READ_CONTACTS)==PackageManager.PERMISSION_GRANTED;}
 private boolean foreground(){return admitted()&&unlocked()&&getActivity()!=null&&!getActivity().isFinishing()&&!getActivity().isDestroyed()&&getActivity().hasWindowFocus();}
 @PluginMethod public void status(PluginCall call){JSObject out=new JSObject();out.put("available",admitted());out.put("readable",readable());call.resolve(out);}
 @Override @PluginMethod public void requestPermissions(PluginCall call){
  if(!foreground()){call.reject("Contacts is available only in the unlocked Alpha image");return;}
  LateLaunch.ask(call,()->requestPermissionForAlias("contacts",call,"permissionResult"));
 }
 @PermissionCallback private void permissionResult(PluginCall call){status(call);}
 @PluginMethod public void list(PluginCall call){
  if(!readable()){call.reject("Contacts access is unavailable");return;}
  try{worker.execute(()->{try{
   if(!readable())throw new SecurityException();
   JSObject result=new AlphaContactsCatalog(getContext()).list(call.getString("query",""),call.getInt("limit",50));
   if(!readable())throw new SecurityException();call.resolve(result);
  }catch(Exception unavailable){call.reject("Contacts could not be read. Check access and refresh.");}});}catch(java.util.concurrent.RejectedExecutionException retired){call.reject("Contacts closed");}
 }
 @PluginMethod public void create(PluginCall call){
  if(!foreground()){call.reject("Contacts is available only in the unlocked Alpha image");return;}
  launch(call,new Intent(Intent.ACTION_INSERT).setType(ContactsContract.Contacts.CONTENT_TYPE));
 }
 @PluginMethod public void edit(PluginCall call){
  if(!foreground()||!readable()){call.reject("Contacts access is unavailable");return;}
  try{worker.execute(()->{try{
   android.net.Uri uri=new AlphaContactsCatalog(getContext()).reviewed(call.getString("id"),call.getString("lookup"),call.getString("revision"));
   getActivity().runOnUiThread(()->{if(!foreground()||!readable()){call.reject("Return to Contacts before editing");return;}launch(call,new Intent(Intent.ACTION_EDIT).setDataAndType(uri,ContactsContract.Contacts.CONTENT_ITEM_TYPE));});
  }catch(Exception unavailable){call.reject("Contact changed or is unavailable. Refresh before editing.");}});}catch(java.util.concurrent.RejectedExecutionException retired){call.reject("Contacts closed");}
 }
 private void launch(PluginCall call,Intent intent){
  // Pin a system editor, never a renderer-supplied component, URI, account or write payload.
  java.util.List<android.content.pm.ResolveInfo> handlers=getContext().getPackageManager().queryIntentActivities(intent,PackageManager.MATCH_DEFAULT_ONLY);
  android.content.pm.ActivityInfo editor=null;
  for(android.content.pm.ResolveInfo handler:handlers){android.content.pm.ActivityInfo a=handler.activityInfo;if(a!=null&&a.enabled&&a.exported&&(a.applicationInfo.flags&android.content.pm.ApplicationInfo.FLAG_SYSTEM)!=0&&!getContext().getPackageName().equals(a.packageName)){editor=a;break;}}
  if(editor==null){call.reject("Android Contacts editor is unavailable");return;}
  intent.setComponent(new android.content.ComponentName(editor.packageName,editor.name));
  LateLaunch.ask(call,()->startActivityForResult(call,intent,"editorResult"));
 }
 @ActivityCallback private void editorResult(PluginCall call,ActivityResult result){if(call==null)return;JSObject out=new JSObject();out.put("status","returned");call.resolve(out);}
 @Override protected void handleOnDestroy(){closed=true;worker.shutdown();super.handleOnDestroy();}
}
