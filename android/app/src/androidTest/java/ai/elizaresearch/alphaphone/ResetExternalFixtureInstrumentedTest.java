package ai.elizaresearch.alphaphone;

import android.app.*;
import android.app.job.*;
import android.content.*;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.security.keystore.*;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import javax.crypto.KeyGenerator;
import org.junit.Test;
import static org.junit.Assert.*;

/** Explicit external-runner phases for an owned disposable secondary user only.
 * No method clears app data or authenticates: the runner must use the actual native review.
 * Supply the returned metadata again after clear; no surviving app-private oracle is used. */
public final class ResetExternalFixtureInstrumentedTest {
 private static final int JOB=1940931, NOTICE=1940932;
 private static final String CHANNEL="reset-fixture", SLOT="reset-fixture:v1:runtime";
 private static byte[] bytes(String run){return ("Alpha reset fixture "+run).getBytes(StandardCharsets.UTF_8);}
 private static String sha(byte[] value)throws Exception{StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(value))out.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return out.toString();}
 private static void write(File file,byte[] data)throws Exception{try(FileOutputStream out=new FileOutputStream(file)){out.write(data);out.getFD().sync();}}
 private static org.json.JSONObject note(String id,String body)throws Exception{return new org.json.JSONObject().put("id",id).put("kind","text").put("title","Reset fixture").put("body",body).put("pinned",false).put("when","Saved on this device");}
 private static String notes(String run)throws Exception{
  String collection=run.substring(0,8)+"-"+run.substring(8,12)+"-"+run.substring(12,16)+"-"+run.substring(16,20)+"-"+run.substring(20);
  String inner=new org.json.JSONObject().put("version",2).put("collectionId",collection).put("records",new org.json.JSONArray().put(note(run,"Saved reset sentinel"))).put("deleted",new org.json.JSONArray()).toString();
  return new org.json.JSONObject().put("version",1).put("currentRaw",inner).put("archive",new org.json.JSONObject().put("v1",org.json.JSONObject.NULL).put("v2",org.json.JSONObject.NULL).put("daily",org.json.JSONObject.NULL)).toString();
 }
 private static String draft(String run)throws Exception{
  String current=new org.json.JSONObject(notes(run)).getString("currentRaw"),id=run+"_draft";
  return new org.json.JSONObject().put("version",1).put("savedAt",1).put("base",sha(current.getBytes(StandardCharsets.UTF_8))).put("reason","failed").put("records",new org.json.JSONArray().put(note(id,"Unsaved reset sentinel"))).put("added",new org.json.JSONArray().put(id)).put("removed",new org.json.JSONArray()).put("before",new org.json.JSONObject()).toString();
 }
 private static KeyStore keys()throws Exception{KeyStore keys=KeyStore.getInstance("AndroidKeyStore");keys.load(null);return keys;}
 @Test public void externalFixturePhase()throws Exception{
  Bundle args=InstrumentationRegistry.getArguments();String phase=args.getString("resetFixturePhase"),run=args.getString("resetFixtureRun");
  assertNotNull("Explicit resetFixturePhase required",phase);
  assertNotNull("Host-owned run identity required",run);assertTrue("Safe unique run identity",run.matches("[a-f0-9]{32}"));
  int user=android.os.Process.myUid()/100000;
  assertTrue("Never operate in owner user",user>0);
  assertEquals("Runner must explicitly identify this disposable user",String.valueOf(user),args.getString("resetFixtureDisposableUser"));
  assertEquals("Explicit disposable profile acknowledgement","owned-disposable-alpha-reset",args.getString("resetFixtureAcknowledgement"));
  Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();String name="alpha-reset-"+run,alias="alpha-reset-fixture-"+run;
  File file=new File(c.getFilesDir(),name),cache=new File(c.getCacheDir(),name);AlphaCredentialStore store=new AlphaCredentialStore(c);
  String payload=new org.json.JSONObject().put("fixture",run).toString();
  JobScheduler jobs=c.getSystemService(JobScheduler.class);NotificationManager notices=c.getSystemService(NotificationManager.class);
  if("prepare".equals(phase)){
   assertFalse("No pending real reset",AlphaDataReset.pending(c));assertFalse(file.exists());assertFalse(keys().containsAlias(alias));
   assertNull("Only fresh synthetic Notes",store.readCredentialSlot(AlphaCredentialStore.NOTES_RECORDS));
   assertNull("Only fresh synthetic draft",store.readCredentialSlot(AlphaCredentialStore.NOTES_DRAFT));assertNull(store.readCredentialSlot(SLOT));
   assertNull(jobs.getPendingJob(JOB));
   write(file,bytes(run));write(cache,bytes(run));assertTrue(c.getSharedPreferences(name,0).edit().putString("value",run).commit());
   store.writeCredentialSlot(AlphaCredentialStore.NOTES_RECORDS,notes(run));store.writeCredentialSlot(AlphaCredentialStore.NOTES_DRAFT,draft(run));store.writeCredentialSlot(SLOT,payload);
   KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");generator.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());generator.generateKey();assertTrue(keys().containsAlias(alias));
   assertEquals(JobScheduler.RESULT_SUCCESS,jobs.schedule(new JobInfo.Builder(JOB,new ComponentName(c,"androidx.work.impl.background.systemjob.SystemJobService")).setMinimumLatency(86400000L).build()));
   notices.createNotificationChannel(new NotificationChannel(CHANNEL,"Reset fixture",NotificationManager.IMPORTANCE_LOW));
   assertTrue("Notification permission must be granted by disposable runner",notices.areNotificationsEnabled());
   notices.notify(NOTICE,new Notification.Builder(c,CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(name).setContentText("Synthetic reset sentinel").build());
   // NotificationManager publication is asynchronous. Observe the one posted
   // sentinel without reposting or confusing delayed visibility with denial.
   long noticeDeadline=android.os.SystemClock.elapsedRealtime()+5000;
   while(java.util.Arrays.stream(notices.getActiveNotifications()).noneMatch(n->n.getId()==NOTICE)&&android.os.SystemClock.elapsedRealtime()<noticeDeadline)android.os.SystemClock.sleep(100);
   assertTrue("Posted reset sentinel becomes visible within five seconds",java.util.Arrays.stream(notices.getActiveNotifications()).anyMatch(n->n.getId()==NOTICE));
   ContentValues media=new ContentValues();media.put(MediaStore.Downloads.DISPLAY_NAME,name+".txt");media.put(MediaStore.Downloads.MIME_TYPE,"text/plain");media.put(MediaStore.Downloads.RELATIVE_PATH,"Download/");
   Uri uri=c.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,media);assertNotNull(uri);
   try(OutputStream out=c.getContentResolver().openOutputStream(uri)){assertNotNull(out);out.write(bytes(run));}
   Bundle result=new Bundle();result.putString("resetFixtureRun",run);result.putString("resetFixtureMediaUri",uri.toString());result.putString("resetFixtureMediaName",name+".txt");result.putString("resetFixtureMediaSha256",sha(bytes(run)));result.putString("resetFixtureKeystoreAlias",alias);result.putInt("resetFixtureUser",user);
   InstrumentationRegistry.getInstrumentation().addResults(result);
  }else if("verify-preserved".equals(phase)){
   assertArrayEquals("Private file retained",bytes(run),java.nio.file.Files.readAllBytes(file.toPath()));assertArrayEquals("Cache retained",bytes(run),java.nio.file.Files.readAllBytes(cache.toPath()));assertEquals("Preferences retained",run,c.getSharedPreferences(name,0).getString("value",null));
   assertEquals("Saved Notes retained",notes(run),store.readCredentialSlot(AlphaCredentialStore.NOTES_RECORDS));assertEquals("Unsaved draft retained",draft(run),store.readCredentialSlot(AlphaCredentialStore.NOTES_DRAFT));assertEquals("Runtime fixture retained",payload,store.readCredentialSlot(SLOT));
   assertTrue("UID key retained",keys().containsAlias(alias));assertNotNull("Job retained",jobs.getPendingJob(JOB));assertTrue("Notification retained",java.util.Arrays.stream(notices.getActiveNotifications()).anyMatch(n->n.getId()==NOTICE));assertFalse("No reset authority recorded",AlphaDataReset.pending(c));
  }else if("verify".equals(phase)){
   assertFalse("Private file erased",file.exists());assertFalse("Cache erased",cache.exists());assertFalse("Preferences erased",c.getSharedPreferences(name,0).contains("value"));
   assertNull("Notes erased",store.readCredentialSlot(AlphaCredentialStore.NOTES_RECORDS));assertNull("Draft erased",store.readCredentialSlot(AlphaCredentialStore.NOTES_DRAFT));assertNull("Runtime fixture erased",store.readCredentialSlot(SLOT));
   assertFalse("UID Keystore fixture erased",keys().containsAlias(alias));assertNull("Owned job cancelled",jobs.getPendingJob(JOB));
   assertFalse("Owned notification cancelled",java.util.Arrays.stream(notices.getActiveNotifications()).anyMatch(n->n.getId()==NOTICE));assertFalse("Reset marker erased",AlphaDataReset.pending(c));
   // Shared-media permissions may be revoked by reset. The external runner owns
   // URI/name/hash verification and cleanup; never infer deletion from denied access.
   assertNotNull("External media oracle must survive outside app data",args.getString("resetFixtureMediaUri"));
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();assertEquals("null",WebViewTestDriver.evaluate("localStorage.getItem('alpha.connection.selection.v1')"));
   }
  }else if("record-before-dispatch".equals(phase)){
   assertEquals("Only a seeded disposable fixture may record",payload,store.readCredentialSlot(SLOT));assertFalse(AlphaDataReset.pending(c));
   AlphaDataReset.record(c);assertTrue(AlphaDataReset.pending(c));
   // Return without dispatch. The external runner stops this process and launches
   // the app to verify attachBaseContext resumes the persisted clear request.
  }else throw new AssertionError("Unknown reset fixture phase");
 }
}
