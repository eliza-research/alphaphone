package ai.elizaresearch.alphaphone;

import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.file.Files;
import java.security.MessageDigest;
import org.json.*;

/** Test APK only: snapshot an already-stopped synthetic utterance before real ASR.
 * Adds diagnostic work after capture; never suitable for latency qualification. */
@CapacitorPlugin(name="ConversationInputEvidence")
public final class ConversationInputEvidence extends Plugin {
 private final JSONArray artifacts=new JSONArray();
 private static String hash(byte[] bytes)throws Exception{StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))out.append(String.format("%02x",b&255));return out.toString();}
 @PluginMethod public void snapshot(PluginCall call){
  try {
   String run=InboxFixtureScope.runId,id=call.getString("recordingId");
   if(!"1".equals(InstrumentationRegistry.getArguments().getString("localConversation"))||!ConversationFixtureAgent.allowReply||!"prepare".equals(InboxFixtureScope.phase)||run==null||!run.matches("[a-f0-9-]{36}")||id==null||!id.matches("[a-f0-9-]{36}")||artifacts.length()>=4)throw new IllegalStateException("Fixture scope unavailable");
   AlphaVoiceCloudPlugin voice=(AlphaVoiceCloudPlugin)getBridge().getPlugin("AlphaVoiceCloud").getInstance();
   java.lang.reflect.Field field=AlphaVoiceCloudPlugin.class.getDeclaredField("capture");field.setAccessible(true);AlphaCloudVoiceCapture capture=(AlphaCloudVoiceCapture)field.get(voice);
   byte[] encoded;
   synchronized(capture){File selected=capture.selected(id);if(selected==null||selected.length()<1||selected.length()>4*1024*1024)throw new IllegalStateException("Stopped capture unavailable");encoded=Files.readAllBytes(selected.toPath());}
   String relative="conversation-audio-evidence/"+run+"/"+id;
   File m4a=new File(getContext().getFilesDir(),relative+".m4a");if(!m4a.getParentFile().mkdirs()&&!m4a.getParentFile().isDirectory())throw new IllegalStateException("Evidence directory unavailable");
   Files.write(m4a.toPath(),encoded);byte[] wav=AlphaVoicePcm.decode(m4a,()->false);Files.write(new File(getContext().getFilesDir(),relative+".wav").toPath(),wav);
   artifacts.put(new JSONObject().put("path","files/"+relative+".m4a").put("bytes",encoded.length).put("sha256",hash(encoded)));
   artifacts.put(new JSONObject().put("path","files/"+relative+".wav").put("bytes",wav.length).put("sha256",hash(wav)));
   android.os.Bundle evidence=new android.os.Bundle();evidence.putString("conversationAudioFixture",artifacts.toString());InstrumentationRegistry.getInstrumentation().addResults(evidence);
   call.resolve(new JSObject().put("copied",true));
  }catch(Exception error){call.reject("Stopped fixture audio could not be retained");}
 }
}
