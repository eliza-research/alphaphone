import test from 'node:test';
import assert from 'node:assert/strict';
import {readWebViewEvidence,assertSameWebView} from '../scripts/webview-evidence.mjs';
const dump='Current WebView package (name, version): (com.android.webview, 145.0)\nWebView package dirty: false\n';
function adb({state=dump,paths='package:/system/webview.apk',hash='a'.repeat(64)}={}){
 return args=>args.includes('webviewupdate')?state:args.includes('path')?paths:`${hash}  ${args.at(-1)}\n`;
}
test('provider identity binds selected version and every split APK',()=>{
 assert.deepEqual(readWebViewEvidence(adb()),{packageName:'com.android.webview',version:'145.0',apkSha256:['a'.repeat(64)]});
 assert.equal(readWebViewEvidence(adb({paths:'package:/system/a.apk\npackage:/system/b.apk'})).apkSha256.length,2);
});
test('unknown, dirty, duplicate and malformed observations fail closed',()=>{
 for(const state of ['',dump+dump,dump.replace('false','true')])assert.throws(()=>readWebViewEvidence(adb({state})),/provider/);
 for(const paths of ['','package:/a.apk\npackage:/a.apk','package:/space here.apk'])assert.throws(()=>readWebViewEvidence(adb({paths})),/path/);
 assert.throws(()=>readWebViewEvidence(adb({hash:'unknown'})),/hash/);
});
test('same version with changed bytes is a different campaign',()=>{
 const before=readWebViewEvidence(adb());assertSameWebView(before,readWebViewEvidence(adb()));
 assert.throws(()=>assertSameWebView(before,readWebViewEvidence(adb({hash:'b'.repeat(64)}))),/changed/);
});
