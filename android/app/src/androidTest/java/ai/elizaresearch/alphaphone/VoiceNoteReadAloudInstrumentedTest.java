package ai.elizaresearch.alphaphone;

import android.content.Context;
import android.net.ConnectivityManager;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/**
 * daily-11: the note read-aloud route on Android. Through the real Capacitor bridge, the
 * renderer's local speech calls synthesize note text with the on-device engine
 * (synthesizeLocal, execution "device"), play it with MediaPlayer, finish with playbackEnded,
 * and a stop request ends a longer passage with playbackStopped. Opt-in with -e localSpeech 1
 * and networking disabled, like LocalSpeechInstrumentedTest. This is emulator or device evidence
 * for the playback route only, not speaker intelligibility to a listener.
 */
@RunWith(AndroidJUnit4.class)
public final class VoiceNoteReadAloudInstrumentedTest {
 private static void until(String expression,long timeout)throws Exception{long end=SystemClock.elapsedRealtime()+timeout;while(SystemClock.elapsedRealtime()<end){if("true".equals(WebViewTestDriver.evaluate("Boolean("+expression+")")))return;SystemClock.sleep(100);}fail("Read-aloud condition timed out: "+expression);}
 /** Starts one local passage through the bridge; results land on window.__readAloud. */
 private static String speak(String text,boolean stopAfterStart){
  return "(()=>{const v=Capacitor.Plugins.AlphaVoiceCloud,r=window.__readAloud={events:[],state:'preparing'},requestId=crypto.randomUUID();"
   + "for(const e of ['playbackEnded','playbackFailed','playbackStopped'])v.addListener(e,x=>{r.events.push(e);if(x.playbackId===r.playbackId)r.state=e;});"
   + "v.synthesizeLocal({text:"+JSONObject.quote(text)+",requestId}).then(p=>{r.playbackId=p.playbackId;r.execution=p.execution;return v.play({playbackId:p.playbackId});})"
   + ".then(()=>{r.started=true;"+(stopAfterStart?"return v.stopPlayback({requestId});":"")+"}).catch(e=>{r.state='error';r.error=String(e&&e.message||e);});})()";
 }
 @Test public void noteTextPlaysLocallyAndStops()throws Exception {
  org.junit.Assume.assumeTrue("Opt-in real local models required","1".equals(InstrumentationRegistry.getArguments().getString("localSpeech")));
  Context app=InstrumentationRegistry.getInstrumentation().getTargetContext();
  assertNull("Disable device networking before on-device acceptance",app.getSystemService(ConnectivityManager.class).getActiveNetwork());
  JSONObject evidence=new JSONObject().put("pass",false);File folder=new File(app.getExternalFilesDir(null),"local-speech-evidence");assertTrue(folder.isDirectory()||folder.mkdirs());
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   until("window.Capacitor?.Plugins?.AlphaVoiceCloud&&document.querySelector('.os')",60000);
   long start=SystemClock.elapsedRealtime();
   WebViewTestDriver.evaluate(speak("Groceries. Milk and eggs.",false));
   until("window.__readAloud.state!=='preparing'",180000);
   evidence.put("shortPassageMs",SystemClock.elapsedRealtime()-start).put("shortExecution",WebViewTestDriver.evaluate("window.__readAloud.execution"));
   assertEquals("A short note plays to completion","\"playbackEnded\"",WebViewTestDriver.evaluate("window.__readAloud.state"));
   assertEquals("Read aloud runs on the device engine","\"device\"",WebViewTestDriver.evaluate("window.__readAloud.execution"));
   WebViewTestDriver.evaluate(speak("This is a longer note that keeps playing until it is stopped. It has several sentences so it lasts long enough to stop. The last sentence is never reached.",true));
   until("window.__readAloud.state!=='preparing'",180000);
   assertEquals("Stop ends the reading","\"playbackStopped\"",WebViewTestDriver.evaluate("window.__readAloud.state"));
   assertEquals("Playback had started before the stop","true",WebViewTestDriver.evaluate("window.__readAloud.started===true"));
   assertNull(app.getSystemService(ConnectivityManager.class).getActiveNetwork());
   evidence.put("pass",true).put("execution","android-process-cpu").put("physicalSpeakerVerified",false);
  } finally { try(Writer out=new FileWriter(new File(folder,"note-read-aloud.json"))){out.write(evidence.toString(2));} }
 }
 private static void clickUi(String label)throws Exception{
  String button="[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==="+JSONObject.quote(label)+"&&b.getClientRects().length&&!b.disabled&&!b.closest('[inert]'))";
  until(button,20000);WebViewTestDriver.evaluate(button+".click()");
 }
 private static void fillUi(String label,String value)throws Exception{
  String selector="document.querySelector('[aria-label=\""+label+"\"]')";until(selector,20000);
  WebViewTestDriver.evaluate("(()=>{const e="+selector+";Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()");
 }
 /** Actual production Notes controls and renderer cleanup, with the native port only observed. */
 @Test public void offlineNotesReadAloudUsesNativeRendererAndConfirmsStop()throws Exception{
  org.junit.Assume.assumeTrue("Opt-in real local models required","1".equals(InstrumentationRegistry.getArguments().getString("localSpeech")));
  org.junit.Assume.assumeFalse("Production policy required",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  Context app=InstrumentationRegistry.getInstrumentation().getTargetContext();
  assertNull("Disable networking for the complete UI flow",app.getSystemService(ConnectivityManager.class).getActiveNetwork());
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();WebViewTestDriver.evaluate(AppNavigation.request("Notes"));until(AppNavigation.selected("Notes"),20000);until("window.__alphaTestNavigation?.status==='complete'",20000);AppNavigation.declineStartupAccess();
   clickUi("New note");fillUi("Title","Offline note");fillUi("Note","Milk and eggs.");
   String record="__notesEnvelope.records.find(n=>n.title==='Offline note')";
   long end=SystemClock.elapsedRealtime()+20000;String id="null";
   while(SystemClock.elapsedRealtime()<end){id=NotesSecureFixture.evaluate("("+record+")?.id??null");if(!"null".equals(id))break;SystemClock.sleep(100);}assertNotEquals("Synthetic note persisted","null",id);
   final String noteId=id;
   try{
    WebViewTestDriver.evaluate("window.__uiSpeech={local:0,cloud:0,started:0,ended:0,cancelled:0,stopped:0};window.__uiSpeechOriginal=Capacitor.nativePromise;Capacitor.nativePromise=function(plugin,method,input){const result=window.__uiSpeechOriginal.apply(this,arguments);if(plugin!=='AlphaVoiceCloud')return result;if(['synthesize','transcribeRecording'].includes(method))window.__uiSpeech.cloud++;return result.then(value=>{const s=window.__uiSpeech;if(method==='synthesizeLocal'&&value.execution==='device')s.local++;if(method==='play')s.started++;if(method==='cancel')s.cancelled++;if(method==='stopPlayback')s.stopped++;return value;});};Capacitor.Plugins.AlphaVoiceCloud.addListener('playbackEnded',()=>window.__uiSpeech.ended++).then(h=>window.__uiSpeechListener=h)");
    until("window.__uiSpeechListener",10000);
    clickUi("Read aloud");until("window.__uiSpeech.ended===1&&window.__uiSpeech.cancelled>=1&&window.__uiSpeech.stopped>=1",180000);
    assertEquals("Exactly one local synthesis and playback","true",WebViewTestDriver.evaluate("__uiSpeech.local===1&&__uiSpeech.started===1&&__uiSpeech.cloud===0"));
    until("document.querySelector('button[aria-label=\"Read aloud\"]')",20000);
    fillUi("Note","This is a longer note. The local voice reads the words on this phone. Stop reading ends the sound and keeps the note. The final sentence is not needed.");
    WebViewTestDriver.evaluate("window.__uiSpeech={local:0,cloud:0,started:0,ended:0,cancelled:0,stopped:0}");
    clickUi("Read aloud");until("window.__uiSpeech.started===1",180000);clickUi("Stop reading");
    until("window.__uiSpeech.cancelled>=1&&window.__uiSpeech.stopped>=1",20000);
    assertEquals("No Cloud speech method was invoked","0",WebViewTestDriver.evaluate("__uiSpeech.cloud"));
    assertNull("Networking stayed disabled",app.getSystemService(ConnectivityManager.class).getActiveNetwork());
   }finally{
    WebViewTestDriver.evaluate("if(window.__uiSpeechOriginal)Capacitor.nativePromise=window.__uiSpeechOriginal;window.__uiSpeechListener?.remove()");
    NotesSecureFixture.replaceRecords("records=>records.filter(n=>n.id!=="+noteId+")");
   }
  }
 }

}
