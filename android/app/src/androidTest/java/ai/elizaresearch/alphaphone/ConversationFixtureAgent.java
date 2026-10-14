package ai.elizaresearch.alphaphone;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.*;
/** Test APK only: closed identity/history protocol; no runtime, HTTP or inference. */
@CapacitorPlugin(name="Agent")
public final class ConversationFixtureAgent extends Plugin {
 static final String CONVERSATION="12345678-1234-4234-8234-123456789abc";
 static final java.util.List<String> routes=new java.util.concurrent.CopyOnWriteArrayList<>();
 static volatile int sends;
 @PluginMethod public void launchSurface(PluginCall c){c.resolve(new JSObject().put("assistant",false));}
 @PluginMethod public void takeInvocation(PluginCall c){c.resolve(new JSObject());}
 @PluginMethod public void residentAttachment(PluginCall c){c.resolve(new JSObject().put("attachable",true));}
 @PluginMethod public void getStatus(PluginCall c){c.resolve(new JSObject().put("packaged",true).put("state","stopped").put("serviceActive",false).put("socketListening",false));}
 @PluginMethod public void start(PluginCall c){c.resolve(new JSObject().put("state","ready"));}
 @PluginMethod public void cancelStart(PluginCall c){c.resolve();}
 @PluginMethod public void stop(PluginCall c){c.resolve();}
 @PluginMethod public void requestStream(PluginCall c){sends++;c.reject("Fixture forbids inference");}
 @PluginMethod public void cancelStream(PluginCall c){c.resolve();}
 @PluginMethod public void request(PluginCall c){
  try{
   String path=c.getString("path"),method=c.getString("method");routes.add(method+" "+path);JSONObject value;
   if("GET".equals(method)&&"/api/auth/me".equals(path))value=new JSONObject().put("identity",new JSONObject().put("kind","owner").put("id","synthetic-conversation-owner")).put("access",new JSONObject().put("role","OWNER").put("mode","local"));
   else if("GET".equals(method)&&"/api/agents".equals(path))value=new JSONObject().put("agents",new JSONArray().put(new JSONObject().put("id","synthetic-conversation-agent").put("status","running").put("name","Synthetic conversation fixture")));
   else if("GET".equals(method)&&"/api/conversations".equals(path))value=new JSONObject().put("conversations",new JSONArray());
   else if("POST".equals(method)&&"/api/conversations".equals(path))value=new JSONObject().put("conversation",new JSONObject().put("id",CONVERSATION).put("title","Synthetic voice lifecycle"));
   else if("GET".equals(method)&&path.startsWith("/api/conversations/"+CONVERSATION+"/messages"))value=new JSONObject().put("messages",new JSONArray()).put("hasMore",false);
   else {c.reject("Closed conversation fixture rejects: "+method+" "+path);return;}
   c.resolve(new JSObject().put("status",200).put("body",value.toString()));
  }catch(Exception error){c.reject("Invalid fixture request");}
 }
}
