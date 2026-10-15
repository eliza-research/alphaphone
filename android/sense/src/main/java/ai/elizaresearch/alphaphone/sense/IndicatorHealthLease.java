package ai.elizaresearch.alphaphone.sense;

/** Monotonic, process-local additional capture precondition. Never grants consent or starts audio. */
public final class IndicatorHealthLease {
 public static final long MAX_AGE_MS=1500;
 private Object binding;
 private long sequence=-1,deadline;
 private boolean lost;
 /** A different process capability retires every prior renewal. A replacement cannot clear loss. */
 public synchronized void bind(Object token,long now){
  if(token==binding)return;
  if(deadline>0&&now>=deadline)lost=true;
  binding=token;sequence=-1;deadline=0;
 }
 public synchronized boolean renew(Object token,long next,long now,boolean visible){
  if(token==null||token!=binding||next<0||next<=sequence||now<0)return false;
  if(!visible){revoke(token);return false;}
  if(deadline>0&&now>=deadline)lost=true;
  sequence=next;
  deadline=now>Long.MAX_VALUE-MAX_AGE_MS?Long.MAX_VALUE:now+MAX_AGE_MS;
  return !lost;
 }
 public synchronized boolean valid(long now){
  if(deadline>0&&now>=deadline)lost=true;
  return binding!=null&&!lost&&now>=0&&deadline>now;
 }
 /** Death/revocation cannot be undone by replaying renewals or rebinding. */
 public synchronized void revoke(Object token){if(token!=null&&token==binding){binding=null;deadline=0;lost=true;}}
 public synchronized void invalidate(){binding=null;deadline=0;lost=true;}
 /** Only an existing explicit user resume/enable path may clear the loss latch. */
 public synchronized void userRearmed(){lost=false;deadline=0;}
 public synchronized boolean lost(){return lost;}
}
