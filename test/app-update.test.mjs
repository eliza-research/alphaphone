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
const between=(text,from,to)=>text.slice(text.indexOf(from),text.indexOf(to,text.indexOf(from)));

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
 // Everything on the worker settles the call: a binder RuntimeException from PackageInstaller is inside the try, not thrown off the executor.
 const worker=between(install,'PluginWorkers.submit(updateWorker,()->{','},()->call.reject(');
 assert.match(worker,/^PluginWorkers\.submit\(updateWorker,\(\)->\{\s*java\.io\.File apk=updateApk\(\);\s*try\{\s*PackageInstaller installer=getContext\(\)\.getPackageManager\(\)\.getPackageInstaller\(\);/);
 assert.match(worker,/\}catch\(Exception unavailable\)\{call\.reject\("Update unavailable"\);\}\s*finally\{apk\.delete\(\);\}\s*$/);
 // From the owner's tap: without install-unknown-apps for Alpha, only that Android page opens.
 const allowed=install.indexOf('if(!getContext().getPackageManager().canRequestPackageInstalls()){');
 assert.ok(allowed>0&&allowed<install.indexOf('Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES')&&install.indexOf('return;')<install.indexOf('PluginWorkers.submit(updateWorker,'));
 const order=['installer.getMySessions()','installer.abandonSession(stale.getSessionId())','copyVerified(in,out,size,sha256);','getPackageArchiveInfo(apk.getPath(),0)','installer.createSession(params)','session.commit('].map(step=>install.indexOf(step));
 assert.ok(order.every((at,index)=>at>0&&(index===0||at>order[index-1])),'stale sessions go first; size, SHA-256 and the archive are admitted before a session exists');
 // Android accepts a same-versionCode reinstall, so the archive must be exactly the offered, newer build of this package.
 assert.match(install,/archive==null\|\|!getContext\(\)\.getPackageName\(\)\.equals\(archive\.packageName\)\|\|archive\.getLongVersionCode\(\)!=versionCode\|\|versionCode<=BuildConfig\.VERSION_CODE\)throw/);
 assert.match(install,/params\.setAppPackageName\(getContext\(\)\.getPackageName\(\)\);/);
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

test('Android asks for the owner\'s confirmation once Alpha is resumed, and only once',()=>{
 // Android drops an activity Alpha starts while stopped (screen locked during the download), and no later
 // event would retry it: the receiver opens it only while resumed, otherwise handleOnResume does.
 const receiver=between(plugin,'public void onReceive(Context context,Intent intent){','\n };');
 assert.match(receiver,/STATUS_PENDING_USER_ACTION\)return;\s*updateConfirm=confirm;\s*if\(getActivity\(\)\.getLifecycle\(\)\.getCurrentState\(\)\.isAtLeast\(androidx\.lifecycle\.Lifecycle\.State\.RESUMED\)\)confirmUpdate\(\);\s*\}$/);
 assert.doesNotMatch(receiver,/startActivity|hasWindowFocus|shareForeground/,'a resumed Alpha without window focus (shade open, split screen) gets no later resume, so it opens now');
 assert.match(plugin,/@Override protected void handleOnResume\(\)\{super\.handleOnResume\(\);confirmUpdate\(\);\}/);
 // Taken before it is started, so a resume after it opened never opens it again.
 assert.match(between(plugin,'private void confirmUpdate(){','\n }'),/Intent confirm=updateConfirm;updateConfirm=null;\s*if\(confirm!=null\)try\{getActivity\(\)\.startActivity\(confirm\);\}catch\(RuntimeException unavailable\)/);
 assert.equal(plugin.match(/startActivity\(confirm\)/g).length,1);
});

test('the first plugin of a process deletes a download a killed process left, never one in flight',()=>{
 const load=between(plugin,'@Override public void load(){','\n }');
 assert.match(load,/super\.load\(\);\s*if\(!updateApkSwept\)\{updateApkSwept=true;updateApk\(\)\.delete\(\);\}\s*androidx\.core\.content\.ContextCompat\.registerReceiver/);
 // Static: AlphaAssistActivity's bridge loads a second plugin while MainActivity's may be downloading.
 assert.match(plugin,/\n private static boolean updateApkSwept;\n/);
 assert.match(plugin,/private java\.io\.File updateApk\(\)\{return new java\.io\.File\(getContext\(\)\.getCacheDir\(\),"alpha-update\.apk"\);\}/);
 assert.equal(plugin.match(/"alpha-update\.apk"/g).length,1,'one cache path for the download and the sweep');
});
