package ai.elizaresearch.alphaphone;

/** Reproduces duplicate observations while a durable capture awaits its UI clear. */
public final class WorkflowNoticeIntentDedupTest {
 private static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 public static void main(String[] args){
  WorkflowNoticeIntentDedup<Object> pending=new WorkflowNoticeIntentDedup<>();
  Object first=new String("equal intent"),next=new String("equal intent");
  check(pending.retain(first,"route-a"),"First tap queued");
  check(!pending.retain(first,"route-a"),"load and renderer polling cannot queue the same Intent twice");
  // Storage succeeded, but its main-thread clearing callback has not run yet.
  check(!pending.retain(first,"route-a"),"No second capture before asynchronous Intent clear");
  check(pending.retain(next,"route-a"),"A genuinely new Intent with the same token is a new tap");
  pending.release(first,"route-a");
  check(!pending.retain(next,"route-a"),"Clearing one Intent cannot release another");
  pending.release(next,"route-a");
  check(pending.retain(next,"route-a"),"Executor rejection release permits explicit retry");
  check(!pending.retain(next,"route-a"),"Storage failure retains the in-flight identity for drain retry");
  check(pending.retain(next,"route-b"),"A changed route on an Intent is distinct");
  pending.release(next,"route-a");
  check(!pending.retain(next,"route-b"),"An old clear cannot release a newer route");
  check(new WorkflowNoticeIntentDedup<>().retain(next,"route-b"),"New process/plugin can recover a retained Intent");
  WorkflowNoticeIntentDedup<Object> bounded=new WorkflowNoticeIntentDedup<>();Object slot=null;
  for(int i=0;i<512;i++){slot=new Object();check(bounded.retain(slot,"route"),"Within bound");}
  Object overflow=new Object();check(!bounded.retain(overflow,"route"),"Pending Intent retention is bounded");
  bounded.release(slot,"route");check(bounded.retain(overflow,"route"),"Clearing frees capacity for retry");
  System.out.println("PASS workflow Intent identity dedup, new taps, retries and bounds");
 }
}
