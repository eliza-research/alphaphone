package ai.elizaresearch.alphaphone;
import java.nio.charset.StandardCharsets;
import org.json.*;
/** Native-only fixture data: fill the actual collection without laying out a giant editor value. */
final class NotesCapacityFixture {
 static final int RECORD_BYTES=512*1024,HEADROOM=2048,EDIT_BYTES=4096;
 static String collection(String original,String marker,int cap)throws Exception{
  JSONObject saved=new JSONObject(original),envelope=new JSONObject(saved.getString("currentRaw"));
  JSONArray records=envelope.getJSONArray("records");
  records.put(note(marker,"Capacity target "+marker,""));
  JSONObject last=null;
  // Reserve one bounded body for exact padding after JSON-envelope overhead is measured.
  for(int i=0;i<64;i++){last=note(marker+"_"+i,"Capacity fixture "+i,i<63?"F".repeat(RECORD_BYTES):"");records.put(last);}
  saved.put("currentRaw",envelope.toString());
  int padding=cap-HEADROOM-saved.toString().getBytes(StandardCharsets.UTF_8).length;
  if(padding<0||padding>RECORD_BYTES)throw new IllegalStateException("Disposable collection does not leave bounded fixture capacity");
  last.put("body","F".repeat(padding));saved.put("currentRaw",envelope.toString());
  String result=saved.toString();
  if(result.getBytes(StandardCharsets.UTF_8).length!=cap-HEADROOM)throw new IllegalStateException("Fixture byte count changed");
  return result;
 }
 private static JSONObject note(String id,String title,String body)throws Exception{
  return new JSONObject().put("id",id).put("kind","text").put("title",title).put("body",body).put("pinned",false).put("when","Saved on this device");
 }
}
