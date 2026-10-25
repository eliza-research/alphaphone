package ai.elizaresearch.alphaphone;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.lang.reflect.Field;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Opt-in live native probes. Email delivery additionally requires explicit authorizedEmailSend and testEmail arguments. */
@RunWith(AndroidJUnit4.class)
public final class AuthCloudProbeInstrumentedTest {
 @Test public void publicProviderDiscoveryThroughNativeTransport()throws Exception{
  org.junit.Assume.assumeTrue("Opt-in read-only Cloud probe","1".equals(InstrumentationRegistry.getArguments().getString("authReadOnlyLiveProbe")));
  String environment=InstrumentationRegistry.getArguments().getString("cloudEnvironment","staging");
  org.json.JSONObject config=CloudDeployment.get(environment);
  JSObject headers=new JSObject();headers.put("Accept","application/json");headers.put("X-Steward-Tenant",config.getString("tenant"));
  boolean sendEmail="1".equals(InstrumentationRegistry.getArguments().getString("authorizedEmailSend"));
  boolean emailRoute=sendEmail||"1".equals(InstrumentationRegistry.getArguments().getString("emailCodeRouteProbe"));
  boolean readiness="1".equals(InstrumentationRegistry.getArguments().getString("googleReadinessProbe"));
  String probePath=emailRoute?"/steward/auth/email/code/send":readiness?"/steward/auth/oauth/google/app-readiness?tenant_id="+config.getString("tenant")+"&redirect_uri="+java.net.URLEncoder.encode("https://alphacompute.ai/alphaphone/auth/"+("staging".equals(environment)?"staging/":"")+"callback",java.nio.charset.StandardCharsets.UTF_8):"/steward/auth/providers";
  JSObject input=new JSObject();String id=UUID.randomUUID().toString();input.put("requestId",id);boolean fixture="1".equals(InstrumentationRegistry.getArguments().getString("providerProbeFixture"));input.put("url",(fixture?"http://10.0.2.2:5398":config.getString("api"))+probePath);input.put("method",emailRoute?"POST":"GET");if(emailRoute){headers.put("Content-Type","application/json");JSObject body=new JSObject();if(sendEmail){String email=InstrumentationRegistry.getArguments().getString("testEmail");assertNotNull("Explicit test email is required",email);body.put("email",email);body.put("tenantId",config.getString("tenant"));}input.put("body",body.toString());}input.put("headers",headers);
  CountDownLatch done=new CountDownLatch(1);AtomicReference<JSObject> result=new AtomicReference<>();AtomicReference<String> failure=new AtomicReference<>();
  PluginCall call=new PluginCall(null,"AlphaConnection","read-only-provider-probe","request",input){
   @Override public void resolve(JSObject data){result.set(data);done.countDown();}
   @Override public void reject(String message){failure.set(message);done.countDown();}
  };
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AtomicReference<AlphaConnectionPlugin> transport=new AtomicReference<>();
   BoundedActivityScenario.main(()->{try{Field f=scenario.getClass().getDeclaredField("activity");f.setAccessible(true);MainActivity activity=(MainActivity)f.get(scenario);transport.set((AlphaConnectionPlugin)activity.getBridge().getPlugin("AlphaConnection").getInstance());transport.get().request(call);}catch(Exception e){failure.set(e.getClass().getSimpleName());done.countDown();}});
   try{
    assertTrue("Native provider request completed",done.await(35,TimeUnit.SECONDS));assertNull("Native transport failed",failure.get());assertNotNull(result.get());
    int status=result.get().getInt("status");org.json.JSONObject data=result.get().optJSONObject("data");
    System.out.println("READ_ONLY_CLOUD_DISCOVERY emailRoute="+emailRoute+" readiness="+readiness+" environment="+environment+" status="+status+" google="+(data!=null&&data.optBoolean("google"))+" email="+(data!=null&&data.optBoolean("email"))+" sms="+(data!=null&&data.optBoolean("sms"))+" appAuth="+(data==null?0:data.optInt("appAuth"))+" edgeError="+(data==null?"":data.optString("error_code","")));
    assertEquals(emailRoute?"Code-only email route must reject the empty preflight without sending":readiness?"Registered app Google readiness must be reachable from Android":"Public provider discovery must be reachable from Android",emailRoute&&!sendEmail?400:200,status);
    if(sendEmail){assertNotNull(data);assertTrue(data.optBoolean("ok"));org.json.JSONObject challenge=data.optJSONObject("data");assertNotNull(challenge);assertEquals(6,challenge.optInt("codeLength"));}
    if(readiness){assertNotNull(data);assertTrue(data.optBoolean("ok"));assertEquals(1,data.optInt("appAuth"));assertEquals(config.getString("tenant"),data.optString("tenantId"));}
    if(fixture){
     JSObject badHeaders=new JSObject();badHeaders.put("X-Steward-Tenant","invalid tenant");JSObject invalid=new JSObject();invalid.put("requestId",UUID.randomUUID().toString());invalid.put("url","http://10.0.2.2:5398/steward/auth/providers");invalid.put("method","GET");invalid.put("headers",badHeaders);
     CountDownLatch rejected=new CountDownLatch(1);AtomicReference<String> rejection=new AtomicReference<>();
     transport.get().request(new PluginCall(null,"AlphaConnection","invalid-tenant-probe","request",invalid){@Override public void resolve(JSObject ignored){rejected.countDown();}@Override public void reject(String message){rejection.set(message);rejected.countDown();}});
     assertTrue("Invalid tenant header settled",rejected.await(10,TimeUnit.SECONDS));assertNotNull("Invalid tenant header must be rejected before HTTP",rejection.get());
    }

   }finally{if(transport.get()!=null){JSObject cancel=new JSObject();cancel.put("requestId",id);transport.get().cancel(new PluginCall(null,"AlphaConnection","cancel-probe","cancel",cancel){@Override public void resolve(){}});}}
  }
 }
}
