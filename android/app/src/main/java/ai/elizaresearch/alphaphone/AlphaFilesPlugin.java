package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.media.DocumentFolderTree;
import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** User-selected SAF tree only, through the shared folder-tree engine (elizaOS
 * plugin-native-media DocumentFolderTree). The renderer gets opaque capabilities, never authority
 * from a supplied URI/path; no broad storage permission or provider fallback. Alpha keeps its
 * installed preference name and its selected-document capabilities. */
@CapacitorPlugin(name="AlphaFiles")
public class AlphaFilesPlugin extends Plugin {
 /** Installed name of the preference that records the chosen tree. */
 static final String PREF="alpha-files-tree";
 private final ExecutorService worker=Executors.newSingleThreadExecutor();
 private final AtomicBoolean picking=new AtomicBoolean();
 private DocumentFolderTree tree;
 @Override public void load(){tree=new DocumentFolderTree(getContext(),PREF,uri->SelectedDocumentAccess.authorize(getContext(),uri,0));}
 private void run(PluginCall call,DocumentFolderTree.Work task){PluginWorkers.submit(worker,()->call.resolve(tree.guarded(task)),()->call.resolve(DocumentFolderTree.result("unavailable","Files closed. Reopen Files to continue.")));}
 @PluginMethod public void choose(PluginCall call){
  if(!picking.compareAndSet(false,true)){call.resolve(DocumentFolderTree.result("busy","A folder picker is already open."));return;}
  Intent intent=DocumentFolderTree.pickerIntent();
  try{startActivityForResult(call,intent,"chosen");}catch(RuntimeException error){picking.set(false);call.resolve(DocumentFolderTree.result("unavailable","Android folder selection is unavailable."));}
 }
 @ActivityCallback private void chosen(PluginCall call,ActivityResult response){
  picking.set(false);if(call==null)return;Intent data=response.getData();
  if(response.getResultCode()!=Activity.RESULT_OK||data==null||data.getData()==null){call.resolve(DocumentFolderTree.result("cancelled","Folder selection cancelled."));return;}
  android.net.Uri uri=data.getData();int flags=data.getFlags();
  run(call,()->tree.adopt(uri,flags));
 }
 @PluginMethod public void list(PluginCall call){run(call,()->tree.list(call.getString("id"),call.getString("cursor")));}
 /** Android grants folders in place; nothing is copied. Import opens the same tree picker. */
 @PluginMethod public void importFolder(PluginCall call){choose(call);}
 /** Per-item move or delete, each checked against its listed revision; every outcome is named. */
 @PluginMethod public void changeMany(PluginCall call){run(call,()->tree.changeMany(call.getArray("items"),call.getString("action",""),Boolean.TRUE.equals(call.getBoolean("confirmPermanent")),call.getString("destinationId")));}
 /** One share sheet for several files. Folders are skipped, and nothing is sent until the user picks an app. */
 @PluginMethod public void shareMany(PluginCall call){run(call,()->tree.shareMany(getActivity(),call.getArray("items")));}
 @PluginMethod public void createFolder(PluginCall call){run(call,()->tree.createFolder(call.getString("id"),call.getString("name","")));}
 @PluginMethod public void rename(PluginCall call){run(call,()->tree.rename(call.getString("id"),call.getString("name",""),call.getString("expectedRevision")));}
 @PluginMethod public void delete(PluginCall call){run(call,()->tree.delete(call.getString("id"),Boolean.TRUE.equals(call.getBoolean("confirmPermanent")),call.getString("expectedRevision")));}
 @PluginMethod public void move(PluginCall call){run(call,()->tree.move(call.getString("id"),call.getString("destinationId"),call.getString("expectedRevision")));}
 @PluginMethod public void select(PluginCall call){run(call,()->tree.select(call.getString("id")));}
 @PluginMethod public void forget(PluginCall call){run(call,()->tree.forget());}
 @Override protected void handleOnDestroy(){worker.shutdownNow();}
}
