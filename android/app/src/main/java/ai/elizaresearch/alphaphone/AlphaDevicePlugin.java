package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.system.SystemFacts;
import ai.eliza.plugins.system.SystemSettingsPages;
import ai.eliza.plugins.system.SystemShade;
import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Device facts, allowlisted settings, and explicit bounded text handoffs to Android. */
@CapacitorPlugin(name="AlphaDevice")
public final class AlphaDevicePlugin extends Plugin {
 /** Explicit bounded text handoff; chooser opening never claims a sent message. */
 static String boundedShareText(String text){
  if(text==null||text.isBlank()||text.indexOf('\0')>=0||text.length()>65536)throw new IllegalArgumentException();
  try{java.nio.ByteBuffer bytes=java.nio.charset.StandardCharsets.UTF_8.newEncoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).encode(java.nio.CharBuffer.wrap(text));if(bytes.remaining()>65536)throw new IllegalArgumentException();}
  catch(java.nio.charset.CharacterCodingException malformed){throw new IllegalArgumentException();}
  return text;
 }
 static boolean shareForeground(android.app.Activity activity){
  if(activity==null||activity.isFinishing()||activity.isDestroyed()||!activity.hasWindowFocus())return false;
  android.app.KeyguardManager lock=activity.getSystemService(android.app.KeyguardManager.class);
  android.os.UserManager users=activity.getSystemService(android.os.UserManager.class);
  return lock!=null&&users!=null&&!lock.isDeviceLocked()&&users.isUserUnlocked()&&activity instanceof androidx.lifecycle.LifecycleOwner&&((androidx.lifecycle.LifecycleOwner)activity).getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED);
 }
 @PluginMethod public void shareText(PluginCall call){
  final String text,title;try{text=boundedShareText(call.getString("text"));title=call.getString("title","");if(title.length()>200||title.chars().anyMatch(c->c<32||c==127))throw new IllegalArgumentException();}catch(Exception invalid){call.reject("Choose valid text of at most 64 KiB.");return;}
  android.app.Activity activity=getActivity();if(activity==null){call.reject("Open and unlock Alpha before sharing.");return;}
  activity.runOnUiThread(()->{if(!shareForeground(activity)){call.reject("Open and unlock Alpha before sharing.");return;}try{
   Intent send=new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,text).putExtra(Intent.EXTRA_SUBJECT,title).putExtra(Intent.EXTRA_TITLE,title);
   activity.startActivity(Intent.createChooser(send,"Share externally"));JSObject result=new JSObject();result.put("status","opened");call.resolve(result);
  }catch(RuntimeException unavailable){call.reject("Android sharing is unavailable.");}});
 }
 @PluginMethod public void copyText(PluginCall call){
  final String text;try{text=boundedShareText(call.getString("text"));}catch(Exception invalid){call.reject("Choose valid text of at most 64 KiB.");return;}
  android.app.Activity activity=getActivity();if(activity==null){call.reject("Open and unlock Alpha before copying.");return;}
  activity.runOnUiThread(()->{if(!shareForeground(activity)){call.reject("Open and unlock Alpha before copying.");return;}try{android.content.ClipboardManager clipboard=activity.getSystemService(android.content.ClipboardManager.class);if(clipboard==null)throw new IllegalStateException();clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Alpha text",text));call.resolve();}catch(RuntimeException unavailable){call.reject("Clipboard unavailable.");}});
 }
 static int textScalePercent(Context context){int value=context.getSharedPreferences("alpha-appearance",Context.MODE_PRIVATE).getInt("text-scale-percent",100);return value>=75&&value<=150?value:100;}
 static int effectiveTextZoom(Context context,int percent){float scale=context.getResources().getConfiguration().fontScale;if(!Float.isFinite(scale)||scale<=0)scale=1;return Math.max(1,Math.round(percent*scale));}
 static void applyTextScale(MainActivity activity){activity.getBridge().getWebView().getSettings().setTextZoom(effectiveTextZoom(activity,textScalePercent(activity)));}
 @PluginMethod public void setTextScale(PluginCall call){
  Integer percent=call.getInt("percent");if(percent==null||percent<75||percent>150){call.reject("Text size must be between75 and150 percent");return;}
  getActivity().runOnUiThread(()->{
   if(!(getActivity() instanceof MainActivity)||getActivity().isFinishing()||getActivity().isDestroyed()){call.reject("Alpha view is unavailable");return;}
   if(!getContext().getSharedPreferences("alpha-appearance",Context.MODE_PRIVATE).edit().putInt("text-scale-percent",percent).commit()){call.reject("Text size could not be saved");return;}
   applyTextScale((MainActivity)getActivity());JSObject out=new JSObject();out.put("textScalePercent",textScalePercent(getContext()));out.put("effectiveTextZoom",getBridge().getWebView().getSettings().getTextZoom());call.resolve(out);
  });
 }
 @PluginMethod public void snapshot(PluginCall call) {
  JSObject out=new JSObject();
  // System switch, transport and power facts come from the shared reader (ElizaSystem.getSystemFacts):
  // a key Android did not answer is absent, never off.
  for(java.util.Map.Entry<String,Object> fact:SystemFacts.read(getContext()).entrySet())out.put(fact.getKey(),fact.getValue());
  out.put("model",Build.MODEL);out.put("manufacturer",Build.MANUFACTURER);
  out.put("androidRelease",Build.VERSION.RELEASE);out.put("securityPatch",Build.VERSION.SECURITY_PATCH);
  out.put("build",Build.DISPLAY);out.put("appVersion",BuildConfig.VERSION_NAME);
  out.put("readAt",System.currentTimeMillis());
  out.put("textScalePercent",textScalePercent(getContext()));out.put("effectiveTextZoom",effectiveTextZoom(getContext(),textScalePercent(getContext())));
  NotificationManager notifications=(NotificationManager)getContext().getSystemService(Context.NOTIFICATION_SERVICE);
  out.put("notificationsEnabled",notifications!=null&&notifications.areNotificationsEnabled());
  JSObject grants=new JSObject();
  boolean fine=getContext().checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED,coarse=getContext().checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED;
  out.put("locationAccess",fine?"precise":coarse?"approximate":"denied");
  // Only permissions Alpha declares. Contacts is removed from the manifest, so it is not reported.
  String[][] permissions={{"Microphone",Manifest.permission.RECORD_AUDIO},{"Location",Manifest.permission.ACCESS_FINE_LOCATION},{"Camera",Manifest.permission.CAMERA},{"Calendar",Manifest.permission.READ_CALENDAR}};
  for(String[] p:permissions)grants.put(p[0],getContext().checkSelfPermission(p[1])==PackageManager.PERMISSION_GRANTED);
  grants.put("Location",fine||coarse);out.put("permissions",grants);
  out.put("passwordProvider",PasswordProviderSupport.status(getContext()));
  appFacts(getContext(),out);call.resolve(out);
 }
 /** Alpha's own build facts, omitted when Android cannot answer. */
 static void appFacts(Context context,JSObject out){
  java.util.Map<String,Object> facts=new java.util.LinkedHashMap<>();
  SystemFacts.fact(facts,"appVersionCode",()->BuildConfig.VERSION_CODE);
  SystemFacts.fact(facts,"appUpdatedAt",()->{long at=context.getPackageManager().getPackageInfo(context.getPackageName(),0).lastUpdateTime;return at>0?at:null;});
  for(java.util.Map.Entry<String,Object> fact:facts.entrySet())out.put(fact.getKey(),fact.getValue());
 }
 @PluginMethod public void openPasswordProvider(PluginCall call) {
  String action=call.getString("action","");
  getActivity().runOnUiThread(()->{
   try {
    Intent target=PasswordProviderSupport.intent(getContext(),action);
    String destination=Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE.equals(target.getAction())?"provider-picker":"external";
    try { getActivity().startActivity(target); }
    catch(android.content.ActivityNotFoundException missing) {
     if(!"settings".equals(action)||!Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE.equals(target.getAction()))throw missing;
     getActivity().startActivity(new Intent(Settings.ACTION_SETTINGS));destination="system-settings";
    }
    if(Settings.ACTION_SETTINGS.equals(target.getAction()))destination="system-settings";
    JSObject out=new JSObject();out.put("status","opened");out.put("destination",destination);call.resolve(out);
   } catch(RuntimeException unavailable) { call.reject("Password provider setup could not be opened. No provider change is confirmed."); }
  });
 }
 /**
  * Asks Android to open its own notification shade (#416, #417). Launcher flavor only, and only
  * while Alpha's window has focus, so a pull or button on visible Home is the only way to reach it.
  * Resolves with {status}: opened, standalone, permission-missing, unsupported or not-in-front.
  * Any status but opened leaves the renderer's truthful fallback to show.
  */
 @PluginMethod public void openNotificationShade(PluginCall call){
  android.app.Activity activity=getActivity();
  if(activity==null){JSObject out=new JSObject();out.put("status","not-in-front");call.resolve(out);return;}
  activity.runOnUiThread(()->{
   JSObject out=new JSObject();
   if(activity.isFinishing()||activity.isDestroyed()||!activity.hasWindowFocus())out.put("status",SystemShade.NOT_IN_FRONT);
   else out.put("status",SystemShade.expand(getContext(),BuildConfig.IS_LAUNCHER));
   call.resolve(out);
  });
 }
 @PluginMethod public void openSettings(PluginCall call) {
  String page=call.getString("page","");
  if(SystemSettingsPages.actions(page)==null){call.reject("Unsupported settings page");return;}
  getActivity().runOnUiThread(()->{
   // The shared allowlist (SystemSettingsPages); "specific" is false when only the broader fallback opened.
   int opened=SystemSettingsPages.open(page,getContext().getPackageName(),intent->getActivity().startActivity(intent));
   if(opened<0){call.reject("This Android settings page is unavailable");return;}
   JSObject out=new JSObject();out.put("status","opened");out.put("page",page);out.put("specific",opened==0);call.resolve(out);
  });
 }

 private final java.util.concurrent.ExecutorService diagnosticsWorker=java.util.concurrent.Executors.newSingleThreadExecutor();
 /**
  * Runs problem-log work off the bridge thread. A call that the page made just before the activity
  * was destroyed can arrive after handleOnDestroy has stopped the worker; the executor then throws
  * on the bridge thread and the process dies (seen once on the API 36 emulator in
  * LauncherHomeInstrumentedTest). Such a call is answered with a rejection instead.
  */
 private void diagnostics(PluginCall call,Runnable work){
  PluginWorkers.submit(diagnosticsWorker,work,()->call.reject("Problem log is unavailable"));
 }
 /** Local problem log (shared plugin-native-system crash.CrashLog): failure classes only, never messages, stacks or content. */
 @PluginMethod public void crashLog(PluginCall call){
  diagnostics(call,()->{
   try{
    try{ai.eliza.plugins.system.crash.CrashLog.collectExitReasons(getContext());}catch(Exception unavailable){/* Exit history is best effort. */}
    JSObject out=new JSObject();out.put("entries",ai.eliza.plugins.system.crash.CrashLog.read(getContext()).getJSONArray("entries"));out.put("exitHistory",Build.VERSION.SDK_INT>=Build.VERSION_CODES.R);call.resolve(out);
   }catch(Exception error){call.reject("Problem log is unavailable");}
  });
 }
 @PluginMethod public void recordRendererFailure(PluginCall call){
  diagnostics(call,()->{try{ai.eliza.plugins.system.crash.CrashLog.recordRenderer(getContext(),call.getString("kind"),call.getString("errorClass"));call.resolve();}catch(Exception error){call.reject("Problem was not recorded");}});
 }
 @PluginMethod public void clearCrashLog(PluginCall call){
  diagnostics(call,()->{try{ai.eliza.plugins.system.crash.CrashLog.clear(getContext());call.resolve();}catch(Exception error){call.reject("Problem log could not be cleared");}});
 }
 /** Non-secret build identity for diagnostics: variant, pin and packaged runtime hashes. */
 @PluginMethod public void diagnosticsFacts(PluginCall call){
  diagnostics(call,()->{
   try{
    JSObject out=new JSObject();
    out.put("appVersion",BuildConfig.VERSION_NAME);out.put("versionCode",BuildConfig.VERSION_CODE);
    out.put("variant",BuildConfig.IS_LAUNCHER?"launcher":"standalone");out.put("buildType",BuildConfig.BUILD_TYPE);
    out.put("testMocks",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);out.put("sdkInt",Build.VERSION.SDK_INT);
    out.put("androidRelease",Build.VERSION.RELEASE);out.put("securityPatch",Build.VERSION.SECURITY_PATCH);
    JSObject hashes=new JSObject();
    for(String asset:new String[]{"agent/alpha-source.json","agent/agent-bundle.js","agent/workflow-worker/manifest.json","agent/workflow-worker/files.sha256"}){String hash=assetSha256(asset);if(hash!=null)hashes.put(asset,hash);}
    out.put("runtimeHashes",hashes);
    try(java.io.InputStream in=getContext().getAssets().open("agent/alpha-source.json")){
     java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[8192];int count,total=0;
     while((count=in.read(buffer))!=-1){total+=count;if(total>64*1024)throw new java.io.IOException();bytes.write(buffer,0,count);}
     String base=new org.json.JSONObject(new String(bytes.toByteArray(),java.nio.charset.StandardCharsets.UTF_8)).optString("base","");
     if(base.matches("[0-9a-f]{40}"))out.put("upstreamPin",base);
    }catch(Exception notPackaged){/* Developer APKs may omit the packaged runtime. */}
    call.resolve(out);
   }catch(Exception error){call.reject("Diagnostics are unavailable");}
  });
 }
 private String assetSha256(String asset){
  try(java.io.InputStream in=getContext().getAssets().open(asset)){
   java.security.MessageDigest digest=java.security.MessageDigest.getInstance("SHA-256");byte[] buffer=new byte[65536];int count;
   while((count=in.read(buffer))!=-1)digest.update(buffer,0,count);
   StringBuilder hex=new StringBuilder();for(byte b:digest.digest())hex.append(String.format(java.util.Locale.ROOT,"%02x",b));return hex.toString();
  }catch(Exception absent){return null;}
 }
 /** User-initiated share of already redacted diagnostics. Android's chooser decides the destination. */
 @PluginMethod public void shareDiagnostics(PluginCall call){
  String text=call.getString("text");
  if(text==null||text.length()>256*1024){call.reject("Diagnostics are too large");return;}
  try{Object parsed=new org.json.JSONTokener(text).nextValue();if(!(parsed instanceof org.json.JSONObject)||!"alpha-diagnostics/v1".equals(((org.json.JSONObject)parsed).optString("format")))throw new IllegalArgumentException();}
  catch(Exception invalid){call.reject("Diagnostics are not valid");return;}
  getActivity().runOnUiThread(()->{
   try{
    Intent send=new Intent(Intent.ACTION_SEND);send.setType("text/plain");send.putExtra(Intent.EXTRA_TEXT,text);send.putExtra(Intent.EXTRA_SUBJECT,"Alpha Phone diagnostics");
    getActivity().startActivity(Intent.createChooser(send,"Share diagnostics"));JSObject out=new JSObject();out.put("status","opened");call.resolve(out);
   }catch(RuntimeException unavailable){call.reject("Sharing is unavailable");}
  });
 }
 @Override protected void handleOnDestroy(){diagnosticsWorker.shutdown();super.handleOnDestroy();}
}
