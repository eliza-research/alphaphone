package ai.elizaresearch.alphaphone;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import androidx.lifecycle.Lifecycle;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigInteger;
import java.net.SocketException;
import java.net.URL;
import java.net.URLConnection;
import java.net.URLStreamHandler;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.security.cert.Certificate;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.HttpsURLConnection;

/**
 * Host-JVM run of AlphaDevicePlugin's update members, compiled from the plugin source by
 * test/app-update.test.mjs against the stubs in test/fixtures/app-update-jvm: one Context is one process whose
 * bridges all hear each broadcast, and the HTTPS download is served in memory, with the plugin's deadline
 * shortened to three seconds. Not Android, PackageInstaller or network evidence: the stubs transcribe what AOSP's source
 * does, they do not prove it.
 */
public final class UpdateFlowTest {
 private static final byte[] APK="the offered update".getBytes(java.nio.charset.StandardCharsets.UTF_8);
 private static byte[] served=APK;
 private interface Body {InputStream open(Served connection);}
 private static final Body IN_MEMORY=connection->new ByteArrayInputStream(served);
 private static volatile Body body=IN_MEMORY;
 private static final List<Served> connections=new CopyOnWriteArrayList<>();
 private static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 private static String sha256(byte[] bytes)throws Exception{return String.format("%064x",new BigInteger(1,MessageDigest.getInstance("SHA-256").digest(bytes)));}
 private static final class Served extends HttpsURLConnection {
  final CountDownLatch closed=new CountDownLatch(1);
  Served(URL url){super(url);connections.add(this);}
  @Override public int getResponseCode(){return 200;}
  @Override public InputStream getInputStream(){return body.open(this);}
  @Override public void connect(){}
  @Override public void disconnect(){closed.countDown();}
  @Override public boolean usingProxy(){return false;}
  @Override public String getCipherSuite(){return "";}
  @Override public Certificate[] getLocalCertificates(){return new Certificate[0];}
  @Override public Certificate[] getServerCertificates(){return new Certificate[0];}
 }
 /** A socket read in flight: an interrupt does not end it, only disconnect does, or the release that lets its bytes arrive. */
 private static final class Held implements Body {
  final CountDownLatch reading=new CountDownLatch(1),released=new CountDownLatch(1);
  @Override public InputStream open(Served connection){
   InputStream bytes=new ByteArrayInputStream(APK);
   return new InputStream(){
    @Override public int read()throws IOException{throw new IOException("A download reads whole buffers");}
    @Override public int read(byte[] buffer,int offset,int length)throws IOException{
     reading.countDown();
     boolean interrupted=false;
     while(released.getCount()>0&&connection.closed.getCount()>0)try{Thread.sleep(2);}catch(InterruptedException stillBlocked){interrupted=true;}
     if(interrupted)Thread.currentThread().interrupt();
     if(connection.closed.getCount()==0)throw new SocketException("Socket closed");
     return bytes.read(buffer,offset,length);
    }
   };
  }
  /** Starts a tap and returns once its download is in flight, with its file in the cache. */
  PluginCall start(AlphaDevicePlugin plugin)throws Exception{
   body=this;connections.clear();
   PluginCall call=offered();plugin.installUpdate(call);
   check(reading.await(20,TimeUnit.SECONDS),"the download started");
   return call;
  }
 }
 /** Never silent: one byte of the offered APK after each pause. */
 private static Body trickle(long pauseMillis){
  return connection->new InputStream(){
   private int at;
   @Override public int read()throws IOException{
    if(at==APK.length)return -1;
    try{Thread.sleep(pauseMillis);}catch(InterruptedException stopped){throw new IOException(stopped);}
    return APK[at++];
   }
   @Override public int read(byte[] buffer,int offset,int length)throws IOException{int value=read();if(value<0)return -1;buffer[offset]=(byte)value;return 1;}
  };
 }
 private static AlphaDevicePlugin bridge(Context context,Lifecycle.State state){
  AlphaDevicePlugin plugin=new AlphaDevicePlugin();
  plugin.context=context;plugin.activity=new Activity();plugin.activity.state=state;plugin.load();
  return plugin;
 }
 private static PackageInfo archive(String packageName,long versionCode){PackageInfo info=new PackageInfo();info.packageName=packageName;info.versionCode=versionCode;return info;}
 private static PluginCall offered()throws Exception{return new PluginCall(new JSObject().put("apkUrl","https://updates.test/alpha-8.apk").put("sha256",sha256(APK)).put("sizeBytes",(long)APK.length).put("versionCode",8L));}
 private static File download(Context context){return new File(context.getCacheDir(),"alpha-update.apk");}
 /** The owner's tap on the offered build, settled only after its attempt let go of the download. */
 private static PluginCall tap(AlphaDevicePlugin plugin)throws Exception{
  PluginCall call=offered();
  plugin.installUpdate(call);call.awaitAnswer();
  check(!download(plugin.getContext()).exists(),"no tap leaves its download in the cache");
  return call;
 }
 private static int committed(Context context){List<Integer> all=context.packages.installer.committed;return all.get(all.size()-1);}
 /** Android's request for the owner's confirmation, heard by every bridge of the process. */
 private static Intent confirmation(Context context,Integer session){
  Intent confirm=new Intent("android.content.pm.action.CONFIRM_INSTALL");
  Intent status=new Intent("ai.elizaresearch.alphaphone.UPDATE_STATUS").putExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_PENDING_USER_ACTION).putExtra(Intent.EXTRA_INTENT,confirm);
  if(session!=null){status.putExtra(PackageInstaller.EXTRA_SESSION_ID,session);context.packages.installer.sendConfirmation(session);}
  context.broadcast(status);
  return confirm;
 }
 /** Android's request to confirm a developer-verification result, sent with the accepted session still active (Android 17). */
 private static Intent verificationRequest(Context context,int session){
  Intent confirm=new Intent("android.content.pm.action.CONFIRM_DEVELOPER_VERIFICATION");
  context.broadcast(new Intent("ai.elizaresearch.alphaphone.UPDATE_STATUS").putExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_PENDING_USER_ACTION).putExtra(PackageInstaller.EXTRA_SESSION_ID,session).putExtra(Intent.EXTRA_INTENT,confirm));
  return confirm;
 }
 /** Android's last status for a session, which it then forgets, as every non-staged session. */
 private static void ended(Context context,int session,int status){
  context.broadcast(new Intent("ai.elizaresearch.alphaphone.UPDATE_STATUS").putExtra(PackageInstaller.EXTRA_STATUS,status).putExtra(PackageInstaller.EXTRA_SESSION_ID,session));
  context.packages.installer.sessions.remove((Integer)session);
 }
 /** A killed process runs no destroy: its receivers and memory go, and Android's sessions stay. */
 private static AlphaDevicePlugin restarted(Context context)throws Exception{
  context.receivers.clear();
  forgetProcess();
  return bridge(context,Lifecycle.State.RESUMED);
 }
 private static void plugin(String field,Object value)throws Exception{
  java.lang.reflect.Field member=AlphaDevicePlugin.class.getDeclaredField(field);
  member.setAccessible(true);member.set(null,value);
 }
 private static void forgetProcess()throws Exception{
  plugin("updateOwner",null);plugin("updateConfirm",null);plugin("updateSession",0);plugin("updateDue",false);plugin("updateOpen",false);plugin("updateAsked",0L);
 }
 /** Seconds pass after Alpha's last exchange with Android, without a test sleeping through them. */
 private static void settled()throws Exception{plugin("updateAsked",0L);}
 /** Alpha's last exchange with Android was this long ago, for the tests that measure the wait itself. */
 private static void aged(long millis)throws Exception{plugin("updateAsked",System.nanoTime()-TimeUnit.MILLISECONDS.toNanos(millis));}
 private static void resume(AlphaDevicePlugin plugin){plugin.activity.state=Lifecycle.State.RESUMED;plugin.handleOnResume();}
 private static void stop(AlphaDevicePlugin plugin){plugin.activity.state=Lifecycle.State.CREATED;}
 private static Context installing(File cache)throws Exception{forgetProcess();Context context=new Context(cache);context.packages.archive=archive(context.getPackageName(),8);return context;}
 /** The confirmation goes with no status, as Home or Alpha's own singleTask relaunch can do it. Alpha returns, and time passes. */
 private static void dismissed(AlphaDevicePlugin plugin)throws Exception{stop(plugin);resume(plugin);settled();}

 private static void aStartSweepsTheDownloadOfAKilledProcess(File cache)throws Exception{
  Context context=new Context(cache);
  Files.write(download(context).toPath(),APK);
  bridge(context,Lifecycle.State.RESUMED);
  check(!download(context).exists(),"a bridge's load deletes what a killed process left");
 }
 private static void oneTapInstallsWhileATapOnAnotherBridgeChangesNothing(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  AlphaDevicePlugin first=bridge(context,Lifecycle.State.RESUMED),second=bridge(context,Lifecycle.State.RESUMED);
  Held held=new Held();
  PluginCall running=held.start(first);
  PluginCall quiet=offered();second.installUpdate(quiet);quiet.awaitAnswer();
  check(quiet.resolved.get()==1&&quiet.rejected.get()==0,"the second bridge's tap settles without a failure");
  check(connections.size()==1&&installer.sessions.isEmpty(),"and downloads and stages nothing");
  check(download(context).exists(),"the running attempt keeps its file");
  bridge(context,Lifecycle.State.CREATED);
  check(download(context).exists(),"a bridge that loads meanwhile does not sweep it");
  check(running.resolved.get()==0,"the first tap is still running");
  held.released.countDown();running.awaitAnswer();body=IN_MEMORY;
  check(running.resolved.get()==1&&running.rejected.get()==0&&installer.committed.size()==1,"one tap installs, once");
  check(!download(context).exists(),"and its download goes");
  ended(context,committed(context),PackageInstaller.STATUS_SUCCESS);
  check(tap(second).resolved.get()==1&&installer.committed.size()==2,"a tap after Android ended that session runs");
  check(installer.abandoned.isEmpty()&&installer.sessions.equals(List.of(committed(context))),"and abandons nothing");
 }
 private static void aTapOnAnotherBridgeLeavesAConfirmationPendingForTheOwner(File cache)throws Exception{
  Context context=installing(cache);
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED),other=bridge(context,Lifecycle.State.RESUMED);
  PackageInstaller installer=context.packages.installer;
  tap(owner);
  int pending=committed(context);
  stop(owner);
  Intent confirm=confirmation(context,pending);
  connections.clear();
  settled();
  check(tap(other).resolved.get()==1,"the other bridge's tap settles without a failure");
  check(connections.isEmpty()&&installer.committed.equals(List.of(pending))&&installer.abandoned.isEmpty()&&installer.sessions.equals(List.of(pending)),"and changes nothing while the owner keeps a confirmation");
  resume(owner);resume(owner);
  check(owner.activity.started.equals(List.of(confirm))&&other.activity.started.isEmpty(),"the owner's kept confirmation opens, once, there alone");
  settled();
  tap(other);
  check(installer.committed.equals(List.of(pending))&&installer.abandoned.isEmpty(),"once its owner is back, a tap on either bridge commits nothing");
  check(other.activity.started.equals(List.of(confirm))&&owner.activity.started.equals(List.of(confirm)),"and only that bridge opens the confirmation again");
 }
 private static void aRepeatTapKeepsAConfirmationHeldForResume(File cache)throws Exception{
  Context context=installing(cache);
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED);
  tap(owner);
  int pending=committed(context);
  // A tap made in front, still queued behind a check, that reaches the worker once Alpha has left and the status has arrived.
  Held checking=new Held();body=checking;
  PluginCall answer=offered();owner.checkForUpdate(answer);
  check(checking.reading.await(20,TimeUnit.SECONDS),"a check holds the worker");
  PluginCall repeat=offered();owner.installUpdate(repeat);
  stop(owner);
  Intent confirm=confirmation(context,pending);
  connections.clear();
  settled();
  checking.released.countDown();answer.awaitAnswer();repeat.awaitAnswer();body=IN_MEMORY;
  check(repeat.resolved.get()==1&&repeat.rejected.get()==0,"the repeat tap settles without a failure");
  check(owner.activity.started.isEmpty(),"and opens nothing while Alpha is away");
  check(connections.isEmpty()&&context.packages.installer.abandoned.isEmpty()&&context.packages.installer.committed.size()==1,"it neither downloads nor cancels anything");
  resume(owner);resume(owner);
  check(owner.activity.started.equals(List.of(confirm)),"the kept confirmation opens once");
  settled();
  tap(owner);
  check(context.packages.installer.abandoned.isEmpty()&&context.packages.installer.committed.equals(List.of(pending))&&owner.activity.started.equals(List.of(confirm,confirm)),"once it has been shown and its owner is back, a later tap opens that session's confirmation again");
 }
 private static void aTapQueuedBehindAnAttemptKeepsWhatItStaged(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED);
  Held held=new Held();
  PluginCall running=held.start(owner);
  // A page reload forgets the renderer's busy state; the plugin, its worker and this attempt live on.
  PluginCall queued=offered();owner.installUpdate(queued);
  held.released.countDown();running.awaitAnswer();queued.awaitAnswer();body=IN_MEMORY;
  check(running.resolved.get()==1&&queued.resolved.get()==1&&queued.rejected.get()==0,"both taps settle without a failure");
  check(connections.size()==1&&installer.committed.size()==1&&installer.abandoned.isEmpty(),"the queued tap neither downloads again nor cancels the session the attempt staged");
  int staged=committed(context);
  Intent confirm=confirmation(context,staged);
  check(owner.activity.started.equals(List.of(confirm)),"so that session's confirmation stays");
  dismissed(owner);
  check(tap(owner).resolved.get()==1&&installer.abandoned.isEmpty()&&installer.committed.equals(List.of(staged))&&owner.activity.started.equals(List.of(confirm,confirm)),"and a later tap opens it again, never replacing it");
 }
 private static void aTapQueuedBehindAFailedAttemptRetries(File cache)throws Exception{
  Context context=installing(cache);
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED);
  Held held=new Held();
  PluginCall dropped=held.start(owner);
  PluginCall queued=offered();owner.installUpdate(queued);
  body=IN_MEMORY;connections.get(0).disconnect();
  dropped.awaitAnswer();queued.awaitAnswer();
  check(dropped.rejected.get()==1&&queued.resolved.get()==1&&context.packages.installer.committed.size()==1,"an attempt that staged nothing does not void the tap behind it");
 }
 /** Holds the installer's next commit once updateSession names its session; the returned latch counts down when it is reached. */
 private static CountDownLatch holdCommit(PackageInstaller installer,CountDownLatch release){
  CountDownLatch atCommit=new CountDownLatch(1);
  installer.committing=()->{atCommit.countDown();try{check(release.await(20,TimeUnit.SECONDS),"the commit was released");}catch(InterruptedException stopped){throw new AssertionError(stopped);}};
  return atCommit;
 }
 private static void aTapAfterSessionAssignedBeforeCommitReturnsKeepsSession(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED);
  CountDownLatch release=new CountDownLatch(1),atCommit=holdCommit(installer,release);
  connections.clear();
  PluginCall running=offered();owner.installUpdate(running);
  check(atCommit.await(20,TimeUnit.SECONDS),"the first attempt reaches commit after naming its session");
  PluginCall queued=offered();owner.installUpdate(queued);
  release.countDown();running.awaitAnswer();queued.awaitAnswer();
  check(running.resolved.get()==1&&queued.resolved.get()==1&&queued.rejected.get()==0,"both taps settle without a failure");
  check(connections.size()==1&&installer.committed.size()==1&&installer.abandoned.isEmpty(),"a tap during commit must not replace the committing session: committed="+installer.committed+" abandoned="+installer.abandoned);
  int staged=committed(context);
  stop(owner);
  Intent confirm=confirmation(context,staged);
  resume(owner);
  check(owner.activity.started.equals(List.of(confirm)),"that session's kept confirmation still opens");
  dismissed(owner);
  check(tap(owner).resolved.get()==1&&installer.abandoned.isEmpty()&&installer.committed.equals(List.of(staged))&&owner.activity.started.equals(List.of(confirm,confirm)),"and a later tap, once its owner is back, opens it again");
 }
 private static void aTapQueuedOnAnotherBridgeDuringCommitKeepsSession(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED),other=bridge(context,Lifecycle.State.RESUMED);
  CountDownLatch release=new CountDownLatch(1),atCommit=holdCommit(installer,release);
  PluginCall running=offered();owner.installUpdate(running);
  check(atCommit.await(20,TimeUnit.SECONDS),"the first attempt reaches commit");
  // The other bridge's tap waits behind its own check until the attempt has ended and updating is free.
  Held checking=new Held();body=checking;
  PluginCall answer=offered();other.checkForUpdate(answer);
  check(checking.reading.await(20,TimeUnit.SECONDS),"a check holds the other bridge's worker");
  PluginCall queued=offered();other.installUpdate(queued);
  release.countDown();running.awaitAnswer();
  // Android answers before the queued tap runs. The three seconds keep this one quiet too; aTapTakenBeforeACommitStaysQuietPastTheWindow takes them away.
  Intent confirm=confirmation(context,committed(context));
  checking.released.countDown();answer.awaitAnswer();queued.awaitAnswer();body=IN_MEMORY;
  check(queued.resolved.get()==1&&queued.rejected.get()==0&&installer.committed.size()==1,"a tap taken before the commit returned stages nothing on any bridge: committed="+installer.committed);
  check(owner.activity.started.equals(List.of(confirm))&&other.activity.started.isEmpty(),"and opens nothing");
  dismissed(owner);
  check(tap(other).resolved.get()==1&&installer.committed.size()==1&&installer.abandoned.isEmpty()&&installer.sessions.size()==1&&other.activity.started.equals(List.of(confirm)),"a later tap there opens the same session's confirmation");
 }
 private static void aTapQueuedBehindACommitThatFailsRetries(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED);
  Held held=new Held();
  PluginCall dropped=held.start(owner);
  PluginCall queued=offered();owner.installUpdate(queued);
  installer.committing=()->{installer.committing=()->{};throw new IllegalStateException("Session gone");};
  body=IN_MEMORY;held.released.countDown();
  dropped.awaitAnswer();queued.awaitAnswer();
  check(dropped.rejected.get()==1&&queued.resolved.get()==1&&queued.rejected.get()==0,"the failed commit settles quietly and the tap behind it installs");
  check(installer.committed.size()==1&&installer.sessions.equals(List.of(committed(context))),"only the retry's session remains: committed="+installer.committed+" sessions="+installer.sessions);
 }
 private static void aPendingSessionFencesATapBeforeAnyDownload(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED);
  tap(owner);
  int earlier=committed(context);
  connections.clear();
  check(tap(owner).resolved.get()==1&&connections.isEmpty(),"a tap while Android holds a session downloads nothing");
  check(installer.abandoned.isEmpty()&&installer.sessions.equals(List.of(earlier)),"the earlier session stays");
  Intent confirm=confirmation(context,earlier);
  check(owner.activity.started.equals(List.of(confirm)),"and its confirmation still opens");
  installer.sessions.remove((Integer)earlier);
  check(tap(owner).resolved.get()==1&&installer.sessions.equals(List.of(committed(context))),"after Android ended that session, the next tap installs");
  check(installer.abandoned.isEmpty(),"with nothing left to abandon");
 }
 private static void theDeadlineEndsATrickleNotADownloadThatFinishesInTime(File cache)throws Exception{
  Context context=installing(cache);
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED);
  body=trickle(400);connections.clear();
  PluginCall late=tap(owner);
  check(late.rejected.get()==1&&late.resolved.get()==0,"a download still trickling at the deadline fails quietly");
  check(connections.get(0).closed.getCount()==0&&context.packages.installer.sessions.isEmpty(),"its connection closes and nothing is staged");
  body=trickle(2);
  check(tap(owner).resolved.get()==1&&context.packages.installer.committed.size()==1,"a slow download inside the deadline installs, and nothing held the failed attempt");
  body=IN_MEMORY;
 }
 private static void destroyClosesADownloadInFlight(File cache)throws Exception{
  Context context=installing(cache);
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED),other=bridge(context,Lifecycle.State.RESUMED);
  Held held=new Held();
  PluginCall running=held.start(owner);
  owner.handleOnDestroy();
  running.awaitAnswer();body=IN_MEMORY;
  check(running.rejected.get()==1&&connections.get(0).closed.getCount()==0,"destroy closes the connection the worker is blocked on");
  check(context.packages.installer.sessions.isEmpty()&&!download(context).exists(),"nothing is staged or left behind");
  check(tap(other).resolved.get()==1&&context.packages.installer.committed.size()==1,"another bridge's later tap installs");
  other.handleOnDestroy();
  bridge(context,Lifecycle.State.RESUMED).handleOnDestroy();
  check(context.receivers.isEmpty(),"a bridge with a finished attempt, or none, is destroyed cleanly and stops listening");
 }
 private static void destroyingAnotherBridgeLeavesADownloadInFlight(File cache)throws Exception{
  Context context=installing(cache);
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED),idle=bridge(context,Lifecycle.State.RESUMED);
  Held held=new Held();
  PluginCall running=held.start(owner);
  idle.handleOnDestroy();
  check(connections.get(0).closed.getCount()==1&&download(context).exists(),"the owner's connection and file stay");
  held.released.countDown();running.awaitAnswer();body=IN_MEMORY;
  check(running.resolved.get()==1&&context.packages.installer.committed.size()==1,"and its attempt installs, once");
 }
 private static void destroyAfterTheDownloadChangesNoSession(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED);
  int left=installer.createSession(null);
  context.packages.archiveRead=owner::handleOnDestroy;
  check(tap(owner).rejected.get()==1,"destroyed while the archive is read");
  check(installer.abandoned.isEmpty()&&installer.sessions.equals(List.of(left)),"a session left unsealed stays and no new one opens");
  Context stagingContext=installing(cache);
  AlphaDevicePlugin staging=bridge(stagingContext,Lifecycle.State.RESUMED);
  stagingContext.packages.installer.staging=staging::handleOnDestroy;
  check(tap(staging).rejected.get()==1,"destroyed while the session is written");
  check(stagingContext.packages.installer.committed.isEmpty()&&stagingContext.packages.installer.sessions.isEmpty(),"nothing commits for a receiver that is gone, and the session goes");
 }
 private static void aResumedOwnerOpensItAtOnceAndOnce(File cache)throws Exception{
  Context context=installing(cache);
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED),other=bridge(context,Lifecycle.State.CREATED);
  check(tap(owner).resolved.get()==1,"the tap settles once the session is committed");
  Intent confirm=confirmation(context,committed(context));
  check(owner.activity.started.equals(List.of(confirm)),"the resumed owner opens Android's confirmation");
  resume(owner);
  check(owner.activity.started.size()==1,"a later resume never opens it again");
  resume(other);
  check(other.activity.started.isEmpty(),"another bridge kept no copy of a confirmation already shown");
 }
 private static void aStoppedOwnerOpensItOnItsNextResume(File cache)throws Exception{
  Context context=installing(cache);
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED);
  tap(owner);
  stop(owner);
  Intent confirm=confirmation(context,committed(context));
  check(owner.activity.started.isEmpty(),"Android would drop an activity started while stopped");
  resume(owner);
  check(owner.activity.started.equals(List.of(confirm)),"the kept confirmation opens on resume");
  stop(owner);resume(owner);
  check(owner.activity.started.size()==1,"and only then");
 }
 private static void anotherBridgeNeverOpensIt(File cache)throws Exception{
  Context context=installing(cache);
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED),other=bridge(context,Lifecycle.State.CREATED);
  tap(owner);
  stop(owner);
  resume(other);
  Intent confirm=confirmation(context,committed(context));
  check(other.activity.started.isEmpty(),"a resumed bridge does not open another bridge's session");
  resume(other);
  check(other.activity.started.isEmpty(),"nor on its next resume");
  resume(owner);
  check(owner.activity.started.equals(List.of(confirm)),"the owner still gets it");
 }
 private static void onlyItsOwnSessionsConfirmationIsKept(File cache)throws Exception{
  Context context=installing(cache);
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED),idle=bridge(context,Lifecycle.State.RESUMED);
  confirmation(context,null);
  check(idle.activity.started.isEmpty()&&owner.activity.started.isEmpty(),"no bridge acts on a status without a session, before any tap");
  tap(owner);
  int mine=committed(context);
  confirmation(context,mine+1);confirmation(context,null);
  stop(owner);confirmation(context,mine+1);resume(owner);
  check(owner.activity.started.isEmpty(),"a foreign session's confirmation is neither opened nor kept");
  context.broadcast(new Intent("ai.elizaresearch.alphaphone.UPDATE_STATUS").putExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_FAILURE).putExtra(PackageInstaller.EXTRA_SESSION_ID,mine).putExtra(Intent.EXTRA_INTENT,new Intent("ignored")));
  check(owner.activity.started.isEmpty(),"only a request for confirmation is acted on");
 }
 /** A confirmation left with no answer ends with no status: only a status or Android's list frees the fence. */
 private static void aLaterTapReopensAnUnansweredConfirmation(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED);
  tap(owner);
  int first=committed(context);
  Intent shown=confirmation(context,first);
  connections.clear();
  dismissed(owner);
  check(tap(owner).resolved.get()==1&&connections.isEmpty(),"the tap settles and downloads nothing");
  check(installer.abandoned.isEmpty()&&installer.sessions.equals(List.of(first))&&installer.committed.equals(List.of(first)),"it commits nothing, replacing and abandoning nothing");
  check(owner.activity.started.equals(List.of(shown,shown)),"it opens Android's request again, once");
  check(installer.internals.get(first).active==0,"and Android's count stays true, unlike after a second commit");
  stop(owner);resume(owner);
  check(owner.activity.started.size()==2,"a resume adds nothing");
  ended(context,first,PackageInstaller.STATUS_FAILURE_ABORTED);
  check(tap(owner).resolved.get()==1&&installer.committed.size()==2&&committed(context)!=first,"the owner's cancel frees the next tap");
 }
 private static void aTapAfterCommitBeforeAnyStatusChangesNothing(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED),other=bridge(context,Lifecycle.State.RESUMED);
  installer.validating=true;
  tap(owner);
  int pending=committed(context);
  connections.clear();
  check(!installer.getMySessions().get(0).isActive(),"Android reads a commit idle until it has validated it");
  settled();
  check(tap(owner).resolved.get()==1&&tap(other).resolved.get()==1,"taps while Android validates settle without a failure");
  installer.validate(pending);
  check(tap(owner).resolved.get()==1&&tap(other).resolved.get()==1,"and so do taps while it works");
  check(connections.isEmpty()&&installer.committed.equals(List.of(pending))&&installer.abandoned.isEmpty()&&installer.sessions.equals(List.of(pending)),"none of them downloads, commits again, abandons or replaces");
  check(owner.activity.started.isEmpty()&&other.activity.started.isEmpty(),"and none opens anything");
 }
 private static void aStatusThatNeverArrivesStartsNothingWithoutATap(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED);
  tap(owner);
  int pending=committed(context);
  connections.clear();
  // Android is idle and its request for the confirmation has not reached Alpha.
  installer.sendConfirmation(pending);
  resume(owner);
  AlphaDevicePlugin later=bridge(context,Lifecycle.State.RESUMED);
  check(connections.isEmpty()&&installer.committed.equals(List.of(pending))&&installer.abandoned.isEmpty()&&installer.sessions.equals(List.of(pending)),"no resume or load retries, replaces or abandons it");
  check(tap(owner).resolved.get()==1&&installer.committed.equals(List.of(pending)),"a tap while that status can still be in flight stays quiet");
  settled();
  check(tap(owner).resolved.get()==1&&installer.committed.equals(List.of(pending)),"a late status is not a lost one: a live owner never commits again");
  Intent confirm=confirmation(context,pending);
  check(owner.activity.started.equals(List.of(confirm))&&later.activity.started.isEmpty(),"and when it comes it opens on the bridge that asked");
 }
 /** Named in docs/android-and-aosp.md: Android's status is not assumed either way, so only the process's end moves this on. */
 private static void aStatusALiveProcessNeverHearsWaitsForItsEnd(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED);
  tap(owner);
  int pending=committed(context);
  installer.sendConfirmation(pending);
  for(int again=0;again<3;again++){settled();check(tap(owner).resolved.get()==1,"each tap settles without a failure");}
  check(installer.committed.equals(List.of(pending))&&installer.internals.get(pending).active==0,"a live owner commits once, and Android's count stays true");
  AlphaDevicePlugin next=restarted(context);
  check(tap(next).resolved.get()==1&&installer.committed.equals(List.of(pending,pending)),"the next process asks");
  Intent confirm=confirmation(context,pending);
  check(next.activity.started.equals(List.of(confirm)),"and opens the answer");
 }
 /** A large APK validates for longer than any wait Alpha could pick, and its status comes only after that. */
 private static void aLongValidationDrawsNoSecondCommit(File cache)throws Exception{
  for(int sdk=30;sdk<=37;sdk++){
   String run=" sdk "+sdk;
   Context context=installing(cache);
   PackageInstaller installer=context.packages.installer;
   installer.sdk=sdk;
   AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED);
   installer.validating=true;
   tap(owner);
   int pending=committed(context);
   aged(4000);
   check(tap(owner).resolved.get()==1&&installer.committed.equals(List.of(pending)),"a tap past three seconds of validation commits nothing:"+run);
   installer.validate(pending);
   aged(4000);
   check(tap(owner).resolved.get()==1&&installer.committed.equals(List.of(pending)),"nor while Android works on it:"+run);
   installer.sendConfirmation(pending);
   aged(4000);
   check(tap(owner).resolved.get()==1&&installer.committed.equals(List.of(pending))&&installer.internals.get(pending).active==0,"nor while its status crosses to the main thread, so Android's count stays true:"+run);
   Intent confirm=confirmation(context,pending);
   check(owner.activity.started.equals(List.of(confirm)),"and its one status opens one confirmation:"+run);
  }
 }
 /** Marked only once validated: with the owner gone, a tap must not read Android's work as a session left behind. */
 private static void aSessionUnderValidationIsLeftAloneWhoeverAsks(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED),other=bridge(context,Lifecycle.State.RESUMED);
  installer.validating=true;
  tap(owner);
  int pending=committed(context);
  owner.handleOnDestroy();
  settled();
  check(tap(other).resolved.get()==1&&installer.committed.equals(List.of(pending)),"another bridge leaves it past the window");
  AlphaDevicePlugin next=restarted(context);
  check(tap(next).resolved.get()==1&&installer.committed.equals(List.of(pending))&&installer.abandoned.isEmpty(),"so does a restarted process");
  installer.validate(pending);installer.sendConfirmation(pending);
  check(tap(next).resolved.get()==1&&installer.committed.equals(List.of(pending,pending)),"once Android marks it and waits on the owner, with no owner left, a tap asks");
  Intent confirm=confirmation(context,pending);
  check(next.activity.started.equals(List.of(confirm)),"and opens the answer");
 }
 private static void theThreeSecondsAreThreeSeconds(File cache)throws Exception{
  Context context=installing(cache);
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED);
  tap(owner);
  int pending=committed(context);
  aged(60000);
  Intent confirm=confirmation(context,pending);
  tap(owner);
  check(owner.activity.started.equals(List.of(confirm)),"opening a confirmation starts them again, however old the commit");
  aged(30000);
  stop(owner);resume(owner);
  tap(owner);
  check(owner.activity.started.size()==1,"and so does the return from a long dialog");
  aged(2500);
  tap(owner);
  check(owner.activity.started.size()==1,"they are not over at 2.5 s");
  aged(3100);
  tap(owner);
  check(owner.activity.started.equals(List.of(confirm,confirm)),"and are at 3.1 s, with no restart");
 }
 private static void aRestartRebuildsTheFenceFromAndroid(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  tap(bridge(context,Lifecycle.State.RESUMED));
  int pending=committed(context);
  AlphaDevicePlugin next=restarted(context);
  connections.clear();
  check(installer.committed.equals(List.of(pending)),"a load commits nothing");
  check(tap(next).resolved.get()==1&&connections.isEmpty()&&installer.committed.equals(List.of(pending)),"a tap in the new process, with Android still working, changes nothing");
  installer.sendConfirmation(pending);
  check(tap(next).resolved.get()==1&&connections.isEmpty()&&installer.committed.equals(List.of(pending,pending))&&installer.abandoned.isEmpty(),"once it waits on the owner, a tap asks for that session, known only from Android, because this process holds no confirmation");
  Intent confirm=confirmation(context,pending);
  check(next.activity.started.equals(List.of(confirm)),"and the new process opens the answer");
  resume(next);
  check(next.activity.started.size()==1,"once");
 }
 /** The case Session.commit's javadoc allows, from Android 11: only a later write records a commit's mark, so most sessions come back this way. */
 private static void aSessionARebootRestoredUncommittedIsCommittedAgain(File cache)throws Exception{
  for(int sdk=30;sdk<=37;sdk++){
   String run=" sdk "+sdk;
   Context context=installing(cache);
   PackageInstaller installer=context.packages.installer;
   installer.sdk=sdk;
   tap(bridge(context,Lifecycle.State.RESUMED));
   int pending=committed(context);
   installer.reboot();
   check(!installer.getSessionInfo(pending).isCommitted()&&installer.getSessionInfo(pending).getProgress()==0f,"it reads like a validation, but for its age:"+run);
   AlphaDevicePlugin next=restarted(context);
   connections.clear();
   check(tap(next).resolved.get()==1&&installer.committed.equals(List.of(pending,pending))&&installer.abandoned.isEmpty()&&connections.isEmpty(),"no process is waiting on it, and a tap asks:"+run);
   check(installer.getSessionInfo(pending).getProgress()==0.8f,"which counts its staging as a first commit does:"+run);
   Intent confirm=confirmation(context,pending);
   check(next.activity.started.equals(List.of(confirm)),"and the answer opens:"+run);
  }
 }
 /** Android 11 and later cannot install it, and Android 10 installs it reading nothing a tap could fence on. */
 private static void aSessionARebootRestoredCommittedIsGivenUp(File cache)throws Exception{
  for(int sdk=29;sdk<=37;sdk++){
   String run=" sdk "+sdk;
   Context context=installing(cache);
   PackageInstaller installer=context.packages.installer;
   installer.sdk=sdk;
   tap(bridge(context,Lifecycle.State.RESUMED));
   int stale=committed(context);
   confirmation(context,stale);
   installer.write();
   installer.reboot();
   check(installer.getSessionInfo(stale).isCommitted()&&installer.getSessionInfo(stale).getProgress()==0f,"it comes back committed with nothing counted:"+run);
   AlphaDevicePlugin next=restarted(context);
   resume(next);
   check(installer.abandoned.isEmpty(),"nothing happens without a tap:"+run);
   connections.clear();
   check(tap(next).resolved.get()==1&&installer.abandoned.equals(List.of(stale)),"the owner's tap gives it up:"+run);
   int fresh=committed(context);
   check(fresh!=stale&&installer.committed.equals(List.of(stale,fresh))&&connections.size()==1&&installer.sessions.equals(List.of(fresh)),"never committing it, and installs afresh in that tap:"+run);
   Intent confirm=confirmation(context,fresh);
   check(next.activity.started.equals(List.of(confirm)),"so the new session's confirmation opens:"+run);
  }
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  int one=installer.createSession(null),two=installer.createSession(null),left=installer.createSession(null);
  for(int stale:List.of(one,two)){installer.internals.get(stale).sealed=true;installer.validate(stale);}
  installer.write();installer.reboot();
  installer.internals.get(left).sealed=true;
  check(tap(restarted(context)).resolved.get()==1&&installer.abandoned.equals(List.of(one,two))&&installer.committed.equals(List.of(left)),"one tap clears every such session, and a session it can still ask for goes on");
 }
 /** A self-update kills Alpha before its status, and Android forgets the session whatever its result. */
 private static void aStatusLostToADeadProcessFreesTheNextTap(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  tap(bridge(context,Lifecycle.State.RESUMED));
  int pending=committed(context);
  AlphaDevicePlugin next=restarted(context);
  installer.sessions.remove((Integer)pending);
  check(tap(next).resolved.get()==1&&installer.committed.size()==2&&installer.sessions.equals(List.of(committed(context)))&&committed(context)!=pending,"the vanished session reconciles to a fresh install");
  check(installer.abandoned.isEmpty(),"with nothing to abandon");
 }
 private static void aTerminalStatusAllowsANewTap(File cache)throws Exception{
  for(int status:new int[]{PackageInstaller.STATUS_SUCCESS,PackageInstaller.STATUS_FAILURE,PackageInstaller.STATUS_FAILURE_ABORTED}){
   Context context=installing(cache);
   PackageInstaller installer=context.packages.installer;
   AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED);
   tap(owner);
   int pending=committed(context);
   stop(owner);
   confirmation(context,pending);
   ended(context,pending,status);
   resume(owner);
   check(owner.activity.started.isEmpty(),"a confirmation kept for an ended session never opens: status "+status);
   check(tap(owner).resolved.get()==1&&installer.committed.size()==2&&committed(context)!=pending&&installer.abandoned.isEmpty(),"and the next tap installs: status "+status);
  }
 }
 private static void aFailedAskLeavesTheSession(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  tap(bridge(context,Lifecycle.State.RESUMED));
  int pending=committed(context);
  confirmation(context,pending);
  AlphaDevicePlugin next=restarted(context);
  installer.committing=()->{installer.committing=()->{};throw new IllegalStateException("Session gone");};
  check(tap(next).rejected.get()==1&&installer.abandoned.isEmpty()&&installer.sessions.equals(List.of(pending)),"a commit Android refuses settles quietly and abandons nothing");
  settled();
  connections.clear();
  installer.listDown=true;
  check(tap(next).rejected.get()==1&&connections.isEmpty()&&installer.sessions.equals(List.of(pending)),"a list Android cannot give fails closed: nothing downloads");
  installer.listDown=false;
  check(tap(next).resolved.get()==1&&installer.committed.equals(List.of(pending,pending)),"the next tap asks again");
 }
 private static void aDestroyedOwnersSessionPassesToTheNextTap(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED),other=bridge(context,Lifecycle.State.RESUMED);
  tap(owner);
  int pending=committed(context);
  stop(owner);
  Intent confirm=confirmation(context,pending);
  owner.handleOnDestroy();
  settled();
  check(tap(other).resolved.get()==1&&installer.committed.equals(List.of(pending))&&installer.abandoned.isEmpty(),"the confirmation outlives its owner, so the tap commits nothing");
  check(other.activity.started.equals(List.of(confirm))&&owner.activity.started.isEmpty(),"and opens it, once, there");
 }
 private static void anUnsealedSessionNeverFences(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  int left=installer.createSession(null);
  check(tap(bridge(context,Lifecycle.State.RESUMED)).resolved.get()==1&&installer.committed.size()==1&&committed(context)!=left,"a killed process's unfinished session does not stop a tap");
  check(installer.abandoned.isEmpty()&&installer.sessions.contains(left),"and stays until Android expires it");
 }
 /** An older build could leave one sealed session per bridge. */
 private static void sealedSessionsAreAskedForInTurn(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  int one=installer.createSession(null),two=installer.createSession(null);
  for(int left:List.of(one,two))installer.internals.get(left).sealed=true;
  installer.reboot();
  AlphaDevicePlugin owner=restarted(context);
  tap(owner);
  check(installer.committed.equals(List.of(one)),"one session is asked for at a time");
  settled();
  tap(owner);
  check(installer.committed.equals(List.of(one)),"and the next waits for the first to end");
  ended(context,one,PackageInstaller.STATUS_FAILURE_ABORTED);
  settled();
  tap(owner);
  check(installer.committed.equals(List.of(one,two)),"then the next");
  ended(context,two,PackageInstaller.STATUS_FAILURE_ABORTED);
  settled();
  tap(owner);
  check(installer.committed.size()==3&&installer.abandoned.isEmpty(),"and with none left the tap installs");
 }
 /** The rule the fence exists for: a commit reaching an accepted session ends it through Android 13, and from 16 once its stage directory is in use. 14 and 15 stop at a guard. */
 private static void androidDestroysAnAcceptedInstallCommittedAgain(File cache)throws Exception{
  for(int sdk=29;sdk<=37;sdk++)for(int prepared=0;prepared<=1;prepared++){
   Context context=installing(cache);
   PackageInstaller installer=context.packages.installer;
   installer.sdk=sdk;
   int id=installer.createSession(null);
   try(PackageInstaller.Session session=installer.openSession(id)){session.commit(null);}
   installer.sendConfirmation(id);
   check(installer.internals.get(id).active==0,"one commit reads idle at its confirmation: sdk "+sdk);
   for(int asked=1;asked<=2;asked++){
    try(PackageInstaller.Session session=installer.openSession(id)){session.commit(null);}
    installer.sendConfirmation(id);
    check(installer.internals.get(id).active==-asked,"each later commit lowers Android's count: sdk "+sdk);
   }
   installer.accept(id);
   installer.install(id);
   check(installer.getSessionInfo(id).getProgress()==0.8f&&!installer.getSessionInfo(id).isActive(),"so an accept leaves the session reading idle: sdk "+sdk);
   if(prepared==1)installer.prepare(id);
   installer.openSession(id).commit(null);
   check(installer.destroyed.equals(sdk<=33||sdk>=36&&prepared==1?List.of(id):List.of()),"and a commit during the install ends it unless Android's guard stops it first: sdk "+sdk+", prepared "+prepared);
  }
 }
 private static void aTapDuringAnAcceptedInstallLeavesIt(File cache)throws Exception{
  for(int sdk=29;sdk<=37;sdk++)for(int reopened=0;reopened<=1;reopened++){
   String run=" sdk "+sdk+", reopened "+reopened;
   Context context=installing(cache);
   PackageInstaller installer=context.packages.installer;
   installer.sdk=sdk;
   AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED),other=bridge(context,Lifecycle.State.RESUMED);
   tap(owner);
   int pending=committed(context);
   confirmation(context,pending);
   for(int again=0;again<reopened;again++){dismissed(owner);tap(owner);}
   int opened=1+reopened;
   stop(owner);
   installer.accept(pending);
   resume(owner);
   check(tap(owner).resolved.get()==1&&tap(other).resolved.get()==1&&owner.activity.started.size()==opened&&other.activity.started.isEmpty(),"a tap just after an accept, which Android may not list yet, opens nothing:"+run);
   check(!installer.getSessionInfo(pending).isActive(),"an accept alone reads idle on every Android, until its install thread reaches it:"+run);
   installer.install(pending);
   settled();
   check(installer.getSessionInfo(pending).isActive()==sdk>=34,"from there an accepted session reads active from Android 14, reopened or not:"+run);
   if(sdk>=34)check(tap(owner).resolved.get()==1&&owner.activity.started.size()==opened,"and that alone fences it:"+run);
   installer.prepare(pending);
   check(tap(owner).resolved.get()==1&&tap(other).resolved.get()==1,"taps during the install settle without a failure:"+run);
   check(owner.activity.started.size()==opened&&other.activity.started.isEmpty()&&installer.committed.equals(List.of(pending)),"and neither commit nor open a second confirmation:"+run);
   check(installer.destroyed.isEmpty()&&installer.sessions.equals(List.of(pending)),"the install goes on:"+run);
   ended(context,pending,PackageInstaller.STATUS_SUCCESS);
   check(tap(owner).resolved.get()==1&&installer.committed.size()==2,"and its end frees the next tap:"+run);
  }
 }
 /** The one commit left after the first, and the only way Android's count goes wrong: progress still fences the install. */
 private static void aSessionCommittedAgainAfterARestartKeepsItsInstall(File cache)throws Exception{
  for(int sdk=29;sdk<=37;sdk++){
   Context context=installing(cache);
   PackageInstaller installer=context.packages.installer;
   installer.sdk=sdk;
   tap(bridge(context,Lifecycle.State.RESUMED));
   int pending=committed(context);
   confirmation(context,pending);
   AlphaDevicePlugin next=restarted(context);
   connections.clear();
   tap(next);
   Intent confirm=confirmation(context,pending);
   check(installer.committed.equals(List.of(pending,pending))&&installer.abandoned.isEmpty()&&next.activity.started.equals(List.of(confirm))&&installer.internals.get(pending).active==-1,"the new process asks once, at the cost of Android's count, and gives up nothing: sdk "+sdk);
   dismissed(next);
   check(tap(next).resolved.get()==1&&installer.committed.size()==2&&next.activity.started.equals(List.of(confirm,confirm))&&installer.internals.get(pending).active==-1,"it then holds a confirmation, so no later tap lowers the count again: sdk "+sdk);
   stop(next);
   installer.accept(pending);
   installer.install(pending);
   resume(next);
   check(!installer.getSessionInfo(pending).isActive(),"the accepted session reads idle: sdk "+sdk);
   installer.prepare(pending);
   settled();
   check(tap(next).resolved.get()==1&&connections.isEmpty(),"a tap during the install settles and downloads nothing: sdk "+sdk);
   check(installer.committed.size()==2&&next.activity.started.size()==2&&installer.destroyed.isEmpty()&&installer.sessions.equals(List.of(pending)),"and neither commits, opens nor destroys: sdk "+sdk);
   AlphaDevicePlugin after=restarted(context);
   check(tap(after).resolved.get()==1&&installer.committed.size()==2&&after.activity.started.isEmpty()&&installer.destroyed.isEmpty(),"another restart reads the same from Android: sdk "+sdk);
  }
 }
 private static void aTapWhileAConfirmationStartsChangesNothing(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED),other=bridge(context,Lifecycle.State.RESUMED);
  tap(owner);
  int pending=committed(context);
  Intent confirm=confirmation(context,pending);
  // Android has it, reads the session idle, and has not yet covered Alpha.
  check(tap(owner).resolved.get()==1&&tap(other).resolved.get()==1,"taps in that window settle without a failure");
  check(owner.activity.started.equals(List.of(confirm))&&other.activity.started.isEmpty()&&installer.committed.equals(List.of(pending)),"and neither open a second confirmation nor commit");
 }
 private static void aConfirmationUpBehindItsOwnerFencesAnotherBridge(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  AlphaDevicePlugin assist=bridge(context,Lifecycle.State.RESUMED),main=bridge(context,Lifecycle.State.RESUMED);
  tap(assist);
  int pending=committed(context);
  Intent confirm=confirmation(context,pending);
  stop(assist);
  settled();
  check(tap(main).resolved.get()==1&&main.activity.started.isEmpty()&&installer.committed.equals(List.of(pending)),"a tap in the other task, however late, leaves the confirmation up in the first");
  resume(assist);
  settled();
  check(tap(main).resolved.get()==1&&main.activity.started.equals(List.of(confirm))&&assist.activity.started.equals(List.of(confirm)),"once its owner is back it has gone, and the other bridge may open it");
  stop(main);
  settled();
  check(tap(assist).resolved.get()==1&&assist.activity.started.size()==1,"and the fence follows the bridge that opened it");
  main.handleOnDestroy();
  settled();
  check(tap(assist).resolved.get()==1&&assist.activity.started.equals(List.of(confirm,confirm)),"a destroyed owner never holds it");
 }
 private static void aStartAndroidDroppedDoesNotFence(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED),other=bridge(context,Lifecycle.State.RESUMED);
  tap(owner);
  int pending=committed(context);
  Intent confirm=confirmation(context,pending);
  // Alpha never paused, so nothing covers it. Only time tells, and it does not hold the owner up.
  settled();
  check(tap(owner).resolved.get()==1&&owner.activity.started.equals(List.of(confirm,confirm))&&installer.committed.equals(List.of(pending)),"a later tap opens it again");
  owner.activity.refuseStart=new IllegalStateException("Android refused");
  dismissed(owner);
  check(tap(owner).resolved.get()==1&&owner.activity.started.size()==2,"a start Android refuses settles quietly");
  settled();
  check(tap(owner).resolved.get()==1&&owner.activity.started.size()==3&&installer.committed.equals(List.of(pending)),"and leaves no fence behind it");
  owner.activity.refuseStart=new IllegalStateException("Android refused");
  dismissed(owner);
  tap(owner);
  stop(owner);
  settled();
  check(tap(other).resolved.get()==1&&other.activity.started.equals(List.of(confirm)),"even once its owner has gone away, since nothing opened");
 }
 private static void anEndOfTheSessionForgetsItsConfirmationBeforeAndroidsList(File cache)throws Exception{
  Context context=installing(cache);
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED);
  tap(owner);
  int pending=committed(context);
  Intent confirm=confirmation(context,pending);
  dismissed(owner);
  // Android posts the session's removal after its status.
  context.broadcast(new Intent("ai.elizaresearch.alphaphone.UPDATE_STATUS").putExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_FAILURE).putExtra(PackageInstaller.EXTRA_SESSION_ID,pending));
  context.packages.installer.internals.get(pending).ended=true;
  tap(owner);
  check(owner.activity.started.equals(List.of(confirm))&&context.packages.installer.committed.equals(List.of(pending)),"a tap in that moment opens and commits nothing on an ended session");
  AlphaDevicePlugin next=restarted(context);
  check(tap(next).rejected.get()==1&&next.activity.started.isEmpty()&&context.packages.installer.abandoned.isEmpty(),"a restarted process's commit there is refused, quietly");
  context.packages.installer.sessions.remove((Integer)pending);
  check(tap(next).resolved.get()==1&&committed(context)!=pending,"and once Android drops it the next tap installs");
 }
 /** Android forgot a session and its status never reached Alpha: what Alpha held for it must not touch the next one. */
 private static void aLostSessionLeavesNothingToTheNext(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED),other=bridge(context,Lifecycle.State.RESUMED);
  tap(owner);
  int lost=committed(context);
  stop(owner);
  confirmation(context,lost);
  installer.sessions.remove((Integer)lost);
  tap(other);
  int next=committed(context);
  check(next!=lost&&installer.abandoned.isEmpty(),"the next tap installs");
  installer.sendConfirmation(next);
  resume(other);
  check(other.activity.started.isEmpty(),"the kept confirmation does not open for the next session");
  settled();
  tap(other);
  check(other.activity.started.isEmpty()&&installer.committed.equals(List.of(lost,next)),"and no tap finds it");
  Intent confirm=confirmation(context,next);
  check(other.activity.started.equals(List.of(confirm)),"only Android's own request for that session opens");
  context=installing(cache);
  installer=context.packages.installer;
  owner=bridge(context,Lifecycle.State.RESUMED);other=bridge(context,Lifecycle.State.RESUMED);
  tap(owner);
  lost=committed(context);
  confirmation(context,lost);
  stop(owner);
  installer.sessions.remove((Integer)lost);
  tap(other);
  confirm=confirmation(context,committed(context));
  check(other.activity.started.equals(List.of(confirm)),"a confirmation left open on a lost session holds nothing up");
  context=installing(cache);
  installer=context.packages.installer;
  owner=bridge(context,Lifecycle.State.RESUMED);
  tap(owner);
  lost=committed(context);
  confirmation(context,lost);
  int left=installer.createSession(null);
  installer.internals.get(left).sealed=true;installer.validate(left);installer.sendConfirmation(left);
  installer.sessions.remove((Integer)lost);
  dismissed(owner);
  tap(owner);
  check(installer.committed.equals(List.of(lost,left))&&owner.activity.started.size()==1,"another session still listed is asked for itself");
 }
 private static void aSecondRequestNeverOpensOverTheFirst(File cache)throws Exception{
  Context context=installing(cache);
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED);
  tap(owner);
  int pending=committed(context);
  Intent first=confirmation(context,pending);
  Intent second=confirmation(context,pending);
  check(owner.activity.started.equals(List.of(first)),"a request arriving while one is open waits");
  stop(owner);resume(owner);
  check(owner.activity.started.equals(List.of(first,second)),"and opens once its owner is back");
 }
 private static void aKeptConfirmationNeverOpensOnWhatAndroidIsPast(File cache)throws Exception{
  for(int sdk=29;sdk<=37;sdk++){
   Context context=installing(cache);
   PackageInstaller installer=context.packages.installer;
   installer.sdk=sdk;
   AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED);
   tap(owner);
   int pending=committed(context);
   stop(owner);
   confirmation(context,pending);
   installer.accept(pending);
   installer.install(pending);
   if(sdk<34)installer.prepare(pending);
   resume(owner);
   check(owner.activity.started.isEmpty(),"a kept confirmation stays shut on an accepted session: sdk "+sdk);
   installer.prepare(pending);
   settled();
   check(tap(owner).resolved.get()==1&&owner.activity.started.isEmpty()&&installer.committed.equals(List.of(pending)),"and a tap does not reach it: sdk "+sdk);
  }
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED);
  tap(owner);
  int gone=committed(context);
  stop(owner);
  confirmation(context,gone);
  // Android forgot the session and its status never came.
  installer.sessions.remove((Integer)gone);
  resume(owner);
  check(owner.activity.started.isEmpty(),"nor on a session Android no longer lists");
  check(tap(owner).resolved.get()==1&&installer.committed.size()==2&&committed(context)!=gone,"and the next tap installs");
 }
 private static void anAndroidThatCannotAnswerStillOpensAKeptConfirmation(File cache)throws Exception{
  Context context=installing(cache);
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED);
  tap(owner);
  int pending=committed(context);
  stop(owner);
  Intent confirm=confirmation(context,pending);
  context.packages.installer.infoDown=true;
  resume(owner);
  check(owner.activity.started.equals(List.of(confirm)),"resuming never fails on a read of the session");
 }
 /** Android 17 asks about a developer-verification result on an accepted, active session, and its dismissal sends no status. */
 private static void aDeveloperVerificationRequestStaysAnswerable(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED);
  tap(owner);
  int pending=committed(context);
  Intent install=confirmation(context,pending);
  stop(owner);
  installer.accept(pending);
  installer.install(pending);
  Intent kept=verificationRequest(context,pending);
  resume(owner);
  check(installer.getSessionInfo(pending).isActive()&&owner.activity.started.equals(List.of(install,kept)),"it opens though the session is active");
  dismissed(owner);
  check(tap(owner).resolved.get()==1&&owner.activity.started.equals(List.of(install,kept,kept))&&installer.committed.equals(List.of(pending)),"a tap opens it again, committing nothing");
  dismissed(owner);
  installer.prepare(pending);
  check(tap(owner).resolved.get()==1&&owner.activity.started.size()==3,"and once it is answered and the install runs, a tap does nothing");
 }
 /** Named in docs/android-and-aosp.md: Android holds a client's reference until a reboot, so this session reads active until then. */
 private static void aProcessKilledBeforeClosingStaysFencedUntilAReboot(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  tap(bridge(context,Lifecycle.State.RESUMED));
  int pending=committed(context);
  installer.sendConfirmation(pending);
  installer.internals.get(pending).active++;
  AlphaDevicePlugin next=restarted(context);
  connections.clear();
  check(tap(next).resolved.get()==1&&connections.isEmpty()&&installer.committed.equals(List.of(pending)),"a tap stays quiet and abandons nothing");
  installer.reboot();
  check(tap(restarted(context)).resolved.get()==1&&installer.committed.equals(List.of(pending,pending)),"a reboot resets the count, and a tap asks");
 }
 private static void anIdleBridgesDestroyLeavesTheOwnersKeptConfirmation(File cache)throws Exception{
  Context context=installing(cache);
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED),idle=bridge(context,Lifecycle.State.RESUMED);
  tap(owner);
  stop(owner);
  Intent confirm=confirmation(context,committed(context));
  idle.handleOnDestroy();
  resume(owner);
  check(owner.activity.started.equals(List.of(confirm)),"another bridge's destroy changes nothing the owner kept");
 }
 private static void aDestroyedOwnerLeavesNoStatusToWaitFor(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED),other=bridge(context,Lifecycle.State.RESUMED);
  tap(owner);
  int pending=committed(context);
  installer.sendConfirmation(pending);
  owner.handleOnDestroy();
  settled();
  check(tap(other).resolved.get()==1&&installer.committed.equals(List.of(pending,pending)),"its receiver is gone, so a tap on a live bridge asks");
  Intent confirm=confirmation(context,pending);
  check(other.activity.started.equals(List.of(confirm))&&owner.activity.started.isEmpty(),"and opens the answer there");
 }
 private static void aRefusedCommitLeavesNoStatusToWaitFor(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  tap(bridge(context,Lifecycle.State.RESUMED));
  int pending=committed(context);
  installer.sendConfirmation(pending);
  AlphaDevicePlugin next=restarted(context);
  installer.committing=()->{installer.committing=()->{};throw new IllegalStateException("Session gone");};
  check(tap(next).rejected.get()==1,"Android refuses the commit");
  settled();
  check(tap(next).resolved.get()==1&&installer.committed.equals(List.of(pending,pending)),"so the same live bridge asks again on its next tap");
 }
 private static void aTapTakenBeforeACommitStaysQuietPastTheWindow(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED),other=bridge(context,Lifecycle.State.RESUMED);
  CountDownLatch release=new CountDownLatch(1),atCommit=holdCommit(installer,release);
  PluginCall running=offered();owner.installUpdate(running);
  check(atCommit.await(20,TimeUnit.SECONDS),"the first attempt reaches commit");
  Held checking=new Held();body=checking;
  PluginCall answer=offered();other.checkForUpdate(answer);
  check(checking.reading.await(20,TimeUnit.SECONDS),"a check holds the other bridge's worker");
  PluginCall queued=offered();other.installUpdate(queued);
  release.countDown();running.awaitAnswer();
  Intent confirm=confirmation(context,committed(context));
  dismissed(owner);
  checking.released.countDown();answer.awaitAnswer();queued.awaitAnswer();body=IN_MEMORY;
  check(other.activity.started.isEmpty()&&owner.activity.started.equals(List.of(confirm))&&installer.committed.size()==1,"the tap it overtook reopens nothing, past the three seconds too");
 }
 private static void aStatusInsideCommitReachesItsOwner(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED);
  Intent[] confirm=new Intent[1];
  installer.committing=()->{installer.committing=()->{};confirm[0]=confirmation(context,installer.sessions.get(0));};
  tap(owner);
  check(owner.activity.started.equals(List.of(confirm[0])),"a status landing while commit runs has its owner");
 }
 private static void aTerminalStatusWithAnIntentDropsAKeptConfirmation(File cache)throws Exception{
  Context context=installing(cache);
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED);
  tap(owner);
  int pending=committed(context);
  stop(owner);
  confirmation(context,pending);
  context.broadcast(new Intent("ai.elizaresearch.alphaphone.UPDATE_STATUS").putExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_FAILURE).putExtra(PackageInstaller.EXTRA_SESSION_ID,pending).putExtra(Intent.EXTRA_INTENT,new Intent("ignored")));
  resume(owner);
  check(owner.activity.started.isEmpty(),"a terminal status ends what was kept, listed or not");
 }
 /** A bridge left as owner after its destroy would hold every live bridge's tap for the rest of the process. */
 private static void aBridgeDestroyedDuringItsListReadTakesNothingOver(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED),live=bridge(context,Lifecycle.State.RESUMED);
  tap(owner);
  int pending=committed(context);
  Intent confirm=confirmation(context,pending);
  dismissed(owner);
  installer.listing=()->{installer.listing=()->{};stop(owner);owner.handleOnDestroy();};
  check(tap(owner).rejected.get()==1,"its tap stops quietly");
  settled();
  check(tap(live).resolved.get()==1&&live.activity.started.equals(List.of(confirm)),"and a live bridge's tap opens what it kept");
  Context restarting=installing(cache);
  PackageInstaller other=restarting.packages.installer;
  tap(bridge(restarting,Lifecycle.State.RESUMED));
  int asked=committed(restarting);
  other.sendConfirmation(asked);
  AlphaDevicePlugin dying=restarted(restarting),stays=bridge(restarting,Lifecycle.State.RESUMED);
  other.listing=()->{other.listing=()->{};stop(dying);dying.handleOnDestroy();};
  check(tap(dying).rejected.get()==1&&other.committed.equals(List.of(asked)),"nothing commits for a receiver that is gone");
  check(tap(stays).resolved.get()==1&&other.committed.equals(List.of(asked,asked)),"so a live bridge's tap asks");
  Intent answer=confirmation(restarting,asked);
  check(stays.activity.started.equals(List.of(answer)),"and hears the answer");
 }
 private static void everyFailureSettlesQuietly(File cache)throws Exception{
  Context binder=installing(cache);
  AlphaDevicePlugin plugin=bridge(binder,Lifecycle.State.RESUMED);
  binder.packages.binderDown=true;
  check(tap(plugin).rejected.get()==1,"a binder failure on the worker still settles the call");
  Context other=new Context(cache);other.packages.archive=archive(other.getPackageName(),9);
  PluginCall refused=tap(bridge(other,Lifecycle.State.RESUMED));
  check(refused.rejected.get()==1&&refused.resolved.get()==0&&other.packages.installer.sessions.isEmpty(),"an archive of another versionCode gets no session");
  Context foreign=new Context(cache);foreign.packages.archive=archive("com.example.other",8);
  check(tap(bridge(foreign,Lifecycle.State.RESUMED)).rejected.get()==1&&foreign.packages.installer.sessions.isEmpty(),"nor an archive of another package");
  Context tampered=installing(cache);
  AlphaDevicePlugin tapped=bridge(tampered,Lifecycle.State.RESUMED);
  served="the offered updatf".getBytes(java.nio.charset.StandardCharsets.UTF_8);
  check(tap(tapped).rejected.get()==1&&tampered.packages.installer.sessions.isEmpty(),"nor a download that does not match its manifest");
  served=APK;
  check(tapped.activity.started.isEmpty(),"a failure opens nothing");
 }
 private static void withoutTheGrantOnlyAndroidsPageOpens(File cache)throws Exception{
  Context context=installing(cache);context.packages.installsAllowed=false;
  AlphaDevicePlugin plugin=bridge(context,Lifecycle.State.RESUMED);
  check(tap(plugin).resolved.get()==1,"the tap settles");
  check(plugin.activity.started.size()==1&&plugin.activity.started.get(0).action.equals("android.settings.MANAGE_UNKNOWN_APP_SOURCES"),"Android's page opens");
  check(context.packages.installer.sessions.isEmpty(),"and nothing is downloaded or staged");
 }
 private static void appSignerIsTheOriginalCertificateOfOneSigner(File cache)throws Exception{
  Signature original=new Signature(new byte[]{1,2,3}),rotated=new Signature(new byte[]{4,5,6});
  Context context=new Context(cache);AlphaDevicePlugin plugin=bridge(context,Lifecycle.State.RESUMED);
  context.packages.installed=new PackageInfo();
  context.packages.installed.signingInfo=new SigningInfo(new Signature[]{original},new Signature[]{original});
  check(sha256(original.toByteArray()).equals(plugin.appSigner(context)),"an install that never rotated reports its certificate");
  context.packages.installed.signingInfo=new SigningInfo(new Signature[]{rotated},new Signature[]{original,rotated});
  check(sha256(original.toByteArray()).equals(plugin.appSigner(context)),"a rotated install reports what it reported before the rotation");
  context.packages.installed.signingInfo=new SigningInfo(new Signature[]{original,rotated},null);
  check(plugin.appSigner(context)==null,"several signers have no one lineage: nothing is reported");
 }
 public static void main(String[] args)throws Exception{
  URL.setURLStreamHandlerFactory(protocol->!"https".equals(protocol)?null:new URLStreamHandler(){@Override protected URLConnection openConnection(URL url){return new Served(url);}});
  File cache=Files.createTempDirectory("alpha-update-flow").toFile();
  int status=1;
  try{
   aStartSweepsTheDownloadOfAKilledProcess(cache);
   oneTapInstallsWhileATapOnAnotherBridgeChangesNothing(cache);
   aTapOnAnotherBridgeLeavesAConfirmationPendingForTheOwner(cache);
   aRepeatTapKeepsAConfirmationHeldForResume(cache);
   aTapQueuedBehindAnAttemptKeepsWhatItStaged(cache);
   aTapQueuedBehindAFailedAttemptRetries(cache);
   aTapAfterSessionAssignedBeforeCommitReturnsKeepsSession(cache);
   aTapQueuedOnAnotherBridgeDuringCommitKeepsSession(cache);
   aTapQueuedBehindACommitThatFailsRetries(cache);
   aPendingSessionFencesATapBeforeAnyDownload(cache);
   theDeadlineEndsATrickleNotADownloadThatFinishesInTime(cache);
   destroyClosesADownloadInFlight(cache);
   destroyingAnotherBridgeLeavesADownloadInFlight(cache);
   destroyAfterTheDownloadChangesNoSession(cache);
   aResumedOwnerOpensItAtOnceAndOnce(cache);
   aStoppedOwnerOpensItOnItsNextResume(cache);
   anotherBridgeNeverOpensIt(cache);
   onlyItsOwnSessionsConfirmationIsKept(cache);
   aLaterTapReopensAnUnansweredConfirmation(cache);
   aTapAfterCommitBeforeAnyStatusChangesNothing(cache);
   aStatusThatNeverArrivesStartsNothingWithoutATap(cache);
   aStatusALiveProcessNeverHearsWaitsForItsEnd(cache);
   aLongValidationDrawsNoSecondCommit(cache);
   aSessionUnderValidationIsLeftAloneWhoeverAsks(cache);
   theThreeSecondsAreThreeSeconds(cache);
   aRestartRebuildsTheFenceFromAndroid(cache);
   aSessionARebootRestoredUncommittedIsCommittedAgain(cache);
   aSessionARebootRestoredCommittedIsGivenUp(cache);
   aStatusLostToADeadProcessFreesTheNextTap(cache);
   aTerminalStatusAllowsANewTap(cache);
   aFailedAskLeavesTheSession(cache);
   aDestroyedOwnersSessionPassesToTheNextTap(cache);
   anUnsealedSessionNeverFences(cache);
   sealedSessionsAreAskedForInTurn(cache);
   androidDestroysAnAcceptedInstallCommittedAgain(cache);
   aTapDuringAnAcceptedInstallLeavesIt(cache);
   aSessionCommittedAgainAfterARestartKeepsItsInstall(cache);
   aTapWhileAConfirmationStartsChangesNothing(cache);
   aConfirmationUpBehindItsOwnerFencesAnotherBridge(cache);
   aStartAndroidDroppedDoesNotFence(cache);
   anEndOfTheSessionForgetsItsConfirmationBeforeAndroidsList(cache);
   aLostSessionLeavesNothingToTheNext(cache);
   aSecondRequestNeverOpensOverTheFirst(cache);
   aKeptConfirmationNeverOpensOnWhatAndroidIsPast(cache);
   anAndroidThatCannotAnswerStillOpensAKeptConfirmation(cache);
   aDeveloperVerificationRequestStaysAnswerable(cache);
   aProcessKilledBeforeClosingStaysFencedUntilAReboot(cache);
   anIdleBridgesDestroyLeavesTheOwnersKeptConfirmation(cache);
   aDestroyedOwnerLeavesNoStatusToWaitFor(cache);
   aRefusedCommitLeavesNoStatusToWaitFor(cache);
   aTapTakenBeforeACommitStaysQuietPastTheWindow(cache);
   aStatusInsideCommitReachesItsOwner(cache);
   aTerminalStatusWithAnIntentDropsAKeptConfirmation(cache);
   aBridgeDestroyedDuringItsListReadTakesNothingOver(cache);
   everyFailureSettlesQuietly(cache);
   withoutTheGrantOnlyAndroidsPageOpens(cache);
   appSignerIsTheOriginalCertificateOfOneSigner(cache);
   System.out.println("PASS update flow");
   status=0;
  }catch(RuntimeException|AssertionError failed){
   failed.printStackTrace();
  }finally{
   for(File left:cache.listFiles())left.delete();
   cache.delete();
  }
  // Each bridge's update worker is a live non-daemon thread; on Android its destroy stops it.
  System.exit(status);
 }
}
