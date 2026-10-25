package ai.elizaresearch.alphaphone;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.lang.reflect.Field;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real Android plugin/WebView lifecycle; provider navigation is synthetic, no code-send API runs. */
@RunWith(AndroidJUnit4.class)
public final class AuthVerificationInstrumentedTest {
 private static Object field(Object value,String name)throws Exception{Field f=value.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(value);}
 private static final class Call extends PluginCall {
  JSObject result;String failure;int settlements;
  Call(String method,JSObject data){super(null,"AlphaCaptcha",UUID.randomUUID().toString(),method,data);}
  @Override public void resolve(JSObject data){result=data;settlements++;}
  @Override public void resolve(){settlements++;}
  @Override public void reject(String message){failure=message;settlements++;}
 }
 private static Call start(AlphaCaptchaPlugin plugin){JSObject data=new JSObject();data.put("requestId",UUID.randomUUID().toString());data.put("environment","production");data.put("provider","turnstile");data.put("siteKey","public-fixture-key");data.put("action","email_otp");Call call=new Call("verify",data);plugin.verify(call);return call;}
 private static Call cancel(AlphaCaptchaPlugin plugin,String id){JSObject data=new JSObject();data.put("requestId",id);Call call=new Call("cancel",data);plugin.cancel(call);return call;}
 private static WebResourceRequest request(String url,boolean main){return new WebResourceRequest(){public Uri getUrl(){return Uri.parse(url);}public boolean isForMainFrame(){return main;}public boolean isRedirect(){return false;}public boolean hasGesture(){return false;}public String getMethod(){return "GET";}public Map<String,String> getRequestHeaders(){return Map.of();}};}
 private interface Check{void run(AlphaCaptchaPlugin plugin)throws Exception;}
 private void exercise(Check check)throws Exception{
  org.junit.Assume.assumeTrue("Disposable auth-verification campaign only","1".equals(InstrumentationRegistry.getArguments().getString("authVerificationNative")));
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AtomicReference<Throwable> error=new AtomicReference<>();
   BoundedActivityScenario.main(()->{try{MainActivity activity=(MainActivity)field(scenario,"activity");check.run((AlphaCaptchaPlugin)activity.getBridge().getPlugin("AlphaCaptcha").getInstance());}catch(Throwable t){error.set(t);}});
   if(error.get()!=null)throw new AssertionError(error.get());
  }
 }
 @Test public void boundMainFrameResultSettlesOnceAndCannotComeFromAnIframe()throws Exception{exercise(plugin->{
  Call call=start(plugin);Object pending=field(plugin,"active");assertNotNull(pending);WebView web=(WebView)field(pending,"web");
  assertFalse(web.getSettings().getAllowFileAccess());assertFalse(web.getSettings().getAllowContentAccess());
  String callback=field(pending,"result")+"#state="+field(pending,"state")+"&token=synthetic-verification-token";
  assertFalse(web.getWebViewClient().shouldOverrideUrlLoading(web,request(callback,false)));assertEquals(0,call.settlements);
  assertTrue(web.getWebViewClient().shouldOverrideUrlLoading(web,request(callback,true)));assertEquals("synthetic-verification-token",call.result.getString("token"));assertEquals(1,call.settlements);assertNull(field(plugin,"active"));
  ((Runnable)field(pending,"expiry")).run();assertEquals(1,call.settlements);
 });}
 @Test public void wrongStateAndOffOriginReturnsNeverReleaseTokens()throws Exception{exercise(plugin->{
  for(boolean wrongState:new boolean[]{true,false}){
   Call call=start(plugin);Object pending=field(plugin,"active");WebView web=(WebView)field(pending,"web");String url=(wrongState?field(pending,"result"):"https://wrong.invalid/result")+"#state="+(wrongState?UUID.randomUUID():field(pending,"state"))+"&token=must-not-release";
   assertTrue(web.getWebViewClient().shouldOverrideUrlLoading(web,request(url,true)));assertEquals(1,call.settlements);assertNull(call.result);assertNotNull(call.failure);assertNull(field(plugin,"active"));
  }
 });}
 @Test public void cancellationIsOwnedAndExpiryRetiresThePrompt()throws Exception{exercise(plugin->{
  Call call=start(plugin);Object pending=field(plugin,"active");cancel(plugin,UUID.randomUUID().toString());assertSame(pending,field(plugin,"active"));assertEquals(0,call.settlements);
  cancel(plugin,call.getString("requestId"));assertEquals(1,call.settlements);assertNull(call.result);assertNotNull(call.failure);assertNull(field(plugin,"active"));
  Call expired=start(plugin);Object next=field(plugin,"active");((Runnable)field(next,"expiry")).run();assertEquals(1,expired.settlements);assertNull(expired.result);assertNull(field(plugin,"active"));
 });}
}
