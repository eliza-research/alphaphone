package ai.elizaresearch.alphaphone;
import org.json.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.function.Consumer;
public final class NativeVoiceIpcTest {
 // Successful parsing must tolerate busy CI hosts; the deadline cases below retain 30 ms.
 static final long RESPONSE_TIMEOUT_MS=10000;
 static void check(boolean condition,String why){if(!condition)throw new AssertionError(why);}
 static class Handle implements NativeVoiceIpc.Handle {final CountDownLatch cancelled=new CountDownLatch(1);public void cancel(){cancelled.countDown();}}
 static class Port implements NativeVoiceIpc.Port {
  Handle handle;public NativeVoiceIpc.Handle open(){return handle=new Handle();}
  public void request(JSONObject input,Consumer<String> event,NativeVoiceIpc.Handle handle){
   event.accept("{\"type\":\"response\",\"status\":200}");
   event.accept("{\"type\":\"chunk\",\"dataBase64\":\"e30=\"}");event.accept("{\"type\":\"complete\"}");
  }
 }
 public static void main(String[] args)throws Exception{
  AtomicReference<NativeVoiceIpc.Handle> active=new AtomicReference<>();Port port=new Port();
  JSONObject reply=NativeVoiceIpc.exchange(port,new JSONObject(),active,()->{},RESPONSE_TIMEOUT_MS);
  check(reply.getInt("status")==200&&reply.getString("body").equals("{}"),"reassembles only response chunks");
  check(active.get()==null&&port.handle.cancelled.getCount()==0,"release after completion");
  Port blocked=new Port(){public void request(JSONObject input,Consumer<String> event,NativeVoiceIpc.Handle handle){try{check(((Handle)handle).cancelled.await(2,TimeUnit.SECONDS),"deadline must cancel transport");}catch(InterruptedException error){throw new RuntimeException(error);}}};
  try{NativeVoiceIpc.exchange(blocked,new JSONObject(),active,()->{},30);throw new AssertionError("deadline accepted");}catch(java.io.IOException expected){}
  check(active.get()==null,"deadline releases active slot");
  Port oversized=new Port(){public void request(JSONObject input,Consumer<String> event,NativeVoiceIpc.Handle handle){event.accept("{\"type\":\"chunk\",\"dataBase64\":\""+Base64.getEncoder().encodeToString(new byte[129*1024])+"\"}");}};
  try{NativeVoiceIpc.exchange(oversized,new JSONObject(),active,()->{},RESPONSE_TIMEOUT_MS);throw new AssertionError("oversized accepted");}catch(IllegalStateException expected){}
  check(oversized.handle.cancelled.getCount()==0,"oversize closes socket");
  AtomicInteger dispatches=new AtomicInteger();
  Port counted=new Port(){public void request(JSONObject input,Consumer<String> event,NativeVoiceIpc.Handle handle){dispatches.incrementAndGet();super.request(input,event,handle);}};
  AtomicInteger deadlineChecks=new AtomicInteger();
  try{NativeVoiceIpc.exchange(counted,new JSONObject(),active,()->{if(deadlineChecks.incrementAndGet()==2)check(counted.handle.cancelled.await(2,TimeUnit.SECONDS),"deadline before dispatch");},30);throw new AssertionError("expired dispatch accepted");}catch(java.io.IOException expected){}
  check(dispatches.get()==0,"no IPC dispatch after deadline during admission");
  AtomicInteger checks=new AtomicInteger();
  try{NativeVoiceIpc.exchange(counted,new JSONObject(),active,()->{if(checks.incrementAndGet()>1)throw new SecurityException("re-enrolled");},RESPONSE_TIMEOUT_MS);throw new AssertionError("changed session accepted");}catch(SecurityException expected){}
  check(active.get()==null&&dispatches.get()==0,"changed enrollment releases slot without dispatch or retry");
  System.out.println("PASS native voice IPC: assembly, deadline, response bound, enrollment fencing");
 }
}
