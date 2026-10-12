/** Read-only identity of the selected provider; version alone is not byte identity. */
export function readWebViewEvidence(adb) {
 const state=adb(['shell','dumpsys','webviewupdate']);
 const matches=[...state.matchAll(/^\s*Current WebView package \(name, version\): \(([a-zA-Z0-9_.]+), ([a-zA-Z0-9_.-]+)\)\s*$/gm)];
 if(matches.length!==1 || !/^\s*WebView package dirty: false\s*$/m.test(state))throw Error('Selected WebView provider is absent, ambiguous or changing');
 const [,packageName,version]=matches[0];
 const paths=adb(['shell','pm','path',packageName]).trim().split(/\r?\n/).map(row=>{
  const match=/^package:(\/[A-Za-z0-9_./+=-]+\.apk)$/.exec(row);
  if(!match)throw Error('Invalid WebView APK path');
  return match[1];
 }).sort();
 if(new Set(paths).size!==paths.length)throw Error('Duplicate WebView APK path');
 const apkSha256=paths.map(file=>{
  const output=adb(['shell','sha256sum',file]).trim();
  const match=/^([a-f0-9]{64})\s+\S+$/.exec(output);
  if(!match||output.slice(64).trim()!==file)throw Error('WebView APK hash was not observed');
  return match[1];
 }).sort();
 return {packageName,version,apkSha256};
}
export function assertSameWebView(before,after){
 if(JSON.stringify(before)!==JSON.stringify(after))throw Error('WebView provider changed during instrumentation; class results are not a stable-provider campaign');
}
