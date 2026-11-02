import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeSource,fixture,runJvm,root} from './fixtures/jvm-tools.mjs';

// One-tap app update, native side (AlphaDevicePlugin). The download admission and the update flow run on the
// host JVM from the plugin's own source; the rest are source checks (class S) of Android wiring that only a
// device exercises. The renderer policy is in test/settings-truth.test.mjs and the rendered rows in
// settings-device-facts.spec.ts.
const plugin=readFileSync(nativeSource('AlphaDevicePlugin.java'),'utf8');
const install=plugin.slice(plugin.indexOf('@PluginMethod public void installUpdate('),plugin.indexOf('@Override protected void handleOnDestroy()'));
const javaFiles=dir=>readdirSync(dir,{recursive:true}).filter(file=>file.endsWith('.java')).map(file=>join(dir,file));

test('the download is admitted only at its declared size and SHA-256',()=>{
 const start=plugin.indexOf(' static final long UPDATE_MAX_BYTES='),end=plugin.indexOf(' private static final String UPDATE_STATUS=');
 assert.ok(start>0&&end>start,'the admission members exist');
 const dir=mkdtempSync(join(tmpdir(),'alpha-update-'));
 try{
  // Only the admission members, in a class of the plugin's name: no Capacitor or Android types.
  const members=join(dir,'AlphaDevicePlugin.java');
  writeFileSync(members,`package ai.elizaresearch.alphaphone;\nfinal class AlphaDevicePlugin {\n${plugin.slice(start,end)}}\n`);
  assert.match(runJvm([members,fixture('UpdateDownloadTest.java')],'ai.elizaresearch.alphaphone.UpdateDownloadTest'),/^PASS update download/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the update flow runs one attempt per process, keeps Android\'s confirmation for the bridge that started it, opens it once, and settles every failure quietly',()=>{
 const start=plugin.indexOf(' static final long UPDATE_MAX_BYTES='),end=plugin.lastIndexOf('}');
 const hour='UPDATE_DEADLINE_NANOS=java.util.concurrent.TimeUnit.HOURS.toNanos(1)';
 const signer=plugin.match(/^ *SystemFacts\.fact\(facts,"appSigner".*$/m)?.[0];
 assert.ok(start>0&&end>start&&signer&&plugin.includes(hour),'the update members exist');
 const dir=mkdtempSync(join(tmpdir(),'alpha-update-flow-'));
 try{
  // The plugin's own members in a class of its name, with only the deadline shortened to seconds; the stubs state what Android and Capacitor do.
  const members=join(dir,'AlphaDevicePlugin.java');
  writeFileSync(members,`package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.system.SystemFacts;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.provider.Settings;
import com.getcapacitor.*;
final class AlphaDevicePlugin extends Plugin {
 private final java.util.concurrent.ExecutorService diagnosticsWorker=java.util.concurrent.Executors.newSingleThreadExecutor();
 Object appSigner(Context context){java.util.Map<String,Object> facts=new java.util.HashMap<>();
${signer}
  return facts.get("appSigner");}
${plugin.slice(start,end).replace(hour,'UPDATE_DEADLINE_NANOS=java.util.concurrent.TimeUnit.SECONDS.toNanos(3)')}}
`);
  assert.match(runJvm([members,nativeSource('PluginWorkers.java'),...javaFiles(fixture('app-update-jvm')),fixture('UpdateFlowTest.java')],'ai.elizaresearch.alphaphone.UpdateFlowTest'),/^PASS update flow/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Android installs only the offered newer build of this package, in place of this plugin\'s own earlier session',()=>{
 const order=['copyVerified(in,out,size,sha256,deadline);','getPackageArchiveInfo(apk.getPath(),0)','installer.abandonSession(updateSession)','installer.createSession(params)','updateSession=id;','session.commit('].map(step=>install.indexOf(step));
 assert.ok(order.every((at,index)=>at>0&&(index===0||at>order[index-1])),'size, SHA-256 and the archive are admitted before any session changes, and a new session\'s status can only arrive once it is this plugin\'s');
 // Android accepts a same-versionCode reinstall, so the archive must be exactly the offered, newer build of this package.
 assert.match(install,/archive==null\|\|!getContext\(\)\.getPackageName\(\)\.equals\(archive\.packageName\)\|\|archive\.getLongVersionCode\(\)!=versionCode\|\|versionCode<=BuildConfig\.VERSION_CODE\)throw/);
 assert.match(install,/params\.setAppPackageName\(getContext\(\)\.getPackageName\(\)\);/);
 // The status intent reaches only this app's receiver, and Android must be able to add the session result to it.
 assert.match(install,/new Intent\(UPDATE_STATUS\)\.setPackage\(getContext\(\)\.getPackageName\(\)\)/);
 assert.match(install,/PendingIntent\.FLAG_MUTABLE/);
 assert.match(plugin,/registerReceiver\(getContext\(\),updateStatus,new android\.content\.IntentFilter\(UPDATE_STATUS\),androidx\.core\.content\.ContextCompat\.RECEIVER_NOT_EXPORTED\)/);
 assert.match(install,/catch\(Exception failed\)\{installer\.abandonSession\(id\);throw failed;\}/);
 // A check of 404 is an answer, not a failure.
 assert.match(plugin,/if\(status==404\)\{call\.resolve\(new JSObject\(\)\);return;\}\s*if\(status!=200\)throw/);
 assert.match(plugin,/updateConnection\(BuildConfig\.ALPHA_UPDATE_MANIFEST_URL\)/);
 assert.match(plugin,/handleOnDestroy\(\)\{[^}]*getContext\(\)\.unregisterReceiver\(updateStatus\);/);
 assert.doesNotMatch(plugin,/setRequireUserAction|INSTALL_PACKAGES"|toast|Toast/);
});

test('Alpha stays nonprivileged and reads one configured HTTPS manifest from its own rolling release',()=>{
 const manifestXml=readFileSync(join(root,'android/app/src/main/AndroidManifest.xml'),'utf8');
 assert.match(manifestXml,/<uses-permission android:name="android\.permission\.REQUEST_INSTALL_PACKAGES" \/>/);
 assert.doesNotMatch(manifestXml,/android\.permission\.(INSTALL_PACKAGES|UPDATE_PACKAGES_WITHOUT_USER_ACTION|DELETE_PACKAGES)"/);
 const url=JSON.parse(readFileSync(join(root,'app.config.json'),'utf8')).updateManifestUrl;
 assert.equal(new URL(url).protocol,'https:');
 // Not releases/latest: any newer release of the repository without the manifest would answer 404 and withdraw a valid offer.
 assert.equal(url,'https://github.com/eliza-research/alphaphone/releases/download/app-stable/alpha-update-stable.json');
 const docs=readFileSync(join(root,'docs/android-and-aosp.md'),'utf8');
 assert.ok(docs.includes('`'+url+'`')&&docs.includes('gh release upload app-stable alpha-update-stable.json --repo eliza-research/alphaphone --clobber'),'the runbook publishes to the configured release');
 assert.match(readFileSync(join(root,'android/app/product.gradle'),'utf8'),/buildConfigField 'String', 'ALPHA_UPDATE_MANIFEST_URL', "\\"\$\{updateManifestUrl\}\\""/);
 for(const file of ['apps/app/src/prototype/settings-adapter.ts','android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaDevicePlugin.java'])assert.ok(!readFileSync(join(root,file),'utf8').includes(url),file);
});
