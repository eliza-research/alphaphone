package ai.elizaresearch.alphaphone;

import android.content.Context;
import android.os.SystemClock;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.*;
import static org.junit.Assert.*;

/** Test APK only: persisted synthetic loopback session, restored by the real renderer initializer. */
final class WorkflowNoticeOwnerFixture implements AutoCloseable {
 static final String PREFS="workflow-owner-restore-fixture",OWNER_SLOT="workflow-notice-owner:v1";
 final Context context;final JSONObject identity;final String origin,token;final ServerSocket server;final Thread peer;
 final AtomicInteger verified=new AtomicInteger(),agents=new AtomicInteger();volatile Throwable failure;
 static boolean preparing(){return "prepare".equals(InstrumentationRegistry.getArguments().getString("workflowOwnerPhase"));}
 static void prepare()throws Exception{
  org.junit.Assume.assumeTrue("Synthetic restore requires test-mocks build",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();assertTrue(android.os.Process.myUid()/100000>0);
  assertFalse("Fresh fixture preferences",context.getSharedPreferences(PREFS,0).contains("identity"));
  int port;try(ServerSocket probe=new ServerSocket(0,1,InetAddress.getByName("127.0.0.1"))){port=probe.getLocalPort();}
  String origin="http://127.0.0.1:"+port,token="SYNTHETIC-LOCAL-ONLY-"+UUID.randomUUID();
  JSONObject identity=new JSONObject().put("origin",origin).put("ownerId","fixture-owner-"+UUID.randomUUID()).put("agentId",UUID.randomUUID().toString());
  AlphaCredentialStore store=new AlphaCredentialStore(context);assertNull(store.readCredentialSlot("remote:"+origin));
  try(BoundedActivityScenario<MainActivity> activity=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();long end=SystemClock.elapsedRealtime()+20000;
   while(!"true".equals(WebViewTestDriver.evaluate("Boolean(document.documentElement.dataset.activeView)"))&&SystemClock.elapsedRealtime()<end)SystemClock.sleep(50);
   JSONObject credential=new JSONObject().put("origin",origin).put("token",token).put("sessionId",token).put("identityId",identity.getString("ownerId")).put("expiresAt",System.currentTimeMillis()+3600000);
   store.writeCredentialSlot("remote:"+origin,credential.toString());
   String selection=new JSONObject().put("kind","local").put("origin",origin).toString();
   assertEquals("true",WebViewTestDriver.evaluate("localStorage.setItem('alpha.connection.selection.v1',"+JSONObject.quote(selection)+");localStorage.getItem('alpha.connection.selection.v1')==="+JSONObject.quote(selection)));
  }
  assertTrue(context.getSharedPreferences(PREFS,0).edit().putString("identity",identity.toString()).putString("token",token).commit());
 }
 WorkflowNoticeOwnerFixture(Context context)throws Exception{
  org.junit.Assume.assumeTrue("Synthetic restore requires test-mocks build",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  this.context=context;identity=new JSONObject(context.getSharedPreferences(PREFS,0).getString("identity","{}"));origin=identity.getString("origin");token=context.getSharedPreferences(PREFS,0).getString("token",null);assertNotNull(token);
  URI uri=new URI(origin);assertEquals("http",uri.getScheme());assertEquals("127.0.0.1",uri.getHost());server=new ServerSocket(uri.getPort(),8,InetAddress.getByName("127.0.0.1"));
  peer=new Thread(()->{while(!server.isClosed())try(Socket socket=server.accept()){
   socket.setSoTimeout(5000);BufferedReader reader=new BufferedReader(new InputStreamReader(socket.getInputStream(),StandardCharsets.UTF_8));String line=reader.readLine();if(line==null||line.length()>2048)throw new IOException("Invalid fixture request");String[] request=line.split(" ");String auth=null;int size=0;
   while((line=reader.readLine())!=null&&!line.isEmpty()){size+=line.length();if(size>16384)throw new IOException("Fixture header bound");if(line.toLowerCase(java.util.Locale.ROOT).startsWith("authorization:"))auth=line.substring(line.indexOf(':')+1).trim();}
   int status=404;JSONObject body=new JSONObject();
   if("GET".equals(request[0])&&("/api/auth/me".equals(request[1])||"/api/agents".equals(request[1]))){
    if(!("Bearer "+token).equals(auth))throw new IOException("Synthetic credential mismatch");status=200;
    if("/api/auth/me".equals(request[1])){verified.incrementAndGet();body.put("identity",new JSONObject().put("id",identity.getString("ownerId")).put("kind","owner").put("displayName","Synthetic fixture owner")).put("session",new JSONObject().put("id",token).put("kind","machine").put("expiresAt",System.currentTimeMillis()+3600000)).put("access",new JSONObject().put("role","OWNER").put("mode","session"));}
    else{agents.incrementAndGet();body.put("agents",new JSONArray().put(new JSONObject().put("id",identity.getString("agentId")).put("name","Synthetic fixture agent").put("status","running")));}
   }
   byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);socket.getOutputStream().write(("HTTP/1.1 "+status+" Fixture\r\nContent-Type: application/json\r\nContent-Length: "+bytes.length+"\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));socket.getOutputStream().write(bytes);socket.getOutputStream().flush();
  }catch(Exception error){if(!server.isClosed())failure=error;}},"synthetic-notice-owner");peer.setDaemon(true);peer.start();
 }
 void awaitOwner(boolean signedIn)throws Exception{
  AlphaCredentialStore store=new AlphaCredentialStore(context);long end=SystemClock.elapsedRealtime()+20000;
  do{assertNull("Loopback peer failure",failure);String raw=store.readCredentialSlot(OWNER_SLOT);if(raw!=null){JSONObject owner=new JSONObject(raw).optJSONObject("owner");if(!signedIn&&owner==null)return;if(signedIn&&owner!=null&&identity.getString("origin").equals(owner.optString("origin"))&&identity.getString("ownerId").equals(owner.optString("ownerId"))&&identity.getString("agentId").equals(owner.optString("agentId"))){assertTrue(verified.get()>0);assertTrue(agents.get()>0);return;}}SystemClock.sleep(50);}while(SystemClock.elapsedRealtime()<end);fail("Renderer did not settle expected owner");
 }
 public void close()throws Exception{server.close();peer.join(6000);assertFalse("Loopback peer stopped",peer.isAlive());assertNull("Loopback peer failure",failure);}
}
