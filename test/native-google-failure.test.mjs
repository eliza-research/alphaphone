import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),base='android/app/src/main/java/ai/elizaresearch/alphaphone/';
const java=process.env.JAVA_HOME;
const javaTool=name=>java?join(java,'bin',name):name;
const read=p=>readFileSync(join(root,p),'utf8');
function run(extra,fixture){const dir=mkdtempSync(join(tmpdir(),'native-google-classification-'));try{let files=[join(root,base+'CloudDeployment.java'),join(root,base+'CloudSignInFlow.java')];if(extra){const f=join(dir,fixture+'.java');writeFileSync(f,extra);files.push(f);}else files.push(join(root,'test/fixtures/'+fixture+'.java'));execFileSync(javaTool('javac'),['--release','11','-d',dir,...files],{timeout:30000});return execFileSync(javaTool('java'),['-cp',dir,'ai.elizaresearch.alphaphone.'+fixture],{encoding:'utf8',timeout:10000});}finally{rmSync(dir,{recursive:true,force:true});}}
test('native Google exact deployed response map, unsafe bodies, expiry and legacy behavior',()=>{assert.match(run(null,'NativeGoogleClassificationTest'),/PASS native Google classification/);});
test('actual native observation helper emits only bounded fields and callsites use separate stages',()=>{
 const source=read(base+'AlphaCloudSignInPlugin.java');
 const start=source.indexOf(' @PluginMethod public void startGoogle('),end=source.indexOf(' /** Observe only',start),body=source.slice(start,end);
 assert.match(body,/observeGoogleResponse\(next, CloudSignInFlow.GoogleStage.CHALLENGE, challenge\)/);
 assert.match(body,/observeGoogleResponse\(next, CloudSignInFlow.GoogleStage.VERIFY, verified\)/);
 assert.doesNotMatch(body,/failureForStatus\("exchange"/);
 assert.match(body,/System.currentTimeMillis\(\) >= next.expiresAt/);
 assert.match(body,/completeOrRequireMfa\(next, session\)/);
 const methods=source.slice(source.indexOf(' private CloudSignInFlow.GoogleFailure observeGoogleResponse'),source.indexOf(' /**\n  * Strict App Link capture'));
 assert.ok(methods.includes('response.data.opt("error")'));
 const harness=`package ai.elizaresearch.alphaphone;
 public class NativeGoogleObserverTest {
  static class Attempt {long startedAt=System.currentTimeMillis()-100;long expiresAt=System.currentTimeMillis()+10000;}
  static class Data {Object ok,error;Object opt(String k){return k.equals("ok")?ok:error;}}
  static class Response {int status;Data data=new Data();}
  static class Log {static String value;static int i(String tag,String line){value=tag+" "+line;return 0;}}
  ${methods.replace('android.util.Log.i','Log.i')}
  public static void main(String[]args){NativeGoogleObserverTest p=new NativeGoogleObserverTest();Response r=new Response();r.status=401;r.data.ok=false;r.data.error="Google identity could not be verified";
   CloudSignInFlow.GoogleFailure f=p.observeGoogleResponse(new Attempt(),CloudSignInFlow.GoogleStage.VERIFY,r);
   if(!"provider-refused".equals(f.code)||!Log.value.contains("reason=google-identity-unverified")||Log.value.contains((String)r.data.error))throw new AssertionError();
   r.data.error="SECRET_TOKEN\\nhttps://private/?jwt=secret";p.observeGoogleResponse(new Attempt(),CloudSignInFlow.GoogleStage.VERIFY,r);
   if(Log.value.contains("SECRET")||Log.value.contains("https")||!Log.value.contains("unclassified-provider-refusal"))throw new AssertionError();
   System.out.println("PASS actual native observer");
  }
 }`;
 assert.match(run(harness,'NativeGoogleObserverTest'),/PASS actual native observer/);
});
