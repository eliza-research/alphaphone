package ai.elizaresearch.alphaphone;

import android.content.*;
import android.net.Uri;
import android.os.Build;
import android.app.KeyguardManager;
import android.os.UserManager;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.*;
import java.util.concurrent.*;

/** Agent album facade over the same permission and exact-revision catalog as Photos.
 * It uses AlphaPhotos' PermittedMediaCatalog and PermittedMediaReview instances (one epoch, one
 * observer, one review at a time), owns no index and never uses URI-only destructive requests. */
@CapacitorPlugin(name="AlphaPhotoLibrary")
public class AlphaPhotoLibraryPlugin extends Plugin {
 private final ExecutorService worker=Executors.newSingleThreadExecutor();
 private PermittedMediaCatalog catalog;
 private PermittedMediaReview review;
 private volatile boolean destroyed,watching;
 @Override public void load(){
  AlphaPhotosPlugin photos=(AlphaPhotosPlugin)getBridge().getPlugin("AlphaPhotos").getInstance();
  catalog=photos.permittedCatalog();review=photos.permittedReview();
  if(catalog==null||review==null)throw new IllegalStateException("AlphaPhotos must load before AlphaPhotoLibrary");
  catalog.addListener(()->{if(watching&&!destroyed)notifyListeners("libraryChanged",new JSObject());});
 }
 private interface ReadAction {void run(long ticket);}
 private void submit(PluginCall call,ReadAction action){
  if(destroyed){call.reject("Device library closed");return;}
  try{long ticket=catalog.readTicket();worker.execute(()->{try{catalog.requireReadTicket(ticket);if(destroyed)throw new IllegalStateException();action.run(ticket);}catch(Exception changed){call.reject("Device library access changed");}});}
  catch(RuntimeException stopped){call.reject("Device library closed");}
 }
 private boolean locked(){KeyguardManager keyguard=getContext().getSystemService(KeyguardManager.class);UserManager users=getContext().getSystemService(UserManager.class);return keyguard==null||users==null||keyguard.isDeviceLocked()||!users.isUserUnlocked();}
 private JSObject scopeResult(){
  JSObject access=catalog.access(),out=new JSObject();String scope=access.getString("scope");
  out.put("scope",scope);out.put("imageAccess",access.getString("images"));out.put("videoAccess",access.getString("videos"));
  out.put("images","full".equals(access.getString("images")));out.put("videos","full".equals(access.getString("videos")));
  out.put("canSelectMore",Build.VERSION.SDK_INT>=34);out.put("canEditOthers",Build.VERSION.SDK_INT>=30);out.put("locked",locked());
  try{out.put("version",catalog.fence().cursorIdentity());}catch(Exception unavailable){out.put("version","");}return out;
 }
 private boolean readable(PluginCall call){
  if(locked()){call.reject("Unlock the phone to use the device library","LIBRARY_LOCKED");return false;}
  if("denied".equals(catalog.access().getString("scope"))){call.reject("Photo library access is not allowed","LIBRARY_DENIED");return false;}return true;
 }
 @PluginMethod public void scope(PluginCall call){call.resolve(scopeResult());}
 @PluginMethod public void requestAccess(PluginCall call){((AlphaPhotosPlugin)getBridge().getPlugin("AlphaPhotos").getInstance()).requestLibraryAccess(call);}
 @PluginMethod public void watch(PluginCall call){watching=call.getBoolean("active",false)&&!destroyed;catalog.watch("library",watching);JSObject out=new JSObject();out.put("active",watching);call.resolve(out);}
 private JSObject item(JSObject row){row.put("takenAt",row.optLong("date",0L));return row;}
 @PluginMethod public void page(PluginCall call){submit(call,ticket->{
  if(!readable(call))return;
  try{
   JSObject page=catalog.list(call.getString("before",""),call.getString("query",""),call.getString("kind","all"),call.getBoolean("thumbnails",false),call.getBoolean("favorites",false)?"favorites":"all",call.getLong("from",0L),call.getLong("to",Long.MAX_VALUE),Math.min(24,Math.max(1,call.getInt("limit",24))));
   JSArray rows=new JSArray();org.json.JSONArray source=page.getJSONArray("items");for(int i=0;i<source.length();i++)rows.put(item(JSObject.fromJSONObject(source.getJSONObject(i))));
   JSObject out=scopeResult();out.put("items",rows);out.put("next",page.getString("next"));out.put("generation",1);catalog.publish(call,out,ticket);
  }catch(Exception failure){call.reject("Photo library changed. Reload before continuing.");}
 });}
 @PluginMethod public void inspect(PluginCall call){submit(call,ticket->{if(!readable(call))return;try{catalog.publish(call,item(catalog.read(call.getString("id"),null,call.getBoolean("pixels",true))),ticket);}catch(Exception failure){call.reject("That item is unavailable","LIBRARY_MISSING");}});}
 @PluginMethod public void validate(PluginCall call){submit(call,ticket->{
  if(!readable(call))return;try{
   JSArray requested=call.getArray("items"),results=new JSArray();if(requested==null||requested.length()>200)throw new IllegalArgumentException();
   PermittedMediaCatalog.Fence fence=catalog.fence();
   for(int i=0;i<requested.length();i++){
    org.json.JSONObject expected=requested.getJSONObject(i);String id=expected.getString("id");JSObject result=new JSObject();result.put("id",id);
    try{JSObject row=item(catalog.read(id,null,false));boolean same=row.getString("revision").equals(expected.getString("revision"));result.put("status",same?"current":"changed");if(!same)result.put("item",row);}catch(SecurityException missing){result.put("status","missing");}results.put(result);
   }
   catalog.requireCurrent(fence);JSObject out=new JSObject();out.put("items",results);catalog.publish(call,out,ticket);
  }catch(Exception unavailable){call.reject("Library validation unavailable. Reload Photos.");}
 });}
 /** A full bounded page refresh avoids a second unqualified incremental index. */
 @PluginMethod public void changes(PluginCall call){JSObject out=new JSObject();out.put("reset",true);call.resolve(out);}
 @PluginMethod public void requestChange(PluginCall call){submit(call,ticket->{
  if(!readable(call))return;try{
   String action=call.getString("operation","");if(!Set.of("favorite","unfavorite","trash").contains(action)){call.reject("Manage permanent deletion in Android Photos.");return;}
   JSArray requested=call.getArray("items");if(requested==null||requested.length()<1||requested.length()>20)throw new IllegalArgumentException();
   List<String> ids=new ArrayList<>(),revisions=new ArrayList<>();for(int i=0;i<requested.length();i++){org.json.JSONObject row=requested.getJSONObject(i);ids.add(row.getString("id"));revisions.add(row.getString("revision"));}
   review.request(call,ids,revisions,!action.equals("trash"),!action.equals("unfavorite"),true);
  }catch(Exception unavailable){call.reject("Select current permitted items before review.");}
 });}
 @PluginMethod public void share(PluginCall call){((AlphaPhotosPlugin)getBridge().getPlugin("AlphaPhotos").getInstance()).shareMany(call);}
 // Foreground state and closing belong to AlphaPhotos, which owns the shared catalog and review.
 @Override protected void handleOnPause(){watching=false;catalog.watch("library",false);}
 // Posted so AlphaPhotos' own handleOnResume (plugin order is unspecified) has restored foreground first.
 @Override protected void handleOnResume(){new android.os.Handler(android.os.Looper.getMainLooper()).post(()->{if(!destroyed)notifyListeners("scopeChanged",scopeResult());});}
 @Override protected void handleOnDestroy(){destroyed=true;watching=false;catalog.watch("library",false);worker.shutdown();}
}
