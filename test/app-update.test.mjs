import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {nativeSource,fixture,runJvm,root} from './fixtures/jvm-tools.mjs';
import {parseUpdateManifest,updateCheckDue,UPDATE_SCHEMA,UPDATE_MAX_BYTES,UPDATE_CHECK_INTERVAL_MS} from '../apps/app/src/runtime/app-update.ts';

// One-tap app update: the renderer's manifest policy, the native size and SHA-256 admission on the host JVM,
// and source checks of the Android wiring. None of this is device, PackageInstaller or network evidence.
const manifest={schema:'alpha-update/v1',versionCode:8,versionName:'0.1.1',apkUrl:'https://github.com/eliza-research/alphaphone/releases/download/app-8/alpha-phone-8.apk',sha256:'0a'.repeat(32),sizeBytes:400_000_000,notes:'Faster Home'};

test('only a complete, newer manifest with an HTTPS APK, a SHA-256 and a bounded size is offered',()=>{
 assert.equal(UPDATE_SCHEMA,'alpha-update/v1');
 const {schema,...offered}=manifest;
 assert.deepEqual(parseUpdateManifest(manifest,7),offered);
 assert.deepEqual(parseUpdateManifest({...manifest,notes:undefined},7),{...offered,notes:''},'notes are optional');
 assert.deepEqual(parseUpdateManifest({...manifest,sizeBytes:UPDATE_MAX_BYTES},7)?.sizeBytes,UPDATE_MAX_BYTES);
 // Newer only, against the versionCode Android reports; an unknown installed version offers nothing.
 for(const installed of [8,9,undefined,null,'7',0.5,Number.NaN])assert.equal(parseUpdateManifest(manifest,installed),null,String(installed));
 // HTTPS only, without credentials in the URL.
 for(const apkUrl of ['http://example.com/a.apk','file:///sdcard/a.apk','content://downloads/a.apk','https://user:secret@example.com/a.apk','example.com/a.apk','','https://'+'a'.repeat(2048)+'.apk',7])
  assert.equal(parseUpdateManifest({...manifest,apkUrl},7),null,String(apkUrl).slice(0,40));
 // SHA-256 as 64 lowercase hex characters.
 for(const sha256 of ['0A'.repeat(32),'0a'.repeat(31),'0a'.repeat(33),'g'.repeat(64),'',undefined])assert.equal(parseUpdateManifest({...manifest,sha256},7),null,String(sha256));
 // A positive whole size within the bound the native download enforces.
 for(const sizeBytes of [0,-1,1.5,UPDATE_MAX_BYTES+1,'400000000',undefined])assert.equal(parseUpdateManifest({...manifest,sizeBytes},7),null,String(sizeBytes));
 for(const change of [{schema:'alpha-update/v2'},{schema:undefined},{versionCode:'8'},{versionCode:8.5},{versionName:''},{versionName:'x'.repeat(65)},{versionName:'0.1\n1'},{notes:7},{notes:'x'.repeat(501)}])
  assert.equal(parseUpdateManifest({...manifest,...change},7),null,JSON.stringify(change));
 for(const value of [null,undefined,[],'{}',7])assert.equal(parseUpdateManifest(value,7),null);
});

test('the automatic check runs at most once a day',()=>{
 const day=UPDATE_CHECK_INTERVAL_MS,at=1_760_000_000_000;
 assert.equal(day,86_400_000);
 assert.equal(updateCheckDue(Number.NaN,at),true,'never checked');
 assert.equal(updateCheckDue(at,at),false);
 assert.equal(updateCheckDue(at,at+day-1),false);
 assert.equal(updateCheckDue(at,at+day),true);
 assert.equal(updateCheckDue(at+60_000,at),true,'a clock set back does not postpone checks');
});

test('the native download is admitted only at its declared size and SHA-256',()=>{
 assert.match(runJvm([nativeSource('AppUpdateTransfer.java'),fixture('AppUpdateTransferTest.java')],'ai.elizaresearch.alphaphone.AppUpdateTransferTest'),/^PASS app update transfer/);
 assert.match(readFileSync(nativeSource('AppUpdateTransfer.java'),'utf8'),/static final long MAX_BYTES=1L<<30;/);
 assert.equal(UPDATE_MAX_BYTES,2**30,'renderer and native bounds agree');
});

test('the plugin installs through PackageInstaller for this package only, unprivileged, from one configured HTTPS manifest',()=>{
 const plugin=readFileSync(nativeSource('AlphaUpdatePlugin.java'),'utf8');
 const install=plugin.slice(plugin.indexOf('@PluginMethod public void install('));
 // From the owner's tap: without install-unknown-apps for Alpha, only that Android page opens.
 const allowed=install.indexOf('if(!getContext().getPackageManager().canRequestPackageInstalls()){');
 assert.ok(allowed>0&&allowed<install.indexOf('Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES')&&install.indexOf('return;')<install.indexOf('work(call,'),'the permission page replaces the install');
 // Verified before any session exists, for this package only; Android confirms and enforces the signer.
 const verified=install.indexOf('AppUpdateTransfer.copyVerified(in,out,size,sha256);'),session=install.indexOf('installer.createSession(params)');
 assert.ok(verified>0&&session>verified,'size and SHA-256 are admitted before a session is created');
 assert.ok(install.indexOf('params.setAppPackageName(getContext().getPackageName());')<session);
 assert.match(install,/catch\(Exception failed\)\{installer\.abandonSession\(id\);throw failed;\}/);
 assert.match(install,/finally\{apk\.delete\(\);\}/);
 assert.match(plugin,/\(HttpsURLConnection\)new URL\(url\)\.openConnection\(\)/);
 assert.match(plugin,/open\(BuildConfig\.ALPHA_UPDATE_MANIFEST_URL\)/);
 assert.match(plugin,/STATUS_PENDING_USER_ACTION\)return;\s*try\{activity\.startActivity\(confirm\);\}/);
 assert.doesNotMatch(plugin,/setRequireUserAction|INSTALL_PACKAGES|toast|Toast/);
 assert.match(readFileSync(nativeSource('MainActivity.java'),'utf8'),/registerPlugin\(AlphaUpdatePlugin\.class\);/);
 // REQUEST_INSTALL_PACKAGES only: no privileged or silent install permission.
 const manifestXml=readFileSync(join(root,'android/app/src/main/AndroidManifest.xml'),'utf8');
 assert.match(manifestXml,/<uses-permission android:name="android\.permission\.REQUEST_INSTALL_PACKAGES" \/>/);
 assert.doesNotMatch(manifestXml,/android\.permission\.(INSTALL_PACKAGES|UPDATE_PACKAGES_WITHOUT_USER_ACTION|DELETE_PACKAGES)"/);
 // One configured URL: app.config.json, into BuildConfig by product.gradle; no source names it.
 const url=JSON.parse(readFileSync(join(root,'app.config.json'),'utf8')).updateManifestUrl;
 assert.equal(new URL(url).protocol,'https:');
 assert.match(readFileSync(join(root,'android/app/product.gradle'),'utf8'),/buildConfigField 'String', 'ALPHA_UPDATE_MANIFEST_URL', "\\"\$\{updateManifestUrl\}\\""/);
 const sources=dir=>readdirSync(dir,{withFileTypes:true,recursive:true}).filter(entry=>entry.isFile()&&/\.(ts|tsx|java)$/.test(entry.name)).map(entry=>join(entry.parentPath,entry.name));
 for(const file of [...sources(join(root,'apps/app/src')),...sources(join(root,'android/app/src'))])assert.ok(!readFileSync(file,'utf8').includes(url),file);
});
