package ai.elizaresearch.alphaphone;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.io.*;
import java.nio.*;
import java.nio.charset.*;
import java.util.Arrays;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
/** Explicit, transient SAF text import/export. No broad file permission or network. */
@CapacitorPlugin(name="AlphaNoteDocuments")
public final class AlphaNoteDocumentsPlugin extends Plugin {
 private final AtomicBoolean busy=new AtomicBoolean();private final ExecutorService worker=Executors.newSingleThreadExecutor();private volatile boolean closed;
 private JSObject result(String status,String message){JSObject r=new JSObject();r.put("status",status);r.put("message",message);return r;}
 private byte[] bytes(String text)throws CharacterCodingException{
  if(text==null||text.length()>65536)throw new IllegalArgumentException();ByteBuffer b=StandardCharsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT).encode(CharBuffer.wrap(text));if(b.remaining()>65536)throw new IllegalArgumentException();byte[] value=new byte[b.remaining()];b.get(value);return value;
 }
 private void choose(PluginCall call,Intent intent,String callback){
  if(closed||!busy.compareAndSet(false,true)){call.resolve(result("unavailable","A document operation is already open."));return;}
  try{startActivityForResult(call,intent,callback);}catch(RuntimeException error){busy.set(false);call.resolve(result("unavailable","Android document selection is unavailable."));}
 }
 @PluginMethod public void importText(PluginCall call){if(!BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS){call.resolve(result("unsupported","Notes import is unavailable."));return;}choose(call,new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("text/*").addCategory(Intent.CATEGORY_OPENABLE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),"imported");}
 @PluginMethod public void exportText(PluginCall call){
  if(!BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS){call.resolve(result("unsupported","Notes export is unavailable."));return;}
  try{bytes(call.getString("text"));String title=call.getString("title","Note").replaceAll("[\\\\/\\p{Cntrl}]","_");if(title.length()>100)title=title.substring(0,100);if(title.isBlank())title="Note";
   choose(call,new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("text/plain").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,title+".txt").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION),"exported");
  }catch(Exception error){call.resolve(result("too-large","Export requires valid UTF-8 text of at most 64 KiB."));}
 }
 private byte[] pdfBytes(PluginCall call){return DocumentExportBytes.pdf(call.getString("dataBase64"));}
 @PluginMethod public void exportPdf(PluginCall call){
  try{pdfBytes(call);String title=call.getString("title","Alpha scan").replaceAll("[\\\\/\\p{Cntrl}]","_");if(title.length()>100)title=title.substring(0,100);if(title.isBlank())title="Alpha scan";
   choose(call,new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/pdf").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,title+".pdf").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION),"exportedPdf");
  }catch(Exception error){call.resolve(result("failed","PDF export requires valid PDF bytes of at most 8 MB."));}
 }
 @ActivityCallback private void exportedPdf(PluginCall call,ActivityResult response){Uri uri=chosen(call,response);if(uri==null)return;run(call,()->{
  boolean opened=false;try{
   byte[] content=pdfBytes(call);try(OutputStream out=getContext().getContentResolver().openOutputStream(uri,"wt")){if(out==null)throw new IOException();opened=true;out.write(content);out.flush();}
   try(InputStream in=getContext().getContentResolver().openInputStream(uri)){DocumentExportBytes.verify(in,content);}
   JSObject value=result("exported","PDF saved and exact bytes verified.");value.put("bytes",content.length);call.resolve(value);
  }catch(Exception error){call.resolve(result(opened?"unverified":"failed",opened?"The provider may have saved some or all PDF bytes. Inspect the destination before retrying.":"The selected destination could not be written."));}
 });}
 private Uri chosen(PluginCall call,ActivityResult response){
  if(call==null){busy.set(false);return null;}
  if(response.getResultCode()!=Activity.RESULT_OK||response.getData()==null){busy.set(false);call.resolve(result("cancelled","Document selection cancelled. Nothing imported or exported."));return null;}
  Uri uri=response.getData().getData();if(uri==null||!"content".equals(uri.getScheme())){busy.set(false);call.resolve(result("unavailable","The document provider returned no accessible document."));return null;}return uri;
 }
 private void run(PluginCall call,Runnable operation){try{worker.execute(()->{try{if(closed)call.resolve(result("cancelled","Document operation closed."));else operation.run();}finally{busy.set(false);}});}catch(RejectedExecutionException error){busy.set(false);call.resolve(result("cancelled","Document operation closed."));}}
 @ActivityCallback private void imported(PluginCall call,ActivityResult response){Uri uri=chosen(call,response);if(uri==null)return;run(call,()->{
  try{
   JSObject value=SelectedDocumentAccess.readTransientText(getContext(),uri);
   String name="Imported note";try(android.database.Cursor row=getContext().getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){if(row!=null&&row.moveToFirst()&&!row.isNull(0))name=row.getString(0);}
   value.put("name",name);call.resolve(value);
  }catch(RuntimeException error){call.resolve(result("failed","The selected document could not be read."));}
 });}
 @ActivityCallback private void exported(PluginCall call,ActivityResult response){Uri uri=chosen(call,response);if(uri==null)return;run(call,()->{
  boolean opened=false;try{
   byte[] content=bytes(call.getString("text"));try(OutputStream out=getContext().getContentResolver().openOutputStream(uri,"wt")){if(out==null)throw new IOException();opened=true;out.write(content);out.flush();}
   byte[] actual;try(InputStream in=getContext().getContentResolver().openInputStream(uri)){if(in==null)throw new IOException();ByteArrayOutputStream copy=new ByteArrayOutputStream();byte[] buffer=new byte[4096];int n;while((n=in.read(buffer))!=-1){if(copy.size()+n>65536)throw new IOException();copy.write(buffer,0,n);}actual=copy.toByteArray();}
   if(!Arrays.equals(content,actual))throw new IOException();JSObject value=result("exported","Export saved and exact bytes verified.");value.put("bytes",content.length);call.resolve(value);
  }catch(Exception error){call.resolve(result(opened?"unverified":"failed",opened?"The provider may have saved some or all text, but exact bytes could not be verified. Inspect the destination before retrying.":"The selected destination could not be written."));}
 });}
 @Override protected void handleOnDestroy(){closed=true;worker.shutdown();super.handleOnDestroy();}
}
