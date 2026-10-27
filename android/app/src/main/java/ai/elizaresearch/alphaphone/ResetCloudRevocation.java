package ai.elizaresearch.alphaphone;

/** Best-effort key revocation bounded independently of network and credential-store latency. Runs as
 * the shared reset coordinator's before-dispatch step (AlphaDataReset), only for a durable reset. */
final class ResetCloudRevocation {
 private ResetCloudRevocation(){}
 static void revoke(android.content.Context context,long timeoutMs){
  if(timeoutMs<=0||!AlphaDataReset.pending(context))return;
  final long deadline=System.nanoTime()+Math.min(timeoutMs,8000)*1_000_000L;
  Thread worker=new Thread(()->{
   for(String environment:CloudKeyRevocation.environments(BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS)){
    if(Thread.currentThread().isInterrupted()||System.nanoTime()>=deadline)return;
    try{
     String saved=AlphaCredentialStore.readSlotBeforeAttach(context,"cloud:"+environment);
     if(saved!=null&&System.nanoTime()<deadline)CloudKeyRevocation.revoke(environment,new org.json.JSONObject(saved).optString("token",null),BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
    }catch(Exception unavailable){/* Local reset must still proceed. */}
   }
  },"alpha-reset-key-revocation");
  worker.setDaemon(true);worker.start();
  try{long remaining=deadline-System.nanoTime();if(remaining>0)worker.join(Math.max(1,remaining/1_000_000L));}
  catch(InterruptedException interrupted){Thread.currentThread().interrupt();}
  finally{worker.interrupt();}
 }
}
