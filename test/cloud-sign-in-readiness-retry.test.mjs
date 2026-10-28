// Actual native status/probe/cache policy with a closed clock and queued probe ports.
// Host JVM only; no Android, credentials, Cloud, Google or OTP requests.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {runJvm,nativeSource} from './fixtures/jvm-tools.mjs';
const source=readFileSync(nativeSource('AlphaCloudSignInPlugin.java'),'utf8');const part=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return source.slice(a,b);};
test('explicit Retry refreshes only negative readiness, coalesces probes and retains all admission measurement',()=>{const d=mkdtempSync(join(tmpdir(),'alpha-readiness-retry-'));try{const file=join(d,'ReadinessRetryHarness.java');const code=`package ai.elizaresearch.alphaphone;import java.util.*;import java.util.concurrent.*;
@interface PluginMethod{}public class ReadinessRetryHarness{
 static class System{static long now=1000000;static long currentTimeMillis(){return now;}}
 static class JSObject{Map<String,Object> values=new HashMap<>();JSObject put(String k,Object v){values.put(k,v);return this;}}
 static class PluginCall{boolean refresh;int resolved,rejected;JSObject result;String environment="production";String getString(String k,String fallback){return environment;}Boolean getBoolean(String k,Boolean fallback){return refresh;}void resolve(JSObject v){resolved++;result=v;}void reject(String a,String b){rejected++;}}
 static class Attempt{boolean google;String mfaType,phone;}Attempt attempt;final Object lock=new Object();
 static class Queue implements Executor{final List<Runnable> tasks=new ArrayList<>();boolean closed;public void execute(Runnable r){if(closed)throw new RejectedExecutionException();tasks.add(r);}void drain(){while(!tasks.isEmpty())tasks.remove(0).run();}}
 final Queue prober=new Queue();final Map<CloudSignInFlow.Environment,CloudSignInReadiness.Result> readiness=new EnumMap<>(CloudSignInFlow.Environment.class),stored=new EnumMap<>(CloudSignInFlow.Environment.class);final Map<CloudSignInFlow.Environment,List<PluginCall>> probing=new EnumMap<>(CloudSignInFlow.Environment.class);int measures;boolean fail;CloudSignInReadiness.Result next;boolean testMocks(){return false;}
 CloudSignInReadiness.Result storedReadiness(CloudSignInFlow.Environment e){return stored.get(e);}void storeReadiness(CloudSignInFlow.Environment e,CloudSignInReadiness.Result r){stored.put(e,r);}CloudSignInReadiness.Result measure(CloudSignInFlow.Environment e)throws Exception{measures++;if(fail)throw new Exception("Synthetic offline");return next;}
 ${part(' @PluginMethod public void status(', ' private JSObject statusOutcome(')}
 ${part(' private JSObject statusOutcome(', ' private void probe(')}
 ${part(' private void probe(', ' /** Cloud refused this phone')}
 static PluginCall call(boolean refresh){PluginCall c=new PluginCall();c.refresh=refresh;return c;}
 static void check(boolean v,String why){if(!v)throw new AssertionError(why);}static boolean ready(PluginCall c){return Boolean.TRUE.equals(c.result.values.get("inApp"));}
 public static void main(String[]args){CloudSignInFlow.Environment e=CloudSignInFlow.Environment.PRODUCTION;
  for(boolean persisted:new boolean[]{false,true}){ReadinessRetryHarness h=new ReadinessRetryHarness();CloudSignInReadiness.Result old=CloudSignInReadiness.Result.notReady(System.now);(persisted?h.stored:h.readiness).put(e,old);PluginCall passive=call(false);h.status(passive);check(passive.resolved==1&&!ready(passive)&&h.prober.tasks.isEmpty(),"ordinary lookup must retain fresh negative cache");PluginCall retry=call(true),joined=call(true);h.status(retry);h.status(joined);check(h.prober.tasks.size()==1&&retry.resolved==0&&joined.resolved==0,"explicit negative retry must queue exactly one new probe and join waiters");h.next=CloudSignInReadiness.combine(true,false,false,true,true,true,true,System.now);h.prober.drain();check(h.measures==1&&retry.resolved==1&&joined.resolved==1&&ready(retry),"fresh complete measure enables admitted email");check(Boolean.FALSE.equals(retry.result.values.get("google")),"failed Google/DAL checks must stay false");check(h.stored.get(e)==h.next&&h.probing.isEmpty(),"normal cache persistence and inflight release");}
  ReadinessRetryHarness positive=new ReadinessRetryHarness();positive.readiness.put(e,new CloudSignInReadiness.Result(true,true,System.now+CloudSignInReadiness.READY_TTL_MS));PluginCall hot=call(true);positive.status(hot);check(hot.resolved==1&&positive.measures==0&&positive.prober.tasks.isEmpty(),"positive cache must survive explicit Retry");
  ReadinessRetryHarness partial=new ReadinessRetryHarness();partial.readiness.put(e,new CloudSignInReadiness.Result(true,false,System.now+CloudSignInReadiness.NOT_READY_TTL_MS));PluginCall partialRetry=call(true);partial.status(partialRetry);check(partial.prober.tasks.size()==1&&partialRetry.resolved==0,"partial readiness must remeasure on explicit Retry");partial.next=new CloudSignInReadiness.Result(true,true,System.now+CloudSignInReadiness.READY_TTL_MS);partial.prober.drain();check(partial.measures==1&&Boolean.TRUE.equals(partialRetry.result.values.get("google")),"Google enabled only by fresh full measurement result");
  ReadinessRetryHarness warming=new ReadinessRetryHarness();warming.probe(e,null,false);PluginCall duringWarm=call(true);warming.status(duringWarm);check(warming.prober.tasks.size()==1,"explicit Retry joins an existing cold warmup probe");warming.next=CloudSignInReadiness.Result.notReady(System.now);warming.prober.drain();check(warming.measures==1&&duringWarm.resolved==1&&!ready(duringWarm),"existing failed warmup does not auto retry");
  ReadinessRetryHarness failed=new ReadinessRetryHarness();failed.readiness.put(e,CloudSignInReadiness.Result.notReady(System.now));failed.fail=true;PluginCall retry=call(true);failed.status(retry);failed.prober.drain();check(retry.resolved==1&&!ready(retry)&&failed.measures==1&&failed.prober.tasks.isEmpty(),"failed refreshed measurement stays negative and never auto retries");check(failed.readiness.get(e).until==System.now+CloudSignInReadiness.NOT_READY_TTL_MS,"negative TTL unchanged");
  ReadinessRetryHarness closed=new ReadinessRetryHarness();closed.readiness.put(e,CloudSignInReadiness.Result.notReady(System.now));closed.prober.closed=true;PluginCall refused=call(true);closed.status(refused);check(refused.resolved==1&&!ready(refused)&&closed.probing.isEmpty(),"executor refusal releases waiters fail closed");
  ReadinessRetryHarness invalid=new ReadinessRetryHarness();PluginCall staging=call(true);staging.environment="staging";invalid.status(staging);check(staging.rejected==1&&invalid.prober.tasks.isEmpty(),"production environment guard must stay authoritative");
  java.lang.System.out.println("PASS actual native status/probe explicit negative retry, persistent cache, positive cache, single-flight and fail-closed admission");
 }} `;writeFileSync(file,code);assert.match(runJvm([nativeSource('CloudDeployment.java'),nativeSource('CloudSignInFlow.java'),nativeSource('CloudSignInReadiness.java'),file],'ai.elizaresearch.alphaphone.ReadinessRetryHarness'),/^PASS actual native status\/probe/);}finally{rmSync(d,{recursive:true,force:true});}});
test('actual Retry controller forwards refresh only for explicit user retry, not ordinary entry',async()=>{
 const {transformSync}=await import('esbuild');const ui=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');const text=(a,b)=>{const from=ui.indexOf(a),to=ui.indexOf(b,from+a.length);assert.ok(from>=0&&to>from);return ui.slice(from,to);};const methods=text('async function inAppSignInMethods(','/** A failed or cancelled step');const begin=text('  async beginSignIn(','  /** Leaves the sign-in screen');const contract=readFileSync(new URL('../apps/app/src/runtime/cloud-sign-in.ts',import.meta.url),'utf8');const module=await import('data:text/javascript;base64,'+Buffer.from(transformSync(contract,{loader:'ts',format:'esm'}).code).toString('base64'));
 const body=`const cloudServiceName=()=> 'Eliza Cloud';let inAppPhone=false,inAppEmail=true;let operation=null,inAppGoogle=false,epoch=0,signInReadinessOwner=null;const inputs=[],updates=[];const cloudSignIn={status:async input=>{inputs.push(input);return {inApp:true,email:true,google:false};}};const SIGN_IN_READINESS_WAIT_MS=6000,cloudEnvironmentAllowed=()=>true,residentCloudFlow=()=>true,residentEnvironment=()=>'production';let cloud={environment:'production',cancelLogin(){}};const state={purpose:'agent'},update=x=>updates.push(x),work=async(_,action)=>action(new AbortController().signal),ensureResident=async()=>{};${methods};const controller={${begin}};return {controller,inputs,updates};`;
 const compiled=transformSync('function make(){'+body+'}',{loader:'ts',format:'esm'}).code;const make=new Function('signInReadiness',compiled+';return make();');const ordinary=make(module.signInReadiness);await ordinary.controller.beginSignIn('production');assert.deepEqual(ordinary.inputs,[{environment:'production'}]);const retry=make(module.signInReadiness);await retry.controller.beginSignIn('production',true);assert.deepEqual(retry.inputs,[{environment:'production',refreshNegative:true}]);assert.equal(retry.updates.at(-1).signIn.step,'choose');assert.ok(ui.includes('beginSignIn(residentEnvironment(),true)}>Retry sign-in'));assert.equal((ui.match(/beginSignIn\(residentEnvironment\(\),true\)/g)||[]).length,1,'only explicit Retry control forces refresh');
});

test('automatic readiness retains existing and newer errors without restarting the agent',async()=>{
 const {transformSync}=await import('esbuild');
 const ui=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
 const part=(a,b)=>{const from=ui.indexOf(a),to=ui.indexOf(b,from+a.length);assert.ok(from>=0&&to>from);return ui.slice(from,to);};
 const work=part('async function work(','/** Start (or restart) the resident.');
 const begin=part('  async beginSignIn(','  /** Leaves the sign-in screen');
 const compiled=transformSync(`function make(){
  let operation=null,residentStartInBackground=false,epoch=0,signInReadinessOwner=null,inAppGoogle=false,inAppPhone=false,inAppEmail=true,release,starts=0;
  const state={purpose:'agent',error:'Saved sign-in expired'},update=value=>Object.assign(state,value);
  const cloud={environment:'production',cancelLogin(){}},cloudSignIn={},cloudServiceName=()=> 'Eliza Cloud';
  const cloudEnvironmentAllowed=()=>true,residentCloudFlow=()=>true,residentEnvironment=()=> 'production';
  const inAppSignInMethods=()=>new Promise(resolve=>{release=()=>resolve({google:false,email:true});});
  const runQueuedResidentRebind=()=>{},runQueuedSignInReturn=()=>{},ensureResident=async()=>{starts++;};
  ${work}
  const controller={${begin}};
  return {controller,state,release:()=>release(),starts:()=>starts};
 }`,{loader:'ts',format:'esm'}).code;
 const fixture=new Function(compiled+';return make();')();
 const automatic=fixture.controller.beginSignIn('production',false,true);
 assert.equal(fixture.state.error,'Saved sign-in expired','the existing error remains visible while readiness is pending');
 fixture.state.error='A newer native failure';fixture.release();await automatic;
 assert.equal(fixture.state.error,'A newer native failure','completion cannot overwrite a newer asynchronous error');
 assert.equal(fixture.starts(),0,'readiness alone cannot retry a blocked startup');
 const explicit=fixture.controller.beginSignIn('production');
 assert.equal(fixture.state.error,'','an explicit new attempt clears the previous error');
 fixture.release();await explicit;assert.equal(fixture.starts(),1);
});

test('native warmup, explicit status and renderer Retry retain the single existing probe/admission path',()=>{
 assert.match(source,/probe\(CloudSignInFlow\.Environment\.PRODUCTION, null, false\);/);
 assert.match(source,/probe\(environment, call, Boolean\.TRUE\.equals\(call\.getBoolean\("refreshNegative", false\)\)\);/);
 assert.equal((source.match(/private void probe\(/g)||[]).length,1);
 const probe=part(' private void probe(',' /** Cloud refused this phone');
 assert.equal((probe.match(/measure\(environment\)/g)||[]).length,1);
 assert.match(probe,/List<PluginCall> waiting = probing\.get\(environment\);/);
 assert.match(probe,/if \(waiting != null\) \{ if \(call != null\) waiting\.add\(call\); return; \}/);
 assert.match(probe,/result = CloudSignInReadiness\.Result\.notReady/);
 for(const forbidden of ['startGoogle(', 'startEmail(', 'forgetReadiness(', 'store().', 'scheduleAtFixedRate', 'postDelayed'])assert.ok(!probe.includes(forbidden),forbidden);
});
