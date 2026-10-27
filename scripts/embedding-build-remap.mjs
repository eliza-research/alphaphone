import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

// This receipt is authenticated by the current embedding admission record. Its SDK
// root is part of the reviewed bytes: NDK header paths survive in JNI debug data
// and also affect the engine's build ID before its debug sections are stripped.
export const SDK_PROVENANCE_RECEIPT = 'docs/evidence/native-c95a/embedding-QUALIFICATION.json';
export function embeddingBuildRemap(productRoot, {sdk, staging, fork, build}) {
 const manifest=JSON.parse(fs.readFileSync(path.join(productRoot,'android/embedding-host/qualified-host.json'),'utf8'));
 const bytes=fs.readFileSync(path.join(productRoot,SDK_PROVENANCE_RECEIPT));
 if(createHash('sha256').update(bytes).digest('hex')!==manifest.qualificationReceiptSha256)throw Error('Reviewed SDK provenance receipt is missing or changed');
 const receipt=JSON.parse(bytes),buildSdk=receipt.env?.ANDROID_HOME;
 // The reviewed bytes carry the SDK path the build remapped to, not the build host's SDK root.
 const sdkRule=(receipt.env?.CCC_OVERRIDE_OPTIONS??'').split(/\s+/).find(option=>option.startsWith(`+-ffile-prefix-map=${buildSdk}=`));
 const reviewedSdk=sdkRule?sdkRule.slice(`+-ffile-prefix-map=${buildSdk}=`.length):buildSdk;
 if(receipt.forkPin!==manifest.forkPin||receipt.identity!==manifest.identity)throw Error('Reviewed SDK provenance does not match the embedding host');
 for(const directory of [sdk,staging,fork,build,reviewedSdk])
  if(typeof directory!=='string'||!path.isAbsolute(directory)||/\s/.test(directory))throw Error('Build path remapping needs absolute paths without whitespace');
 const target='/alphaphone-embedding-host';
 return {CCC_OVERRIDE_OPTIONS:['#',...[
  [staging,target],
  [fork,target+'/plugins/plugin-local-inference/native/llama.cpp'],
  [build,target+'/jni-build'],
  [sdk,reviewedSdk],
 ].map(([from,to])=>`+-ffile-prefix-map=${from}=${to}`)].join(' ')};
}
