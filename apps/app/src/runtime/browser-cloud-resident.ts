import {managedServiceRequest} from './managed-service-routes.ts';
import {Capacitor} from '@capacitor/core';
/** Explicit loopback development host with real Cloud services; never enabled in built artifacts. */
export const browserCloudResidentEnabled=import.meta.env!==undefined&&import.meta.env.DEV===true&&import.meta.env.VITE_ALPHA_CLOUD_RESIDENT==='1'&&!Capacitor.isNativePlatform();
export const browserCloudResidentEnvironment=browserCloudResidentEnabled&&import.meta.env.VITE_ALPHA_CLOUD_ENVIRONMENT==='staging'?'staging':'production';
export async function browserResidentCall(operation:'residentBind'|'residentClear'|'residentStatus'|'residentStart',credentialId?:string){
 if(!browserCloudResidentEnabled)throw Error('Cloud resident host unavailable');
 const response=await fetch('/__alpha-browser-cloud',{method:'POST',headers:{'Content-Type':'application/json','X-Alpha-Browser-Cloud':'1'},body:JSON.stringify({operation,environment:browserCloudResidentEnvironment,credentialId}),signal:AbortSignal.timeout(120000),redirect:'error'});
 if(!response.ok)throw Error('Cloud resident binding unavailable');
 return response.json();
}

/** Reuse the production route policy for one exact, explicitly selected development issuer. */
export function browserCloudManagedServiceAllowed(input:string,method:string,hasBody=false):boolean {
 if(browserCloudResidentEnabled&&browserCloudResidentEnvironment==='staging'){
  let url:URL;try{url=new URL(input);}catch{return false;}
  if(url.origin!=='https://api-staging.eliza.app')return false;
  // Policy comparison only. The transport still dispatches the original staging URL.
  url.hostname='api.eliza.app';
  return managedServiceRequest(url.href,method,hasBody);
 }
 return managedServiceRequest(input,method,hasBody);
}
