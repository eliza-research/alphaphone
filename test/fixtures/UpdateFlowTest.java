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
 * shortened to three seconds. Not Android, PackageInstaller or network evidence: the stubs state what Android does,
 * they do not prove it.
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
  if(session!=null)status.putExtra(PackageInstaller.EXTRA_SESSION_ID,session);
  context.broadcast(status);
  return confirm;
 }
 private static void resume(AlphaDevicePlugin plugin){plugin.activity.state=Lifecycle.State.RESUMED;plugin.handleOnResume();}
 private static void stop(AlphaDevicePlugin plugin){plugin.activity.state=Lifecycle.State.CREATED;}
 private static Context installing(File cache){Context context=new Context(cache);context.packages.archive=archive(context.getPackageName(),8);return context;}

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
  int firstSession=committed(context);
  check(tap(second).resolved.get()==1&&installer.committed.size()==2,"a tap after it finished runs");
  check(installer.abandoned.isEmpty()&&installer.sessions.equals(List.of(firstSession,committed(context))),"and leaves the first bridge's session");
 }
 private static void aTapOnAnotherBridgeLeavesAConfirmationPendingForTheOwner(File cache)throws Exception{
  Context context=installing(cache);
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED),other=bridge(context,Lifecycle.State.RESUMED);
  tap(owner);
  int pending=committed(context);
  stop(owner);
  Intent confirm=confirmation(context,pending);
  tap(other);
  check(context.packages.installer.abandoned.isEmpty()&&context.packages.installer.sessions.contains(pending),"the owner's session stays");
  Intent theirs=confirmation(context,committed(context));
  check(other.activity.started.equals(List.of(theirs)),"the other bridge opens only its own");
  resume(owner);resume(owner);
  check(owner.activity.started.equals(List.of(confirm)),"the owner's kept confirmation still opens, once");
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
  checking.released.countDown();answer.awaitAnswer();repeat.awaitAnswer();body=IN_MEMORY;
  check(repeat.resolved.get()==1&&repeat.rejected.get()==0,"the repeat tap settles without a failure");
  check(connections.isEmpty()&&context.packages.installer.abandoned.isEmpty()&&context.packages.installer.committed.size()==1,"it neither downloads nor cancels anything");
  resume(owner);resume(owner);
  check(owner.activity.started.equals(List.of(confirm)),"the kept confirmation opens once");
  tap(owner);
  check(context.packages.installer.abandoned.equals(List.of(pending)),"once it has been shown, a later tap replaces that session");
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
  check(tap(owner).resolved.get()==1&&installer.abandoned.equals(List.of(staged)),"and a later tap still replaces it");
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
  check(tap(owner).resolved.get()==1&&installer.abandoned.equals(List.of(staged))&&installer.committed.size()==2,"and a later tap, once that confirmation has opened, still replaces it");
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
  checking.released.countDown();answer.awaitAnswer();queued.awaitAnswer();body=IN_MEMORY;
  check(queued.resolved.get()==1&&queued.rejected.get()==0&&installer.committed.size()==1,"a tap taken before the commit returned stages nothing on any bridge: committed="+installer.committed);
  check(tap(other).resolved.get()==1&&installer.committed.size()==2&&installer.abandoned.isEmpty(),"and a later tap there runs, leaving the first bridge's session");
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
 private static void aTapRefusedBeforeAdmissionLeavesTheEarlierSessionAndALaterTapWorks(File cache)throws Exception{
  Context context=installing(cache);
  PackageInstaller installer=context.packages.installer;
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED);
  tap(owner);
  int earlier=committed(context);
  served="the offered updatf".getBytes(java.nio.charset.StandardCharsets.UTF_8);
  check(tap(owner).rejected.get()==1,"the download does not match");
  served=APK;
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
  tap(owner);
  int earlier=committed(context);
  context.packages.archiveRead=owner::handleOnDestroy;
  check(tap(owner).rejected.get()==1,"destroyed while the archive is read");
  check(installer.abandoned.isEmpty()&&installer.sessions.equals(List.of(earlier)),"the earlier session stays and no new one opens");
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
 private static void aLaterTapReplacesAnUnansweredSession(File cache)throws Exception{
  Context context=installing(cache);
  AlphaDevicePlugin owner=bridge(context,Lifecycle.State.RESUMED);
  tap(owner);
  int first=committed(context);
  tap(owner);
  int second=committed(context);
  check(context.packages.installer.abandoned.equals(List.of(first))&&context.packages.installer.sessions.equals(List.of(second)),"each tap starts clean");
  confirmation(context,first);
  check(owner.activity.started.isEmpty(),"the replaced session's confirmation is dropped");
  Intent confirm=confirmation(context,second);
  check(owner.activity.started.equals(List.of(confirm)),"the fresh session's is opened");
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
   aTapRefusedBeforeAdmissionLeavesTheEarlierSessionAndALaterTapWorks(cache);
   theDeadlineEndsATrickleNotADownloadThatFinishesInTime(cache);
   destroyClosesADownloadInFlight(cache);
   destroyingAnotherBridgeLeavesADownloadInFlight(cache);
   destroyAfterTheDownloadChangesNoSession(cache);
   aResumedOwnerOpensItAtOnceAndOnce(cache);
   aStoppedOwnerOpensItOnItsNextResume(cache);
   anotherBridgeNeverOpensIt(cache);
   onlyItsOwnSessionsConfirmationIsKept(cache);
   aLaterTapReplacesAnUnansweredSession(cache);
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
