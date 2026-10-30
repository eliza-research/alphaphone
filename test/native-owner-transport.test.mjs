// Executes Alpha's production request/Host methods and shared enrollment. Android and
// HTTP are finite ports; this covers call ownership, not device or provider acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {nativeSource,runJvm,jsonJarSkip,root,upstreamConnection} from './fixtures/jvm-tools.mjs';
function method(source,start){const at=source.indexOf(start);assert.ok(at>=0,start);let depth=0;for(let i=source.indexOf('{',at);i<source.length;i++){if(source[i]==='{')depth++;else if(source[i]==='}'&&--depth===0)return source.slice(at,i+1);}throw Error(start);}
test('shared owner transport preserves actual Alpha pending-call, lifecycle and effect admission',{skip:jsonJarSkip},()=>{
 const source=process.env.ALPHA_NATIVE_OWNER_BASELINE
  ?execFileSync('git',['show',process.env.ALPHA_NATIVE_OWNER_BASELINE+':android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java'],{cwd:root,encoding:'utf8'})
  :readFileSync(nativeSource('AlphaLocalAgentPlugin.java'),'utf8');
 const service=readFileSync(join(process.env.ALPHA_RESIDENT_NATIVE_SOURCE||join(root,'vendor/eliza'), 'packages/app/platforms/android/app/src/main/java/ai/elizaos/app/ElizaAgentService.java'),'utf8');
 const admission=service.slice(service.indexOf('    private static long ownerRequestEpoch;'),service.indexOf('    private static final String CREDENTIAL_SHUTDOWN_EPOCH'));
 assert.ok(admission.includes('observeRequests()'),'candidate service observation is required');
 const methods=['private static JSONObject raw(', 'private NativeOwnerTransport.Host ownerHost(long epoch,PluginCall request)','private void requireEnrollmentRoot(','private void requireCurrent(','private long admittedEpoch(','private void requireOwned(','private void resolveCurrent(','private void rejectPending(','private void rejectSuperseded(','@PluginMethod public void request(PluginCall call)'].map(start=>method(source,start)).join('\n');
 const directory=mkdtempSync(join(tmpdir(),'alpha-owner-transport-'));
 try{
  const file=join(directory,'AlphaLocalAgentPlugin.java');
  writeFileSync(file,`package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.agent.connection.*;import org.json.*;import java.util.*;import java.util.concurrent.*;
public final class AlphaLocalAgentPlugin {
 @interface PluginMethod{} static final Object lifecycleLock=new Object(),enrollmentLock=new Object();static long lifecycleEpoch=1;static boolean accepting=true;boolean disposed;
 static String rootToken,ownerToken,ownerIdentity,notificationAgent;static long expiresAt;final Set<PluginCall> pending=new HashSet<>();final ExecutorService workers=Executors.newFixedThreadPool(2);
 static final class Superseded extends Exception{}static void clearEnrollment(){rootToken=null;ownerToken=null;ownerIdentity=null;expiresAt=0;}
 static class AlphaCanonicalNotifications{static void ensure(Object c){}static void suspendForRestart(){}}
 static class PreparedViewNavigation{static boolean allowed(String p,String m,String b){return false;}}
 static class PluginWorkers{static Future<?> latest;static void submit(ExecutorService e,Runnable run,Runnable rejected){try{latest=e.submit(run);}catch(RejectedExecutionException ex){rejected.run();}}}
 static class JSObject extends JSONObject{JSObject(){}JSObject(String v){super(v);}public JSObject put(String k,Object v){super.put(k,v);return this;}}
 static class PluginCall{final JSObject input;volatile JSObject result;volatile String error;final CountDownLatch done=new CountDownLatch(1);PluginCall(String p,String m,String owner,String body){input=new JSObject().put("path",p).put("method",m);if(owner!=null)input.put("ownerId",owner);if(body!=null)input.put("body",body);}String getString(String k){return input.has(k)?input.getString(k):null;}String getString(String k,String f){String v=getString(k);return v==null?f:v;}JSONObject getObject(String k){return input.optJSONObject(k);}void reject(String v){error=v;done.countDown();}void reject(String v,String code){reject(v);}void resolve(JSObject value){result=value;done.countDown();}}
 static class Context{Context getAssets(){return this;}java.io.InputStream open(String name)throws java.io.IOException{return new java.io.FileInputStream(CONFIG+"/"+name);}}Context getContext(){return new Context();}static String CONFIG;
 static class ElizaAgentService{static String localAgentToken(){return "root";} static String requestLocalAgent(String value)throws Exception{JSONObject input=new JSONObject(value);JSONObject h=input.getJSONObject("headers");String bearer=h.getString("Authorization").substring(7);return exchange(input.getString("path"),input.getString("method"),input.optString("body",null),bearer,h,input.getInt("timeoutMs")).toString();} ${admission}}
 static void logRequestFailure(String category,String method,int status,String reason){}
 static int effects,pairs;static JSONObject lastHeaders;static String lastBody,lastMethod;static CountDownLatch pairEntered,pairRelease,effectEntered,effectRelease;static JSONObject exchange(String path,String method,String body,String bearer,JSONObject headers,int timeout)throws Exception{
  JSONObject result;
  if(path.equals("/api/auth/status"))result=new JSONObject().put("authenticated",true).put("instanceId","instance");
  else if(path.equals("/api/auth/pair-code"))result=new JSONObject().put("code","code");
  else if(path.equals("/api/auth/pair")){pairs++;if(pairEntered!=null){CountDownLatch entered=pairEntered;pairEntered=null;entered.countDown();if(!pairRelease.await(3,TimeUnit.SECONDS))throw new AssertionError("held pair");}result=new JSONObject().put("access","owner").put("instanceId","instance").put("identityId","owner").put("token","token");}
  else if(path.equals("/api/auth/me"))result=new JSONObject().put("access",new JSONObject().put("role","OWNER")).put("identity",new JSONObject().put("id","owner")).put("session",new JSONObject().put("id","token").put("expiresAt",System.currentTimeMillis()+600000));
  else {effects++;lastHeaders=headers;lastBody=body;lastMethod=method;if(!"token".equals(bearer))throw new AssertionError("owner bearer");if(effectEntered!=null){CountDownLatch entered=effectEntered;effectEntered=null;entered.countDown();if(!effectRelease.await(3,TimeUnit.SECONDS))throw new AssertionError("held effect");}result=new JSONObject().put("ok",true);}
  return new JSONObject().put("status",200).put("body",result.toString()).put("bodyBase64","sensitive-original");
 }
 ${methods}
 static void check(boolean v,String why){if(!v)throw new AssertionError(why);}static void done(PluginCall c)throws Exception{check(c.done.await(4,TimeUnit.SECONDS),"request completion");}
 public static void main(String[] args)throws Exception{CONFIG=args[0];AlphaLocalAgentPlugin plugin=new AlphaLocalAgentPlugin();try{
  pairEntered=new CountDownLatch(1);pairRelease=new CountDownLatch(1);CountDownLatch entered=pairEntered;
  PluginCall old=new PluginCall("/api/lifeops/calendar/events","POST","owner","{}");plugin.request(old);Future<?> oldTask=PluginWorkers.latest;check(entered.await(3,TimeUnit.SECONDS),"actual request reaches enrollment");
  synchronized(lifecycleLock){plugin.pending.remove(old);}pairRelease.countDown();oldTask.get(3,TimeUnit.SECONDS);check(effects==0&&old.result==null,"same-epoch retired call must not dispatch an effect");
  PluginCall next=new PluginCall("/api/lifeops/calendar/events","POST","owner","{}");plugin.request(next);done(next);check(next.error==null&&effects==1,"successor effect keeps the original domain contract");
  PluginCall wrong=new PluginCall("/api/lifeops/calendar/events","POST","other","{}");plugin.request(wrong);done(wrong);check(wrong.result.getInt("status")==409&&effects==1,"wrong owner refuses before effect");
  PluginCall forbidden=new PluginCall("/api/wallet/export","GET","owner",null);plugin.request(forbidden);done(forbidden);check(forbidden.error!=null&&effects==1,"shared reads do not grant adjacent effects");
  PluginCall me=new PluginCall("/api/auth/me","GET",null,null);plugin.request(me);done(me);check(me.error==null&&!me.result.toString().contains("token")&&!me.result.has("bodyBase64"),"shared auth projection redacts bearer");
  for(String[] route:new String[][]{{"/api/first-run","POST"},{"/api/config","PUT"},{"/api/character","PUT"},{"/api/stream/settings","POST"}}){PluginCall setup=new PluginCall(route[0],route[1],"owner","{}");plugin.request(setup);done(setup);check(setup.error==null&&route[1].equals(lastMethod)&&"{}".equals(lastBody),"shared setup write "+route[0]);}
  PluginCall setup=new PluginCall("/api/first-run","POST","owner","{}");setup.input.put("headers",new JSONObject().put("idempotency-key","setup operation:one/v2").put("x-elizaos-client-id","fixture-client"));plugin.request(setup);done(setup);check(setup.error==null&&"setup operation:one/v2".equals(lastHeaders.getString("Idempotency-Key"))&&"fixture-client".equals(lastHeaders.getString("X-ElizaOS-Client-Id")),"actual raw request preserves normalized idempotency/client headers");
  PluginCall large=new PluginCall("/api/first-run","POST","owner",new JSONObject().put("name","a".repeat(2*1024*1024)).toString());plugin.request(large);done(large);check(large.error==null,"new common request uses the 10 MiB bound rather than legacy 2 MiB");
  int before=effects;PluginCall huge=new PluginCall("/api/first-run","POST","owner","é".repeat(5*1024*1024+1));plugin.request(huge);done(huge);check(huge.error!=null&&effects==before,"UTF8 common body bound before dispatch");
  PluginCall legacyHuge=new PluginCall("/api/lifeops/calendar/events","POST","owner","a".repeat(2*1024*1024+1));plugin.request(legacyHuge);done(legacyHuge);check(legacyHuge.error!=null&&effects==before,"legacy reviewed effect retains2MiB bound");
  PluginCall alias=new PluginCall("/api/%66irst-run","POST","owner","{}");plugin.request(alias);done(alias);check(alias.error!=null&&effects==before,"startup alias refused");
  PluginCall duplicate=new PluginCall("/api/first-run","POST","owner","{}");duplicate.input.put("headers",new JSONObject().put("Idempotency-Key","a").put("idempotency-key","b"));plugin.request(duplicate);done(duplicate);check(duplicate.error!=null&&effects==before,"ambiguous header refused before effect");
  effectEntered=new CountDownLatch(1);effectRelease=new CountDownLatch(1);CountDownLatch writing=effectEntered;PluginCall late=new PluginCall("/api/first-run","POST","owner","{}");plugin.request(late);check(writing.await(3,TimeUnit.SECONDS),"setup request dispatched");ElizaAgentService.retireRuntimeRequests();effectRelease.countDown();done(late);check(late.error!=null&&late.result==null,"late startup response refused after real service retirement");
  int beforeStop=effects;PluginCall stopped=new PluginCall("/api/config","GET",null,null);plugin.request(stopped);done(stopped);check(stopped.error!=null&&effects==beforeStop,"service retirement fences Alpha even before local epoch changes");
  System.out.println("PASS actual Alpha request: held enrollment and reattachment, successor effect, expected owner, strict routes, redaction and service retirement");
 }finally{plugin.workers.shutdownNow();}}
}`);
  const output=runJvm([upstreamConnection('OwnerRoutePolicy.java'),upstreamConnection('NativeAppReadPolicy.java'),upstreamConnection('NativeAppRequestPolicy.java'),upstreamConnection('NativeOwnerTransport.java'),nativeSource('OwnerRoutes.java'),file],'ai.elizaresearch.alphaphone.AlphaLocalAgentPlugin',{json:true,args:[join(root,'config')]});
  assert.match(output,/PASS actual Alpha request/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
