package ai.elizaresearch.alphaphone;
import org.json.*;
import java.util.concurrent.atomic.AtomicInteger;
public final class DeferredDeletionJournalTest {
 static final class Store implements DeferredDeletionJournal.Store{String saved;boolean fail;public String read(){return saved;}public void save(String value){if(fail)throw new IllegalStateException("disk unavailable");saved=value;}}
 static JSONObject object(String value)throws Exception{return new JSONObject().put("id",value);}
 static void check(boolean value){if(!value)throw new AssertionError();}
 public static void main(String[] args)throws Exception{
  Store store=new Store();JSONObject owner=object("owner"),target=object("exact-event-revision");DeferredDeletionJournal j=new DeferredDeletionJournal(store);
  j.stage("undo",owner,target,new DeletionDeadline("boot",100,1000));j=new DeferredDeletionJournal(store);
  check(j.undo("undo",owner,"boot",9999).getString("phase").equals("undone"));AtomicInteger effects=new AtomicInteger();
  j.expire("undo","boot",20000,(a,b)->null,t->{effects.incrementAndGet();return object("bad");});check(effects.get()==0);
  j.stage("expiry",owner,target,new DeletionDeadline("boot",100,1000));
  j.expire("expiry","other-boot",999999,(a,b)->null,t->{effects.incrementAndGet();return object("bad");});check(effects.get()==0);
  j.expire("expiry","boot",10100,(a,b)->"owner-changed",t->{effects.incrementAndGet();return object("bad");});check(effects.get()==0);
  check(j.expire("expiry","boot",50000,(a,b)->null,t->{effects.incrementAndGet();return object("bad");}).getString("phase").equals("paused"));check(effects.get()==0);
  check(j.undo("expiry",owner,"boot",50000).getString("phase").equals("undone"));
  j.stage("write",owner,target,new DeletionDeadline("boot",100,1000));
  store.fail=true;try{j.expire("write","boot",10100,(a,b)->null,t->{effects.incrementAndGet();return object("bad");});throw new AssertionError();}catch(IllegalStateException expected){}check(effects.get()==0);store.fail=false;
  try{j.expire("write","boot",10100,(a,b)->null,t->{effects.incrementAndGet();store.fail=true;return new JSONObject().put("status","deleted");});throw new AssertionError();}catch(IllegalStateException expected){}store.fail=false;
  check(effects.get()==1);j=new DeferredDeletionJournal(store);
  j.expire("write","boot",50000,(a,b)->null,t->{effects.incrementAndGet();return new JSONObject().put("status","deleted");});check(effects.get()==1);
  boolean unknown=false;JSONArray all=j.list("boot",50000);for(int i=0;i<all.length();i++)unknown|=all.getJSONObject(i).getString("id").equals("write")&&all.getJSONObject(i).getString("phase").equals("unknown");check(unknown);
  j.stage("reboot",owner,target,new DeletionDeadline("boot",100,1000));check(j.undo("reboot",owner,"new-boot",1).getString("phase").equals("undone"));
  j.stage("foreign",owner,target,new DeletionDeadline("boot",100,1000));try{j.undo("foreign",object("other"),"boot",101);throw new AssertionError();}catch(SecurityException expected){}
  check(j.expire("foreign","boot",10100,(a,b)->null,t->{effects.incrementAndGet();throw new IllegalStateException("unknown transport");}).getString("phase").equals("unknown"));
  j.expire("foreign","boot",50100,(a,b)->null,t->{effects.incrementAndGet();return object("bad");});check(effects.get()==2);
  j.acknowledge("calendar","foreign");check(j.acknowledged("calendar","foreign"));check(!j.acknowledged("reminder","foreign"));
  j=new DeferredDeletionJournal(store);check(j.acknowledged("calendar","foreign"));
  j.expire("foreign","boot",60100,(a,b)->null,t->{effects.incrementAndGet();return object("bad");});check(effects.get()==2);
  JSONArray acknowledged=j.list("boot",60100);boolean receiptRetained=false;for(int i=0;i<acknowledged.length();i++){JSONObject row=acknowledged.getJSONObject(i);if(row.getString("id").equals("foreign")){check(row.getString("phase").equals("unknown"));receiptRetained=true;}}check(receiptRetained);
  for(int n=0;n<20;n++){
   Store raceStore=new Store();DeferredDeletionJournal race=new DeferredDeletionJournal(raceStore);race.stage("race",owner,target,new DeletionDeadline("boot",100,1000));
   java.util.concurrent.CountDownLatch start=new java.util.concurrent.CountDownLatch(1);AtomicInteger writes=new AtomicInteger();java.util.concurrent.atomic.AtomicReference<Throwable> failure=new java.util.concurrent.atomic.AtomicReference<>();
   AtomicInteger lateUndo=new AtomicInteger();
   Thread undo=new Thread(()->{try{start.await();race.undo("race",owner,"boot",10099);}catch(IllegalStateException late){lateUndo.incrementAndGet();}catch(Throwable e){failure.set(e);}});
   Thread expiry=new Thread(()->{try{start.await();race.expire("race","boot",10100,(a,b)->null,t->{writes.incrementAndGet();return new JSONObject().put("status","deleted");});}catch(Throwable e){failure.set(e);}});
   undo.start();expiry.start();start.countDown();undo.join();expiry.join();if(failure.get()!=null)throw new AssertionError(failure.get());
   String phase=race.list("boot",20000).getJSONObject(0).getString("phase");check(phase.equals("undone")?writes.get()==0&&lateUndo.get()==0:phase.equals("deleted")&&writes.get()==1&&lateUndo.get()==1);
  }
  // An Undo that arrives after expiry dispatched is refused, never reported as a kept item.
  Store lateStore=new Store();DeferredDeletionJournal late=new DeferredDeletionJournal(lateStore);late.stage("late",owner,target,new DeletionDeadline("boot",100,1000));
  check(late.expire("late","boot",10100,(a,b)->null,t->new JSONObject().put("status","deleted")).getString("phase").equals("deleted"));
  try{late.undo("late",owner,"boot",10099);throw new AssertionError("late undo reported success");}catch(IllegalStateException expected){}
  late.stage("conflict",owner,target,new DeletionDeadline("boot",100,1000));late.expire("conflict","boot",10100,(a,b)->null,t->new JSONObject().put("status","conflict"));
  try{late.undo("conflict",owner,"boot",10099);throw new AssertionError("conflict undo reported success");}catch(IllegalStateException expected){}
  late.stage("twice",owner,target,new DeletionDeadline("boot",100,1000));check(late.undo("twice",owner,"boot",200).getString("phase").equals("undone"));check(late.undo("twice",owner,"boot",200).getString("phase").equals("undone"));
  check(DeferredDeletionJournal.requireUndone(new JSONObject().put("phase","undone")).getString("phase").equals("undone"));
  for(String settled:new String[]{"deleted","conflict","dispatching","unknown","queued"})try{DeferredDeletionJournal.requireUndone(new JSONObject().put("phase",settled));throw new AssertionError(settled);}catch(IllegalStateException expected){}
  Store retained=new Store();DeferredDeletionJournal bounded=new DeferredDeletionJournal(retained);
  bounded.stage("uncertain",owner,target,new DeletionDeadline("boot",1,1));bounded.expire("uncertain","boot",10001,(a,b)->null,t->{throw new IllegalStateException("lost response");});
  for(int n=0;n<600;n++){String id="terminal_"+n;bounded.stage(id,owner,target,new DeletionDeadline("boot",n+10,n+10));bounded.undo(id,owner,"boot",n+11);}
  JSONArray history=bounded.list("boot",100000);check(history.length()<=129);boolean kept=false;for(int i=0;i<history.length();i++)kept|=history.getJSONObject(i).getString("id").equals("uncertain");check(kept);
  Store largeStore=new Store();DeferredDeletionJournal large=new DeferredDeletionJournal(largeStore);JSONObject largeTarget=object("large").put("description","x".repeat(256*1024));
  large.stage("keep_unknown",owner,target,new DeletionDeadline("boot",1,1));large.expire("keep_unknown","boot",10001,(a,b)->null,t->{throw new IllegalStateException("lost response");});
  for(int n=0;n<20;n++){String id="large_"+n;large.stage(id,owner,largeTarget,new DeletionDeadline("boot",n+10,n+10));large.undo(id,owner,"boot",n+11);check(largeStore.saved.getBytes(java.nio.charset.StandardCharsets.UTF_8).length<=3*1024*1024);}
  JSONArray largeRows=large.list("boot",99999);boolean retainedUnknown=false;for(int n=0;n<largeRows.length();n++)retainedUnknown|=largeRows.getJSONObject(n).getString("id").equals("keep_unknown");check(retainedUnknown);check(largeRows.length()<20);
  System.out.println("PASS durable deletion claims, recovery and no replay");
 }
}
