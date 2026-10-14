package ai.elizaresearch.alphaphone;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
/** Real renderer/native capture lifecycle; only identity/history use a closed synthetic transport. */
final class LocalConversationFixture {
 private static void until(String expression,long timeout)throws Exception{long end=SystemClock.elapsedRealtime()+timeout;while(SystemClock.elapsedRealtime()<end){if("true".equals(eval("Boolean("+expression+")")))return;SystemClock.sleep(100);}fail("Voice permission UI condition timed out: "+expression);}
 private static String button(String label){return "[...document.querySelectorAll('button')].find(e=>(e.getAttribute('aria-label')==="+JSONObject.quote(label)+"||e.textContent.trim()==="+JSONObject.quote(label)+")&&e.getClientRects().length&&!e.disabled)";}
 private static void click(String label)throws Exception{until(button(label),20000);eval(button(label)+".click()");}
 /** The live production activity, without an injected Cloud or agent transport. */
 private static MainActivity activity()throws Exception{
  java.util.concurrent.atomic.AtomicReference<MainActivity> out=new java.util.concurrent.atomic.AtomicReference<>();
  BoundedActivityScenario.main(()->{for(androidx.test.runner.lifecycle.Stage stage:new androidx.test.runner.lifecycle.Stage[]{androidx.test.runner.lifecycle.Stage.RESUMED,androidx.test.runner.lifecycle.Stage.STARTED,androidx.test.runner.lifecycle.Stage.PAUSED,androidx.test.runner.lifecycle.Stage.STOPPED})for(android.app.Activity a:androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(stage))if(out.get()==null&&a instanceof MainActivity&&!a.isFinishing())out.set((MainActivity)a);});
  return out.get();
 }
 private static String eval(String script)throws Exception{
  MainActivity a=null;long end=SystemClock.elapsedRealtime()+20000;while((a=activity())==null&&SystemClock.elapsedRealtime()<end)SystemClock.sleep(50);
  assertNotNull("Live activity for WebView evaluation",a);MainActivity target=a;
  java.util.concurrent.CountDownLatch done=new java.util.concurrent.CountDownLatch(1);java.util.concurrent.atomic.AtomicReference<String> out=new java.util.concurrent.atomic.AtomicReference<>();
  BoundedActivityScenario.main(()->target.getBridge().getWebView().evaluateJavascript(script,value->{out.set(value);done.countDown();}));
  assertTrue("WebView responds",done.await(10,java.util.concurrent.TimeUnit.SECONDS));return out.get();
 }
 private static boolean appFocused()throws Exception{MainActivity a=activity();AtomicBoolean focused=new AtomicBoolean();if(a!=null)BoundedActivityScenario.main(()->focused.set(a.hasWindowFocus()));return focused.get();}
 void run(boolean utterance)throws Exception {
  org.junit.Assume.assumeTrue("Owned disposable user required","1".equals(InstrumentationRegistry.getArguments().getString("localConversation")));
  assertFalse("Production renderer required",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  assertEquals(PackageManager.PERMISSION_GRANTED,context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO));
  InboxFixtureScope.phase="prepare";InboxFixtureScope.runId=java.util.UUID.randomUUID().toString();ConversationFixtureAgent.routes.clear();ConversationFixtureAgent.sends=0;ConversationFixtureAgent.allowReply=utterance;ConversationFixtureAgent.transcript=null;
  androidx.test.runner.MonitoringInstrumentation runner=(androidx.test.runner.MonitoringInstrumentation)InstrumentationRegistry.getInstrumentation();
  runner.interceptActivityUsing(new androidx.test.runner.intercepting.InterceptingActivityFactory(){
   @Override public boolean shouldIntercept(ClassLoader loader,String name,android.content.Intent intent){return name.equals(MainActivity.class.getName());}
   @Override public android.app.Activity create(ClassLoader loader,String name,android.content.Intent intent){return new ConversationFixtureActivity();}
  });
  try{
   BoundedActivityScenario.main(()->context.startActivity(new android.content.Intent(context,MainActivity.class).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK|android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK)));
   until("document.querySelector('.os')&&window.Capacitor?.Plugins?.AlphaVoiceCloud",60000);
   click("Sign in with Eliza Cloud");
   until("!document.querySelector('.alpha-connection-scrim')",60000);
   for(int i=0;i<150;i++){
    if("true".equals(eval("(()=>{try{return JSON.parse(localStorage.getItem('alpha.startup-permissions.v1')||'null')?.dismissed===true}catch{return false}})()")))break;
    if("true".equals(eval("(()=>{const b=[...document.querySelectorAll('dialog.alpha-startup-permissions[open] button')].find(b=>b.textContent.trim()==='Not now');if(!b)return false;b.click();return true})()")))break;
    SystemClock.sleep(100);
   }
   eval("window.__conversationNative={starts:0,cancels:0,cloud:0,transcripts:0,localSpeech:0,played:0,ended:0};window.__conversationPromise=Capacitor.nativePromise;Capacitor.nativePromise=function(plugin,method,input){const s=window.__conversationNative;if(plugin==='AlphaVoiceCloud'&&['synthesize','transcribeRecording'].includes(method))s.cloud++;return window.__conversationPromise.apply(this,arguments).then(value=>{if(plugin==='AlphaVoiceCloud'){if(method==='startRecording'){s.starts++;s.maxDurationMs=value.maxDurationMs;}if(method==='cancelRecording')s.cancels++;if(method==='transcribeLocalRecording'&&value.execution==='device'){s.transcripts++;s.text=value.text;}if(method==='synthesizeLocal'&&value.execution==='device')s.localSpeech++;if(method==='play')s.played++;}return value;});}");
   eval("Capacitor.Plugins.AlphaVoiceCloud.addListener('playbackEnded',()=>window.__conversationNative.ended++).then(h=>window.__conversationEndListener=h)");until("window.__conversationEndListener",10000);
   click("Talk");until("window.__conversationNative.starts===1",180000);
   assertEquals("Local recording cap","29000",eval("window.__conversationNative.maxDurationMs"));
   until("document.querySelector('[data-alpha-chat-recorder]')?.textContent.includes('transcribed on this device')",20000);
   if(utterance){
    android.util.Log.i("AlphaVoiceFixture","CAPTURE_READY "+InboxFixtureScope.runId);
    until("window.__conversationNative.transcripts>=1&&window.__conversationNative.ended>=1&&window.__conversationNative.starts>=2",180000);
    assertEquals("One automatic send",1,ConversationFixtureAgent.sends);
    assertNotNull("Transcript reached synthetic agent",ConversationFixtureAgent.transcript);
    assertTrue("Known fixture was transcribed",ConversationFixtureAgent.transcript.toLowerCase(java.util.Locale.ROOT).contains("nightfall"));
    assertEquals("Local synthesis and native playback","true",eval("window.__conversationNative.localSpeech===1&&window.__conversationNative.played===1"));
   }
   click("Stop voice conversation");
   until("window.__conversationNative.cancels>=1&&!document.querySelector('[data-alpha-chat-recorder]')",20000);
   assertEquals("No Cloud speech calls","0",eval("window.__conversationNative.cloud"));
   if(!utterance)assertEquals("Stop before speech sends no text",0,ConversationFixtureAgent.sends);
   java.io.File[] captures=context.getCacheDir().listFiles((dir,name)->name.startsWith("alpha-cloud-voice-")&&name.endsWith(".m4a"));
   assertEquals("Cancelled capture is removed",0,captures==null?0:captures.length);
  }finally{
   MainActivity live=activity();if(live!=null)BoundedActivityScenario.main(live::finish);
   ConversationFixtureAgent.allowReply=false;runner.useDefaultInterceptingActivityFactory();
  }
 }
}
