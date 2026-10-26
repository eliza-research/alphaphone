import fs from 'node:fs';
import {loadAdmittedPatches, PIXEL10A_SOURCE_PATCHES, verifyPixel10aSource} from './pixel10a-source-contract.mjs';
const args=process.argv.slice(2), values={}, patchManifests=[];
for(let i=0;i<args.length;i+=2) {
  if(args[i]==='--admitted-patch' && args[i+1]) { patchManifests.push(args[i+1]); continue; }
  if(!['--aosp-source','--factory-image','--out'].includes(args[i]) || !args[i+1] || args[i+1].startsWith('--') || values[args[i]]) throw Error('Use --aosp-source PATH --factory-image FILE [--admitted-patch MANIFEST.json ...] [--out NEW_FILE]');
  values[args[i]]=args[i+1];
}
// Default: the reviewed patches the image applies; --admitted-patch replaces that list.
const patches=loadAdmittedPatches(process.cwd(), patchManifests.length ? patchManifests : PIXEL10A_SOURCE_PATCHES);
const evidence=await verifyPixel10aSource({source:values['--aosp-source'],factory:values['--factory-image'],patches});
const report=JSON.stringify({...evidence,observedAt:new Date().toISOString()},null,2)+'\n';
if(values['--out']) fs.writeFileSync(values['--out'],report,{flag:'wx'});
console.log(report);
