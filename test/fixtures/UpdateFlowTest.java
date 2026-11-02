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
import java.io.InputStream;
import java.math.BigInteger;
import java.net.URL;
import java.net.URLConnection;
import java.net.URLStreamHandler;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.security.cert.Certificate;
import java.util.List;
import javax.net.ssl.HttpsURLConnection;

/**
 * Host-JVM run of AlphaDevicePlugin's update members, compiled from the plugin source by
 * test/app-update.test.mjs against the stubs in test/fixtures/app-update-jvm: one Context is one process whose
 * bridges all hear each broadcast, and the HTTPS download is served in memory. Not Android, PackageInstaller
 * or network evidence: the stubs state what Android does, they do not prove it.
 */
public final class UpdateFlowTest {
 private static final byte[] APK="the offered update".getBytes(java.nio.charset.StandardCharsets.UTF_8);
 private static byte[] served=APK;
 private static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 private static String sha256(byte[] bytes)throws Exception{return String.format("%064x",new BigInteger(1,MessageDigest.getInstance("SHA-256").digest(bytes)));}
 private static final class Served extends HttpsURLConnection {
  Served(URL url){super(url);}
  @Override public int getResponseCode(){return 200;}
  @Override public InputStream getInputStream(){return new ByteArrayInputStream(served);}
  @Override public void connect(){}
  @Override public void disconnect(){}
  @Override public boolean usingProxy(){return false;}
  @Override public String getCipherSuite(){return "";}
  @Override public Certificate[] getLocalCertificates(){return new Certificate[0];}
  @Override public Certificate[] getServerCertificates(){return new Certificate[0];}
 }
 private static AlphaDevicePlugin bridge(Context context,Lifecycle.State state){
  AlphaDevicePlugin plugin=new AlphaDevicePlugin();
  plugin.context=context;plugin.activity=new Activity();plugin.activity.state=state;plugin.load();
  return plugin;
 }
 private static PackageInfo archive(String packageName,long versionCode){PackageInfo info=new PackageInfo();info.packageName=packageName;info.versionCode=versionCode;return info;}
 /** The owner's tap on the offered build, settled, with its download gone: the worker deletes it just after settling. */
 private static PluginCall tap(AlphaDevicePlugin plugin)throws Exception{
  PluginCall call=new PluginCall(new JSObject().put("apkUrl","https://updates.test/alpha-8.apk").put("sha256",sha256(APK)).put("sizeBytes",(long)APK.length).put("versionCode",8L));
  plugin.installUpdate(call);call.awaitAnswer();
  File download=new File(plugin.getContext().getCacheDir(),"alpha-update.apk");
  for(int wait=0;download.exists()&&wait<500;wait++)Thread.sleep(10);
  check(!download.exists(),"no tap leaves its download in the cache");
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

 private static void firstLoadSweepsTheDownloadOfAKilledProcess(File cache)throws Exception{
  File download=new File(cache,"alpha-update.apk");
  Files.write(download.toPath(),APK);
  Context context=new Context(cache);
  bridge(context,Lifecycle.State.RESUMED);
  check(!download.exists(),"the first bridge deletes what a killed process left");
  Files.write(download.toPath(),APK);
  bridge(context,Lifecycle.State.CREATED);
  check(download.exists(),"a later bridge never deletes a download in flight");
  download.delete();
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
   firstLoadSweepsTheDownloadOfAKilledProcess(cache);
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
  }catch(AssertionError failed){
   failed.printStackTrace();
  }finally{
   for(File left:cache.listFiles())left.delete();
   cache.delete();
  }
  // Each bridge's update worker is a live non-daemon thread; on Android its destroy stops it.
  System.exit(status);
 }
}
