import test from 'node:test';
import React from 'react';
import {transformSync} from 'esbuild';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

// In-app Eliza Cloud sign-in (owner directive 2026-10-14). The pure policy runs on a plain JVM; the
// Android wiring is checked from source. This builds no APK, runs nothing on Android, verifies no App
// Link, and contacts neither Eliza Cloud nor Google.
const root=resolve(import.meta.dirname,'..');
const read=file=>readFileSync(join(root,file),'utf8');
const between=(text,start,end)=>{const from=text.indexOf(start),to=text.indexOf(end,from+start.length);assert.ok(from>=0&&to>from,`${start} … ${end} located`);return text.slice(from,to);};
const java=process.env.JAVA_HOME||(process.platform==='darwin'?'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home':'');const binary=name=>java?join(java,'bin',name):name;
const native='android/app/src/main/java/ai/elizaresearch/alphaphone/';

test('PKCE, state, authorize URL, strict App Link return, pending record, readiness and routes (plain JVM)',()=>{
 const temporary=mkdtempSync(join(tmpdir(),'cloud-sign-in-'));
 try{
  execFileSync(binary('javac'),['--release','11','-d',temporary,join(root,native,'CloudSignInFlow.java'),join(root,native,'CloudSignInReadiness.java'),join(root,native,'ConnectionRoutes.java'),join(root,'test/fixtures/CloudSignInFlowTest.java'),join(root,'test/fixtures/CloudSignInContractTest.java')],{timeout:60000});
  assert.match(execFileSync(binary('java'),['-cp',temporary,'ai.elizaresearch.alphaphone.CloudSignInFlowTest'],{encoding:'utf8',timeout:60000}),/^PASS cloud sign-in flow \(\d+ checks\)/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});

test('actual native probe keeps email ready with missing DAL, unverified links or unavailable Google (plain JVM)',()=>{
 const temporary=mkdtempSync(join(tmpdir(),'cloud-sign-in-probe-'));
 try{
  const measure=between(read(native+'AlphaCloudSignInPlugin.java'),' private CloudSignInReadiness.Result measure(', ' private boolean assetLinksGrant(');
  const harness=`package ai.elizaresearch.alphaphone;
import java.util.*;
public class CloudSignInProbeTest {
 boolean google=true, dal=true, device=true, registered=true, email=true;
 String mode="ready"; int authorizeCalls=0;
 static class JSONObject {
  final Map<String,Object> values=new HashMap<>();
  JSONObject put(String key,Object value){values.put(key,value);return this;}
  Object opt(String key){return values.get(key);}
  String optString(String key,String fallback){Object value=opt(key);return value instanceof String?(String)value:fallback;}
  JSONObject optJSONObject(String key){return null;}
  JSONArray optJSONArray(String key){return null;}
 }
 static class JSONArray {int length(){return 0;} String optString(int index){return "";}}
 static class Uri {static String encode(String value){return java.net.URLEncoder.encode(value,java.nio.charset.StandardCharsets.UTF_8);}}
 static class CloudEmailCode {static final String SEND_PATH="/steward/auth/email/code/send";}
 static class Response {
  final int status; final JSONObject data; final String location;
  Response(int s,JSONObject d,String l){status=s;data=d;location=l;}
 }
 Response get(String url)throws Exception{
  if(url.contains("/mobile/config?"))return new Response(registered?200:503,new JSONObject().put("success",true).put("clientId",CloudSignInFlow.CLIENT_ID).put("environment","production").put("redirectUri","https://eliza.app/alphaphone/auth/callback").put("codeChallengeMethod","S256"),null);
  if(url.contains("/steward/auth/providers?"))return new Response(200,new JSONObject().put("email",email).put("google",true).put("googleNative",google),null);
  authorizeCalls++;
  if(mode.equals("timeout"))throw new java.net.SocketTimeoutException();
  return new Response(mode.equals("refused")?400:302,new JSONObject(),mode.equals("refused")?null:"https://accounts.google.com/o/oauth2/v2/auth");
 }
 int probePost(CloudSignInFlow.Environment e,String path){return 400;}
 boolean assetLinksGrant(CloudSignInFlow.Environment e){return dal;}
 boolean appLinkVerified(CloudSignInFlow.Environment e){return device;}
 ${measure}
 void check(boolean expectedEmail,boolean expectedGoogle)throws Exception{
  CloudSignInReadiness.Result result=measure(CloudSignInFlow.environment("production",false));
  if(result.inApp!=expectedEmail||result.google!=expectedGoogle)throw new AssertionError(mode);
 }
 public static void main(String[] args)throws Exception{
  CloudSignInProbeTest p=new CloudSignInProbeTest();p.google=false;p.check(true,false);
  if(p.authorizeCalls!=0)throw new AssertionError("disabled Google must not be probed");
  p.google=true;p.mode="timeout";p.check(true,true);
  p.mode="refused";p.check(true,true);
  p.mode="ready";p.device=false;p.check(true,true);
  p.device=true;p.dal=false;p.check(true,true);
  p.dal=true;p.registered=false;p.check(false,false);
  p.registered=true;p.email=false;p.check(false,false);
  p.email=true;p.check(true,true);
  System.out.println("PASS optional Google probe (8 scenarios)");
 }
}`;
  const source=join(temporary,'CloudSignInProbeTest.java');writeFileSync(source,harness);
  execFileSync(binary('javac'),['--release','11','-d',temporary,join(root,native,'CloudSignInFlow.java'),join(root,native,'CloudSignInReadiness.java'),source],{timeout:60000});
  assert.match(execFileSync(binary('java'),['-cp',temporary,'ai.elizaresearch.alphaphone.CloudSignInProbeTest'],{encoding:'utf8',timeout:60000}),/^PASS optional Google probe \(8 scenarios\)/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});

test('exact native email verify/connect/token/ack chain retains failures and custody without a browser return (plain JVM)',()=>{
 const temporary=mkdtempSync(join(tmpdir(),'cloud-email-chain-'));
 try{
  const plugin=read(native+'AlphaCloudSignInPlugin.java');
  const methods={
   ACTUAL_VERIFY:between(plugin,' private void verify(PluginCall call, boolean mfa)',' private void release(')+between(plugin,' private void completeOrRequireMfa(',' // ── Shared tail:'),
   ACTUAL_RELEASE:between(plugin,' private void release(',' @PluginMethod public void clearCredentialState('),
   ACTUAL_COMPLETE:between(plugin,' private void complete(',' /** The saved key'),
   ACTUAL_PREVIOUS_TOKEN:between(plugin,' private static String previousToken(',' /** Bounded retry'),
   ACTUAL_ACK:between(plugin,' private boolean acknowledge(',' /** A key stored before'),
   ACTUAL_OUTCOMES:between(plugin,' private void finish(',' /** Cloud refusing'),
   ACTUAL_INSTANT:between(plugin,' private static long instant(',' private Response post('),
   ACTUAL_RECEIPT_SLOT:plugin.match(/^ static String receiptSlot\(.*$/m)?.[0],
  };
  let harness=read('test/fixtures/CloudEmailNativeChainTest.java.txt');
  for(const [name,source]of Object.entries(methods)){assert(source,name);harness=harness.replace('/* '+name+' */',source);}
  const source=join(temporary,'CloudEmailNativeChainTest.java');writeFileSync(source,harness);
  execFileSync(binary('javac'),['--release','11','-d',temporary,join(root,native,'CloudSignInFlow.java'),join(root,native,'CloudEmailCode.java'),join(root,'test/fixtures/native-email/org/json/JSONObject.java'),source],{timeout:60000});
  assert.match(execFileSync(binary('java'),['-cp',temporary,'ai.elizaresearch.alphaphone.CloudEmailNativeChainTest'],{encoding:'utf8',timeout:60000}),/^PASS native email chain \(13 scenarios; no browser\/DAL facilities\)/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});

// Shared callback contract: the same fixture JSON is committed in elizaOS/eliza, whose fallback page
// and Steward redirect tests read it. Here every vector goes through the native parser.
test('shared callback contract vectors (fixture shared with elizaOS/eliza) through the native parser',()=>{
 const contract=JSON.parse(read('test/fixtures/alphaphone-auth-callback-contract.json'));
 assert.equal(contract.contract,'alphaphone-auth-callback');assert.equal(contract.version,1);
 assert.equal(contract.package,'ai.elizaresearch.alphaphone');assert.equal(contract.callbackPath,'/alphaphone/auth/callback');
 assert.deepEqual(contract.hosts,{production:'eliza.app',staging:'staging.eliza.app'});
 for(const kind of ['success','error','return','reject'])assert.ok(contract.cases.some(row=>row.expect===kind),`vectors cover ${kind}`);
 // A code is a success only from the fragment; no other vector carries one as a result.
 for(const row of contract.cases)if(row.expect==='success')assert.ok(new URL(row.url).hash.includes('code=')&&!new URL(row.url).search,row.name);
 // The fallback page's hand-off arrives as the bare callback URL: no result, nothing forwarded.
 for(const row of contract.fallbackHandoffs){
  assert.ok(!row.intentUrl.split('#Intent')[0].includes('?')&&!/code=|state=/.test(row.intentUrl),row.name);
  assert.equal(`https://${row.intentUrl.slice('intent://'.length).split('#Intent')[0]}`,row.deliveredUrl,row.name);
 }
 const native_=read(native+'CloudSignInFlow.java');
 for(const error of contract.errorAllowlist)assert.ok(native_.includes(`"${error}"`),`native allowlists ${error}`);
 assert.equal((native_.match(/"(?:app_link_unverified|mfa_required|oauth_[a-z_]+)"/g)||[]).filter((v,i,a)=>a.indexOf(v)===i).length,contract.errorAllowlist.length,'no error outside the shared allowlist');
 const lines=[...contract.cases.map(row=>['case',row.environment,row.expect,row.url,row.code??'',row.state??'',row.error??'']),
  ...contract.fallbackHandoffs.map(row=>['case',row.environment,row.expect,row.deliveredUrl,'','','']),
  ...Object.entries(contract.authorizeRequired).map(([name,value])=>['authorize',name,value])];
 for(const line of lines)assert.ok(line.every(field=>!/[\t\n]/.test(field)));
 const temporary=mkdtempSync(join(tmpdir(),'cloud-sign-in-contract-'));
 try{
  writeFileSync(join(temporary,'vectors.tsv'),lines.map(line=>line.join('\t')).join('\n')+'\n');
  execFileSync(binary('javac'),['--release','11','-d',temporary,join(root,native,'CloudSignInFlow.java'),join(root,'test/fixtures/CloudSignInContractTest.java')],{timeout:60000});
  assert.match(execFileSync(binary('java'),['-cp',temporary,'ai.elizaresearch.alphaphone.CloudSignInContractTest',join(temporary,'vectors.tsv')],{encoding:'utf8',timeout:60000}),new RegExp(`^PASS callback contract \\(${lines.length} vectors\\)`));
 }finally{rmSync(temporary,{recursive:true,force:true});}
});

test('the sign-in App Link is build-gated with the delegation return; staging lives in the test-mocks overlay',()=>{
 const strip=text=>text.replace(/<!--[\s\S]*?-->/g,'');
 const main=strip(read('android/app/src/main/AndroidManifest.xml')),mocks=strip(read('android/app/src/testMocks/AndroidManifest.xml')),gradle=read('android/app/build.gradle');
 const filter=host=>`<intent-filter android:autoVerify="true"><action android:name="android.intent.action.VIEW"/><category android:name="android.intent.category.DEFAULT"/><category android:name="android.intent.category.BROWSABLE"/><data android:scheme="https" android:host="${host}" android:path="/alphaphone/auth/callback"/></intent-filter>`;
 assert.ok(!main.includes('autoVerify'),'a default build declares no https App Link');
 assert.ok(gradle.includes(filter('\\${appLinkHost}')),'ELIZAOS_APP_LINK_HOST adds the sign-in return beside the delegation return');
 assert.ok(!main.includes('staging.eliza.app'),'no staging host in a product manifest');
 assert.ok(between(main,'<activity android:name=".MainActivity"','</activity>').includes('<data android:scheme="alphaphone" android:host="cloud-delegation"/>'),'the delegation return is unchanged');
 assert.ok(main.includes('<intent><action android:name="android.support.customtabs.action.CustomTabsService"/></intent>'),'Custom Tabs providers are visible');
 assert.ok(mocks.includes(filter('staging.eliza.app'))&&mocks.includes('<activity android:name=".MainActivity" tools:node="merge">'),'the staging return merges into MainActivity in test-mocks builds');
 const assetlinks=JSON.parse(read('android/app/src/main/assetlinks.template.json'));
 assert.equal(assetlinks[0].target.package_name,'ai.elizaresearch.alphaphone');
 assert.deepEqual(assetlinks[0].relation,['delegate_permission/common.handle_all_urls']);
});

test('the native sign-in client owns every secret, compares state before burning and logs only fixed Google diagnostics',()=>{
 const plugin=read(native+'AlphaCloudSignInPlugin.java');
 assert.match(read(native+'MainActivity.java'),/registerPlugin\(AlphaCloudSignInPlugin\.class\);/);
 assert.match(read(native+'RendererCredentialSlots.java'),/"cloud-signin"/,'pending and receipt slots are native-only');
 const diagnostic = between(plugin,' private void logGoogleOutcome(', '\n /**\n  * Strict App Link capture');
 const diagnosticBody = diagnostic.slice(diagnostic.indexOf('{') + 1, diagnostic.lastIndexOf('}')).trim();
 assert.equal(diagnosticBody, 'android.util.Log.i("AlphaCloudSignIn", CloudSignInFlow.googleDiagnostic(stage, status, outcome, current.startedAt, current.expiresAt, System.currentTimeMillis()));', 'the only log accepts the fixed serializer, never raw response, URL, token, headers or body');
 assert.equal((plugin.match(/android\.util\.Log\./g)||[]).length, 1, 'one native log sink');
 assert.equal((plugin.match(/CloudSignInFlow\.googleDiagnostic\(/g)||[]).length, 1, 'one fixed serializer call');
 assert.doesNotMatch(plugin.replace(diagnostic, ''),/android\.util\.Log|System\.out|printStackTrace|Log\.[dewiv]\(/,'all other native sign-in logging remains forbidden');
 const observer = between(plugin,' private CloudSignInFlow.GoogleFailure observeGoogleResponse(', ' private void logGoogleOutcome(');
 assert.equal(observer.slice(observer.indexOf('{')+1,observer.lastIndexOf('}')).replace(/\s+/g,' ').trim(), 'CloudSignInFlow.GoogleFailure outcome = CloudSignInFlow.googleFailure(stage, response.status, response.data.opt("ok"), response.data.opt("error")); logGoogleOutcome(current, stage, response.status, outcome); return outcome;', 'provider data enters only the classifier; only classified outcome reaches logging');
 assert.equal((plugin.match(/\blogGoogleOutcome\(/g)||[]).length, 3, 'only observer and local deadline call the single log method');
 assert.ok(plugin.includes('logGoogleOutcome(next, CloudSignInFlow.GoogleStage.LOCAL_DEADLINE, 0, expired);'));
 assert.ok(plugin.includes('CloudSignInFlow.GoogleFailure expired = CloudSignInFlow.googleFailure(CloudSignInFlow.GoogleStage.LOCAL_DEADLINE, 0, null, null);'));
 const flow = read(native+'CloudSignInFlow.java');
 assert.doesNotMatch(flow,/android\.util\.Log|System\.out|printStackTrace|Log\.[dewiv]\(/,'classification itself never logs');
 const serializer = between(flow,' static String googleDiagnostic(', '\n /** Ack');
 assert.doesNotMatch(serializer,/getMessage|toString|\.data|\.token|\.verifier|\.headers|\.body|\.location|\.id\b/, 'no raw provider/request fields are serialized');
 assert.match(serializer,/status >= 100 && status <= 599/);
 assert.match(serializer,/Math\.min\(86_400_000L/);
 assert.match(serializer,/Math\.max\(-86_400_000L/);
 // The renderer receives only these outcome fields.
 for(const resolved of plugin.match(/\.resolve\([^;]*;/g)||[])assert.doesNotMatch(resolved,/token|secret|verifier|refresh|code"/i,resolved);
 const finish=between(plugin,'JSObject outcome = new JSObject()','finish(current, outcome);');assert.doesNotMatch(finish,/\.put\("(?:secret|token)"/);
 // The key is renderer-readable (the existing cloud:<environment> slot); the source says so plainly.
 assert.match(plugin,/That slot is renderer-readable/);assert.doesNotMatch(plugin,/no \.\.\. unacknowledged key crosses|unacknowledged key crosses the bridge/);
 // Fixed routes only, no redirects, origin and route checked before any connection.
 const post=between(plugin,'private Response post(Attempt current, CloudSignInFlow.Environment environment,','/** The readiness probe');
 assert.ok(post.indexOf('ConnectionRoutes.signInOrigin(')<post.indexOf('fetch(')&&post.indexOf('ConnectionRoutes.signInRoute(')<post.indexOf('fetch('));
 assert.match(between(plugin,'private Fetched fetch(URI url, byte[] body, String bearer, Attempt current','private static final class Fetched'),/setInstanceFollowRedirects\(false\)/);
 // Native Google uses the platform picker with a server nonce and native token exchange.
 const google=between(plugin,'@PluginMethod public void startGoogle(','/**\n  * Strict App Link capture');
 assert.match(google,/NativeGoogleCredential.request/);
 assert.match(google,/google\/native\/challenge/);
 assert.match(google,/google\/native\/verify/);
 assert.doesNotMatch(google,/openBrowser|authorizeUrl|writeCredentialSlot/);
 const capture=between(plugin,'private boolean captureCallback(','private void burnUnclaimedPending()');
 assert.ok(capture.indexOf('intent.setData(null)')>0&&capture.indexOf('intent.setData(null)')<capture.indexOf('run(() ->'),'the return is consumed once');
 // Contract: a return without a result keeps the pending record; a state mismatch is ignored; the
 // record is burned only after the state matched, and before any network request.
 const noResult=between(capture,'ReturnKind.RETURN) {','// Not this phone');
 assert.doesNotMatch(noResult,/removeCredentialSlot|burnUnclaimedPending/);assert.match(noResult,/"app-link-unverified", false/);
 assert.ok(capture.indexOf('!pending.sameState(received)) return;')<capture.indexOf('store.removeCredentialSlot(PENDING_SLOT)'),'state compared before burning');
 assert.ok(capture.indexOf('store.removeCredentialSlot(PENDING_SLOT)')<capture.indexOf('"/steward/auth/oauth/exchange"'),'single use before any network request');
 assert.match(capture,/\.put\("codeVerifier", pending\.verifier\)/);
 assert.match(between(plugin,'@Override protected void handleOnResume()','@Override protected void handleOnDestroy()'),/end\(current, "browser-closed", false\)/,'closing the browser keeps the pending record until expiry or a retry');
 assert.match(between(plugin,'@PluginMethod public void cancel(','// ── Shared tail'),/burnUnclaimedPending\(\);/,'an explicit cancel burns it');
 // Tail: receipt and key stored before ack; bounded ack; Steward session revoked and never stored.
 const tail=between(plugin,'private void complete(Attempt current, JSONObject session)','/** The saved key for this environment');
 const key=tail.indexOf('credentials.writeCredentialSlot("cloud:" + environment.name'),ack=tail.indexOf('acknowledge(current, proof');
 assert.ok(tail.indexOf('receipts.writeCredentialSlot(receiptSlot(environment)')<key&&key<ack,'receipt, then key, then ack');
 assert.ok(tail.indexOf('previousToken(')<key&&tail.indexOf('CloudKeyRevocation.revoke(')>ack,'a replaced key is read before the write and revoked after activation');
 assert.match(tail,/AlphaLocalAgentPlugin\.reserveCredentialIntent\(\)/,'the key write follows the credential-intent rule');
 assert.match(tail,/"\/steward\/auth\/logout"/);
 assert.doesNotMatch(tail,/writeCredentialSlot\([^)]*(refresh|token\b)/,'the Steward session is never stored');
 assert.match(plugin,/for \(int round = 0; round < CloudSignInFlow\.ACK_ATTEMPTS; round\+\+\)/);
 assert.match(plugin,/@Override public void load\(\) \{[\s\S]*?run\(this::resumeAcknowledgements\);/,'an interrupted ack resumes on the next start');
 // Email: the code adapter, a per-attempt verify cap and a global send cooldown.
 const email=between(plugin,'@PluginMethod public void startEmail(','@PluginMethod public void verifyEmail(');
 assert.match(email,/if \(now < Math\.max\(lastEmailSendAt \+ CloudSignInFlow\.RESEND_COOLDOWN_MS, emailSendAllowedAt\)\) \{ call\.reject\("Wait before requesting another code", "cooldown"\); return; \}/);
 assert.match(email,/CloudEmailCode\.SEND_PATH, CloudEmailCode\.sendBody\(/);assert.doesNotMatch(plugin,/"\/steward\/auth\/email\/send"/,'no magic-link send');
 const verify=between(plugin,'private void verify(PluginCall call, boolean mfa)','private void release(');
 assert.match(verify,/CloudEmailCode\.VERIFY_PATH, CloudEmailCode\.verifyBody\(/);
 assert.match(verify,/current\.failedVerifies >= CloudSignInFlow\.MAX_VERIFY_ATTEMPTS/);assert.match(verify,/"attempts-exhausted"/);
 // One sign-in at a time.
 assert.match(google,/if \(attempt != null\) \{ call\.reject\("Another sign-in is in progress", "login-active"\); return; \}/);
});

test('one email code adapter: native constants, the bridge config and the route allowlist agree',()=>{
 const config=JSON.parse(read('config/cloud-email-code.json')),adapter=read(native+'CloudEmailCode.java'),routes=read(native+'ConnectionRoutes.java');
 assert.match(adapter,new RegExp(`SEND_PATH = "${config.sendPath}"`));assert.match(adapter,new RegExp(`VERIFY_PATH = "${config.verifyPath}"`));
 for(const path of [config.sendPath,config.verifyPath])assert.ok(routes.includes(`"${path}"`),path);
 assert.deepEqual(config.tenants,{production:'elizacloud',staging:'elizacloud-staging'});assert.equal(config.client,'ai.elizaresearch.alphaphone');
 for(const field of ['"email"','"tenantId"','"client"','"pkce"','"codeChallenge"','"codeChallengeMethod"','"code"','"codeVerifier"'])assert.ok(adapter.includes(field),field);
 const bridge=read('scripts/browser-cloud-dev-bridge.ts');
 assert.match(bridge,/CLOUD_EMAIL_CODE\.sendPath,emailCodeSendBody\(/);assert.match(bridge,/CLOUD_EMAIL_CODE\.verifyPath,emailCodeVerifyBody\(/);
 assert.doesNotMatch(bridge,/'\/steward\/auth\/email\/send'/);
});

test('native readiness refuses browser fallback and requires native Google availability',()=>{
 const connection=read(native+'AlphaConnectionPlugin.java');
 assert.match(connection,/if\("\/api\/auth\/cli-session"\.equals\(path\)\)operation=RequestOperation\.CLI_CREATE;/);
 assert.match(connection,/boolean cliLogin=ConnectionRoutes\.externalCliLogin\(/);
 const routes=read('apps/app/src/runtime/managed-service-routes.ts');
 assert.match(routes,/cli-session/,'the product renderer allowlist keeps the hand-off');
 const protocol=read('apps/app/src/runtime/cloud-protocol.ts');
 assert.match(protocol,/async login\(signal: AbortSignal, onWaiting\?: \(attempt: CloudLoginAttempt\) => void\): Promise<CloudLoginResult>/);
 const ui=read('apps/app/src/runtime/connection-ui.tsx');
 const begin=between(ui,'async beginSignIn(','cancelSignIn() {');
 assert.ok(begin.indexOf('await inAppSignInMethods(environment, signal, refreshNegative)')>=0&&begin.indexOf('if (!methods) {')>begin.indexOf('await inAppSignInMethods(environment, signal, refreshNegative)'),'not ready: the hand-off');
 assert.match(begin, /if \(residentCloudFlow\(\)\) await residentBrowserLoginAction\(signal\);/,'fallback runs within the readiness operation');
 const readiness=between(ui,'async function inAppSignInMethods(','/** A failed or cancelled step');
 assert.match(readiness,/if \(!port\?\.status\) return null;/);assert.match(readiness,/catch \{ return null; \}/);assert.match(readiness,/SIGN_IN_READINESS_WAIT_MS/);
 assert.match(read('apps/app/src/runtime/cloud-sign-in.ts'),/if \(row\.inApp !== true \|\| row\.email !== true\) return null;/,'only an explicit ready answer switches to in-app');
 assert.match(ui,/browserCloudResidentEnabled\?<button disabled=\{snapshot\.busy\} onClick=\{\(\)=>void connectionController\.signInBrowser\(\)\}>Sign in with browser<\/button>:testMocksEnabled\?/);
 const audit=read('scripts/audit-production-bundle.mjs');
 assert.ok(audit.includes("'Browser sign-in (diagnostic)'")&&audit.includes("'staging.eliza.app/alphaphone'"));
 assert.ok(!audit.includes("'/api/auth/cli-session'")&&!audit.includes("'/auth/cli-login'"),'the hand-off ships until Cloud is ready');
 // Readiness probe: cached, fail-safe, every part required.
 const plugin=read(native+'AlphaCloudSignInPlugin.java');
 const measure=between(plugin,'private CloudSignInReadiness.Result measure(','private boolean assetLinksGrant(');
 for(const part of ['/api/v1/app-auth/mobile/config','/steward/auth/providers','CloudEmailCode.SEND_PATH','googleNative'])assert.ok(measure.includes(part),part);
 assert.doesNotMatch(measure,/authorizeUrl|assetLinksGrant|appLinkVerified/);
 assert.match(between(plugin,'private void probe(','/** Cloud refusing'),/catch \(Exception failure\) \{ result = CloudSignInReadiness\.Result\.notReady/);
});

// Evaluate the actual JSX prop, rather than maintaining a second sign-in view.
test('browser resident sign-in exposes the existing hosted hand-off only in its admitted view',()=>{
 const ui=read('apps/app/src/runtime/connection-ui.tsx');
 const expression=between(ui,'      extra={','}/>\n    {productionSignInRequired').slice('      extra={'.length);
 const compiled=transformSync('const extra='+expression+';',{loader:'tsx',jsxFactory:'React.createElement'}).code;
 const render=new Function('React','browserCloudResidentEnabled','testMocksEnabled','snapshot','connectionController','productionSignInRequired','residentEnvironment',compiled+'return extra;');
 let calls=0;const controller={signInBrowser(){calls++;}};
 assert.equal(render(React,false,false,{busy:false},controller,false,()=>'production'),undefined,'ordinary browser and packaged views have no extra entry');
 const browser=render(React,true,false,{busy:false},controller,false,()=>'production');
 assert.equal(browser.type,'button');assert.equal(browser.props.children,'Sign in with browser');assert.equal(browser.props.disabled,false);
 browser.props.onClick();assert.equal(calls,1,'dispatches the existing hosted sign-in callback');
 assert.equal(render(React,true,false,{busy:true},controller,false,()=>'production').props.disabled,true);
 assert.equal(render(React,false,true,{busy:false},controller,false,()=>'production').props.children,'Browser sign-in (diagnostic)');
});

test('native sign-in errors survive resident startup without hiding genuine startup failures', async () => {
 const source=between(read('apps/app/src/runtime/connection-ui.tsx'),'async function ensureResident()','/** P-43: a startup path');
 const compiled=transformSync(source,{loader:'ts'}).code;
 const run=new Function('state','update','startResident','residentStartFailure',`const residentAlwaysPresent=true,active=null,operation=null;${compiled};return ensureResident();`);
 for(const row of [{error:'Google sign-in failed',startup:'Agent unavailable',previous:'Earlier failure',expected:'Google sign-in failed'},{error:'Earlier failure',startup:'New startup failure',previous:'Earlier failure',expected:'New startup failure'}]){
  const state={error:row.error,message:'',open:true,session:null};
  await run(state,change=>Object.assign(state,change),async()=>Object.assign(state,{error:row.startup}),row.previous);
  assert.equal(state.error,row.expected);
 }
});
