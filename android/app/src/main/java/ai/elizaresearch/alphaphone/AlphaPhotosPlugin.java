package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.media.MediaLibraryKey;
import ai.eliza.plugins.media.OwnedAlbums;
import ai.eliza.plugins.media.OwnedMediaLibrary;
import ai.eliza.plugins.media.OwnedCaptures;
import ai.eliza.plugins.media.OwnedMediaConfig;
import ai.eliza.plugins.media.OwnedPhotoEdits;
import ai.eliza.plugins.media.OwnedVideoPlayback;
import ai.eliza.plugins.media.PermittedMediaCatalog;
import ai.eliza.plugins.media.PermittedMediaReview;
import ai.eliza.plugins.media.VideoCopyEdits;

import android.net.Uri;
import android.os.Build;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Permission-filtered library reads and explicitly reviewed media management. The catalog, review,
 * owned library, custom albums, edit-as-copy and playback engines are the shared native media
 * module's; this plugin binds them to Capacitor and keeps Alpha's installed names (preference
 * files alpha-owned-media-versions and alpha-owned-albums through the "alpha" namespace, MediaStore
 * folders, display-name prefixes, playback path) and its permission and focus gates.
 */
@CapacitorPlugin(name="AlphaPhotos",permissions={
 @Permission(alias="libraryLegacy",strings={"android.permission.READ_EXTERNAL_STORAGE"}),
 @Permission(alias="libraryImages",strings={"android.permission.READ_MEDIA_IMAGES"}),
 @Permission(alias="libraryVideos",strings={"android.permission.READ_MEDIA_VIDEO"}),
 @Permission(alias="librarySelected",strings={"android.permission.READ_MEDIA_VISUAL_USER_SELECTED"})
})
public class AlphaPhotosPlugin extends Plugin {
 /** Debug QA markers are a closed enum: never include media data or exception text. */
 enum Diagnostic {READ_INVOKED,READ_SUCCEEDED,READ_FAILED_SECURITY,READ_FAILED_ARGUMENT,READ_FAILED_IO,READ_FAILED_OTHER,LIBRARY_CHANGED_RESUME,LIBRARY_CHANGED_CATALOG}
 static void diagnostic(Diagnostic marker){if(BuildConfig.DEBUG)android.util.Log.i("AlphaPhotosQA",marker.name());}
 static void diagnosticReadFailure(Exception failure){
  diagnostic(failure instanceof SecurityException?Diagnostic.READ_FAILED_SECURITY:failure instanceof IllegalArgumentException?Diagnostic.READ_FAILED_ARGUMENT:failure instanceof java.io.IOException?Diagnostic.READ_FAILED_IO:Diagnostic.READ_FAILED_OTHER);
 }

 private PermittedMediaCatalog permitted;
 private PermittedMediaReview mediaReview;
 private OwnedVideoPlayback playback;
 static final OwnedMediaConfig MEDIA_CONFIG=AlphaMediaConfig.MEDIA;
 private OwnedPhotoEdits edits;
 private VideoCopyEdits videoCopies;
 private OwnedCaptures captures;
 private OwnedMediaLibrary owned;
 private OwnedAlbums albums;
 /** The shared album write gate; instrumentation tests hold it to stall real album writers. */
 static final Object ALBUMS_LOCK=OwnedAlbums.LOCK;
 private volatile boolean destroyed;
 private void submit(PluginCall call,Runnable action){
  if(destroyed){call.reject("Photo library closed");return;}
  PluginWorkers.submit(worker,()->{if(destroyed)call.reject("Photo library closed");else action.run();},()->call.reject("Photo library closed"));
 }
 @Override public void load(){
  // Observation starts only while the Photos grid is open (watchLibrary). Playback grants recheck
  // their item's revision on every byte request, so unrelated media writes do not revoke them.
  permitted=new PermittedMediaCatalog(getContext(),false,()->{if(!destroyed){diagnostic(Diagnostic.LIBRARY_CHANGED_CATALOG);notifyListeners("libraryChanged",new JSObject());}});mediaReview=new PermittedMediaReview(getBridge(),permitted,worker,LateLaunch::ask);edits=new OwnedPhotoEdits(getContext(), MEDIA_CONFIG,new OwnedPhotoEdits.SourceAccess(){
  public boolean accepts(String id){return id!=null&&id.startsWith("m:");}
  public Uri source(String id)throws Exception{revision(id);return permitted.uri(MediaLibraryKey.parse(id));}
  public String revision(String id)throws Exception{MediaLibraryKey key=MediaLibraryKey.parse(id);if(key.video)throw new IllegalArgumentException("Only still photos support edit copies");JSObject item=permitted.read(id,null,false);if(item.getLong("size")>32L*1024*1024)throw new IllegalArgumentException("Edit copies support source files up to 32 MB");return item.getString("mutationRevision");}
 });captures=new OwnedCaptures(getContext(), MEDIA_CONFIG);playback=new OwnedVideoPlayback(getBridge(),AlphaMediaConfig.PLAYBACK_PATH);owned=new OwnedMediaLibrary(getContext(),MEDIA_CONFIG,playback::revoke);albums=new OwnedAlbums(getContext(),MEDIA_CONFIG,owned,permitted);getBridge().setWebViewClient(playback);}
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
 static String[] libraryPermissionAliases(){return Build.VERSION.SDK_INT>=34?new String[]{"libraryImages","libraryVideos","librarySelected"}:Build.VERSION.SDK_INT>=33?new String[]{"libraryImages","libraryVideos"}:new String[]{"libraryLegacy"};}
 /** Only the explicit Photos permission control invokes this, never list/read/resume. */
 @PluginMethod public void requestLibraryAccess(PluginCall call){
  if(destroyed||!getActivity().hasWindowFocus()){call.reject("Return to Photos to choose access");return;}
  String[] aliases=libraryPermissionAliases();
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
 @Override protected void handleOnPause(){if(videoCopies!=null)videoCopies.cancel(null);if(permitted!=null){permitted.watch("photos",false);permitted.foreground(false);}if(playback!=null)playback.clear();}
 @Override protected void handleOnResume(){if(permitted!=null)permitted.foreground(true);diagnostic(Diagnostic.LIBRARY_CHANGED_RESUME);notifyListeners("libraryChanged",new JSObject());}
 private final ExecutorService worker=Executors.newSingleThreadExecutor();
 @PluginMethod public void beginEdit(PluginCall call){submit(call,()->{try{call.resolve(edits.begin(call.getString("id"),call.getString("revision")));}catch(Exception e){call.reject(e.getMessage()==null?"Photo editor unavailable":e.getMessage());}});}
 @PluginMethod public void previewEdit(PluginCall call){submit(call,()->{try{call.resolve(edits.preview(call.getString("sessionId"),call.getInt("rotation",0),call.getBoolean("crop",false),call.getString("filter","none")));}catch(Exception e){call.reject(e.getMessage()==null?"Preview unavailable":e.getMessage());}});}
 @PluginMethod public void saveEdit(PluginCall call){submit(call,()->{try{call.resolve(edits.save(call.getString("sessionId"),call.getInt("rotation",0),call.getBoolean("crop",false),call.getString("filter","none")));}catch(Exception e){call.reject(e.getMessage()==null?"Save outcome unknown; inspect Photos before retrying":e.getMessage());}});}
 @PluginMethod public void editResult(PluginCall call){if(VideoCopyEdits.isVideoOperation(call.getString("operationId"))){try{videoCopies().result(call.getString("operationId"),call);}catch(Exception unavailable){call.reject("Saved-copy outcome could not be confirmed");}return;}submit(call,()->{try{call.resolve(edits.result(call.getString("operationId")));}catch(Exception e){call.reject("Saved-copy outcome could not be confirmed");}});}
 @PluginMethod public void cancelEdit(PluginCall call){edits.cancel(call.getString("sessionId"));submit(call,()->{edits.releaseCancelled();call.resolve();});}
 private synchronized VideoCopyEdits videoCopies()throws java.io.IOException{if(destroyed)throw new java.io.IOException("Photo library closed");if(videoCopies==null)videoCopies=new VideoCopyEdits(getContext(),MEDIA_CONFIG,new VideoCopyEdits.Sources(){@Override public VideoCopyEdits.Source read(String key,String expected)throws Exception{return videoSource(key,expected,true);}@Override public VideoCopyEdits.Source recheck(String key,String expected)throws Exception{return videoSource(key,expected,false);}},()->!destroyed&&getActivity()!=null&&getActivity().hasWindowFocus());return videoCopies;}
 // Native-only reviewed recovery; deliberately absent from the Capacitor/JS API.
 void preserveClosedVideoCopy(String operationId,String expectedRecordHash,PluginCall call){
  if(destroyed||getActivity()==null||!getActivity().hasWindowFocus()){call.reject("Video copy preservation refused");return;}
  try{videoCopies().preserveClosedFailure(operationId,expectedRecordHash,call);}catch(Exception refused){call.reject("Video copy preservation refused");}
 }
 /** The renderer supplies an existing catalog identity/revision, never a URI or file path. */
 /** {@code opening}: an editor is being opened, so Photos must have window focus. Later rechecks keep every
  * identity, access and revision check but not focus, so a shade pulled down mid-export keeps the export. */
 private VideoCopyEdits.Source videoSource(String key,String expected,boolean opening)throws Exception{
  if(destroyed||getActivity()==null||opening&&!getActivity().hasWindowFocus()||expected==null)throw new IllegalStateException("Return to Photos and reopen the video");
  JSObject record;Uri source;
  if(key!=null&&key.startsWith("m:")){MediaLibraryKey media=MediaLibraryKey.parse(key);if(!media.video)throw new IllegalArgumentException("Choose a video");record=permitted.read(key,null,false,false);source=permitted.uri(media);}
  else{if(!OwnedMediaLibrary.isOwnedKey(key)||!OwnedMediaLibrary.video(key))throw new IllegalArgumentException("Choose a video");record=owned.metadata(key,false);source=OwnedMediaLibrary.uri(key);}
  String revision=record.getString("mutationRevision");if(!expected.equals(revision))throw new IllegalArgumentException("Video changed. Close and reopen the editor.");return new VideoCopyEdits.Source(source,revision);
 }
 @PluginMethod public void beginVideoEdit(PluginCall call){try{videoCopies().begin(call.getString("id"),call.getString("revision"),call);}catch(Exception unavailable){call.reject("Video editor is unavailable. Original unchanged.");}}
 @PluginMethod public void saveVideoEdit(PluginCall call){try{videoCopies().save(call.getString("sessionId"),call.getDouble("start",Double.NaN),call.getDouble("end",Double.NaN),call.getInt("rotation",-1),call.getBoolean("crop",false),call);}catch(Exception unavailable){call.reject("Video edit could not start. Original unchanged.");}}
 @PluginMethod public void cancelVideoEdit(PluginCall call){if(videoCopies!=null)videoCopies.cancel(call.getString("sessionId"));call.resolve();}
 @PluginMethod public void list(PluginCall call){submit(call,()->{
  try{
   boolean trashed=call.getBoolean("trashed",false);if(trashed&&Build.VERSION.SDK_INT<30){call.reject("Android trash requires Android 11 or later");return;}
   String album=call.getString("album","");if(album.startsWith("custom:")){call.resolve(albums.list(album.substring(7),call.getString("before","")));return;}if(!album.isEmpty()&&!album.equals("favorites")&&!album.equals("videos"))throw new IllegalArgumentException();
   if(!"denied".equals(permitted.access().getString("scope"))){call.resolve(permitted.list(call.getString("before",""),"",album.equals("videos")?"video":"all",true,trashed?"trash":album.equals("favorites")?"favorites":"all"));return;}
   if(album.equals("favorites")&&Build.VERSION.SDK_INT<30){call.reject("Favorites require Android 11 or later");return;}
   call.resolve(owned.list(call.getString("before",""),trashed,album));
  }catch(Exception failure){call.reject("Saved media could not be loaded");}
 });}
 @PluginMethod public void read(PluginCall call){diagnostic(Diagnostic.READ_INVOKED);submit(call,()->{
  try{
   boolean trashed=Boolean.TRUE.equals(call.getBoolean("includeTrashed",false));
   if(call.getString("id","").startsWith("m:")){
    String key=call.getString("id");JSObject result=permitted.read(key,call.getString("revision"),true,trashed);MediaLibraryKey media=MediaLibraryKey.parse(key);String revision=result.getString("revision");
    if(media.video)result.put("path",playback.authorize(permitted.uri(media),()->{try{permitted.read(key,revision,false,trashed);}catch(Exception unavailable){throw new SecurityException("Selected video changed or is unavailable");}}));call.resolve(result);diagnostic(Diagnostic.READ_SUCCEEDED);return;
   }
   String key=call.getString("id","");JSObject result=owned.read(key,trashed);
   if(OwnedMediaLibrary.video(key))result.put("path",playback.authorize(OwnedMediaLibrary.uri(key)));call.resolve(result);diagnostic(Diagnostic.READ_SUCCEEDED);
  }catch(Exception failure){diagnosticReadFailure(failure);call.reject("This saved media is no longer available");}
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
   call.resolve(SelectedDocumentAccess.shareUri(getActivity(),owned.verified(call.getString("id",""),null)));
  }catch(Exception failure){call.reject("This saved media is no longer available");}
 });}
 @PluginMethod public void shareMany(PluginCall call){submit(call,()->{
  try{
   JSArray items=call.getArray("items");if(items==null||items.length()<1||items.length()>OwnedMediaLibrary.BATCH)throw new IllegalArgumentException();
   java.util.ArrayList<Uri> uris=new java.util.ArrayList<>();java.util.Set<String> unique=new java.util.HashSet<>();
   for(int i=0;i<items.length();i++){
    org.json.JSONObject item=items.getJSONObject(i);String key=item.getString("id");if(!unique.add(key))throw new IllegalArgumentException();
    if(key.startsWith("m:")){String revision=item.getString("revision");if(revision.isEmpty())throw new IllegalArgumentException();permitted.read(key,revision,false);uris.add(permitted.uri(MediaLibraryKey.parse(key)));}
    else uris.add(owned.verified(key,item.getString("revision")));
   }
   String mime=OwnedMediaLibrary.shareType(getContext().getContentResolver(),uris);
   android.content.Intent send=new android.content.Intent(android.content.Intent.ACTION_SEND_MULTIPLE).setType(mime).putParcelableArrayListExtra(android.content.Intent.EXTRA_STREAM,uris).addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
   android.content.ClipData clip=android.content.ClipData.newRawUri("Selected media",uris.get(0));for(int i=1;i<uris.size();i++)clip.addItem(new android.content.ClipData.Item(uris.get(i)));send.setClipData(clip);
   getActivity().runOnUiThread(()->{if(destroyed||getActivity().isFinishing()||!getActivity().hasWindowFocus()){call.reject("Return to Photos and share the selection again");return;}try{getActivity().startActivity(android.content.Intent.createChooser(send,"Share selected media"));JSObject result=new JSObject();result.put("status","opened");result.put("count",uris.size());call.resolve(result);}catch(RuntimeException failure){call.reject("Android sharing could not open");}});
  }catch(Exception failure){call.reject("A selected item changed or is unavailable. Reselect the media before sharing.");}
 });}
 @PluginMethod public void setTrashed(PluginCall call){setFlag(call,false);}
 @PluginMethod public void setFavorite(PluginCall call){setFlag(call,true);}
 private void setFlag(PluginCall call,boolean favorite){submit(call,()->{
  try{Boolean desired=call.getBoolean(favorite?"favorite":"trashed");if(desired==null)throw new IllegalArgumentException();if(call.getString("id","").startsWith("m:")){mediaReview.request(call,java.util.List.of(call.getString("id")),java.util.List.of(call.getString("revision")),favorite,desired,false);return;}call.resolve(owned.changeFlag(call.getString("id"),call.getString("revision"),favorite,desired));}
  catch(Exception failure){call.reject("This media changed or could not be verified. Refresh Photos before trying again.");}
 });}
 @PluginMethod public void deletePermittedTrash(PluginCall call){submit(call,()->{
  try{JSArray items=call.getArray("items");if(items==null||items.length()<1||items.length()>20)throw new IllegalArgumentException();java.util.List<String> ids=new java.util.ArrayList<>(),revisions=new java.util.ArrayList<>();for(int i=0;i<items.length();i++){org.json.JSONObject item=items.getJSONObject(i);String id=item.getString("id");MediaLibraryKey.parse(id);ids.add(id);revisions.add(item.getString("revision"));}mediaReview.deleteTrashed(call,ids,revisions);}
  catch(Exception invalid){call.reject("Select 1–20 unchanged deleted items again.");}
 });}
 /** A bounded partial operation, never an atomic all-or-nothing promise. */
 @PluginMethod public void changeMany(PluginCall call){submit(call,()->{
  try{
   String operation=call.getString("operation","");if(!operation.equals("favorite")&&!operation.equals("trash")&&!operation.equals("restore"))throw new IllegalArgumentException();
   JSArray items=call.getArray("items");if(items==null||items.length()<1||items.length()>OwnedMediaLibrary.BATCH)throw new IllegalArgumentException();
   boolean permittedItems=false;for(int i=0;i<items.length();i++)if(items.getJSONObject(i).getString("id").startsWith("m:"))permittedItems=true;
   if(permittedItems){java.util.List<String> keys=new java.util.ArrayList<>(),revisions=new java.util.ArrayList<>();for(int i=0;i<items.length();i++){keys.add(items.getJSONObject(i).getString("id"));revisions.add(items.getJSONObject(i).getString("revision"));}mediaReview.request(call,keys,revisions,operation.equals("favorite"),!operation.equals("restore"),true);return;}
   call.resolve(owned.changeMany(operation,items,()->destroyed));
  }catch(Exception invalid){call.reject("Select 1–20 distinct owned items with current revisions.");}
 });}
 @PluginMethod public void summary(PluginCall call){submit(call,()->{
  try{
   if(!"denied".equals(permitted.access().getString("scope"))){call.resolve(permitted.summary());return;}
   call.resolve(owned.summary());
  }catch(Exception failure){call.reject("Album counts could not be loaded");}
 });}
 @PluginMethod public void prepareDeleteTrash(PluginCall call){submit(call,()->{
  if(Build.VERSION.SDK_INT<30){call.reject("Android trash requires Android 11 or later");return;}
  try{call.resolve(owned.prepareDeleteTrash(call.getData().has("items")?call.getArray("items"):null));}
  catch(OwnedMediaLibrary.TooManyTrashed tooMany){call.reject("More than 500 owned items are in trash. Manage a smaller batch in Android Photos.");}
  catch(Exception failure){call.reject("Trash could not be prepared for confirmation");}
 });}
 @PluginMethod public void cancelDeleteTrash(PluginCall call){submit(call,()->{owned.cancelDeleteTrash(call.getString("confirmation",""));call.resolve();});}
 @PluginMethod public void deletePreparedTrash(PluginCall call){submit(call,()->{
  if(Build.VERSION.SDK_INT<30){call.reject("Android trash requires Android 11 or later");return;}
  try{call.resolve(owned.deletePreparedTrash(call.getString("confirmation",""),()->destroyed));}
  catch(IllegalStateException expired){call.reject("Delete confirmation expired. Review trash again.");}
 });}
 @PluginMethod public void albums(PluginCall call){submit(call,()->{
  if(Build.VERSION.SDK_INT<30){call.reject("Owned albums require Android 11 or later");return;}
  try{call.resolve(albums.albums());}catch(Exception failure){call.reject("Owned albums could not be loaded");}
 });}
 @PluginMethod public void changeAlbum(PluginCall call){submit(call,()->{
  if(Build.VERSION.SDK_INT<30){call.reject("Owned albums require Android 11 or later");return;}
  if(destroyed){call.reject("Photo library closed");return;}
  try{call.resolve(albums.change(call.getString("operation",""),call.getString("id",""),call.getString("revision"),call.getString("name"),call.getString("mediaId",""),call.getString("mediaRevision"),()->destroyed));}
  catch(IllegalArgumentException failure){call.reject(failure.getMessage());}catch(Exception failure){call.reject("Album could not be saved. Reload albums before trying again");}
 });}
 @Override protected void handleOnDestroy(){destroyed=true;if(videoCopies!=null)videoCopies.close();if(mediaReview!=null)mediaReview.close();if(permitted!=null)permitted.close();if(edits!=null)edits.cancel(null);PluginWorkers.submit(worker,()->{if(edits!=null)edits.close();},()->{/* Already stopped: nothing left to close on it. */});worker.shutdown();if(playback!=null)playback.clear();}
}
