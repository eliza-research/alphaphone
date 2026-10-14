package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.media.OwnedPhotoEdits;
import ai.eliza.plugins.media.OwnedMediaConfig;
import ai.eliza.plugins.media.OwnedCaptures;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.ImageDecoder;
import android.util.Size;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Permission-filtered library reads and explicitly reviewed media management. */
@CapacitorPlugin(name="AlphaPhotos",permissions={
 @Permission(alias="libraryLegacy",strings={"android.permission.READ_EXTERNAL_STORAGE"}),
 @Permission(alias="libraryImages",strings={"android.permission.READ_MEDIA_IMAGES"}),
 @Permission(alias="libraryVideos",strings={"android.permission.READ_MEDIA_VIDEO"}),
 @Permission(alias="librarySelected",strings={"android.permission.READ_MEDIA_VISUAL_USER_SELECTED"})
})
public class AlphaPhotosPlugin extends Plugin {
 private PermittedMediaCatalog permitted;
 private PermittedMediaReview mediaReview;
 private OwnedVideoPlayback playback;
 static final OwnedMediaConfig MEDIA_CONFIG=OwnedMediaConfig.builder("alpha")
   .edits("Pictures/Alpha Phone/Edits/", "Alpha-edit-").captures("Pictures/", "SCAN_").build();
 private OwnedPhotoEdits edits;
 private OwnedCaptures captures;
 private android.content.SharedPreferences mediaVersions;
 private volatile boolean destroyed;
 private void submit(PluginCall call,Runnable action){
  if(destroyed){call.reject("Photo library closed");return;}
  try{worker.execute(()->{if(destroyed)call.reject("Photo library closed");else action.run();});}
  catch(java.util.concurrent.RejectedExecutionException stopped){call.reject("Photo library closed");}
 }
 @Override public void load(){
  // Observation starts only while the Photos grid is open (watchLibrary). Playback grants recheck
  // their item's revision on every byte request, so unrelated media writes do not revoke them.
  permitted=new PermittedMediaCatalog(getContext(),false,()->{if(!destroyed)notifyListeners("libraryChanged",new JSObject());});mediaReview=new PermittedMediaReview(getBridge(),permitted,worker);edits=new OwnedPhotoEdits(getContext(), MEDIA_CONFIG,new OwnedPhotoEdits.SourceAccess(){
  public boolean accepts(String id){return id!=null&&id.startsWith("m:");}
  public Uri source(String id)throws Exception{revision(id);return permitted.uri(MediaLibraryKey.parse(id));}
  public String revision(String id)throws Exception{MediaLibraryKey key=MediaLibraryKey.parse(id);if(key.video)throw new IllegalArgumentException("Only still photos support edit copies");JSObject item=permitted.read(id,null,false);if(item.getLong("size")>32L*1024*1024)throw new IllegalArgumentException("Edit copies support source files up to 32 MB");return item.getString("mutationRevision");}
 });captures=new OwnedCaptures(getContext(), MEDIA_CONFIG);mediaVersions=getContext().getSharedPreferences("alpha-owned-media-versions",0);playback=new OwnedVideoPlayback(getBridge());getBridge().setWebViewClient(playback);}
 @PluginMethod public void libraryAccess(PluginCall call){call.resolve(permitted.access());}
 /** Photos grid enter/leave. The Device library album watches the same catalog under its own name. */
 @PluginMethod public void watchLibrary(PluginCall call){boolean active=call.getBoolean("active",false)&&!destroyed;permitted.watch("photos",active);JSObject out=new JSObject();out.put("active",active);call.resolve(out);}
 /** The single permitted-media catalog and review shared with AlphaPhotoLibrary: one index, one review at a time. */
 PermittedMediaCatalog permittedCatalog(){return permitted;}
 PermittedMediaReview permittedReview(){return mediaReview;}
 @PluginMethod public void openLibrarySettings(PluginCall call){
  if(destroyed||!getActivity().hasWindowFocus()){call.reject("Return to Photos to review access");return;}
  try{getActivity().startActivity(new android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.fromParts("package",getContext().getPackageName(),null)));call.resolve();}catch(RuntimeException unavailable){call.reject("Android app settings could not open");}
 }
 /** Only the explicit Photos permission control invokes this, never list/read/resume. */
 @PluginMethod public void requestLibraryAccess(PluginCall call){
  if(destroyed||!getActivity().hasWindowFocus()){call.reject("Return to Photos to choose access");return;}
  String[] aliases=Build.VERSION.SDK_INT>=34?new String[]{"libraryImages","libraryVideos","librarySelected"}:Build.VERSION.SDK_INT>=33?new String[]{"libraryImages","libraryVideos"}:new String[]{"libraryLegacy"};
  LateLaunch.ask(call,()->requestPermissionForAliases(aliases,call,"libraryPermissionResult"));
 }
 @PermissionCallback private void libraryPermissionResult(PluginCall call){permitted.invalidate();libraryAccess(call);}
 @Override @PluginMethod public void requestPermissions(PluginCall call){requestLibraryAccess(call);}
 private interface ReadAction {JSObject run()throws Exception;}
 private void submitRead(PluginCall call,ReadAction action){
  try{long ticket=permitted.readTicket();submit(call,()->{try{permitted.requireReadTicket(ticket);JSObject value=action.run();permitted.publish(call,value,ticket);}catch(Exception changed){call.reject("Photo library changed or is unavailable. Refresh Photos and check its access.");}});}
  catch(Exception unavailable){call.reject("Unlock and reopen Photos before reading the library.");}
 }
 @PluginMethod public void listPermitted(PluginCall call){submitRead(call,()->permitted.list(call.getString("before",""),call.getString("query",""),call.getString("kind","all"),call.getBoolean("thumbnails",true),call.getString("filter","all")));}
 @PluginMethod public void readPermitted(PluginCall call){submitRead(call,()->permitted.read(call.getString("id"),call.getString("revision"),call.getBoolean("pixels",true)));}
 @Override protected void handleOnPause(){if(permitted!=null){permitted.watch("photos",false);permitted.foreground(false);}if(playback!=null)playback.clear();}
 @Override protected void handleOnResume(){if(permitted!=null)permitted.foreground(true);notifyListeners("libraryChanged",new JSObject());}
 private final ExecutorService worker=Executors.newSingleThreadExecutor();
 private String owned(){return owned(false);}
 private String owned(boolean trashed){return MediaStore.MediaColumns.OWNER_PACKAGE_NAME+"=? AND "+MediaStore.MediaColumns.IS_PENDING+"=0"+(Build.VERSION.SDK_INT>=30?" AND "+MediaStore.MediaColumns.IS_TRASHED+"="+(trashed?1:0):"");}
 private String[] fields(){if(Build.VERSION.SDK_INT<30)return FIELDS;String[] result=java.util.Arrays.copyOf(FIELDS,12);result[7]=MediaStore.MediaColumns.IS_TRASHED;result[8]=MediaStore.MediaColumns.DATE_EXPIRES;result[9]=MediaStore.MediaColumns.GENERATION_MODIFIED;result[10]=MediaStore.MediaColumns.IS_FAVORITE;result[11]=MediaStore.MediaColumns.GENERATION_ADDED;return result;}
 private String mutationRevision(Cursor row){return row.getLong(3)+":"+row.getLong(4)+(Build.VERSION.SDK_INT>=30?":"+row.getLong(9)+":"+row.getInt(7):"");}
 private static final Uri CATALOG=MediaStore.Files.getContentUri("external");
 private static final String MEDIA=" AND media_type IN (1,3)";
 private static final String[] FIELDS={MediaStore.Images.Media._ID,MediaStore.Images.Media.WIDTH,MediaStore.Images.Media.HEIGHT,MediaStore.Images.Media.DATE_ADDED,MediaStore.Images.Media.SIZE,MediaStore.Files.FileColumns.MEDIA_TYPE,MediaStore.Video.VideoColumns.DURATION};
 private JSObject metadata(Cursor row){
  JSObject item=new JSObject();boolean video=row.getInt(5)==MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO;item.put("id",(video?"v:":"")+row.getLong(0));item.put("kind",video?"video":"image");item.put("duration",video?row.getLong(6)/1000d:0);item.put("width",row.getInt(1));item.put("height",row.getInt(2));item.put("date",row.getLong(3)*1000);String base=row.getLong(3)+":"+row.getLong(4);String marker=mediaVersions.getString((video?"v:":"")+row.getLong(0),"");item.put("revision",base+(Build.VERSION.SDK_INT>=30&&marker.startsWith(base+"|")?"|"+row.getLong(9):""));item.put("mutationRevision",mutationRevision(row));item.put("trashed",Build.VERSION.SDK_INT>=30&&row.getInt(7)==1);item.put("favorite",Build.VERSION.SDK_INT>=30&&row.getInt(10)==1);item.put("expiresAt",Build.VERSION.SDK_INT>=30?row.getLong(8)*1000:0);return item;
 }
 private Uri uri(long id,boolean video){return ContentUris.withAppendedId(video?MediaStore.Video.Media.EXTERNAL_CONTENT_URI:MediaStore.Images.Media.EXTERNAL_CONTENT_URI,id);}
 private long id(String value){long id=Long.parseLong(value.replaceFirst("^v:",""));if(id<=0)throw new IllegalArgumentException();return id;}
 private String image(long id,boolean video,int size)throws Exception{
  Uri uri=uri(id,video);
  Bitmap bitmap=video?getContext().getContentResolver().loadThumbnail(uri,new Size(size,size),null):ImageDecoder.decodeBitmap(ImageDecoder.createSource(getContext().getContentResolver(),uri),(decoder,info,source)->{
   double scale=Math.min(1d,(double)size/Math.max(info.getSize().getWidth(),info.getSize().getHeight()));
   decoder.setTargetSize(Math.max(1,(int)(info.getSize().getWidth()*scale)),Math.max(1,(int)(info.getSize().getHeight()*scale)));
   decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
  });
  try(ByteArrayOutputStream output=new ByteArrayOutputStream()){
   if(!bitmap.compress(Bitmap.CompressFormat.JPEG,85,output))throw new IllegalStateException();
   return "data:image/jpeg;base64,"+Base64.encodeToString(output.toByteArray(),Base64.NO_WRAP);
  }finally{bitmap.recycle();}
 }
 @PluginMethod public void beginEdit(PluginCall call){submit(call,()->{try{call.resolve(edits.begin(call.getString("id"),call.getString("revision")));}catch(Exception e){call.reject(e.getMessage()==null?"Photo editor unavailable":e.getMessage());}});}
 @PluginMethod public void previewEdit(PluginCall call){submit(call,()->{try{call.resolve(edits.preview(call.getString("sessionId"),call.getInt("rotation",0),call.getBoolean("crop",false),call.getString("filter","none")));}catch(Exception e){call.reject(e.getMessage()==null?"Preview unavailable":e.getMessage());}});}
 @PluginMethod public void saveEdit(PluginCall call){submit(call,()->{try{call.resolve(edits.save(call.getString("sessionId"),call.getInt("rotation",0),call.getBoolean("crop",false),call.getString("filter","none")));}catch(Exception e){call.reject(e.getMessage()==null?"Save outcome unknown; inspect Photos before retrying":e.getMessage());}});}
 @PluginMethod public void editResult(PluginCall call){submit(call,()->{try{call.resolve(edits.result(call.getString("operationId")));}catch(Exception e){call.reject("Saved-copy outcome could not be confirmed");}});}
 @PluginMethod public void cancelEdit(PluginCall call){edits.cancel(call.getString("sessionId"));submit(call,()->{edits.releaseCancelled();call.resolve();});}
 @PluginMethod public void list(PluginCall call){submit(call,()->{
  try{
   boolean trashed=call.getBoolean("trashed",false);if(trashed&&Build.VERSION.SDK_INT<30){call.reject("Android trash requires Android 11 or later");return;}
   String album=call.getString("album","");if(album.startsWith("custom:")){listCustomAlbum(call,album.substring(7));return;}if(!album.isEmpty()&&!album.equals("favorites")&&!album.equals("videos"))throw new IllegalArgumentException();
   if(!"denied".equals(permitted.access().getString("scope"))){call.resolve(permitted.list(call.getString("before",""),"",album.equals("videos")?"video":"all",true,trashed?"trash":album.equals("favorites")?"favorites":"all"));return;}
   if(trashed&&!album.isEmpty())throw new IllegalArgumentException();
   if(album.equals("favorites")&&Build.VERSION.SDK_INT<30){call.reject("Favorites require Android 11 or later");return;}
   String filter=album.equals("videos")?" AND media_type=3":album.equals("favorites")?" AND is_favorite=1":"";
   String before=call.getString("before","");long cursor=before.isEmpty()?Long.MAX_VALUE:Long.parseLong(before);if(cursor<=0)throw new IllegalArgumentException();
   Bundle query=new Bundle();query.putString(ContentResolver.QUERY_ARG_SQL_SELECTION,owned(trashed)+MEDIA+filter+" AND _id<?");query.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS,new String[]{getContext().getPackageName(),Long.toString(cursor)});
   query.putStringArray(ContentResolver.QUERY_ARG_SORT_COLUMNS,new String[]{MediaStore.Images.Media._ID});query.putInt(ContentResolver.QUERY_ARG_SORT_DIRECTION,ContentResolver.QUERY_SORT_DIRECTION_DESCENDING);query.putInt(ContentResolver.QUERY_ARG_LIMIT,25);
   if(Build.VERSION.SDK_INT>=30)query.putInt(MediaStore.QUERY_ARG_MATCH_TRASHED,trashed?MediaStore.MATCH_ONLY:MediaStore.MATCH_EXCLUDE);
   JSArray items=new JSArray();String next="";long last=0;
   try(Cursor rows=getContext().getContentResolver().query(CATALOG,fields(),query,null)){
    if(rows==null)throw new IllegalStateException();
    while(rows.moveToNext()){
     if(items.length()==24){next=Long.toString(last);break;}
     JSObject item=metadata(rows);last=rows.getLong(0);
     try{item.put("image",image(last,rows.getInt(5)==3,240));}catch(Exception unavailable){item.put("image","");}
     items.put(item);
    }
   }
   JSObject result=new JSObject();result.put("items",items);result.put("next",next);call.resolve(result);
  }catch(Exception failure){call.reject("Saved media could not be loaded");}
 });}
 @PluginMethod public void read(PluginCall call){submit(call,()->{
  try{
   if(call.getString("id","").startsWith("m:")){
    String key=call.getString("id");JSObject result=permitted.read(key,call.getString("revision"),true);MediaLibraryKey media=MediaLibraryKey.parse(key);String revision=result.getString("revision");
    if(media.video)result.put("path",playback.authorize(permitted.uri(media),()->{try{permitted.read(key,revision,false);}catch(Exception unavailable){throw new SecurityException("Selected video changed or is unavailable");}}));call.resolve(result);return;
   }
   String key=call.getString("id","");long id=id(key);boolean video=key.startsWith("v:");
   Uri uri=uri(id,video);JSObject result;
   try(Cursor row=getContext().getContentResolver().query(CATALOG,fields(),owned()+" AND _id=? AND media_type=?",new String[]{getContext().getPackageName(),Long.toString(id),video?"3":"1"},null)){
    if(row==null||!row.moveToFirst())throw new IllegalArgumentException();result=metadata(row);
   }
   result.put("image",image(id,video,1024));if(video)result.put("path",playback.authorize(uri));call.resolve(result);
  }catch(Exception failure){call.reject("This saved media is no longer available");}
 });}
 /** Scan mode captures stay in memory. Keep photo is the only path that publishes
  * one to Photos: exact JPEG bytes, pending until fully written, one result per operation. */
 @PluginMethod public void keepCapture(PluginCall call){submit(call,()->{
  try{
   OwnedCaptures.Result result=captures.keep(call.getString("operationId",""),call.getString("dataBase64",""));
   JSObject out=new JSObject();out.put("status",result.saved?"saved":"failed");
   if(result.id!=null)out.put("id",result.id);if(result.message!=null)out.put("message",result.message);
   call.resolve(out);
  }catch(IllegalArgumentException invalid){call.reject("Invalid keep request");}
 });}
 @PluginMethod public void share(PluginCall call){submit(call,()->{
  try{
   if(call.getString("id","").startsWith("m:")){
    String key=call.getString("id"),revision=call.getString("revision");if(revision==null||revision.isEmpty())throw new IllegalArgumentException();permitted.read(key,revision,false);
    call.resolve(SelectedDocumentAccess.shareUri(getActivity(),permitted.uri(MediaLibraryKey.parse(key))));return;
   }
   String key=call.getString("id","");long id=id(key);boolean video=key.startsWith("v:");
   Uri uri=uri(id,video);
   try(Cursor row=getContext().getContentResolver().query(CATALOG,fields(),owned()+" AND _id=? AND media_type=?",new String[]{getContext().getPackageName(),Long.toString(id),video?"3":"1"},null)){
    if(row==null||!row.moveToFirst())throw new IllegalArgumentException();
   }
   call.resolve(SelectedDocumentAccess.shareUri(getActivity(),uri));
  }catch(Exception failure){call.reject("This saved media is no longer available");}
 });}
 @PluginMethod public void shareMany(PluginCall call){submit(call,()->{
  try{
   JSArray items=call.getArray("items");if(items==null||items.length()<1||items.length()>20)throw new IllegalArgumentException();
   java.util.ArrayList<Uri> uris=new java.util.ArrayList<>();java.util.Set<String> unique=new java.util.HashSet<>();String mime=null;
   for(int i=0;i<items.length();i++){
    org.json.JSONObject item=items.getJSONObject(i);String key=item.getString("id");if(!unique.add(key))throw new IllegalArgumentException();Uri uri;
    if(key.startsWith("m:")){String revision=item.getString("revision");if(revision.isEmpty())throw new IllegalArgumentException();permitted.read(key,revision,false);uri=permitted.uri(MediaLibraryKey.parse(key));}
    else {if(!key.matches("(?:v:)?[1-9][0-9]*"))throw new IllegalArgumentException();boolean video=key.startsWith("v:");long itemId=id(key);
    try(Cursor row=getContext().getContentResolver().query(CATALOG,fields(),owned()+" AND _id=? AND media_type=?",new String[]{getContext().getPackageName(),Long.toString(itemId),video?"3":"1"},null)){
     if(row==null||!row.moveToFirst()||!mutationRevision(row).equals(item.getString("revision")))throw new IllegalArgumentException();
    }
    uri=uri(itemId,video);}
    try(android.content.res.AssetFileDescriptor file=getContext().getContentResolver().openAssetFileDescriptor(uri,"r")){if(file==null)throw new IllegalArgumentException();}
    String type=getContext().getContentResolver().getType(uri);if(type==null)type="application/octet-stream";mime=mime==null?type:mime.equals(type)?mime:mime.startsWith("image/")&&type.startsWith("image/")?"image/*":mime.startsWith("video/")&&type.startsWith("video/")?"video/*":"*/*";uris.add(uri);
   }
   android.content.Intent send=new android.content.Intent(android.content.Intent.ACTION_SEND_MULTIPLE).setType(mime).putParcelableArrayListExtra(android.content.Intent.EXTRA_STREAM,uris).addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
   android.content.ClipData clip=android.content.ClipData.newRawUri("Selected media",uris.get(0));for(int i=1;i<uris.size();i++)clip.addItem(new android.content.ClipData.Item(uris.get(i)));send.setClipData(clip);
   getActivity().runOnUiThread(()->{if(destroyed||getActivity().isFinishing()||!getActivity().hasWindowFocus()){call.reject("Return to Photos and share the selection again");return;}try{getActivity().startActivity(android.content.Intent.createChooser(send,"Share selected media"));JSObject result=new JSObject();result.put("status","opened");result.put("count",uris.size());call.resolve(result);}catch(RuntimeException failure){call.reject("Android sharing could not open");}});
  }catch(Exception failure){call.reject("A selected item changed or is unavailable. Reselect the media before sharing.");}
 });}
 @PluginMethod public void setTrashed(PluginCall call){setFlag(call,false);}
 @PluginMethod public void setFavorite(PluginCall call){setFlag(call,true);}
 private JSObject changeFlag(String key,String revision,boolean favorite,boolean desired)throws Exception{
  if(Build.VERSION.SDK_INT<30)throw new IllegalArgumentException("unsupported");
  if(key==null||!key.matches("(?:v:)?[1-9][0-9]*")||revision==null||revision.isEmpty()||revision.length()>160)throw new IllegalArgumentException("invalid");
  long itemId=id(key);boolean video=key.startsWith("v:");
   Bundle query=new Bundle();query.putInt(MediaStore.QUERY_ARG_MATCH_TRASHED,MediaStore.MATCH_INCLUDE);
   String selection=MediaStore.MediaColumns.OWNER_PACKAGE_NAME+"=? AND is_pending=0 AND _id=? AND media_type=?";
   String[] args={getContext().getPackageName(),Long.toString(itemId),video?"3":"1"};
   query.putString(ContentResolver.QUERY_ARG_SQL_SELECTION,selection);query.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS,args);
   long generation;
   try(Cursor row=getContext().getContentResolver().query(CATALOG,fields(),query,null)){
    if(row==null||!row.moveToFirst()||!revision.equals(mutationRevision(row))||(favorite&&row.getInt(7)!=0)){throw new IllegalStateException("stale");}
    if((row.getInt(favorite?10:7)==1)==desired){JSObject unchanged=metadata(row);unchanged.put("status","unchanged");return unchanged;}
    generation=row.getLong(9);
   }
   android.content.ContentValues values=new android.content.ContentValues();values.put(favorite?MediaStore.MediaColumns.IS_FAVORITE:MediaStore.MediaColumns.IS_TRASHED,desired?1:0);
   Bundle update=new Bundle(query);update.putString(ContentResolver.QUERY_ARG_SQL_SELECTION,selection+" AND generation_modified=? AND "+(favorite?"is_trashed=0 AND is_favorite":"is_trashed")+"=?");
   update.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS,new String[]{args[0],args[1],args[2],Long.toString(generation),desired?"0":"1"});
   int changed=getContext().getContentResolver().update(uri(itemId,video),values,update);
   if(changed!=1){throw new IllegalStateException("stale");}
   if(video&&!favorite)playback.revoke(uri(itemId,true));
   try(Cursor row=getContext().getContentResolver().query(CATALOG,fields(),query,null)){
    if(row==null||!row.moveToFirst()||(row.getInt(favorite?10:7)==1)!=desired){throw new IllegalStateException("unverified");}
    String base=row.getLong(3)+":"+row.getLong(4);if(!mediaVersions.edit().putString(key,base+"|"+row.getLong(9)).commit())throw new IllegalStateException("unverified");
    JSObject result=metadata(row);result.put("status",favorite?(desired?"favorited":"unfavorited"):(desired?"trashed":"restored"));return result;
   }
 }
 private void setFlag(PluginCall call,boolean favorite){submit(call,()->{
  try{Boolean desired=call.getBoolean(favorite?"favorite":"trashed");if(desired==null)throw new IllegalArgumentException();if(call.getString("id","").startsWith("m:")){mediaReview.request(call,java.util.List.of(call.getString("id")),java.util.List.of(call.getString("revision")),favorite,desired,false);return;}call.resolve(changeFlag(call.getString("id"),call.getString("revision"),favorite,desired));}
  catch(Exception failure){call.reject("This media changed or could not be verified. Refresh Photos before trying again.");}
 });}
 /** A bounded partial operation, never an atomic all-or-nothing promise. */
 @PluginMethod public void changeMany(PluginCall call){submit(call,()->{
  try{
   String operation=call.getString("operation","");if(!operation.equals("favorite")&&!operation.equals("trash")&&!operation.equals("restore"))throw new IllegalArgumentException();
   JSArray items=call.getArray("items");if(items==null||items.length()<1||items.length()>20)throw new IllegalArgumentException();
   boolean permittedItems=false;for(int i=0;i<items.length();i++)if(items.getJSONObject(i).getString("id").startsWith("m:"))permittedItems=true;
   if(permittedItems){java.util.List<String> keys=new java.util.ArrayList<>(),revisions=new java.util.ArrayList<>();for(int i=0;i<items.length();i++){keys.add(items.getJSONObject(i).getString("id"));revisions.add(items.getJSONObject(i).getString("revision"));}mediaReview.request(call,keys,revisions,operation.equals("favorite"),!operation.equals("restore"),true);return;}
   java.util.Set<String> seen=new java.util.HashSet<>();
   // Validate the complete request before the first write.
   for(int i=0;i<items.length();i++){org.json.JSONObject item=items.getJSONObject(i);String key=item.getString("id"),revision=item.getString("revision");if(!key.matches("(?:v:)?[1-9][0-9]*")||!seen.add(key)||revision.isEmpty()||revision.length()>160)throw new IllegalArgumentException();id(key);}
   JSArray outcomes=new JSArray();int verified=0;
   for(int i=0;i<items.length();i++){
    org.json.JSONObject item=items.getJSONObject(i);JSObject outcome=new JSObject();outcome.put("id",item.getString("id"));
    try{if(destroyed)throw new IllegalStateException("unverified");JSObject result=changeFlag(item.getString("id"),item.getString("revision"),operation.equals("favorite"),!operation.equals("restore"));outcome.put("status",result.getString("status"));outcome.put("item",result);verified++;}
    catch(IllegalStateException stale){outcome.put("status","stale".equals(stale.getMessage())?"stale":"unverified");}
    catch(Exception failed){outcome.put("status",Build.VERSION.SDK_INT<30?"unsupported":"unverified");}
    outcomes.put(outcome);
   }
   JSObject result=new JSObject();result.put("status",verified==items.length()?"complete":"partial");result.put("outcomes",outcomes);call.resolve(result);
  }catch(Exception invalid){call.reject("Select 1–20 distinct owned items with current revisions.");}
 });}
 private static final class TrashItem {final String key;final long generation;TrashItem(String key,long generation){this.key=key;this.generation=generation;}}
 private static final class TrashConfirmation {final long until=android.os.SystemClock.elapsedRealtime()+120000;final java.util.List<TrashItem> items;TrashConfirmation(java.util.List<TrashItem> items){this.items=java.util.List.copyOf(items);}}
 private final java.util.LinkedHashMap<String,TrashConfirmation> confirmations=new java.util.LinkedHashMap<>();
 @PluginMethod public void summary(PluginCall call){submit(call,()->{
  try{
   if(!"denied".equals(permitted.access().getString("scope"))){call.resolve(permitted.summary());return;}
   Bundle query=new Bundle();query.putString(ContentResolver.QUERY_ARG_SQL_SELECTION,MediaStore.MediaColumns.OWNER_PACKAGE_NAME+"=? AND is_pending=0"+MEDIA);query.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS,new String[]{getContext().getPackageName()});
   if(Build.VERSION.SDK_INT>=30)query.putInt(MediaStore.QUERY_ARG_MATCH_TRASHED,MediaStore.MATCH_INCLUDE);
   int favorite=0,videos=0,trash=0;
   try(Cursor rows=getContext().getContentResolver().query(CATALOG,fields(),query,null)){
    if(rows==null)throw new IllegalStateException();while(rows.moveToNext()){if(Build.VERSION.SDK_INT>=30&&rows.getInt(7)==1){trash++;continue;}if(rows.getInt(5)==3)videos++;if(Build.VERSION.SDK_INT>=30&&rows.getInt(10)==1)favorite++;}
   }
   JSObject result=new JSObject();result.put("favorites",favorite);result.put("videos",videos);result.put("trash",trash);result.put("canFavorite",Build.VERSION.SDK_INT>=30);call.resolve(result);
  }catch(Exception failure){call.reject("Album counts could not be loaded");}
 });}
 @PluginMethod public void prepareDeleteTrash(PluginCall call){submit(call,()->{
  if(Build.VERSION.SDK_INT<30){call.reject("Android trash requires Android 11 or later");return;}
  try{
   Bundle query=new Bundle();query.putString(ContentResolver.QUERY_ARG_SQL_SELECTION,owned(true)+MEDIA);query.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS,new String[]{getContext().getPackageName()});query.putInt(MediaStore.QUERY_ARG_MATCH_TRASHED,MediaStore.MATCH_ONLY);query.putInt(ContentResolver.QUERY_ARG_LIMIT,501);
   java.util.List<TrashItem> items=new java.util.ArrayList<>();
   try(Cursor rows=getContext().getContentResolver().query(CATALOG,fields(),query,null)){
    if(rows==null)throw new IllegalStateException();while(rows.moveToNext()){if(items.size()>=500){call.reject("More than 500 owned items are in trash. Manage a smaller batch in Android Photos.");return;}items.add(new TrashItem((rows.getInt(5)==3?"v:":"")+rows.getLong(0),rows.getLong(9)));}
   }
   confirmations.entrySet().removeIf(entry->entry.getValue().until<android.os.SystemClock.elapsedRealtime());while(confirmations.size()>=4)confirmations.remove(confirmations.keySet().iterator().next());
   String token=java.util.UUID.randomUUID().toString();confirmations.put(token,new TrashConfirmation(items));JSObject result=new JSObject();result.put("confirmation",token);result.put("count",items.size());call.resolve(result);
  }catch(Exception failure){call.reject("Trash could not be prepared for confirmation");}
 });}
 @PluginMethod public void cancelDeleteTrash(PluginCall call){submit(call,()->{confirmations.remove(call.getString("confirmation",""));call.resolve();});}
 @PluginMethod public void deletePreparedTrash(PluginCall call){submit(call,()->{
  if(Build.VERSION.SDK_INT<30){call.reject("Android trash requires Android 11 or later");return;}
  TrashConfirmation confirmation=confirmations.remove(call.getString("confirmation",""));
  if(confirmation==null||confirmation.until<android.os.SystemClock.elapsedRealtime()){call.reject("Delete confirmation expired. Review trash again.");return;}
  JSArray deleted=new JSArray(),skipped=new JSArray(),failed=new JSArray();
  for(TrashItem item:confirmation.items){
   if(destroyed){failed.put(item.key);continue;}
   try{
    boolean video=item.key.startsWith("v:");long itemId=id(item.key);
    // A typed URI delete can reject a now-restored row before applying the SQL
    // predicate. Classify immutable-snapshot mismatches without requesting deletion.
    Bundle inspect=new Bundle();inspect.putInt(MediaStore.QUERY_ARG_MATCH_TRASHED,MediaStore.MATCH_INCLUDE);
    inspect.putString(ContentResolver.QUERY_ARG_SQL_SELECTION,MediaStore.MediaColumns.OWNER_PACKAGE_NAME+"=? AND is_pending=0 AND _id=? AND media_type=?");inspect.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS,new String[]{getContext().getPackageName(),Long.toString(itemId),video?"3":"1"});
    try(Cursor row=getContext().getContentResolver().query(CATALOG,fields(),inspect,null)){
     if(row==null)throw new IllegalStateException();if(!row.moveToFirst()||row.getInt(7)!=1||row.getLong(9)!=item.generation){skipped.put(item.key);continue;}
    }
    Bundle query=new Bundle();query.putInt(MediaStore.QUERY_ARG_MATCH_TRASHED,MediaStore.MATCH_ONLY);
    query.putString(ContentResolver.QUERY_ARG_SQL_SELECTION,owned(true)+" AND _id=? AND media_type=? AND generation_modified=?");query.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS,new String[]{getContext().getPackageName(),Long.toString(itemId),video?"3":"1",Long.toString(item.generation)});
    int count=getContext().getContentResolver().delete(uri(itemId,video),query);
    if(count==1){deleted.put(item.key);mediaVersions.edit().remove(item.key).apply();if(video)playback.revoke(uri(itemId,true));}else skipped.put(item.key);
   }catch(Exception failure){failed.put(item.key);}
  }
  JSObject result=new JSObject();result.put("deletedIds",deleted);result.put("skippedIds",skipped);result.put("failedIds",failed);result.put("status",skipped.length()+failed.length()==0?"deleted":"partial");call.resolve(result);
 });}

 static final Object ALBUMS_LOCK=new Object();
 private android.content.SharedPreferences albumsStore(){return getContext().getSharedPreferences("alpha-owned-albums",0);}
 private org.json.JSONArray albumsData()throws Exception{return new org.json.JSONArray(albumsStore().getString("albums","[]"));}
 private String mediaIdentity(Cursor row){return row.getLong(3)+":"+row.getLong(4)+":"+row.getLong(11);}
 private org.json.JSONObject albumById(org.json.JSONArray albums,String id)throws Exception{for(int i=0;i<albums.length();i++)if(albums.getJSONObject(i).getString("id").equals(id))return albums.getJSONObject(i);throw new IllegalArgumentException("Album is no longer available");}
 private String albumName(String value){String name=value==null?"":value.trim();if(name.isEmpty()||name.length()>80||name.chars().anyMatch(c->Character.isISOControl(c)))throw new IllegalArgumentException("Use an album name of 1–80 characters");return name;}
 private JSArray albumRows(org.json.JSONObject album,boolean thumbnails,long before,int limit)throws Exception{
  org.json.JSONArray members=album.getJSONArray("members");java.util.Map<String,String> allowed=new java.util.HashMap<>();java.util.List<String> args=new java.util.ArrayList<>();args.add(getContext().getPackageName());StringBuilder ids=new StringBuilder();
  for(int i=0;i<members.length();i++){org.json.JSONObject member=members.getJSONObject(i);String key=member.getString("id");if(key.startsWith("m:"))continue;allowed.put(key,member.getString("identity"));if(ids.length()>0)ids.append(',');ids.append('?');args.add(Long.toString(id(key)));}
  JSArray result=new JSArray();if(allowed.isEmpty())return result;
  try(Cursor rows=getContext().getContentResolver().query(CATALOG,fields(),owned()+MEDIA+" AND _id IN ("+ids+")",args.toArray(new String[0]),"_id DESC")){
   if(rows==null)throw new IllegalStateException();while(rows.moveToNext()){
    String key=(rows.getInt(5)==3?"v:":"")+rows.getLong(0);if(rows.getLong(0)>=before||!mediaIdentity(rows).equals(allowed.get(key)))continue;
    JSObject row=metadata(rows);if(thumbnails){try{row.put("image",image(rows.getLong(0),rows.getInt(5)==3,240));}catch(Exception unavailable){row.put("image","");}}result.put(row);if(result.length()>=limit)break;
   }
  }return result;
 }
 /** Metadata-only permitted members, read in one batched query per volume and type. */
 private JSArray permittedAlbumRows(org.json.JSONObject album,int offset,int limit)throws Exception{
  org.json.JSONArray members=album.getJSONArray("members");java.util.List<String[]> wanted=new java.util.ArrayList<>();java.util.List<Integer> offsets=new java.util.ArrayList<>();
  for(int i=offset;i<members.length();i++){org.json.JSONObject member=members.getJSONObject(i);String key=member.getString("id");if(!key.startsWith("m:"))continue;wanted.add(new String[]{key,member.getString("identity")});offsets.add(i+1);}
  java.util.Map<String,JSObject> found=permitted.albumItems(wanted);JSArray result=new JSArray();
  // Retain membership, withhold inaccessible/changed media.
  for(int i=0;i<wanted.size()&&result.length()<limit;i++){JSObject row=found.get(wanted.get(i)[0]);if(row==null)continue;row.put("albumOffset",offsets.get(i));result.put(row);}
  return result;
 }
 private boolean hasPermittedMembers(org.json.JSONObject album)throws Exception{org.json.JSONArray members=album.getJSONArray("members");for(int i=0;i<members.length();i++)if(members.getJSONObject(i).getString("id").startsWith("m:"))return true;return false;}
 private void listCustomAlbum(PluginCall call,String id)throws Exception{
  if(Build.VERSION.SDK_INT<30)throw new IllegalArgumentException("Owned albums require Android 11 or later");
  PermittedMediaCatalog.Fence fence=permitted.fence();org.json.JSONObject album=albumById(albumsData(),id);String cursor=call.getString("before","");
  if(hasPermittedMembers(album)){
   String prefix="library:"+album.getString("revision")+":"+fence.cursorIdentity()+":";int offset=0;if(!cursor.isEmpty()){if(!cursor.startsWith(prefix))throw new IllegalArgumentException("Album changed");offset=Integer.parseInt(cursor.substring(prefix.length()));if(offset<0||offset>200)throw new IllegalArgumentException();}
   java.util.List<org.json.JSONObject> rows=new java.util.ArrayList<>();JSArray legacy=albumRows(album,false,Long.MAX_VALUE,200),full=permittedAlbumRows(album,0,200);for(int i=0;i<legacy.length();i++)rows.add(legacy.getJSONObject(i));for(int i=0;i<full.length();i++)rows.add(full.getJSONObject(i));rows.sort((a,b)->a.optString("id").compareTo(b.optString("id")));
   // The fence covers only the metadata listing; thumbnails (up to 3 s each) load afterwards and
   // each permitted thumbnail rechecks its own item revision.
   permitted.requireCurrent(fence);
   JSArray items=new JSArray();int end=Math.min(rows.size(),offset+24);for(int i=offset;i<end;i++){org.json.JSONObject row=rows.get(i);String key=row.getString("id");try{if(key.startsWith("m:"))row=permitted.albumItem(key,row.getString("identity"),true);else row.put("image",image(id(key),key.startsWith("v:"),240));}catch(Exception unavailable){continue;}items.put(row);}
   JSObject result=new JSObject();result.put("items",items);result.put("next",end<rows.size()?prefix+end:"");result.put("name",album.getString("name"));result.put("revision",album.getString("revision"));call.resolve(result);return;
  }
  long before=cursor.isEmpty()?Long.MAX_VALUE:Long.parseLong(cursor);if(before<=0)throw new IllegalArgumentException();
  JSArray found=albumRows(album,true,before,25),items=new JSArray();String next="";for(int i=0;i<found.length()&&i<24;i++)items.put(found.getJSONObject(i));if(found.length()>24)next=Long.toString(id(items.getJSONObject(23).getString("id")));
  JSObject result=new JSObject();result.put("items",items);result.put("next",next);result.put("name",album.getString("name"));result.put("revision",album.getString("revision"));call.resolve(result);
 }
 @PluginMethod public void albums(PluginCall call){submit(call,()->{
  if(Build.VERSION.SDK_INT<30){call.reject("Owned albums require Android 11 or later");return;}
  try{PermittedMediaCatalog.Fence fence=permitted.fence();org.json.JSONArray albums=albumsData();JSArray result=new JSArray();for(int i=0;i<albums.length();i++){org.json.JSONObject album=albums.getJSONObject(i);JSObject row=new JSObject();row.put("id",album.getString("id"));row.put("name",album.getString("name"));row.put("revision",album.getString("revision"));JSArray active=albumRows(album,false,Long.MAX_VALUE,200);JSArray full=permittedAlbumRows(album,0,200);for(int j=0;j<full.length();j++)active.put(full.getJSONObject(j));row.put("count",active.length());JSArray members=new JSArray();for(int j=0;j<active.length();j++)members.put(active.getJSONObject(j).getString("id"));row.put("memberIds",members);result.put(row);}JSObject response=new JSObject();response.put("items",result);permitted.requireCurrent(fence);call.resolve(response);}catch(Exception failure){call.reject("Owned albums could not be loaded");}
 });}
 @PluginMethod public void changeAlbum(PluginCall call){submit(call,()->{
  if(Build.VERSION.SDK_INT<30){call.reject("Owned albums require Android 11 or later");return;}
  synchronized(ALBUMS_LOCK){
  if(destroyed){call.reject("Photo library closed");return;}
  try{
   org.json.JSONArray albums=albumsData();String operation=call.getString("operation","");org.json.JSONObject album;
   if(operation.equals("create")){if(albums.length()>=24)throw new IllegalArgumentException("At most 24 custom albums are supported");album=new org.json.JSONObject().put("id",java.util.UUID.randomUUID().toString()).put("name",albumName(call.getString("name"))).put("members",new org.json.JSONArray());albums.put(album);}
   else{album=albumById(albums,call.getString("id",""));if(!album.getString("revision").equals(call.getString("revision")))throw new IllegalArgumentException("Album changed. Reopen it before trying again");}
   if(operation.equals("create")||operation.equals("add")){
    String key=call.getString("mediaId","");
    if(key.startsWith("m:")){
     JSObject item=permitted.read(key,call.getString("mediaRevision"),false);org.json.JSONArray members=album.getJSONArray("members"),next=new org.json.JSONArray();for(int i=0;i<members.length();i++)if(!members.getJSONObject(i).getString("id").equals(key))next.put(members.getJSONObject(i));
     if(next.length()>=200)throw new IllegalArgumentException("An album supports at most 200 items");next.put(new org.json.JSONObject().put("id",key).put("identity",item.getString("identity")));album.put("members",next);
    }else{
    if(!key.matches("(?:v:)?[1-9][0-9]*"))throw new IllegalArgumentException("Select owned media first");
    try(Cursor row=getContext().getContentResolver().query(CATALOG,fields(),owned()+" AND _id=? AND media_type=?",new String[]{getContext().getPackageName(),Long.toString(id(key)),key.startsWith("v:")?"3":"1"},null)){
     if(row==null||!row.moveToFirst()||!mutationRevision(row).equals(call.getString("mediaRevision")))throw new IllegalArgumentException("Media changed. Reselect it before trying again");
     org.json.JSONArray members=album.getJSONArray("members"),next=new org.json.JSONArray();for(int i=0;i<members.length();i++)if(!members.getJSONObject(i).getString("id").equals(key))next.put(members.getJSONObject(i));
     if(next.length()>=200)throw new IllegalArgumentException("An album supports at most 200 owned items");next.put(new org.json.JSONObject().put("id",key).put("identity",mediaIdentity(row)));album.put("members",next);
    }
    }
   }else if(operation.equals("remove")){String key=call.getString("mediaId","");org.json.JSONArray members=album.getJSONArray("members"),next=new org.json.JSONArray();for(int i=0;i<members.length();i++)if(!members.getJSONObject(i).getString("id").equals(key))next.put(members.getJSONObject(i));if(next.length()==members.length())throw new IllegalArgumentException("Media is no longer in this album");album.put("members",next);}
   else if(operation.equals("rename"))album.put("name",albumName(call.getString("name")));
   else if(operation.equals("delete")){org.json.JSONArray next=new org.json.JSONArray();for(int i=0;i<albums.length();i++)if(!albums.getJSONObject(i).getString("id").equals(album.getString("id")))next.put(albums.getJSONObject(i));albums=next;}
   else throw new IllegalArgumentException("Unsupported album operation");
   album.put("revision",java.util.UUID.randomUUID().toString());if(!albumsStore().edit().putString("albums",albums.toString()).commit())throw new IllegalStateException();
   JSObject result=new JSObject();result.put("status",operation.equals("delete")?"deleted":"saved");result.put("id",album.getString("id"));result.put("revision",album.getString("revision"));call.resolve(result);
  }catch(IllegalArgumentException failure){call.reject(failure.getMessage());}catch(Exception failure){call.reject("Album could not be saved. Reload albums before trying again");}
  }
 });}
 @Override protected void handleOnDestroy(){destroyed=true;if(mediaReview!=null)mediaReview.close();if(permitted!=null)permitted.close();if(edits!=null)edits.cancel(null);try{worker.execute(()->{if(edits!=null)edits.close();});}catch(java.util.concurrent.RejectedExecutionException ignored){}worker.shutdown();if(playback!=null)playback.clear();}
}
