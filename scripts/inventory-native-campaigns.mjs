#!/usr/bin/env node
/** Enumerate native campaign admission and omissions; never execute device commands. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CLASS_REGISTRY, CAMPAIGN_RUNNERS, NOT_RUN_BY_A_RUNNER} from './android-instrumentation.mjs';
const output=process.argv[2];
if(!output)throw Error('Usage: node scripts/inventory-native-campaigns.mjs OUTPUT.json');
const roots=['android/app/src/androidTest','android/app/src/testMocks/androidTest'];
const campaigns=CAMPAIGN_RUNNERS.map(file=>({file,source:fs.readFileSync(file,'utf8')}));
const classes=[];
for(const root of roots){
 for(const relative of fs.readdirSync(root,{recursive:true}).filter(file=>file.endsWith('.java')).sort()){
  const file=path.join(root,relative),source=fs.readFileSync(file,'utf8');
  if(!/[\s;{}]@(?:org\.junit\.)?Test\b/.test(source))continue;
  const name=path.basename(file,'.java'),short=name.replace(/InstrumentedTest$/,'');
  const spec=name.endsWith('InstrumentedTest')?CLASS_REGISTRY[short]:undefined;
  const references=campaigns.filter(c=>new RegExp(`\\b${name}\\b`).test(c.source)).map(c=>c.file);
  const gates=[];
  let admission='no-cuttlefish-campaign';
  if(spec){
   if(spec.campaign)gates.push(spec.campaign);
   else {
    admission='named-class';
    if(spec.secondaryUser)gates.push('fresh secondary user with cleanup proof');
    if(spec.testMocks||spec.requiresTestMocksBuild||short==='BrowserDownload')gates.push('--test-mocks');
    if(spec.requires)gates.push(spec.requires);
    if(spec.offline)gates.push('--offline-speech (Cuttlefish)');
    if(spec.homeRole)gates.push('--home-role','launcher variant');
   }
  }
  classes.push({name,qualifiedName:(source.match(/\bpackage\s+([A-Za-z0-9_.]+)\s*;/)?.[1]||'')+'.'+name,file,sha256:createHash('sha256').update(source).digest('hex'),
   status:'not-executed',cuttlefishAdmission:admission,gates,
   instrumentationArgs:spec?.args??{},phases:spec?.phases??[],note:spec?.note??null,
   otherCampaignReferences:references,uncoveredReason:NOT_RUN_BY_A_RUNNER[short]??null});
 }
}
const counts={};for(const c of classes)counts[c.cuttlefishAdmission]=(counts[c.cuttlefishAdmission]??0)+1;
const report={generatedAt:new Date().toISOString(),scope:'Source inventory and runner admission only. named-class does not mean executed or passing. Other campaign references are lexical, not Cuttlefish compatibility. All native/provider/hardware assumptions and method-level skips must remain visible in execution results.',requiredInputs:['fresh owned guest without Alpha packages','exact image fingerprint','source-matched APK and test hashes','explicit fixture/role/clock opt-ins where listed'],counts,classes};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({classes:classes.length,counts,output}));
