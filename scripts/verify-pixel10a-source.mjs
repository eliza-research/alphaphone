import fs from 'node:fs';
import {verifyPixel10aSource} from './pixel10a-source-contract.mjs';
const args=process.argv.slice(2), values={};
for(let i=0;i<args.length;i+=2) {
  if(!['--aosp-source','--factory-image','--out'].includes(args[i]) || !args[i+1] || args[i+1].startsWith('--') || values[args[i]]) throw Error('Use --aosp-source PATH --factory-image FILE [--out NEW_FILE]');
  values[args[i]]=args[i+1];
}
const evidence=await verifyPixel10aSource({source:values['--aosp-source'],factory:values['--factory-image']});
const report=JSON.stringify({...evidence,observedAt:new Date().toISOString()},null,2)+'\n';
if(values['--out']) fs.writeFileSync(values['--out'],report,{flag:'wx'});
console.log(report);
