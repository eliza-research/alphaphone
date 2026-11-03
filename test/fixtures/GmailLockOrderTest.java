package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.notifications.MailBackgroundDelivery;
import ai.eliza.plugins.notifications.MailHistoryReconciliation;
import ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.management.ManagementFactory;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.HashSet;
import java.util.Queue;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;

/** The real MailBackgroundDelivery over the shipped Gmail Host, slot branch, lock order and plugin lifecycle
 * methods, which credential-slot-lock-order.test.mjs splices in. Host-JVM evidence, not device evidence. */
public class GmailLockOrderTest {
 static final long BOUND_NANOS=20_000_000_000L;
 static final String USER="11111111-1111-4111-8111-111111111111",ORG="22222222-2222-4222-8222-222222222222";
 interface Task {void run()throws Exception;}
 static void check(boolean b,String why){if(!b)throw new AssertionError(why);}
 static final class Worker {
  final Thread thread;final AtomicReference<Throwable> failure=new AtomicReference<>();
  Worker(String name,Task task){thread=new Thread(()->{try{task.run();}catch(Throwable error){failure.set(error);}},name);thread.setDaemon(true);}
  Worker start(){thread.start();return this;}
  void finished()throws Exception{
   thread.join(BOUND_NANOS/1_000_000);check(!thread.isAlive(),thread.getName()+" finished");
   if(failure.get()!=null)throw new AssertionError(thread.getName(),failure.get());
  }
 }
 static final class Scheduler implements MailBackgroundDelivery.Scheduler {
  final AtomicInteger schedules=new AtomicInteger();volatile int cancels;
  public void schedule(String generation){schedules.incrementAndGet();}public void cancel(){cancels++;}
 }
 static final class Poster implements MailBackgroundDelivery.Notices {
  final Set<String> active=new HashSet<>();int posts;
  public boolean allowed(){return true;}public boolean active(String key){return active.contains(key);}
  public void post(String key){posts++;active.add(key);}public void cancel(String key){active.remove(key);}public void cancelAll(){active.clear();}
 }
 static final class Transport implements MailBackgroundDelivery.Connections {
  final Queue<JSONObject> pages=new ArrayDeque<>();volatile Runnable onHistory=()->{};
  public HttpURLConnection open(URL url){
   return new HttpURLConnection(url){
    public void connect(){}public void disconnect(){}public boolean usingProxy(){return false;}
    public int getResponseCode(){return 200;}
    public InputStream getInputStream()throws IOException{
     try{
      Object value;
      if(url.getPath().endsWith("history")){onHistory.run();value=pages.remove();}
      else if(url.getPath().endsWith("user"))value=new JSONObject().put("success",true).put("data",new JSONObject().put("id",USER).put("organization_id",ORG));
      else value=new JSONArray().put(new JSONObject().put("connectionId","grant").put("connected",true).put("grantedCapabilities",new JSONArray().put("google.gmail.triage")));
      return new ByteArrayInputStream(value.toString().getBytes(StandardCharsets.UTF_8));
     }catch(Exception e){throw new IOException(e);}
    }
   };
  }
 }
 static JSONObject baseline(String current)throws Exception{return new JSONObject().put("version",1).put("grantId","grant").put("status","baseline-required").put("startHistoryId",JSONObject.NULL).put("historyId",current).put("checkpoint",JSONObject.NULL).put("nextPageToken",JSONObject.NULL).put("events",new JSONArray()).put("backfillRequired",true);}
 static JSONObject newMail(String start,String revision)throws Exception{
  JSONObject event=new JSONObject().put("id",revision+":message-added:mail").put("historyId",revision).put("type","message-added").put("messageId","mail").put("threadId","thread").put("labelIds",new JSONArray().put("INBOX").put("UNREAD")).put("messageAvailable",true);
  return new JSONObject().put("version",1).put("grantId","grant").put("status","page").put("startHistoryId",start).put("historyId",revision).put("checkpoint",revision).put("nextPageToken",JSONObject.NULL).put("events",new JSONArray().put(event)).put("backfillRequired",false);
 }
 static final class Case {
  final AtomicInteger guards=new AtomicInteger();volatile boolean guardHeldLifecycle;
  final AlphaCredentialStore store=new AlphaCredentialStore(()->{check(Thread.holdsLock(JsonCredentialSlots.LOCK),"guard runs under the vault");guardHeldLifecycle=Thread.holdsLock(AlphaLocalAgentPlugin.lifecycleLock);guards.incrementAndGet();});
  final Scheduler scheduler=new Scheduler();final Poster poster=new Poster();final Transport transport=new Transport();
  final MailBackgroundDelivery delivery=new MailBackgroundDelivery(GmailBinding.host(store,this),scheduler,poster,new MailBackgroundDelivery.Config("https://cloud.example","production","google.gmail.triage",4),transport);
  final String generation;
  Case()throws Exception{
   store.slots.write(CloudDeployment.storageSlot("cloud:production"),new JSONObject().put("credentialId","credential").put("token","fixture").toString());
   delivery.configure(delivery.begin(),"credential","grant",USER,ORG);
   generation=saved().getJSONObject("binding").getString("generation");
  }
  JSONObject saved()throws Exception{return new JSONObject(store.readCredentialSlot(GmailBinding.SLOT));}
  String slot()throws Exception{return store.readCredentialSlot(GmailBinding.SLOT);}
 }
 /** Stays blocked on a monitor, rather than finishing, while a holder keeps the lock. Never an unbounded wait. */
 static boolean stuck(Thread thread)throws Exception{
  int blocked=0;
  for(long end=System.nanoTime()+BOUND_NANOS/4;thread.isAlive()&&System.nanoTime()<end;Thread.sleep(2)){blocked=thread.getState()==Thread.State.BLOCKED?blocked+1:0;if(blocked>50)return true;}
  return thread.isAlive();
 }
 /** Reports the old order's deadlock and ends the JVM, whose stuck threads keep both locks forever. */
 static void noDeadlock(Worker... workers)throws Exception{
  for(long end=System.nanoTime()+BOUND_NANOS;System.nanoTime()<end;Thread.sleep(2)){
   long[] cycle=ManagementFactory.getThreadMXBean().findMonitorDeadlockedThreads();
   if(cycle!=null){System.out.println("DEADLOCKED "+cycle.length+" threads");System.out.flush();Runtime.getRuntime().halt(0);}
   boolean running=false;for(Worker worker:workers)running|=worker.thread.isAlive();
   if(!running)return;
  }
  throw new AssertionError("Bounded wait expired without a cycle or completion");
 }
 static void untilBlocked(Worker worker)throws Exception{
  for(long end=System.nanoTime()+BOUND_NANOS;worker.thread.getState()!=Thread.State.BLOCKED;Thread.sleep(1))check(worker.thread.isAlive()&&System.nanoTime()<end,worker.thread.getName()+" reaches the vault");
 }
 /** Starts the rival inside the vault hold that fences the next durable page write, as the ANR's sync did. */
 static MailHistoryReconciliation.Guard rivalAtPageCommit(Case c,Worker rival){
  AtomicBoolean armed=new AtomicBoolean();c.transport.onHistory=()->armed.set(true);
  return ()->{if(Thread.holdsLock(JsonCredentialSlots.LOCK)&&armed.getAndSet(false)){rival.start();untilBlocked(rival);}};
 }

 static void writesAndSyncComplete(Case c)throws Exception{
  check(c.store.mutate("notes-draft:v1:device",null,"{}",false)&&"{}".equals(c.store.readCredentialSlot("notes-draft:v1:device")),"credential slot write completes");
  check(c.guardHeldLifecycle,"an ordinary slot write keeps lifecycle before vault");
  int guards=c.guards.get();
  c.transport.pages.add(baseline("100"));check(c.delivery.sync(c.generation,()->{}),"baseline sync completes");
  check(c.saved().getString("historyId").equals("100")&&c.guards.get()>guards,"sync write is durable and its slot guard still runs");
  c.transport.pages.add(newMail("100","112"));check(c.delivery.sync(c.generation,()->{}),"new-mail sync completes");
  check(c.saved().getString("historyId").equals("112")&&c.poster.posts==1,"checkpoint and exactly one notice");
 }
 static void mainThreadNeverWaits(Case c)throws Exception{
  GmailBackground.delivery=c.delivery;
  String key=c.saved().getJSONObject("notices").keys().next();
  GmailLifecycle plugin=new GmailLifecycle();Intent tap=new Intent(key);int before=c.scheduler.schedules.get();
  AtomicInteger seenByPending=new AtomicInteger(-1);
  CountDownLatch held=new CountDownLatch(1),release=new CountDownLatch(1);
  // First-use GmailBackground.get holds its monitor while it enters the vault, so both must stay off main.
  Worker holder=new Worker("vault-holder",()->{synchronized(GmailBackground.class){synchronized(JsonCredentialSlots.LOCK){held.countDown();release.await();}}}).start();
  held.await();
  Worker main=new Worker("main",()->{plugin.load();plugin.handleOnNewIntent(tap);plugin.handleOnResume();plugin.afterListener(()->seenByPending.set(c.scheduler.schedules.get()));}).start();
  if(stuck(main.thread))System.out.println("MAIN-BLOCKED");
  release.countDown();main.finished();holder.finished();plugin.drain();
  check(c.scheduler.schedules.get()==before+2,"load and every return to the foreground still reschedule");
  check(seenByPending.get()==before+2,"the pendingMail read queued by the listener follows this resume");
  check(c.saved().has("tap")&&tap.data==null,"a notice tap is still captured and stripped");
  check(plugin.pendingNotices.get()>=2,"pendingMail still fires for the tap and the resume");
 }
 static void enrollmentReadNeverWaits()throws Exception{
  check(!AlphaLocalAgentPlugin.enrollmentPresent(),"no enrollment");
  AlphaLocalAgentPlugin.enroll("root",null);check(!AlphaLocalAgentPlugin.enrollmentPresent(),"owner token required");
  AlphaLocalAgentPlugin.enroll("root","owner");check(AlphaLocalAgentPlugin.enrollmentPresent(),"both tokens present");
  CountDownLatch held=new CountDownLatch(1),release=new CountDownLatch(1);
  Worker holder=new Worker("lifecycle-holder",()->{synchronized(AlphaLocalAgentPlugin.lifecycleLock){held.countDown();release.await();}}).start();
  held.await();
  Worker main=new Worker("main",()->check(AlphaLocalAgentPlugin.enrollmentPresent(),"enrollment observed")).start();
  if(stuck(main.thread))System.out.println("ENROLLMENT-BLOCKED");
  release.countDown();main.finished();holder.finished();
 }
 /** The ANR: sync holds the vault at its page write while a lifecycle-first slot writer waits for that vault. */
 static void syncCannotDeadlockSlotWriter()throws Exception{
  Case c=new Case();c.transport.pages.add(baseline("100"));
  Worker writer=new Worker("hosted-inbox",()->check(c.store.mutate("hosted-digests:v1:device",null,"{}",false),"rival write"));
  MailHistoryReconciliation.Guard stop=rivalAtPageCommit(c,writer);
  Worker mail=new Worker("gmail-worker",()->check(c.delivery.sync(c.generation,stop),"sync complete")).start();
  noDeadlock(mail,writer);mail.finished();writer.finished();
  check(c.saved().getString("historyId").equals("100")&&"{}".equals(c.store.readCredentialSlot("hosted-digests:v1:device")),"both writes landed");
 }
 /** Read-then-write through the vault-held path and the lifecycle-first path loses no update on one slot. */
 static void bothPathsStayAtomic()throws Exception{
  Case c=new Case();int rounds=400;c.store.mutate("counter",null,"0",false);
  Task increment=()->{String seen=c.store.readCredentialSlot("counter");for(;!c.store.mutate("counter",seen,String.valueOf(Integer.parseInt(seen)+1),true);)seen=c.store.readCredentialSlot("counter");};
  Worker held=new Worker("vault-first",()->{for(int i=0;i<rounds;i++)synchronized(JsonCredentialSlots.LOCK){increment.run();}}).start();
  Worker ordinary=new Worker("lifecycle-first",()->{for(int i=0;i<rounds;i++)increment.run();}).start();
  noDeadlock(held,ordinary);held.finished();ordinary.finished();
  check(String.valueOf(rounds*2).equals(c.store.readCredentialSlot("counter")),"no lost update");
 }
 /** A withdraw that lost the race to the vault still wins: the sync cannot bring the selection back. */
 static void withdrawCannotBeResurrected()throws Exception{
  Case c=new Case();c.transport.pages.add(baseline("100"));
  Worker withdraw=new Worker("withdraw",()->c.delivery.withdraw(null));
  MailHistoryReconciliation.Guard stop=rivalAtPageCommit(c,withdraw);
  Worker mail=new Worker("gmail-worker",()->c.delivery.sync(c.generation,stop)).start();
  noDeadlock(mail,withdraw);withdraw.finished();
  check(mail.failure.get()==null||mail.failure.get() instanceof SecurityException,"a superseded sync only stops");
  check(c.slot()==null&&c.scheduler.cancels>0,"selection and schedule stay retired");
 }
 /** A Cloud key commit retires mail inside lifecycle then vault: the reentrant path is unchanged. */
 static void credentialCommitStillWithdraws()throws Exception{
  Case c=new Case();
  synchronized(AlphaLocalAgentPlugin.lifecycleLock){synchronized(JsonCredentialSlots.LOCK){c.delivery.withdraw(null);}}
  check(c.slot()==null&&c.guardHeldLifecycle,"commit-time withdraw keeps both locks");
 }
 public static void main(String[] args)throws Exception{
  Case c=new Case();
  writesAndSyncComplete(c);
  mainThreadNeverWaits(c);
  enrollmentReadNeverWaits();
  syncCannotDeadlockSlotWriter();
  bothPathsStayAtomic();
  withdrawCannotBeResurrected();
  credentialCommitStillWithdraws();
  System.out.println("PASS Gmail writes stay vault-only, slot writers keep lifecycle first, main never waits");
 }
}
