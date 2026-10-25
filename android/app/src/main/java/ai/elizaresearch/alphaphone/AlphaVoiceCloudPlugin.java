package ai.elizaresearch.alphaphone;

import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import org.json.JSONObject;

/** Explicit, foreground Cloud voice actions. Credentials and audio never enter renderer memory. */
@CapacitorPlugin(name="AlphaVoiceCloud", permissions={@Permission(alias="microphone",strings={android.Manifest.permission.RECORD_AUDIO})})
public final class AlphaVoiceCloudPlugin extends Plugin {
 private AlphaCloudVoiceCapture capture;
 private final AtomicLong epoch=new AtomicLong();
 private final Map<String,Long> permissionEpochs=new ConcurrentHashMap<>();
 private final Map<String,Pending> pending=new ConcurrentHashMap<>();
 private final ExecutorService workers=new ThreadPoolExecutor(1,1,30,TimeUnit.SECONDS,new ArrayBlockingQueue<>(4));
 private final Handler main=new Handler(Looper.getMainLooper());
 private boolean draining; // Guarded by pending; remains closed after a drain timeout until the barrier completes.
 private final Map<PluginCall,Runnable> drainWaiters=new LinkedHashMap<>();
 private File playbackFile;
 private String playbackId;
 private String playbackRequestId;
 private MediaPlayer player;
 private PluginCall preparingPlayback;
 private volatile boolean destroyed;
 private volatile boolean speechForeground=true;
 private final ai.eliza.speech.LocalSpeechEngineHolder localEngine=new ai.eliza.speech.LocalSpeechEngineHolder(()->new ai.eliza.speech.LocalSpeechEngine(ai.eliza.speech.SpeechAssets.install(getContext())));
 private final java.util.concurrent.atomic.AtomicBoolean localReleaseQueued=new java.util.concurrent.atomic.AtomicBoolean();
 private final Runnable localIdleRelease=this::queueLocalRelease;
 private final android.content.ComponentCallbacks2 localMemoryCallbacks=new android.content.ComponentCallbacks2(){
  public void onConfigurationChanged(android.content.res.Configuration value){}
  public void onLowMemory(){releaseForMemoryPressure();}
  public void onTrimMemory(int level){if(level==TRIM_MEMORY_UI_HIDDEN)scheduleLocalRelease(30000);else if(level>=TRIM_MEMORY_RUNNING_LOW)releaseForMemoryPressure();}
 };
 private void releaseForMemoryPressure(){for(Pending request:pending.values())request.cancel();queueLocalRelease();}
 private void queueLocalRelease(){
  main.removeCallbacks(localIdleRelease);
  if(!localReleaseQueued.compareAndSet(false,true))return;
  try{workers.execute(()->{try{localEngine.release();}finally{localReleaseQueued.set(false);}});}catch(RejectedExecutionException ignored){localReleaseQueued.set(false);}
 }
 private void scheduleLocalRelease(long delay){main.removeCallbacks(localIdleRelease);if(!destroyed)main.postDelayed(localIdleRelease,delay);}
 @PluginMethod public void workflowPresentationCapabilities(PluginCall call){JSObject result=new JSObject();result.put("protocol",2);call.resolve(result);}
 @PluginMethod public void releaseLocalSpeech(PluginCall call){for(Pending request:pending.values())request.cancel();main.post(this::clearPlayback);queueLocalRelease();call.resolve();}

 // Test APK sets this directly on the plugin instance. Never exposed as a Capacitor method.
 String instrumentationBaseUrl;
 String instrumentationCredentialSlot;
 private static final int AUDIO_LIMIT=8*1024*1024;
 private static final class Pending { volatile boolean cancelled; volatile HttpURLConnection connection; volatile JSObject result; volatile String failure,failureCode; void cancel(){cancelled=true;if(connection!=null)connection.disconnect();} }
 @Override public void load(){getContext().registerComponentCallbacks(localMemoryCallbacks);capture=new AlphaCloudVoiceCapture(getContext(),v->notifyListeners("recordingStopped",v));File[] stale=getContext().getCacheDir().listFiles((d,n)->n.startsWith("alpha-cloud-tts-"));if(stale!=null)for(File f:stale)f.delete();}
 @PluginMethod public void startRecording(PluginCall call){
  if(isDraining()){call.reject("Voice cancellation is still draining");return;}
  if(getPermissionState("microphone")!=PermissionState.GRANTED){permissionEpochs.put(call.getCallbackId(),epoch.get());requestPermissionForAlias("microphone",call,"microphonePermission");return;}
  start(call,epoch.get());
 }
 @PermissionCallback private void microphonePermission(PluginCall call){Long e=permissionEpochs.remove(call.getCallbackId());if(e==null||e!=epoch.get()){call.reject("Recording cancelled");return;}if(getPermissionState("microphone")!=PermissionState.GRANTED){call.reject("Microphone permission denied");return;}start(call,e);}
 private void start(PluginCall call,long e){main.post(()->{if(destroyed||isDraining()||e!=epoch.get()){call.reject("Recording cancelled");return;}try{int limit=call.getInt("maxDurationMs",59000);if(limit!=29000&&limit!=59000)throw new IllegalArgumentException("Unsupported capture duration");call.resolve(capture.start(limit));}catch(Exception error){call.reject("Microphone could not start");}});}
 @PluginMethod public void stopRecording(PluginCall call){main.post(()->{try{call.resolve(capture.stop());}catch(Exception error){call.reject("Recording could not be saved");}});}
 @PluginMethod public void saveRecording(PluginCall call){getActivity().runOnUiThread(()->{try{String key=call.getString("recordingId");AlphaNoteAudioPlugin store=(AlphaNoteAudioPlugin)getBridge().getPlugin("AlphaNoteAudio").getInstance();call.resolve(capture.retain(store,key,call.getString("noteId"),call.getString("transcript")));}catch(Exception error){call.reject("The recording could not be saved. Keep this draft and retry.");}});}
 private boolean isDraining(){synchronized(pending){return draining;}}
 private void finishDrain(boolean complete,String error){
  List<PluginCall> calls;synchronized(pending){if(complete)draining=false;calls=new ArrayList<>(drainWaiters.keySet());for(Runnable timeout:drainWaiters.values())main.removeCallbacks(timeout);drainWaiters.clear();}
  for(PluginCall call:calls){if(error==null)call.resolve();else call.reject(error);}
 }
 @PluginMethod public void cancelRecording(PluginCall call){
  epoch.incrementAndGet();permissionEpochs.clear();
  synchronized(pending){
   if(destroyed){call.reject("Voice unavailable");return;}
   for(Pending request:pending.values())request.cancel();
   Runnable timeout=()->{boolean waiting;synchronized(pending){waiting=drainWaiters.remove(call)!=null;}if(waiting)call.reject("Voice cancellation is still draining");};
   drainWaiters.put(call,timeout);main.postDelayed(timeout,120000);if(draining)return;draining=true;
  }
  main.post(()->{
   try{capture.cancel();}catch(RuntimeException error){finishDrain(false,"Recording cancellation failed");return;}
   // Never wait on the UI thread. The serial worker barrier follows cancelled work and its cleanup.
   try{workers.execute(()->main.post(()->{finishDrain(true,destroyed?"Voice unavailable":null);}));}
   catch(RejectedExecutionException error){finishDrain(false,"Voice cancellation is unavailable");}
  });
 }
 private static String required(String value,int max){if(value==null||value.isBlank()||value.length()>max)throw new IllegalArgumentException();return value;}
 private HttpURLConnection connect(PluginCall call,String route,Pending request) throws Exception {
  String environment=call.getString("environment");
  String base=CloudDeployment.api(environment);
  AlphaConnectionPlugin store=(AlphaConnectionPlugin)getBridge().getPlugin("AlphaConnection").getInstance();
  String slot=CloudDeployment.slot(environment);
  if(BuildConfig.DEBUG && instrumentationCredentialSlot!=null){if(!instrumentationCredentialSlot.matches("instrumentation\\.[A-Za-z0-9_-]{1,100}"))throw new IllegalArgumentException();slot=instrumentationCredentialSlot;}
  JSONObject credential=new JSONObject(store.readCredentialSlot(slot));
  String generation=required(call.getString("credentialId"),128);
  if(!generation.equals(credential.optString("credentialId")))throw new IllegalStateException("Cloud account changed");
  String token=required(credential.getString("token"),16384);
  if(token.contains("\r")||token.contains("\n"))throw new IllegalArgumentException();
  if(credential.has("expiresAt")&&credential.getLong("expiresAt")<=System.currentTimeMillis())throw new IllegalStateException();
  if(BuildConfig.DEBUG && instrumentationBaseUrl!=null){java.net.URI test=new java.net.URI(instrumentationBaseUrl);if(!"http".equals(test.getScheme())||!"127.0.0.1".equals(test.getHost())||test.getPort()<1024||test.getRawUserInfo()!=null||test.getRawQuery()!=null||test.getRawFragment()!=null||!"".equals(test.getRawPath()))throw new IllegalArgumentException();base=instrumentationBaseUrl;}
  HttpURLConnection c=(HttpURLConnection)new URL(base+"/api/v1/voice/"+route).openConnection();request.connection=c;
  c.setInstanceFollowRedirects(false);c.setConnectTimeout(20000);c.setReadTimeout(120000);c.setUseCaches(false);c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Authorization","Bearer "+token);
  if(request.cancelled)throw new IOException();return c;
 }
 // Native secure-store lookup binds playback to the selected paired identity.
 private HttpURLConnection connectPaired(PluginCall call,boolean status,Pending request)throws Exception{return connectPaired(call,status,request,false);}
 private HttpURLConnection connectPaired(PluginCall call,boolean status,Pending request,boolean asr)throws Exception{
  String origin=required(call.getString("origin"),2048);java.net.URI uri=new java.net.URI(origin);
  boolean local=BuildConfig.DEBUG&&"http".equals(uri.getScheme())&&Set.of("127.0.0.1","10.0.2.2").contains(uri.getHost());
  if(uri.getHost()==null||(!"https".equals(uri.getScheme())&&!local)||uri.getRawUserInfo()!=null||uri.getRawQuery()!=null||uri.getRawFragment()!=null||!"".equals(uri.getRawPath())||uri.getPort()==0||uri.getPort()>65535)throw new IllegalArgumentException();
  AlphaConnectionPlugin store=(AlphaConnectionPlugin)getBridge().getPlugin("AlphaConnection").getInstance();
  PairedAgentCredential pairedCredential=PairedAgentCredential.resolve(call,store);
  if(pairedCredential.cloud&&asr)throw new IOException("Use on-device transcription for this Cloud connection");
  String token=pairedCredential.token;
  HttpURLConnection c=(HttpURLConnection)new URL(origin+(asr?"/api/asr/whisper":"/api/tts/local-inference")+(status?"/status":"")).openConnection();request.connection=c;
  c.setInstanceFollowRedirects(false);c.setConnectTimeout(20000);c.setReadTimeout(120000);c.setUseCaches(false);c.setRequestMethod(status?"GET":"POST");c.setDoOutput(!status);c.setRequestProperty("Authorization","Bearer "+token);
  if(pairedCredential.cloud)c.setRequestProperty("X-Eliza-Phone-Protocol","1");
  if(request.cancelled)throw new IOException();return c;
 }
 @PluginMethod public void pairedVoiceStatus(PluginCall call){submit(call,request->{
  HttpURLConnection c=connectPaired(call,true,request);successful(c);byte[] response;try(InputStream in=c.getInputStream()){response=read(in,16384,request);}
  JSONObject body=new JSONObject(new String(response,StandardCharsets.UTF_8));JSObject value=new JSObject();value.put("ready",Boolean.TRUE.equals(body.opt("ready"))&&"local-inference".equals(body.optString("provider")));if(request.cancelled||destroyed)throw new IOException();request.result=value;
 });}
 @PluginMethod public void pairedTranscriptionStatus(PluginCall call){submit(call,request->{
  HttpURLConnection c=connectPaired(call,true,request,true);successful(c);byte[] response;try(InputStream in=c.getInputStream()){response=read(in,16384,request);}JSONObject data=new JSONObject(new String(response,StandardCharsets.UTF_8));boolean valid=Boolean.TRUE.equals(data.opt("ready"))&&"standalone-whisper.cpp".equals(data.optString("provider"))&&"pcm16-wav".equals(data.optString("format"))&&data.optInt("sampleRate")==16000&&"en".equals(data.optString("language"));JSObject value=new JSObject();value.put("ready",valid);value.put("provider","standalone-whisper.cpp");if(request.cancelled||destroyed)throw new IOException();request.result=value;
 });}
 @PluginMethod public void transcribePairedRecording(PluginCall call){submit(call,request->{
  String recordingId=required(call.getString("recordingId"),256);File file=capture.selected(recordingId);if(file==null)throw new IOException();
  // Establish exact saved credential binding before decoding; no user paths or URLs are accepted.
  HttpURLConnection c=connectPaired(call,false,request,true);byte[] audio=AlphaVoicePcm.decode(file,()->request.cancelled||destroyed);
  try{c.setRequestProperty("Content-Type","audio/wav");c.setRequestProperty("X-Request-Id",required(call.getString("requestId"),256));c.setFixedLengthStreamingMode(audio.length);try(OutputStream out=c.getOutputStream()){if(request.cancelled)throw new IOException();out.write(audio);}}finally{Arrays.fill(audio,(byte)0);}
  successful(c);byte[] response;try(InputStream in=c.getInputStream()){response=read(in,128*1024,request);}JSONObject data=new JSONObject(new String(response,StandardCharsets.UTF_8));Object text=data.opt("text");if(!(text instanceof String)||((String)text).isBlank()||((String)text).length()>16000||!"standalone-whisper.cpp".equals(data.optString("provider"))||!Boolean.TRUE.equals(data.opt("local"))||!Objects.equals(call.getString("requestId"),data.optString("requestId")))throw new IOException();if(request.cancelled||destroyed)throw new IOException();JSObject value=new JSObject();value.put("text",text);value.put("local",true);value.put("provider","standalone-whisper.cpp");request.result=value;
 });}
 @PluginMethod public void synthesizePaired(PluginCall call){synthesizeAudio(call,true);}
 @PluginMethod public void synthesizeBrowserReading(PluginCall call){main.post(()->{try{AlphaBrowserPlugin browser=(AlphaBrowserPlugin)getBridge().getPlugin("AlphaBrowser").getInstance();if("device".equals(call.getString("execution")))throw new IllegalArgumentException();String reviewed=browser.consumeReading(call);synthesizeAudio(call,true,reviewed);}catch(Exception error){call.reject("Reading approval expired");}});}
 @PluginMethod public void synthesizeLocalBrowserReading(PluginCall call){main.post(()->{try{if(!"device".equals(call.getString("execution")))throw new IllegalArgumentException();AlphaBrowserPlugin browser=(AlphaBrowserPlugin)getBridge().getPlugin("AlphaBrowser").getInstance();String reviewed=browser.consumeReading(call);synthesizeLocalNow(call,reviewed);}catch(Exception error){call.reject("Reading approval expired");}});}
 void cancelBrowserSpeech(String id){Pending request=pending.get(id);if(request!=null)request.cancel();if(Objects.equals(playbackRequestId,id)){clearPlayback();notifyListeners("playbackFailed",new JSObject());}}
 private static byte[] read(InputStream in,int limit,Pending request)throws Exception{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(request.cancelled||out.size()+n>limit)throw new IOException();out.write(b,0,n);}return out.toByteArray();}
 private interface Work {void run(Pending request)throws Exception;}
 private void submit(PluginCall call,Work work){
  final String id;try{id=required(call.getString("requestId"),256);}catch(Exception error){call.reject("Invalid request");return;}
  Pending request=new Pending();synchronized(pending){if(destroyed||draining||!pending.isEmpty()){if(!destroyed&&!draining&&Boolean.FALSE.equals(call.getBoolean("replace",true)))call.reject("Speaker is in use","playback-busy");else call.reject("Voice request already active or unavailable");return;}pending.put(id,request);}
  Runnable deadline=request::cancel;main.postDelayed(deadline,120000);
  try{workers.execute(()->{
   try{if(request.cancelled)throw new IOException();work.run(request);}catch(Exception error){request.failure=request.cancelled?"Voice request cancelled":"Voice request failed";}
   finally{try{if(request.connection!=null)request.connection.disconnect();}catch(RuntimeException error){request.failure="Voice request cleanup failed";}finally{pending.remove(id,request);main.removeCallbacks(deadline);}}
   // A continuation may submit immediately when this resolves: release admission first.
   if(request.cancelled||destroyed)call.reject("Voice request cancelled");else if(request.failure!=null){if(request.failureCode!=null)call.reject(request.failure,request.failureCode);else call.reject(request.failure);}else if(request.result==null)call.reject("Voice request failed");else call.resolve(request.result);
  });}catch(RejectedExecutionException error){main.removeCallbacks(deadline);pending.remove(id,request);call.reject("Voice unavailable");}
 }
 private static void successful(HttpURLConnection c)throws Exception{int status=c.getResponseCode();if(status<200||status>=300)throw new IOException();}
 @PluginMethod public void transcribeRecording(PluginCall call){submit(call,request->{
  String recordingId=required(call.getString("recordingId"),256);File file=capture.selected(recordingId);if(file==null)throw new IOException();
  // Copy the chosen bounded draft before upload; cancellation cannot substitute another recording.
  byte[] audio;try(InputStream in=new FileInputStream(file)){audio=read(in,4*1024*1024,request);}if(audio.length==0)throw new IOException();
  String boundary="AlphaVoice"+UUID.randomUUID().toString().replace("-","");
  byte[] prefix=("--"+boundary+"\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"recording.m4a\"\r\nContent-Type: audio/mp4\r\n\r\n").getBytes(StandardCharsets.US_ASCII);
  byte[] suffix=("\r\n--"+boundary+"--\r\n").getBytes(StandardCharsets.US_ASCII);
  HttpURLConnection c=connect(call,"stt",request);c.setRequestProperty("Content-Type","multipart/form-data; boundary="+boundary);c.setFixedLengthStreamingMode(prefix.length+audio.length+suffix.length);
  try(OutputStream out=c.getOutputStream()){if(request.cancelled)throw new IOException();out.write(prefix);out.write(audio);out.write(suffix);}finally{Arrays.fill(audio,(byte)0);}
  successful(c);byte[] response;try(InputStream in=c.getInputStream()){response=read(in,256*1024,request);}JSONObject data=new JSONObject(new String(response,StandardCharsets.UTF_8));Object transcript=data.get("transcript");if(!(transcript instanceof String))throw new IOException();
  if(request.cancelled||destroyed)throw new IOException();JSObject result=new JSObject();result.put("text",transcript);result.put("local",false);request.result=result;
 });}
 private void submitLocal(PluginCall call,Work work){submit(call,request->{main.removeCallbacks(localIdleRelease);try{work.run(request);}catch(Exception error){localEngine.release();throw error;}catch(LinkageError|OutOfMemoryError error){localEngine.release();throw new IOException("On-device speech unavailable",error);}finally{if(request.cancelled||destroyed)localEngine.release();else scheduleLocalRelease(speechForeground?120000:30000);}});}
 // Local CPU execution has no dependency on an account, URL, or host process.
 @PluginMethod public void localSpeechStatus(PluginCall call){submitLocal(call,request->{
  localEngine.use(engine->{if(request.cancelled||destroyed)throw new IOException();return null;});
  if(request.cancelled||destroyed)throw new IOException();JSObject out=new JSObject();out.put("ready",true);out.put("execution","device");out.put("provider","sherpa-onnx-cpu");request.result=out;
 });}
 @PluginMethod public void transcribeLocalRecording(PluginCall call){submitLocal(call,request->{
  File file=capture.selected(required(call.getString("recordingId"),256));if(file==null)throw new IOException();byte[] wav=AlphaVoicePcm.decode(file,()->request.cancelled||destroyed);float[] samples;
  try{samples=ai.eliza.speech.LocalSpeechEngine.readMono16kWav(new ByteArrayInputStream(wav));}finally{Arrays.fill(wav,(byte)0);}
  String text;try{text=localEngine.use(engine->{if(request.cancelled||destroyed)throw new IOException();return engine.transcribe(samples);});}finally{Arrays.fill(samples,0);}
  if(request.cancelled||destroyed)throw new IOException();JSObject out=new JSObject();out.put("text",text);out.put("local",true);out.put("execution","device");out.put("provider","sherpa-onnx-cpu");request.result=out;
 });}
 @PluginMethod public void synthesizeLocal(PluginCall call){main.post(()->{if(Boolean.FALSE.equals(call.getBoolean("replace",true))&&(playbackFile!=null||!pending.isEmpty())){call.reject("Speaker is in use","playback-busy");return;}synthesizeLocalNow(call);});}
 private void synthesizeLocalNow(PluginCall call){synthesizeLocalNow(call,null);}
 private void synthesizeLocalNow(PluginCall call,String reviewed){submitLocal(call,request->{
  String text=reviewed==null?required(call.getString("text"),500):reviewed;byte[] audio;
  audio=localEngine.use(engine->{if(request.cancelled||destroyed)throw new IOException();if(reviewed!=null)return engine.synthesizePassage(text,()->request.cancelled||destroyed);ai.eliza.speech.LocalSpeechEngine.Audio generated=engine.synthesize(text,()->request.cancelled||destroyed);try{return generated.wav();}finally{Arrays.fill(generated.samples,0);}});
  if(request.cancelled||destroyed){Arrays.fill(audio,(byte)0);throw new IOException();}
  File file=File.createTempFile("alpha-cloud-tts-",".wav",getContext().getCacheDir());CountDownLatch completed=new CountDownLatch(1);
  try{try(OutputStream out=new FileOutputStream(file)){out.write(audio);}main.post(()->{try{if(request.cancelled||destroyed){file.delete();request.failure="Voice request cancelled";return;}if(Boolean.FALSE.equals(call.getBoolean("replace",true))&&playbackFile!=null){file.delete();request.failure="Speaker is in use";request.failureCode="playback-busy";return;}clearPlayback();playbackFile=file;playbackRequestId=call.getString("requestId");playbackId=UUID.randomUUID().toString();JSObject out=new JSObject();out.put("playbackId",playbackId);out.put("execution","device");request.result=out;}catch(RuntimeException error){request.failure="Playback preparation failed";file.delete();}finally{completed.countDown();}});if(!completed.await(10,TimeUnit.SECONDS)){request.cancel();file.delete();throw new IOException("Playback preparation timed out");}}catch(Exception error){file.delete();throw error;}finally{Arrays.fill(audio,(byte)0);}
 });}
 @PluginMethod public void synthesize(PluginCall call){synthesizeAudio(call,false);}
 private void synthesizeAudio(PluginCall call,boolean paired){synthesizeAudio(call,paired,null);}
 private void synthesizeAudio(PluginCall call,boolean paired,String reviewed){submit(call,request->{
  String text=required(reviewed==null?call.getString("text"):reviewed,5000);HttpURLConnection c=paired?connectPaired(call,false,request):connect(call,"tts",request);byte[] body=new JSONObject().put("text",text).put("format",paired?"wav":"mp3").toString().getBytes(StandardCharsets.UTF_8);c.setRequestProperty("Content-Type","application/json");c.setFixedLengthStreamingMode(body.length);try(OutputStream out=c.getOutputStream()){if(request.cancelled)throw new IOException();out.write(body);}successful(c);
  String mime=c.getContentType();if(mime==null||!Set.of("audio/mpeg","audio/mp3","audio/wav").contains(mime.split(";")[0].trim().toLowerCase(Locale.ROOT)))throw new IOException();byte[] audio;try(InputStream in=c.getInputStream()){audio=read(in,AUDIO_LIMIT,request);}if(audio.length==0)throw new IOException();
  CountDownLatch completed=new CountDownLatch(1);
  File file=File.createTempFile("alpha-cloud-tts-",".audio",getContext().getCacheDir());try{try(FileOutputStream out=new FileOutputStream(file)){out.write(audio);}if(request.cancelled||destroyed)throw new IOException();main.post(()->{try{if(request.cancelled||destroyed){file.delete();request.failure="Voice request cancelled";return;}clearPlayback();playbackFile=file;playbackRequestId=call.getString("requestId");playbackId=UUID.randomUUID().toString();JSObject value=new JSObject();value.put("playbackId",playbackId);request.result=value;}catch(RuntimeException error){request.failure="Playback preparation failed";file.delete();}finally{completed.countDown();}});completed.await();}catch(Exception error){file.delete();throw error;}finally{Arrays.fill(audio,(byte)0);}
 });}
 @PluginMethod public void play(PluginCall call){main.post(()->{try{if(playbackFile==null||!Objects.equals(playbackId,call.getString("playbackId"))){call.reject("Playback unavailable");return;}if(player!=null){player.release();player=null;}if(preparingPlayback!=null)preparingPlayback.reject("Playback replaced");preparingPlayback=call;MediaPlayer next=new MediaPlayer();player=next;next.setDataSource(playbackFile.getAbsolutePath());final String activePlaybackId=playbackId;next.setOnCompletionListener(p->{if(player==p){clearPlayback(false);JSObject event=new JSObject();event.put("playbackId",activePlaybackId);notifyListeners("playbackEnded",event);}});next.setOnErrorListener((p,w,e)->{if(player==p){clearPlayback(false);JSObject event=new JSObject();event.put("playbackId",activePlaybackId);notifyListeners("playbackFailed",event);}return true;});next.setOnPreparedListener(p->{if(player==p&&!destroyed){try{p.start();preparingPlayback=null;call.resolve();}catch(RuntimeException error){clearPlayback();}}else call.reject("Playback cancelled");});next.prepareAsync();}catch(Exception error){clearPlayback();call.reject("Playback unavailable");}});}
 private void clearPlayback(){clearPlayback(true);}
 private void clearPlayback(boolean stopped){String previous=playbackId;if(preparingPlayback!=null){preparingPlayback.reject("Playback cancelled");preparingPlayback=null;}if(player!=null){player.release();player=null;}if(playbackFile!=null)playbackFile.delete();playbackFile=null;playbackId=null;playbackRequestId=null;if(stopped&&previous!=null){JSObject event=new JSObject();event.put("playbackId",previous);notifyListeners("playbackStopped",event);}}
 @PluginMethod public void stopPlayback(PluginCall call){String requestId=call.getString("requestId");main.post(()->{if(requestId==null||Objects.equals(playbackRequestId,requestId))clearPlayback();call.resolve();});}
 @PluginMethod public void cancel(PluginCall call){Pending request=pending.get(call.getString("requestId",""));if(request!=null)request.cancel();call.resolve();}
 @Override protected void handleOnResume(){speechForeground=true;scheduleLocalRelease(120000);super.handleOnResume();}
 @Override protected void handleOnPause(){speechForeground=false;scheduleLocalRelease(30000);if(permissionEpochs.isEmpty())epoch.incrementAndGet();if(capture!=null)capture.stopAutomatically();for(Pending request:pending.values())request.cancel();main.post(this::clearPlayback);super.handleOnPause();}
 @Override protected void handleOnDestroy(){destroyed=true;finishDrain(false,"Voice unavailable");epoch.incrementAndGet();permissionEpochs.clear();for(Pending request:pending.values())request.cancel();if(capture!=null)capture.cancel();main.post(this::clearPlayback);main.removeCallbacks(localIdleRelease);getContext().unregisterComponentCallbacks(localMemoryCallbacks);try{workers.execute(localEngine::close);}catch(RejectedExecutionException ignored){}workers.shutdown();super.handleOnDestroy();}
}

/** One foreground-only private audio draft. Capture and upload are separate user actions. */
final class AlphaCloudVoiceCapture {
 private final android.content.Context context;
 private final java.util.function.Consumer<JSObject> events;
 private final Handler handler = new Handler(Looper.getMainLooper());
 private android.media.MediaRecorder recorder;
 private File file;
 private String id;
 private long startedAt;
 private long durationMs;
 private Runnable deadline;
 AlphaCloudVoiceCapture(android.content.Context context, java.util.function.Consumer<JSObject> events) {
  this.context = context; this.events = events;
  File[] stale = context.getCacheDir().listFiles((dir,name) -> name.startsWith("alpha-cloud-voice-") && name.endsWith(".m4a"));
  if (stale != null) for (File candidate : stale) candidate.delete();
 }
 synchronized JSObject start() throws IOException { return start(59000); }
 synchronized JSObject start(int maxDurationMs) throws IOException {
  if(maxDurationMs!=29000&&maxDurationMs!=59000)throw new IllegalArgumentException("Unsupported capture duration");
  if (file != null) throw new IllegalStateException("Finish or discard the current recording first");
  id = UUID.randomUUID().toString(); file = new File(context.getCacheDir(), "alpha-cloud-voice-" + id + ".m4a");
  recorder = new android.media.MediaRecorder();
  try {
   recorder.setAudioSource(android.media.MediaRecorder.AudioSource.MIC);
   recorder.setOutputFormat(android.media.MediaRecorder.OutputFormat.MPEG_4);
   recorder.setAudioEncoder(android.media.MediaRecorder.AudioEncoder.AAC);
   recorder.setAudioChannels(1); recorder.setAudioSamplingRate(16000); recorder.setAudioEncodingBitRate(64000);
   recorder.setOutputFile(file.getAbsolutePath()); recorder.setMaxDuration(maxDurationMs); recorder.setMaxFileSize(4 * 1024 * 1024);
   recorder.setOnInfoListener((source, what, extra) -> {
    if (what == android.media.MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED || what == android.media.MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED) stopAutomatically();
   });
   recorder.setOnErrorListener((source, what, extra) -> { synchronized(this) { cancel(); } JSObject result=new JSObject();result.put("status","failed");result.put("message","Recording stopped because Android reported a microphone error");events.accept(result); });
   recorder.prepare(); recorder.start(); startedAt = android.os.SystemClock.elapsedRealtime();
   deadline = this::stopAutomatically; handler.postDelayed(deadline,maxDurationMs);
   JSObject result = new JSObject(); result.put("status","recording"); result.put("recordingId",id); result.put("maxDurationMs",maxDurationMs); return result;
  } catch (IOException | RuntimeException error) { cancel(); throw error; }
 }
 synchronized JSObject stop() {
  if (recorder == null) throw new IllegalStateException("No recording is active");
  handler.removeCallbacks(deadline); durationMs = android.os.SystemClock.elapsedRealtime() - startedAt;
  try { recorder.stop(); }
  catch (RuntimeException error) { cancel(); throw new IllegalStateException("Recording was too short or unavailable"); }
  recorder.release(); recorder = null;
  if (!file.isFile() || file.length() == 0 || file.length() > 4 * 1024 * 1024) { cancel(); throw new IllegalStateException("Recording is unavailable or exceeds the size limit"); }
  JSObject result = new JSObject(); result.put("status","recorded"); result.put("recordingId",id); result.put("durationMs",durationMs); return result;
 }
 synchronized void stopAutomatically() {
  if (recorder == null) return;
  try { events.accept(stop()); }
  catch (RuntimeException error) { JSObject result=new JSObject();result.put("status","failed");result.put("message","Recording could not be saved");events.accept(result); }
 }
 synchronized JSObject retain(AlphaNoteAudioPlugin store,String recordingId,String noteId,String transcript)throws Exception {File chosen=selected(recordingId);if(chosen==null)throw new IllegalStateException();return store.retain(chosen,recordingId,noteId,durationMs,transcript);}
 synchronized File selected(String recordingId) {
  if (recorder != null || file == null || !id.equals(recordingId)) return null;
  return file;
 }
 synchronized void discard(String recordingId) { if (id != null && id.equals(recordingId)) cancel(); }
 synchronized void cancel() {
  if (deadline != null) handler.removeCallbacks(deadline);
  if (recorder != null) { try { recorder.stop(); } catch (RuntimeException ignored) {} recorder.release(); recorder=null; }
  if (file != null) file.delete(); file=null; id=null; durationMs=0;
 }
}
