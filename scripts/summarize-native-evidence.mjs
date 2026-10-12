#!/usr/bin/env node
/** Observed campaign coverage only; never infers current-source or release acceptance. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export function summarizeNativeEvidence(inventory,runs){
 if(!Array.isArray(inventory?.classes))throw Error('Native source inventory required');
 const classes=inventory.classes.map(row=>({name:row.name,qualifiedName:row.qualifiedName,file:row.file,sourceSha256:row.sha256,admission:row.cuttlefishAdmission,gates:row.gates,cohorts:[]}));
 const byName=new Map(classes.map(row=>[row.name,row]));
 if(byName.size!==classes.length)throw Error('Ambiguous duplicate class names in inventory');
 for(const {file,record:r} of runs){
  if(r?.evidenceClass!=='E'||!r.runId||!Number.isFinite(Date.parse(r.createdAt))||!Array.isArray(r.classes)||!Array.isArray(r.apks)||!/^[a-f0-9]{40}$/.test(r.commit||''))throw Error('Malformed evidence: '+file);
  for(const observed of r.classes){
   const name=observed.class?.split('.').at(-1),row=byName.get(name);
   if(!row||row.qualifiedName&&row.qualifiedName!==observed.class)throw Error('Evidence class absent from inventory: '+observed.class);
   if(!['standalone','launcher'].includes(observed.variant)||!['passed','failed','missing','skipped'].includes(observed.status)||!Number.isInteger(observed.passed)||observed.passed<0||!Array.isArray(observed.failed)||!Array.isArray(observed.ignored))throw Error('Malformed class result: '+name);
   const apks=r.apks.filter(a=>a.variant===observed.variant);
   if(apks.length!==2||!['app','test'].every(role=>apks.some(a=>a.role===role&&/^[a-f0-9]{64}$/.test(a.sha256||''))))throw Error('Unbound APK pair: '+name);
   const target={variant:observed.variant,kind:r.emulator?.kind||'avd',image:r.emulator?.image?.fingerprint||r.emulator?.avd,abi:r.emulator?.abi,sdk:r.emulator?.sdk,testMocks:r.testMocks===true,webView:r.webView??null};
   if(!target.image||!target.abi||!target.sdk)throw Error('Missing target identity: '+file);
   const key=JSON.stringify(target);let cohort=row.cohorts.find(c=>c.key===key);
   if(!cohort){cohort={key,target,attempts:[]};row.cohorts.push(cohort);}
   const status=observed.status==='passed'&&observed.ignored.length?'partial':observed.status;
   cohort.attempts.push({file,runId:r.runId,createdAt:r.createdAt,commit:r.commit,dirty:r.dirty===true,apks:apks.map(a=>({role:a.role,sha256:a.sha256,file:a.file})),status,passedMethods:observed.passed,failedMethods:observed.failed,skippedMethods:observed.ignored});
  }
 }
 const counts={unobservedClasses:0,observedClasses:0,latestCohorts:{}};
 for(const row of classes){
  if(!row.cohorts.length)counts.unobservedClasses++;else counts.observedClasses++;
  for(const cohort of row.cohorts){
   cohort.attempts.sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)||a.file.localeCompare(b.file));
   cohort.latest=cohort.attempts.at(-1);delete cohort.key;
   const status=cohort.latest.status;counts.latestCohorts[status]=(counts.latestCohorts[status]||0)+1;
  }
 }
 return {schema:1,generatedAt:new Date().toISOString(),scope:'Historical observed emulator campaigns. Latest means newest receipt within the same variant/image/ABI/SDK/mock cohort. It does not prove source parity, missing methods, provider acceptance, physical hardware or full-image acceptance. Partial retains assumption skips; unobserved is never passing.',counts,classes};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [inventoryFile,output,...files]=process.argv.slice(2);
 if(!inventoryFile||!output||!files.length)throw Error('Usage: summarize-native-evidence.mjs INVENTORY.json OUTPUT.json RESULTS.json...');
 const checked=new Set();
 const runs=files.map(file=>{
  const record=JSON.parse(fs.readFileSync(file,'utf8'));
  for(const apk of record.apks||[]){
   if(checked.has(apk.file+'#'+apk.sha256))continue;
   if(createHash('sha256').update(fs.readFileSync(apk.file)).digest('hex')!==apk.sha256)throw Error('Archived APK changed: '+apk.file);
   const limit=path.join(path.dirname(apk.role==='test'?path.dirname(apk.file):apk.file),'qualification-limit.json');
   if(fs.existsSync(limit)&&JSON.parse(fs.readFileSync(limit,'utf8')).evidenceUsable===false)throw Error('Archive excluded from evidence: '+limit);
   checked.add(apk.file+'#'+apk.sha256);
  }
  return {file,record};
 });
 const report=summarizeNativeEvidence(JSON.parse(fs.readFileSync(inventoryFile,'utf8')),runs);
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(report.counts));
}
