import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
/** Deployment-owned public authorities, never credentials or values supplied by a login response. */
export function validateCloudDeployment(input){
 if(!input||typeof input!=='object'||Object.keys(input).sort().join(',')!=='production,staging')throw Error('Expected production and staging Cloud configuration');
 for(const environment of ['production','staging']){
  const row=input[environment];
  if(!row||!['api,services,tenant,web','api,name,services,tenant,web'].includes(Object.keys(row).sort().join(',')))throw Error('Invalid Cloud configuration fields');
  if(row.name!==undefined&&(typeof row.name!=='string'||!row.name.trim()||row.name!==row.name.trim()||/[\u0000-\u001f\u007f]/.test(row.name)))throw Error('Invalid Cloud service name');
  for(const field of ['api','web','services']){
   const value=row[field];let url;try{url=new URL(value);}catch{throw Error('Invalid Cloud origin');}
   if(typeof value!=='string'||url.protocol!=='https:'||url.origin!==value||url.username||url.password||url.port||!url.hostname.includes('.')||url.hostname.endsWith('.'))throw Error('Cloud origins must be canonical HTTPS origins on the default port');
  }
  if(typeof row.tenant!=='string'||! /^[a-zA-Z0-9_-]{1,128}$/.test(row.tenant))throw Error('Invalid Cloud tenant');
 }
 if(input.production.api===input.staging.api)throw Error('Cloud environments must use distinct API origins');
 return input;
}
export function deploymentOutputs(config){
 validateCloudDeployment(config);
 const fingerprint=createHash('sha256').update(JSON.stringify(['production','staging'].map(env=>['api','web','services','tenant'].map(key=>config[env][key])))).digest('hex');
 const java=['package ai.elizaresearch.alphaphone;','','/** Generated from config/cloud-deployment.json. Run node scripts/cloud-deployment.mjs. */','final class CloudDeployment {',' private CloudDeployment() {}'];
 const ts=['// Generated from config/cloud-deployment.json. Run node scripts/cloud-deployment.mjs.'];
 for(const env of ['production','staging']){
  const row=config[env];
  ts.push(`export const ${env}Cloud = ${JSON.stringify({name:row.name??new URL(row.api).hostname,api:row.api,web:row.web,agents:new URL(row.services).host,tenant:row.tenant})} as const;`);
  for(const [key,value] of Object.entries({...row,apiHost:new URL(row.api).host,webHost:new URL(row.web).host,servicesHost:new URL(row.services).host}))java.push(` static final String ${env.toUpperCase()}_${key.replace(/[A-Z]/g,c=>'_'+c).toUpperCase()} = ${JSON.stringify(value)};`);
 }
 java.push(` static final String STORAGE_NAMESPACE = "cloud-deployment:${fingerprint}:";`,
  ' static String storageSlot(String name) {',
  '  return name != null && (name.startsWith("cloud:") || name.startsWith("cloud-signin:") || name.equals("local-agent-provider:v1")) ? STORAGE_NAMESPACE + name : name;',
  ' }','}');
 ts.push(`export const cloudStorageNamespace = "cloud-deployment:${fingerprint}:";`,
  'export function cloudStorageSlot(name:string):string { return name.startsWith("cloud:") || name.startsWith("cloud-signin:") || name === "local-agent-provider:v1" ? cloudStorageNamespace + name : name; }');
 return {'apps/app/src/runtime/cloud-deployment.generated.ts':ts.join('\n')+'\n','android/app/src/main/java/ai/elizaresearch/alphaphone/CloudDeployment.java':java.join('\n')+'\n'};
}
export function checkCloudDeployment(directory=root){
 const outputs=deploymentOutputs(JSON.parse(fs.readFileSync(path.join(directory,'config/cloud-deployment.json'),'utf8')));
 for(const [name,contents] of Object.entries(outputs)){
  const file=path.join(directory,name);
  if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==contents)throw Error('Stale Cloud deployment output: '+name+'; run node scripts/cloud-deployment.mjs');
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.includes('--check'))checkCloudDeployment();
 else for(const [name,contents] of Object.entries(deploymentOutputs(JSON.parse(fs.readFileSync(path.join(root,'config/cloud-deployment.json'),'utf8')))))fs.writeFileSync(path.join(root,name),contents);
}
