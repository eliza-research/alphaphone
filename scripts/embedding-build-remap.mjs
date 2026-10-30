import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

// Historical JNI identity and SDK remapping remain bound to these reviewed bytes.
export const SDK_PROVENANCE_RECEIPT = 'docs/evidence/native-c95a/embedding-QUALIFICATION.json';
const CANONICAL_SDK_TARGET = '/work/android-sdk';
function readReceipt(root, relative, expectedHash) {
 if(typeof relative!=='string'||!relative||path.isAbsolute(relative)||relative.split(/[\\/]/).some(part=>!part||part==='.'||part==='..')||!/^[a-f0-9]{64}$/.test(expectedHash??''))throw Error('Reviewed SDK provenance receipt is missing or changed');
 let file=path.resolve(root);
 for(const part of relative.split('/')){file=path.join(file,part);if(fs.lstatSync(file).isSymbolicLink())throw Error('Reviewed SDK provenance receipt must not be a symlink');}
 if(!fs.statSync(file).isFile())throw Error('Reviewed SDK provenance receipt must be a regular file');
 const bytes=fs.readFileSync(file);
 if(createHash('sha256').update(bytes).digest('hex')!==expectedHash)throw Error('Reviewed SDK provenance receipt is missing or changed');
 return JSON.parse(bytes);
}
function absoluteDirectory(value) {
 if(typeof value!=='string'||!path.isAbsolute(value)||/[\s=\0]/.test(value)||path.normalize(value)!==value)throw Error('Build path remapping needs normalized absolute paths without whitespace');
 return value;
}
function remaps(value) {
 if(typeof value!=='string')throw Error('Reviewed SDK path remaps are malformed');
 const parts=value.trim()?value.trim().split(/\s+/):[];
 if(parts[0]==='#')parts.shift();
 const seen=new Set();
 return parts.map(part=>{
  const match=/^\+-ffile-prefix-map=([^=]+)=([^=]+)$/.exec(part);
  if(!match||seen.has(match[1]))throw Error('Reviewed SDK path remaps are malformed or conflicting');
  seen.add(match[1]);return {from:absoluteDirectory(match[1]),to:absoluteDirectory(match[2])};
 });
}
function legacySdk(receipt, manifest) {
 if(receipt.forkPin!==manifest.forkPin||receipt.identity!==manifest.identity)throw Error('Reviewed SDK provenance does not match the embedding host');
 const buildSdk=absoluteDirectory(receipt.env?.ANDROID_HOME);
 const rule=remaps(receipt.env?.CCC_OVERRIDE_OPTIONS??'').find(rule=>rule.from===buildSdk);
 return rule?.to??buildSdk;
}
function fullQualificationSdk(receipt, manifest) {
 const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
 if(receipt.built!==true||receipt.buildPathRemapped!==true||typeof receipt.qualifiedAt!=='string'||!Number.isFinite(Date.parse(receipt.qualifiedAt))||receipt.qualification?.passed!==true||
  ['pin','forkPin','identity','abi'].some(key=>receipt[key]!==manifest[key])||
  !Array.isArray(receipt.inputs)||receipt.inputs.length===0||!same(receipt.inputs,manifest.inputs)||
  !receipt.jniBinding||!same(receipt.jniBinding,manifest.jniBinding))throw Error('Reviewed SDK provenance does not match the embedding host');
 const names=['libelizainference.so','libelizavoicejni.so','libc++_shared.so'];
 if(!Array.isArray(receipt.libraries)||receipt.libraries.length!==names.length||!Array.isArray(manifest.libraries)||manifest.libraries.length!==names.length)throw Error('Reviewed SDK provenance does not match the embedding host');
 for(const name of names){
  const built=receipt.libraries.filter(row=>path.basename(row?.path??'')===name),admitted=manifest.libraries.filter(row=>row?.name===name);
  if(built.length!==1||admitted.length!==1||!/^[a-f0-9]{64}$/.test(built[0].sha256??'')||!Number.isSafeInteger(built[0].bytes)||built[0].bytes<=0||built[0].sha256!==admitted[0].sha256||built[0].bytes!==admitted[0].bytes||built[0].alignment16KiB!==true||admitted[0].alignment16KiB!==true)throw Error('Reviewed SDK provenance does not match the embedding host');
 }
 const buildSdk=absoluteDirectory(receipt.env?.ANDROID_HOME),rules=remaps(receipt.env?.CCC_OVERRIDE_OPTIONS);
 const sdkRules=rules.filter(rule=>rule.to===CANONICAL_SDK_TARGET);
 if(sdkRules.length!==1||sdkRules[0].from!==buildSdk)throw Error('Reviewed SDK path remaps do not identify one authenticated SDK target');
 return CANONICAL_SDK_TARGET;
}
export function qualifiedSdkProvenance(productRoot, manifest) {
 const provenance=manifest.sdkProvenance;
 if(!provenance||Object.keys(provenance).length!==2||provenance.schema!=='full-qualification-v1'||Object.hasOwn(manifest,'newArm64EngineQualification'))throw Error('Reviewed SDK provenance schema is unsupported');
 return fullQualificationSdk(readReceipt(productRoot,provenance.receipt,manifest.qualificationReceiptSha256),manifest);
}
export function embeddingBuildRemap(productRoot, {sdk, staging, fork, build}) {
 const manifest=JSON.parse(fs.readFileSync(path.join(productRoot,'android/embedding-host/qualified-host.json'),'utf8'));
 let reviewedSdk;
 if(Object.hasOwn(manifest,'sdkProvenance')) {
  reviewedSdk=qualifiedSdkProvenance(productRoot,manifest);
 } else if(Object.hasOwn(manifest,'newArm64EngineQualification')) {
  const current=manifest.newArm64EngineQualification;
  const receipt=readReceipt(productRoot,current?.receipt,manifest.qualificationReceiptSha256);
  const legacy=readReceipt(productRoot,SDK_PROVENANCE_RECEIPT,manifest.previousQualification?.receipt);
  reviewedSdk=legacySdk(legacy,manifest);
  const previousEngine=legacy.libraries?.find(row=>path.basename(row.path??'')==='libelizainference.so');
  const engine=manifest.libraries?.find(row=>row.name==='libelizainference.so');
  if(!engine||!previousEngine||!/^[a-f0-9]{64}$/.test(receipt.engine?.sha256??'')||!Number.isSafeInteger(receipt.engine?.bytes)||receipt.engine.bytes<=0||receipt.schemaVersion!==1||receipt.nativeCommit!==manifest.forkPin||current.sourceCommit!==manifest.forkPin||receipt.engine?.sha256!==engine?.sha256||receipt.engine?.sha256!==current.engineSha256||receipt.engine?.bytes!==engine?.bytes||receipt.engine?.abi!==manifest.abi||receipt.previousEngineSha256!==manifest.previousQualification?.engineSha256||receipt.previousEngineSha256!==previousEngine?.sha256)throw Error('Reviewed SDK provenance does not match the embedding host');
  // The new component receipt carries remaps, while the authenticated prior
  // qualification carries the JNI identity and canonical SDK target. Require both.
  const sdkRules=remaps(receipt.toolchain?.pathRemap).filter(rule=>rule.to===reviewedSdk);
  if(sdkRules.length!==1)throw Error('Reviewed SDK path remaps do not identify one authenticated SDK target');
 } else {
  reviewedSdk=legacySdk(readReceipt(productRoot,SDK_PROVENANCE_RECEIPT,manifest.qualificationReceiptSha256),manifest);
 }
 for(const directory of [sdk,staging,fork,build,reviewedSdk])absoluteDirectory(directory);
 const target='/alphaphone-embedding-host';
 return {CCC_OVERRIDE_OPTIONS:['#',...[
  [staging,target],
  [fork,target+'/plugins/plugin-local-inference/native/llama.cpp'],
  [build,target+'/jni-build'],
  [sdk,reviewedSdk],
 ].map(([from,to])=>`+-ffile-prefix-map=${from}=${to}`)].join(' ')};
}
