package ai.elizaresearch.alphaphone;
import android.os.SystemClock;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.*;
import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;
/** Notes durability: a distinct storage-full refusal above slot caps, and the encrypted Notes draft
 * surviving a forced commit failure and a fresh Activity/WebView (the renderer state is discarded;
 * the instrumentation process cannot kill its own app process). Unique synthetic content only. */
public final class NotesStorageDurabilityInstrumentedTest {
 private static String unique(){return UUID.randomUUID().toString();}
 /** A value of exactly n UTF-8 bytes that is a valid JSON string. */
 private static String jsonOfBytes(int n){StringBuilder out=new StringBuilder(n);out.append('"');for(int i=0;i<n-2;i++)out.append('x');return out.append('"').toString();}

 @Test public void storageFullIsADistinctRefusalThatWritesNothing()throws Exception{
  AlphaCredentialStore store=new AlphaCredentialStore(InstrumentationRegistry.getInstrumentation().getTargetContext());
  String slot="notes-storage-test:v1:"+unique();int cap=AlphaCredentialStore.slotLimit(slot);
  assertEquals("Unlisted slots keep the default cap",256*1024,cap);
  assertEquals("Notes draft slot has the Notes collection cap",32*1024*1024,AlphaCredentialStore.slotLimit(AlphaCredentialStore.NOTES_DRAFT));
  assertEquals(AlphaCredentialStore.slotLimit(AlphaCredentialStore.NOTES_RECORDS),AlphaCredentialStore.slotLimit(AlphaCredentialStore.NOTES_DRAFT));
  try{
   String kept="{\"kept\":true}";store.writeCredentialSlot(slot,kept);
   // Fill to the exact cap: accepted. One byte more: storage-full, and the saved value is unchanged.
   String full=jsonOfBytes(cap);store.writeCredentialSlot(slot,full);assertEquals(full,store.readCredentialSlot(slot));
   try{store.writeCredentialSlot(slot,jsonOfBytes(cap+1));fail("Oversized write accepted");}catch(AlphaCredentialStore.StorageFullException expected){}
   assertEquals(full,store.readCredentialSlot(slot));
   // Multi-byte text counts in UTF-8 bytes, not chars.
   StringBuilder wide=new StringBuilder("\"");for(int i=0;i<cap/3+10;i++)wide.append('€');wide.append('"');
   try{store.compareExchangeCredentialSlot(slot,full,wide.toString());fail("Oversized CAS accepted");}catch(AlphaCredentialStore.StorageFullException expected){}
   assertEquals(full,store.readCredentialSlot(slot));
   assertTrue("A fitting CAS still applies",store.compareExchangeCredentialSlot(slot,full,kept));assertEquals(kept,store.readCredentialSlot(slot));
  }finally{store.removeCredentialSlot(slot);}
  assertNull(store.readCredentialSlot(slot));
 }

 private String js(String code)throws Exception{return WebViewTestDriver.evaluate(code);}
 private void until(String code,String what)throws Exception{long end=SystemClock.elapsedRealtime()+30000;while(SystemClock.elapsedRealtime()<end){if("true".equals(js("Boolean("+code+")")))return;SystemClock.sleep(100);}
  throw new AssertionError(what+"; draft="+js("document.documentElement.dataset.notesDraftState||'absent'")+" storage="+js("document.documentElement.dataset.notesStorageState||'absent'"));}
 private void click(String label)throws Exception{String q="[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==="+JSONObject.quote(label)+"&&b.getClientRects().length&&!b.disabled)";until(q,"Button "+label);js("("+q+").click()");}
 private void input(String selector,String value,boolean multiline)throws Exception{until("document.querySelector("+JSONObject.quote(selector)+")","Field "+selector);js("(()=>{const e=document.querySelector("+JSONObject.quote(selector)+");Object.getOwnPropertyDescriptor("+(multiline?"HTMLTextAreaElement":"HTMLInputElement")+".prototype,'value').set.call(e,"+JSONObject.quote(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");}
 private void openNotes()throws Exception{AppNavigation.liveMode();js(AppNavigation.request("Notes"));until("window.__alphaTestNavigation?.status==='complete'","Notes navigation");until("document.documentElement.dataset.notesStorageState==='ready'","Notes ready");}
 private JSONObject slot(String name)throws Exception{JSONObject r=NotesSecureFixture.call("Capacitor.Plugins.AlphaConnection.secureRead({slot:"+JSONObject.quote(name)+"})");return r;}
 private boolean cas(String name,String expected,String value)throws Exception{
  JSONObject args=new JSONObject().put("slot",name).put("expectedValue",expected==null?JSONObject.NULL:expected).put("value",value==null?JSONObject.NULL:value);
  return "saved".equals(NotesSecureFixture.call("Capacitor.Plugins.AlphaConnection.secureCompareExchange("+args+")").getString("status"));
 }

 @Test public void rendererBridgeReportsStorageFullCode()throws Exception{
  org.junit.Assume.assumeTrue("Explicit disposable Notes qualification","1".equals(InstrumentationRegistry.getArguments().getString("notesStorage")));
  String slot="notes-storage-test:v1:"+unique();
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();
   js("window.__fullCode=null;Capacitor.Plugins.AlphaConnection.secureWrite({slot:"+JSONObject.quote(slot)+",value:JSON.stringify('x'.repeat(300*1024))}).then(()=>window.__fullCode='accepted',e=>window.__fullCode=String(e&&e.code))");
   until("window.__fullCode!==null","storage-full bridge result");
   assertEquals(JSONObject.quote("storage-full"),js("window.__fullCode"));
   assertTrue(slot(slot).isNull("value"));
  }
 }

 @Test public void fullCollectionShowsNotesStorageIsFullAndKeepsSavedNotes()throws Exception{
  org.junit.Assume.assumeTrue("Explicit disposable Notes qualification","1".equals(InstrumentationRegistry.getArguments().getString("notesStorage")));
  AlphaCredentialStore store=new AlphaCredentialStore(InstrumentationRegistry.getInstrumentation().getTargetContext());
  String marker="capacity_"+unique(),before=null,seeded=null;Throwable primary=null;String phase="initialize";
  try{
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){openNotes();}
   before=store.readCredentialSlot(AlphaCredentialStore.NOTES_RECORDS);
   assertNotNull("Notes initialized",before);
   assertNull("Do not replace an unrelated encrypted draft",store.readCredentialSlot(AlphaCredentialStore.NOTES_DRAFT));
   int cap=AlphaCredentialStore.slotLimit(AlphaCredentialStore.NOTES_RECORDS);assertEquals(32*1024*1024,cap);
   phase="construct bounded capacity fixture";
   String proposed=NotesCapacityFixture.collection(before,marker,cap);
   phase="native seed CAS";
   assertTrue("Seed only the exact disposable collection",store.compareExchangeCredentialSlot(AlphaCredentialStore.NOTES_RECORDS,before,proposed));
   seeded=proposed;phase="native readback with fixture retained";assertEquals("Exact native fixture readback",seeded,store.readCredentialSlot(AlphaCredentialStore.NOTES_RECORDS));
   phase="open seeded collection in fresh renderer";
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    openNotes();click("Open Capacity target "+marker);until("document.querySelector('textarea[aria-label=Note]')","Small editor");
    // A normal-sized edit crosses the genuine collection cap. The old 33 MiB textarea
    // forced enormous WebView text layout before storage admission could be exercised.
    phase="small edit and storage-full recovery";
    input("textarea[aria-label=Note]","E".repeat(NotesCapacityFixture.EDIT_BYTES),true);
    until("document.documentElement.dataset.notesStorageState==='full'","Storage-full state");
    until("document.body.textContent.includes('Notes storage is full')","Storage-full message");
    until("[...document.querySelectorAll('button')].some(b=>b.getAttribute('aria-label')==='Recover browser Notes'&&b.getClientRects().length)","Export (Notes recovery) offered");
    until("document.documentElement.dataset.notesDraftState==='saved'","Small encrypted recovery draft settled before closing the renderer");
    assertEquals("Saved notes are unchanged",seeded,store.readCredentialSlot(AlphaCredentialStore.NOTES_RECORDS));
    assertEquals("Unsaved small edit remains on screen",JSONObject.quote("E".repeat(NotesCapacityFixture.EDIT_BYTES)),js("document.querySelector('textarea[aria-label=Note]').value"));
   }
  }catch(Exception|Error failure){primary=failure;System.out.println("ALPHA_NOTES_CAPACITY_FAILURE phase="+phase+" heapLimit="+Runtime.getRuntime().maxMemory());throw failure;}finally{
   if(seeded!=null)try{
    assertTrue("Restore only the unchanged fixture collection",store.compareExchangeCredentialSlot(AlphaCredentialStore.NOTES_RECORDS,seeded,before));
    String draft=store.readCredentialSlot(AlphaCredentialStore.NOTES_DRAFT);
    if(draft!=null){JSONArray changed=new JSONObject(draft).getJSONArray("records");assertEquals("Only the fixture edit was drafted",1,changed.length());assertEquals(marker,changed.getJSONObject(0).getString("id"));assertTrue("Remove only the exact fixture draft",store.compareExchangeCredentialSlot(AlphaCredentialStore.NOTES_DRAFT,draft,null));}
   }catch(Exception|Error cleanup){if(primary!=null)primary.addSuppressed(cleanup);else throw cleanup;}
  }
 }

 @Test public void draftSurvivesForcedWriteFailureAndFreshRenderer()throws Exception{
  org.junit.Assume.assumeTrue("Explicit disposable Notes qualification","1".equals(InstrumentationRegistry.getArguments().getString("notesStorage")));
  String title="DRAFT-NOTE-"+unique(),marker="fixture-"+unique();String conflicted=null,originalDraft=null;Throwable primary=null;
  try{
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    openNotes();JSONObject draftSlot=slot(AlphaCredentialStore.NOTES_DRAFT);originalDraft=draftSlot.isNull("value")?null:draftSlot.getString("value");
    assertNull("Start without an unrelated Notes draft",originalDraft);
    click("New note");until("document.querySelector('input[aria-label=Title]')","Editor");
    until("document.body.textContent.includes('Note text encrypted on this device')","New note settled");
    // Force the next commit to fail: change the encrypted record's revision without changing its notes.
    String saved=NotesSecureFixture.read();JSONObject changed=new JSONObject(saved).put("fixtureConflict",marker);conflicted=changed.toString();
    assertTrue(cas(AlphaCredentialStore.NOTES_RECORDS,saved,conflicted));
    input("input[aria-label=Title]",title,false);
    until("document.documentElement.dataset.notesDraftState==='saved'","Encrypted draft saved after the failed commit");
    JSONObject kept=new JSONObject(slot(AlphaCredentialStore.NOTES_DRAFT).getString("value"));
    boolean found=false;JSONArray records=kept.getJSONArray("records");for(int i=0;i<records.length();i++)found|=title.equals(records.getJSONObject(i).optString("title"));
    assertTrue("Draft holds the unsaved title",found);
    assertFalse("The failed commit wrote nothing",NotesSecureFixture.read().contains(title));
   }
   // A fresh Activity and WebView: the previous renderer and its in-memory list are gone.
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    openNotes();
    until("document.documentElement.dataset.notesDraftState==='resumed'","Draft resumed");
    assertTrue("Resumed edit is saved",new JSONObject(NotesSecureFixture.read()).getString("currentRaw").contains(title));
    assertTrue("Draft cleared after its edit was saved",slot(AlphaCredentialStore.NOTES_DRAFT).isNull("value"));
    click("Open "+title);click("Delete note");
   }
  }catch(Exception|AssertionError failure){primary=failure;throw failure;}finally{
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();
    // Remove only this fixture's marker and draft; never clear the collection.
    String now=NotesSecureFixture.read();JSONObject value=new JSONObject(now);
    if(marker.equals(value.optString("fixtureConflict"))){value.remove("fixtureConflict");cas(AlphaCredentialStore.NOTES_RECORDS,now,value.toString());}
    JSONObject draft=slot(AlphaCredentialStore.NOTES_DRAFT);if(!draft.isNull("value")&&draft.getString("value").contains(title))cas(AlphaCredentialStore.NOTES_DRAFT,draft.getString("value"),null);
   }catch(Exception|AssertionError cleanup){if(primary!=null)primary.addSuppressed(cleanup);else throw cleanup;}
  }
 }
}
