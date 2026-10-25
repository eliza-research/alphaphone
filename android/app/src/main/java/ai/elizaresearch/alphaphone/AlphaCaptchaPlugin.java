package ai.elizaresearch.alphaphone;

import android.app.Dialog;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.URI;
import java.util.Set;
import java.util.UUID;

/** Dedicated provider WebView: no Capacitor bridge, file access, app credentials or token persistence. */
@CapacitorPlugin(name="AlphaCaptcha")
public final class AlphaCaptchaPlugin extends Plugin {
 private final Handler handler=new Handler(Looper.getMainLooper());
 private Pending active;
 private final class Pending {
  final PluginCall call; final String id,state,page,result; final Dialog dialog; final WebView web;
  final Runnable expiry=()->finish(null,"Verification expired. Try again.");
  boolean done;
  Pending(PluginCall call,String id,String page) {
   this.call=call;this.id=id;this.page=page;state=UUID.randomUUID().toString();result=URI.create(page).resolve("result").toString();
   dialog=new Dialog(getActivity());web=new WebView(getActivity());
  }
  void finish(String token,String error) {
   if(done)return;done=true;handler.removeCallbacks(expiry);if(active==this)active=null;
   web.stopLoading();dialog.dismiss();if(web.getParent() instanceof ViewGroup)((ViewGroup)web.getParent()).removeView(web);web.destroy();
   if(token!=null){JSObject out=new JSObject();out.put("token",token);call.resolve(out);}else call.reject(error);
  }
  boolean navigate(Uri uri) {
   try {
    URI url=new URI(uri.toString());String withoutFragment=new URI(url.getScheme(),url.getAuthority(),url.getPath(),url.getQuery(),null).toString();
    if(withoutFragment.equals(result)) {
     Uri values=Uri.parse("https://result.invalid/?"+(url.getRawFragment()==null?"":url.getRawFragment()));
     Set<String> keys=values.getQueryParameterNames();
     if(!keys.equals(Set.of("state","token"))&&!keys.equals(Set.of("state","error")))throw new Exception();
     for(String key:keys)if(values.getQueryParameters(key).size()!=1)throw new Exception();
     if(!state.equals(values.getQueryParameter("state")))throw new Exception();
     String token=values.getQueryParameter("token");
     if(token!=null&&(token.isEmpty()||token.length()>8192||token.indexOf('\r')>=0||token.indexOf('\n')>=0))throw new Exception();
     finish(token,"Verification cancelled.");return true;
    }
    if(withoutFragment.equals(page))return false;
   }catch(Exception ignored){ }
   finish(null,"Verification left its expected page. Try again.");return true;
  }
 }
 @PluginMethod public void verify(PluginCall call) {
  getActivity().runOnUiThread(()->{
   if(active!=null){call.reject("Another verification is active.");return;}
   Pending pending=null;
   try {
    String environment=call.getString("environment"),id=call.getString("requestId"),provider=call.getString("provider"),key=call.getString("siteKey"),action=call.getString("action");
    if(id==null||!id.matches("[a-f0-9-]{36}")||!("turnstile".equals(provider)||"hcaptcha".equals(provider))||key==null||key.isBlank()||key.length()>1024||!("email_otp".equals(action)||"sms_otp".equals(action)))throw new Exception();
    String page=CloudDeployment.get(environment).getString("verificationPage");URI uri=new URI(page);
    if(!"https".equals(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null||uri.getQuery()!=null||uri.getFragment()!=null)throw new Exception();
    pending=new Pending(call,id,page);active=pending;final Pending p=pending;
    WebSettings settings=p.web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setSupportMultipleWindows(false);
    p.web.setWebViewClient(new WebViewClient(){
     @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return request.isForMainFrame()?p.navigate(request.getUrl()):false;}
     @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame())p.finish(null,"Verification could not load. Try again.");}
     @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse response){if(request.isForMainFrame())p.finish(null,"Verification service is unavailable. Try again.");}
     @Override public void onReceivedSslError(WebView view,android.webkit.SslErrorHandler ssl,android.net.http.SslError error){ssl.cancel();p.finish(null,"Verification connection failed.");}
     @Override public boolean onRenderProcessGone(WebView view,android.webkit.RenderProcessGoneDetail detail){p.finish(null,"Verification closed. Try again.");return true;}
    });
    LinearLayout layout=new LinearLayout(getActivity());layout.setOrientation(LinearLayout.VERTICAL);Button cancel=new Button(getActivity());cancel.setText("Cancel verification");cancel.setOnClickListener(v->p.finish(null,"Verification cancelled."));layout.addView(cancel);layout.addView(p.web,new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,0,1));
    p.dialog.setContentView(layout);p.dialog.setOnCancelListener(d->p.finish(null,"Verification cancelled."));p.dialog.show();p.dialog.getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.MATCH_PARENT);
    String fragment=new Uri.Builder().appendQueryParameter("state",p.state).appendQueryParameter("provider",provider).appendQueryParameter("siteKey",key).appendQueryParameter("action",action).build().getEncodedQuery();
    handler.postDelayed(p.expiry,180000);p.web.loadUrl(page+"#"+fragment);
   }catch(Exception ignored){if(pending!=null)pending.finish(null,"Verification could not start.");else call.reject("Verification could not start.");}
  });
 }
 @PluginMethod public void cancel(PluginCall call){getActivity().runOnUiThread(()->{if(active!=null&&active.id.equals(call.getString("requestId")))active.finish(null,"Verification cancelled.");call.resolve();});}
 @Override protected void handleOnDestroy(){if(active!=null)active.finish(null,"Verification closed.");super.handleOnDestroy();}
}
