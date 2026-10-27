import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';
// Dependency-free Settings wording, evaluated without the renderer.
const source=readFileSync('apps/app/src/prototype/settings-adapter.ts','utf8');
const region=source.slice(source.indexOf('// settings-facts:begin'),source.indexOf('// settings-facts:end'));
assert.ok(region.length>100,'settings-facts region is present');
const m=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(region,{mode:'transform'})).toString('base64'));
const java=readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaDevicePlugin.java','utf8');

test('the version row shows only what the build and Android report',()=>{
 assert.equal(m.versionLabel('0.1.0',7),'0.1.0 (7)');
 assert.equal(m.versionLabel('0.1.0',undefined),'0.1.0');
 for(const code of [0,-1,1.5,'7',null,NaN])assert.equal(m.versionLabel('0.1.0',code),'0.1.0');
 for(const version of ['',undefined,null,7])assert.equal(m.versionLabel(version,7),'Unavailable');
});
test('updates are never reported as checked, available or current',()=>{
 const format=at=>'day '+at;
 assert.deepEqual(m.updateRows(1760000000000,format),[['Installed or last updated','day 1760000000000'],['Updates','Alpha does not check for updates']]);
 for(const at of [undefined,null,0,-5,'1760000000000',1.5])assert.deepEqual(m.updateRows(at,format),[['Updates','Alpha does not check for updates']]);
 // Neither the adapter nor the native plugin carries an update-check claim.
 assert.doesNotMatch(source,/Up to date|Update available|Check for updates/);
 assert.doesNotMatch(java,/Up to date|Update available/);
});
test('prototype-only sheets (memory wipe, Wi-Fi password, forget network) never reach the renderer',()=>{
 const line=source.split('\n').find(row=>row.includes('const out = render({ ...state'));
 for(const kind of ['wipe','wifiPw','forget','conn','voice'])assert.match(line,new RegExp(`'${kind}'`));
 assert.doesNotMatch(source,/Memory wiped|memWiped/);
});
test('native system facts are read without new permissions and are omitted when unreadable',()=>{
 const facts=java.slice(java.indexOf('static void systemFacts('),java.indexOf('static String[] settingsActions('));
 for(const key of ['wifiEnabled','bluetoothEnabled','airplaneMode','locationEnabled','mobileDataEnabled','interruptionFilter','adaptiveBrightness','appVersionCode','appUpdatedAt'])assert.match(facts,new RegExp(`fact\\(out,"${key}"`));
 // Every fact goes through the omit-on-failure helper; none is put directly with a default.
 assert.doesNotMatch(facts,/out\.put\(/);
 // Reads only: the plugin has no setter for a system switch.
 assert.doesNotMatch(java,/Settings\.(Global|System|Secure)\.put|setWifiEnabled|\.enable\(\)|\.disable\(\)|setInterruptionFilter/);
 const manifest=readFileSync('android/app/src/main/AndroidManifest.xml','utf8');
 for(const permission of ['ACCESS_WIFI_STATE','CHANGE_WIFI_STATE','BLUETOOTH_CONNECT','READ_PHONE_STATE','WRITE_SECURE_SETTINGS','ACCESS_NOTIFICATION_POLICY'])assert.doesNotMatch(manifest,new RegExp(`<uses-permission[^>]*android\\.permission\\.${permission}"(?![^>]*tools:node="remove")`),permission);
});

test('Cloud privacy facts describe AI and speech without model-navigation claims',()=>{
 assert.deepEqual(m.cloudPrivacyRow('Leaves this device'),['Shared with Cloud','Messages and selected content when you use AI']);
 assert.deepEqual(m.cloudPrivacyRow('On-device model'),['Voice','Recordings for transcription and text for playback, when used']);
 assert.equal(m.cloudPrivacyRow('Manage Alpha permissions'),null);
});

test('Cloud privacy hero includes speech while retaining native and offline/startup truth',async()=>{
 const nativeSource=readFileSync('apps/app/src/prototype/native-adapter.ts','utf8');
 const wording=nativeSource.slice(nativeSource.indexOf('export function egressPrivacy('),nativeSource.indexOf('/** Only a verified resident session'));
 const load=async cloud=>import('data:text/javascript;base64,'+Buffer.from(`const cloudRuntimeEnabled=${cloud};const testMocksEnabled=false;const Capacitor={isNativePlatform:()=>true};const cloudServiceName=environment=>environment==='staging'?'Nebula':'Cloud Test';`+stripTypeScriptTypes(wording,{mode:'transform'})).toString('base64'));
 const cloud=await load(true),native=await load(false);
 const connected={kind:'resident',session:{sessionId:'qa'},cloudAccount:{environment:'staging'}};
 for(const isNative of [true,false]){
  const fact=cloud.egressPrivacy(connected,isNative);
  assert.equal(fact.big,'Uses Nebula');assert.ok(fact.sub.includes('go to Nebula for AI'));
  for(const content of ['When used','messages','selected content','Voice recordings','text for playback'])assert.ok(fact.sub.includes(content),content);
 }
 assert.equal(native.egressPrivacy(connected,true).big,'Identifier swap only');
 for(const [kind,label]of [['starting','Agent starting'],['recovering','Agent not running'],['none','Offline']])assert.equal(cloud.egressPrivacy({kind,session:null,cloudAccount:null},true).big,label);
});

// Exercise the policy used by the real adapter for both stale routes and navigation rows.
test('production Settings refuses Developer routes and preserves real About diagnostics',()=>{
 const rows=[{label:'Models'},{label:'Developer'},{label:'About'}, {lbl:'Developer'}];
 assert.deepEqual(m.settingsNavigationRows(rows,false),[{label:'Models'},{label:'About'}]);
 assert.equal(rows.length,4,'filtering must not mutate the reference model');
 assert.equal(m.settingsPage('developer',false),null);
 for(const page of ['about','problems','licenses','models',null,undefined])assert.equal(m.settingsPage(page,false),page);
 assert.match(source,/page: settingsPage\(state\.page, devSurfacesEnabled\)/);
 assert.match(source,/rows: settingsNavigationRows\(group\.rows, devSurfacesEnabled\)/);
});
test('explicit developer surfaces retain Developer navigation and route',()=>{
 const rows=[{label:'Developer'},{label:'About'}];
 assert.equal(m.settingsNavigationRows(rows,true),rows);
 assert.equal(m.settingsPage('developer',true),'developer');
});
