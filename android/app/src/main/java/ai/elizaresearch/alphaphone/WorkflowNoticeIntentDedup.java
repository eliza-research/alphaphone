package ai.elizaresearch.alphaphone;

import java.util.IdentityHashMap;
import java.util.Objects;

/** Retain each actual Intent until durable capture and main-thread clearing finish.
 * A distinct OS Intent remains a distinct tap even when its route token is the same. */
final class WorkflowNoticeIntentDedup<T> {
 private final IdentityHashMap<T,String> retained=new IdentityHashMap<>();
 synchronized boolean retain(T intent,String token){
  if(Objects.equals(retained.get(intent),token))return false;
  if(!retained.containsKey(intent)&&retained.size()>=512)return false;
  retained.put(intent,token);return true;
 }
 synchronized void release(T intent,String token){
  if(Objects.equals(retained.get(intent),token))retained.remove(intent);
 }
}
