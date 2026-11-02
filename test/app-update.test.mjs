import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeSource,fixture,runJvm,root} from './fixtures/jvm-tools.mjs';

// One-tap app update, native side (AlphaDevicePlugin). The download admission runs on the host JVM from the
// plugin's own source; the rest are source checks (class S) of Android wiring that only a device exercises.
// The renderer policy is in test/settings-truth.test.mjs and the rendered rows in settings-device-facts.spec.ts.
const plugin=readFileSync(nativeSource('AlphaDevicePlugin.java'),'utf8');
const install=plugin.slice(plugin.indexOf('@PluginMethod public void installUpdate('),plugin.indexOf('@Override protected void handleOnDestroy()'));

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

test('Android installs only the offered newer build of this package, after any stale session is dropped',()=>{
 // From the owner's tap: without install-unknown-apps for Alpha, only that Android page opens.
 const allowed=install.indexOf('if(!getContext().getPackageManager().canRequestPackageInstalls()){');
 assert.ok(allowed>0&&allowed<install.indexOf('Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES')&&install.indexOf('return;')<install.indexOf('PluginWorkers.submit(updateWorker,'));
 const order=['installer.getMySessions()','installer.abandonSession(stale.getSessionId())','copyVerified(in,out,size,sha256);','getPackageArchiveInfo(apk.getPath(),0)','installer.createSession(params)','session.commit('].map(step=>install.indexOf(step));
 assert.ok(order.every((at,index)=>at>0&&(index===0||at>order[index-1])),'stale sessions go first; size, SHA-256 and the archive are admitted before a session exists');
 // Android accepts a same-versionCode reinstall, so the archive must be exactly the offered, newer build of this package.
 assert.match(install,/archive==null\|\|!getContext\(\)\.getPackageName\(\)\.equals\(archive\.packageName\)\|\|archive\.getLongVersionCode\(\)!=versionCode\|\|versionCode<=BuildConfig\.VERSION_CODE\)throw/);
 assert.match(install,/params\.setAppPackageName\(getContext\(\)\.getPackageName\(\)\);/);
 assert.match(install,/catch\(Exception failed\)\{installer\.abandonSession\(id\);throw failed;\}/);
 assert.match(install,/finally\{apk\.delete\(\);\}/);
 // Only Android's request for the owner's confirmation is acted on; a check of 404 is an answer, not a failure.
 assert.match(plugin,/STATUS_PENDING_USER_ACTION\)return;\s*try\{activity\.startActivity\(confirm\);\}/);
 assert.match(plugin,/if\(status==404\)\{call\.resolve\(new JSObject\(\)\);return;\}\s*if\(status!=200\)throw/);
 assert.match(plugin,/updateConnection\(BuildConfig\.ALPHA_UPDATE_MANIFEST_URL\)/);
 assert.match(plugin,/handleOnDestroy\(\)\{[^}]*getContext\(\)\.unregisterReceiver\(updateStatus\);/);
 assert.doesNotMatch(plugin,/setRequireUserAction|INSTALL_PACKAGES"|toast|Toast/);
});

test('Alpha stays nonprivileged and reads one configured HTTPS manifest',()=>{
 const manifestXml=readFileSync(join(root,'android/app/src/main/AndroidManifest.xml'),'utf8');
 assert.match(manifestXml,/<uses-permission android:name="android\.permission\.REQUEST_INSTALL_PACKAGES" \/>/);
 assert.doesNotMatch(manifestXml,/android\.permission\.(INSTALL_PACKAGES|UPDATE_PACKAGES_WITHOUT_USER_ACTION|DELETE_PACKAGES)"/);
 const url=JSON.parse(readFileSync(join(root,'app.config.json'),'utf8')).updateManifestUrl;
 assert.equal(new URL(url).protocol,'https:');
 assert.match(readFileSync(join(root,'android/app/product.gradle'),'utf8'),/buildConfigField 'String', 'ALPHA_UPDATE_MANIFEST_URL', "\\"\$\{updateManifestUrl\}\\""/);
 for(const file of ['apps/app/src/prototype/settings-adapter.ts','android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaDevicePlugin.java'])assert.ok(!readFileSync(join(root,file),'utf8').includes(url),file);
});
