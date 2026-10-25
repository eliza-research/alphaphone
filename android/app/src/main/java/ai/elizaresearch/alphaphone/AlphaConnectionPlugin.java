package ai.elizaresearch.alphaphone;

import android.content.Intent;
import android.net.Uri;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileNotFoundException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Iterator;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;
import org.json.JSONTokener;

/** First-party renderer transport and encrypted storage. Never injected into browser pages. */
@CapacitorPlugin(name = "AlphaConnection")
public final class AlphaConnectionPlugin extends Plugin {
 private volatile Uri delegationCallback;
 @Override public void load() { super.load(); captureDelegationCallback(getActivity().getIntent()); captureAuthCallback(getActivity().getIntent()); }
 @Override protected void handleOnNewIntent(Intent intent) { super.handleOnNewIntent(intent); captureDelegationCallback(intent); captureAuthCallback(intent); }
 private void captureDelegationCallback(Intent intent) {
  Uri uri = intent == null ? null : intent.getData();
  if(uri==null || !"alphaphone".equals(uri.getScheme()) || !"cloud-delegation".equals(uri.getHost()) || uri.getPort()!=-1 || uri.getUserInfo()!=null || uri.getFragment()!=null || (uri.getPath()!=null&&!uri.getPath().isEmpty()&&!"/".equals(uri.getPath())))return;
  try {
   Set<String> names=uri.getQueryParameterNames();
   if(!names.equals(Set.of("state","code"))&&!names.equals(Set.of("state","error")))return;
   for(String name:names)if(uri.getQueryParameters(name).size()!=1)return;
   String state=uri.getQueryParameter("state");
   if(state==null||!state.matches("[A-Za-z0-9_-]{43}"))return;
   if(names.contains("code"))required(uri.getQueryParameter("code"),4096);
   getActivity().setIntent(intent);delegationCallback=uri;notifyListeners("cloudDelegationCallback",new JSObject(),true);
  }catch(Exception ignored){ /* Invalid unsolicited links never enter the authentication flow. */ }
 }
 @PluginMethod public void readDelegationCallback(PluginCall call) {
  JSObject out=new JSObject();Uri uri=delegationCallback;
  if(uri==null){out.put("callback",JSONObject.NULL);call.resolve(out);return;}
  JSObject value=new JSObject();value.put("state",uri.getQueryParameter("state"));
  if(uri.getQueryParameter("code")!=null)value.put("code",uri.getQueryParameter("code"));else value.put("error","access_denied");
  out.put("callback",value);call.resolve(out);
 }
 @PluginMethod public void clearDelegationCallback(PluginCall call) {
  String state=call.getString("state");Uri uri=delegationCallback;
  if(uri!=null&&state!=null&&state.equals(uri.getQueryParameter("state"))){delegationCallback=null;Intent intent=getActivity().getIntent();if(intent!=null&&uri.equals(intent.getData()))intent.setData(null);}
  call.resolve();
 }

 // The native bridge retains only a bounded callback. PKCE/state validation belongs to
 // the Alpha login controller; neither unsolicited links nor Google pages receive the bridge.
 private volatile String authCallback;
 private volatile String gmailCallback;
 private void captureAuthCallback(Intent intent) {
  Uri uri=intent==null?null:intent.getData();
  if(uri==null || uri.toString().length()>4096 || uri.getUserInfo()!=null || uri.getPort()!=-1)return;
  boolean gmailLink="https".equals(uri.getScheme()) && "alphacompute.ai".equals(uri.getHost()) &&
   Set.of("/alphaphone/gmail/callback","/alphaphone/gmail/staging/callback").contains(uri.getPath());
  boolean gmailFallback="alphaphone".equals(uri.getScheme()) && "gmail".equals(uri.getHost()) &&
   Set.of("/production","/staging").contains(uri.getPath());
  if(gmailLink||gmailFallback){gmailCallback=uri.toString();getActivity().setIntent(intent);return;}
  boolean appLink="https".equals(uri.getScheme()) && "alphacompute.ai".equals(uri.getHost()) &&
   Set.of("/alphaphone/auth/callback","/alphaphone/auth/staging/callback").contains(uri.getPath());
  boolean fallback="alphaphone".equals(uri.getScheme()) && "auth".equals(uri.getHost()) &&
   Set.of("/production","/staging").contains(uri.getPath());
  if(!appLink&&!fallback)return;
  authCallback=uri.toString();getActivity().setIntent(intent);
 }
 @PluginMethod public void readAuthCallback(PluginCall call) {
  JSObject out=new JSObject();out.put("url",authCallback==null?JSONObject.NULL:authCallback);call.resolve(out);
 }
 @PluginMethod public void readGmailCallback(PluginCall call) {
  JSObject out=new JSObject();out.put("url",gmailCallback==null?JSONObject.NULL:gmailCallback);call.resolve(out);
 }
 @PluginMethod public void clearGmailCallback(PluginCall call) {
  String old=gmailCallback;gmailCallback=null;Intent intent=getActivity().getIntent();
  if(intent!=null&&intent.getData()!=null&&intent.getData().toString().equals(old))intent.setData(null);
  call.resolve();
 }
 @PluginMethod public void clearAuthCallback(PluginCall call) {
  String old=authCallback;authCallback=null;Intent intent=getActivity().getIntent();
  if(intent!=null&&intent.getData()!=null&&intent.getData().toString().equals(old))intent.setData(null);
  call.resolve();
 }
 @PluginMethod public void openAuth(PluginCall call) {
  try {
   URI url=validatedUrl(call.getString("url"),false);
   boolean account=CloudDeployment.authorize(url);
   boolean gmail="accounts.google.com".equals(url.getHost()) && "/o/oauth2/v2/auth".equals(url.getPath());
   if((!account&&!gmail) || (gmail && url.getPort()!=-1))throw new IllegalArgumentException();
   getActivity().runOnUiThread(()->{
    try {
     // Custom Tabs keep the provider isolated while preserving the Alpha app task.
     androidx.browser.customtabs.CustomTabsIntent tab=new androidx.browser.customtabs.CustomTabsIntent.Builder()
      .setShowTitle(true).setDefaultColorSchemeParams(new androidx.browser.customtabs.CustomTabColorSchemeParams.Builder()
       .setToolbarColor(android.graphics.Color.rgb(245,243,237)).build()).build();
     String browser=androidx.browser.customtabs.CustomTabsClient.getPackageName(getContext(),null);
     if(browser==null){call.reject("Google sign-in requires a system browser with Custom Tabs.");return;}
     tab.intent.setPackage(browser);tab.launchUrl(getActivity(),Uri.parse(url.toASCIIString()));call.resolve();
    }catch(RuntimeException error){call.reject("Alpha Phone sign-in is unavailable.");}
   });
  }catch(Exception error){call.reject("Unsupported sign-in URL");}
 }

 private static final String KEY_ALIAS = "alpha.connection.aes.v1";
 private static final int RESPONSE_LIMIT = 2 * 1024 * 1024;
 private static final int SECRET_LIMIT = 256 * 1024;
 private final ExecutorService workers = Executors.newFixedThreadPool(4);
 private volatile boolean destroyed;
 private static final Object storageLock = new Object();
 private final ConcurrentHashMap<String, Pending> requests = new ConcurrentHashMap<>();
 /** Bridge messages already queued during Activity teardown can arrive after shutdown. */
 private boolean submit(PluginCall call,Runnable task) {
  if(destroyed){call.reject("Connection closed");return false;}
  try{workers.execute(task);return true;}
  catch(java.util.concurrent.RejectedExecutionException stopped){call.reject("Connection closed");return false;}
 }
 private static final class Pending {
  volatile boolean cancelled;
  volatile HttpURLConnection connection;
  void cancel() { cancelled = true; HttpURLConnection current = connection; if (current != null) current.disconnect(); }
 }
 private static String required(String value, int max) {
  if (value == null || value.isEmpty() || value.length() > max) throw new IllegalArgumentException();
  return value;
 }
 private static int slotLimit(String name){if("notes-audio-deletions:v1:device".equals(name))return 1024*1024;if(name!=null&&name.matches("note-audio-metadata:v1:[A-Za-z0-9_-]{1,100}"))return 512*1024;if("notes-records:v1:device".equals(name))return 32*1024*1024;return name!=null&&(name.startsWith("inbox-drafts:v1:")||name.matches("inbox-operation:v1:[a-f0-9]{64}"))?8*1024*1024:SECRET_LIMIT;}
 private String slotHash(String slot) throws Exception {
  byte[] hash = MessageDigest.getInstance("SHA-256").digest(required(slot, 1024).getBytes(StandardCharsets.UTF_8));
  StringBuilder result = new StringBuilder();
  for (byte b : hash) result.append(String.format(Locale.ROOT, "%02x", b & 255));
  return result.toString();
 }
 private AtomicFile slotFile(String hash) throws Exception {
  File directory = new File(getContext().getNoBackupFilesDir(), "connection-credentials");
  if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException();
  return new AtomicFile(new File(directory, hash));
 }
 private SecretKey key() throws Exception {
  KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
  if (!store.containsAlias(KEY_ALIAS)) {
   KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
   generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
     .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
   generator.generateKey();
  }
  return (SecretKey) store.getKey(KEY_ALIAS, null);
 }
 private static Object parseJson(String value) throws Exception {
  JSONTokener parser = new JSONTokener(value);
  Object parsed = parser.nextValue();
  if (parser.nextClean() != 0) throw new IllegalArgumentException();
  return parsed;
 }
 /** value is serialized JSON; native code never interprets credential fields. */
 @PluginMethod public void secureWrite(PluginCall call) {
  submit(call,() -> {
   try {
    writeCredentialSlot(RendererCredentialSlots.requireAllowed(call.getString("slot")), call.getString("value"));
    call.resolve();
   } catch (Exception error) { call.reject("Secure storage write failed"); }
  });
 }
 void writeCredentialSlot(String name, String serialized) throws Exception {
    String slot = slotHash(name);
    int limit=slotLimit(name);
    String value = required(serialized, limit);
    parseJson(value);
    byte[] plain = value.getBytes(StandardCharsets.UTF_8);
    if (plain.length > limit) throw new IllegalArgumentException();
    synchronized (storageLock) {
     Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
     cipher.updateAAD(slot.getBytes(StandardCharsets.US_ASCII));
     byte[] iv = cipher.getIV(), encrypted = cipher.doFinal(plain);
     AtomicFile file = slotFile(slot); FileOutputStream out = null;
     try {
      out = file.startWrite(); out.write(1); out.write(iv.length); out.write(iv); out.write(encrypted);
      out.getFD().sync(); file.finishWrite(out);
      out = null;
      try (InputStream input = file.openRead()) {
       byte[] committed = readBounded(input, limit + 64);
       if (committed.length != 2 + iv.length + encrypted.length || committed[0] != 1 || committed[1] != iv.length
         || !Arrays.equals(iv, Arrays.copyOfRange(committed, 2, 2 + iv.length))
         || !Arrays.equals(encrypted, Arrays.copyOfRange(committed, 2 + iv.length, committed.length))) throw new IllegalStateException();
      }
     } catch (Exception error) { if (out != null) file.failWrite(out); throw error; }
     finally { Arrays.fill(plain, (byte) 0); }
    }
 }
 /** Native consumers share the same authenticated slot format without a JS credential round trip. */
 String readCredentialSlot(String name) throws Exception {
  String slot=slotHash(name);int limit=slotLimit(name);
  synchronized(storageLock) {
   AtomicFile file=slotFile(slot); byte[] stored;
   try(InputStream input=file.openRead()){stored=readBounded(input,limit+64);}
   catch(FileNotFoundException missing){if(file.getBaseFile().exists()||new File(file.getBaseFile().getPath()+".bak").exists())throw missing;return null;}
   if(stored.length<30||stored[0]!=1||stored[1]!=12)throw new IllegalArgumentException();
   Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
   cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Arrays.copyOfRange(stored,2,14)));
   cipher.updateAAD(slot.getBytes(StandardCharsets.US_ASCII));
   byte[] plain=cipher.doFinal(stored,14,stored.length-14);
   try{String value=new String(plain,StandardCharsets.UTF_8);parseJson(value);return value;}
   finally{Arrays.fill(plain,(byte)0);}
  }
 }
 /** Required before rendering or persisting mock mode; never resumes automatically. */
 @PluginMethod public void pauseNotificationCollection(PluginCall call) {
  submit(call,()->{try{NotificationAccess.pause(getContext(),true);call.resolve();}catch(Exception failure){call.reject("Notification collection could not be paused");}});
 }
 @PluginMethod public void secureRead(PluginCall call) {
  submit(call,()->{
   try{String value=readCredentialSlot(RendererCredentialSlots.requireAllowed(call.getString("slot")));JSObject result=new JSObject();result.put("value",value==null?JSONObject.NULL:value);call.resolve(result);}
   catch(Exception error){call.reject("Secure storage read failed");}
  });
 }
 /** Compare-and-exchange is scoped to local drafts and pending device actions, never credential slots. */
 @PluginMethod public void secureCompareExchange(PluginCall call) {
  submit(call,()->{
   try {
    String name=RendererCredentialSlots.requireAllowed(call.getString("slot"));
    if(name==null||!(name.startsWith("inbox-drafts:v1:")||name.matches("inbox-operation:v1:[a-f0-9]{64}")||name.matches("workflow-draft:v1:[a-f0-9]{64}")||name.equals("notes-records:v1:device")||name.equals("reminder-deletions:v1:device")||name.equals("reminder-creations:v1:device")||name.equals("notes-audio-deletions:v1:device")||name.matches("cloud-delegation:v1:[a-f0-9]{64}"))||!call.getData().has("expectedValue")||!call.getData().has("value"))throw new IllegalArgumentException();
    for(String field:new String[]{"expectedValue","value"})if(!call.getData().isNull(field)&&!(call.getData().get(field) instanceof String))throw new IllegalArgumentException();
    String expected=call.getString("expectedValue"), value=call.getString("value");
    synchronized(storageLock){
     String current=readCredentialSlot(name);
     JSObject result=new JSObject();
     if(!java.util.Objects.equals(expected,current)){result.put("status","conflict");call.resolve(result);return;}
     if(value!=null)writeCredentialSlot(name,value);
     else {
      AtomicFile file=slotFile(slotHash(name));file.delete();
      if(file.getBaseFile().exists()||new File(file.getBaseFile().getPath()+".bak").exists()||new File(file.getBaseFile().getPath()+".new").exists())throw new IllegalStateException();
     }
     result.put("status","saved");call.resolve(result);
    }
   }catch(Exception error){call.reject("Secure draft update failed");}
  });
 }
 void removeCredentialSlot(String name)throws Exception {
  synchronized(storageLock){
   AtomicFile file=slotFile(slotHash(name));file.delete();
   if(file.getBaseFile().exists()||new File(file.getBaseFile()+".bak").exists()||new File(file.getBaseFile()+".new").exists())throw new java.io.IOException("Secure slot removal failed");
  }
 }
 @PluginMethod public void secureRemove(PluginCall call) {
  submit(call,() -> {
   try {
    String slot = slotHash(RendererCredentialSlots.requireAllowed(call.getString("slot")));
    synchronized (storageLock) {
     AtomicFile file = slotFile(slot); file.delete();
     if (file.getBaseFile().exists() || new File(file.getBaseFile().getPath() + ".bak").exists() || new File(file.getBaseFile().getPath() + ".new").exists()) throw new IllegalStateException();
    }
    call.resolve();
   } catch (Exception error) { call.reject("Secure storage removal failed"); }
  });
 }
 private static URI validatedUrl(String text, boolean allowDevelopment) throws Exception {
  URI url = new URI(required(text, 16384));
  String host = url.getHost(), scheme = url.getScheme();
  if (host == null || url.getRawUserInfo() != null || url.getRawFragment() != null || url.getPort() == 0 || url.getPort() > 65535) throw new IllegalArgumentException();
  boolean development = allowDevelopment && BuildConfig.DEBUG && "http".equals(scheme)
    && ("127.0.0.1".equals(host) || "10.0.2.2".equals(host));
  if (!"https".equals(scheme) && !development) throw new IllegalArgumentException();
  return url;
 }
 private static byte[] readBounded(InputStream input, int limit) throws Exception {
  if (input == null) return new byte[0];
  ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int count;
  while ((count = input.read(buffer)) != -1) {
   if (output.size() + count > limit) throw new IllegalArgumentException();
   output.write(buffer, 0, count);
  }
  return output.toByteArray();
 }
 static boolean validDeviceCapabilities(String value) {
  if(value==null||value.contains("\r")||value.contains("\n"))return false;
  String[] parts=value.split(",",-1);if(parts.length<1||parts.length>6)return false;
  java.util.HashSet<String> seen=new java.util.HashSet<>();
  for(String part:parts){String token=part.trim();if(!Set.of("calendar.local-event.v1","notes.local-record.v1","reminders.local-record.v1","reminders.local-record.v2","reminders.create.v1","maps.selected-read.v1","clock.handoff.v1").contains(token)||!seen.add(token))return false;}
  if(seen.contains("reminders.local-record.v1")&&seen.contains("reminders.local-record.v2"))return false;
  return parts.length<=(seen.contains("reminders.create.v1")?6:5);
 }
 @PluginMethod public void request(PluginCall call) {
  final String id;
  try { id = required(call.getString("requestId"), 256); }
  catch (Exception error) { call.reject("Invalid request"); return; }
  Pending pending = new Pending();
  if (requests.putIfAbsent(id, pending) != null) { call.reject("Request already active"); return; }
  if(!submit(call,() -> {
   HttpURLConnection connection = null;
   try {
    if (pending.cancelled) throw new IllegalStateException();
    URI url = validatedUrl(call.getString("url"), true);
    int responseLimit=url.getPath().startsWith("/api/v1/eliza/google/gmail/inbox-v1/")?8*1024*1024:RESPONSE_LIMIT;
    String method = call.getString("method", "GET");
    if (!Set.of("GET", "POST").contains(method)) throw new IllegalArgumentException();
    connection = (HttpURLConnection) url.toURL().openConnection(); pending.connection = connection;
    connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(20000); connection.setReadTimeout(120000);
    connection.setUseCaches(false); connection.setRequestMethod(method);
    JSObject headers = call.getObject("headers", new JSObject());
    Iterator<String> names = headers.keys();
    while (names.hasNext()) {
     String name = names.next(), normalized = name.toLowerCase(Locale.ROOT);
     if (!Set.of("accept", "content-type", "authorization", "x-steward-tenant", "x-eliza-device-id", "x-eliza-device-key", "x-eliza-device-capabilities", "x-eliza-phone-protocol").contains(normalized)) throw new IllegalArgumentException();
     Object raw = headers.get(name); if (!(raw instanceof String)) throw new IllegalArgumentException();
     String value = (String) raw;
     if (value.length() > 16384 || value.contains("\r") || value.contains("\n")) throw new IllegalArgumentException();
     if ("x-steward-tenant".equals(normalized) && !value.matches("[A-Za-z0-9_-]{1,100}")) throw new IllegalArgumentException();
     if ("x-eliza-device-capabilities".equals(normalized) && !validDeviceCapabilities(value)) throw new IllegalArgumentException();
     if ("x-eliza-phone-protocol".equals(normalized) && !"1".equals(value)) throw new IllegalArgumentException();
     connection.setRequestProperty(name, value);
    }
    String body = call.getString("body");
    if (body != null) {
     if (!"POST".equals(method)) throw new IllegalArgumentException();
     byte[] encoded = body.getBytes(StandardCharsets.UTF_8);
     if (encoded.length > responseLimit) throw new IllegalArgumentException();
     parseJson(body); connection.setDoOutput(true); connection.setFixedLengthStreamingMode(encoded.length);
     if (pending.cancelled) throw new IllegalStateException();
     try (java.io.OutputStream output = connection.getOutputStream()) { output.write(encoded); }
    }
    if (pending.cancelled) throw new IllegalStateException();
    int status = connection.getResponseCode();
    if (status >= 300 && status < 400) throw new IllegalArgumentException();
    if (connection.getContentLengthLong() > responseLimit) throw new IllegalArgumentException();
    byte[] bytes;
    try (InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream()) { bytes = readBounded(input, responseLimit); }
    if (pending.cancelled) throw new IllegalStateException();
    Object data = JSONObject.NULL;
    if (bytes.length > 0) {
     try { data = parseJson(new String(bytes, StandardCharsets.UTF_8)); }
     catch (Exception error) { if (status < 400) throw error; }
    }
    JSObject result = new JSObject(); result.put("status", status); result.put("data", data); call.resolve(result);
   } catch (Exception error) { call.reject(pending.cancelled ? "Request cancelled" : "Connection request failed"); }
   finally { if (connection != null) connection.disconnect(); requests.remove(id, pending); }
  }))requests.remove(id,pending);
 }
 @PluginMethod public void cancel(PluginCall call) {
  String id = call.getString("requestId", ""); Pending pending = requests.get(id); if (pending != null) pending.cancel(); call.resolve();
 }
 @PluginMethod public void openExternal(PluginCall call) {
  try {
   URI url = validatedUrl(call.getString("url"), false);
   String host = url.getHost().toLowerCase(Locale.ROOT);
   if (!(host.equals("eliza.app") || host.endsWith(".eliza.app") || host.equals("accounts.google.com"))) throw new IllegalArgumentException();
   if (url.getPort() != -1 && url.getPort() != 443) throw new IllegalArgumentException();
   Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url.toASCIIString())); intent.addCategory(Intent.CATEGORY_BROWSABLE);
   getActivity().runOnUiThread(() -> {
    try { getActivity().startActivity(intent); call.resolve(); }
    catch (RuntimeException error) { call.reject("Authentication browser unavailable"); }
   });
  } catch (Exception error) { call.reject("Unsupported authentication URL"); }
 }
 @Override protected void handleOnDestroy() {
  destroyed=true;
  for (Pending pending : requests.values()) pending.cancel();
  workers.shutdownNow(); super.handleOnDestroy();
 }
}
