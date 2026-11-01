import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

// The real controller sign-in source from connection-ui.tsx (cancelSignIn through signInGoogle, signedIn,
// verifyService, signInFailed), optionally with the real work() and the real resident path
// (residentSignedIn, admitCloudResident, which replaces the client through makeCloud), against the supplied client.
export async function googleControllerHarness(client,store,{realWork=false,resident=false,makeCloud=()=>client,owner,org}={}){
 const source=await readFile(new URL('../../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
 const cut=(from,to,wrap=code=>code)=>{const start=source.search(from),end=source.indexOf(to,start);assert.ok(start>=0&&end>start);return stripTypeScriptTypes(wrap(source.slice(start,end)),{mode:'transform'});};
 // Also locates the synchronous pre-guard method, so these cases run against the base controller too.
 const methods=cut(/^  (?:async )?cancelSignIn\(\) \{/m,'  /** Sends a six-digit code',code=>'({'+code+'})');
 const code=[cut(/^function signInFailed\(/m,'/** The provider authenticated only'),cut(/^async function verifyService\(/m,'let pendingBillingReview:'),cut(/^async function signedIn\(/m,'/** The development hosted-agent client.'),
  ...(realWork?[cut(/^async function work\(/m,'/** Start (or restart) the resident.',code=>'work='+code)]:[]),
  ...(resident?[cut(/^async function residentSignedIn\(/m,'/** The key is stored;'),cut(/^async function admitCloudResident\(/m,'/**\n * Cloud reported, on a background refresh')]:[])].join('\n');
 const serviceSlot=source.match(/const CLOUD_SERVICE = ('[^']+');/);assert.ok(serviceSlot);
 return new Function('client','store','makeCloud','code','methods','crypto','CLOUD_SERVICE','RESIDENT','OWNER','ORG',`
 let operation=null,googleSignInGeneration=0,cloud=client,service=null,membershipRead=null,pendingBillingReview=null,signInReadinessOwner=null,residentStartInBackground=false,entitlementRefresher=null;
 const state={signIn:{step:'choose',environment:'production'},open:true,purpose:RESIDENT?'agent':'cloud-account',error:'',busy:false},listeners=new Set(),log=[];
 const update=patch=>{Object.assign(state,patch);for(const listener of [...listeners])listener();},signInClient=environment=>{if(cloud.environment!==environment)cloud=makeCloud(environment);return cloud;};
 const cloudCredentialStore=store,CloudProtocolError=Error,localStorage={setItem(){}},refreshMembershipBalance=()=>{};
 const productionCloudSignInRequired=()=>false,explicitSignedOutCloudEntry=()=>false,ensureResident=async()=>{log.push('ensureResident');},showGoogleMfa=()=>{throw Error('No MFA');};
 const residentCloudFlow=()=>RESIDENT,residentEnvironment=()=> 'production',residentAlwaysPresent=true,prepareSignInReplacement=()=>{},showPostSignInSetup=()=>{log.push('setup');},save=()=>{},hosted=null,active=true,cloudServiceName=()=> 'Cloud';
 const residentRecoveryReason=()=>null,testMocksEnabled=false,expired=()=>false,retire=()=>{log.push('retire');},detachService=()=>{},runQueuedResidentRebind=()=>{},runQueuedSignInReturn=()=>{},errorMessage=error=>String(error?.message??error);
 // Resident admission as the shared binding controller reports an admitted plan for the stored credential.
 const stopEntitlementRefresh=()=>{},isEntitlementSignInFailure=()=>false,CloudResidentBindingError=class extends Error{},OFFLINE_NOTICE='offline',EntitlementRefresher=class{},checkEntitlement=async()=>null,planAdmission=()=> 'admit',residentPlanEnded=()=>{},residentRefreshRefused=()=>{};
 const residentBindingController=(_environment,_client,callbacks)=>({recordAdmission(){},admit:async signal=>{const {credentialId}=await store.read('production');signal.throwIfAborted();const account={userId:OWNER,organizationId:ORG,credentialId,environment:'production'};service=account;callbacks.verified(account);update({cloudAccount:account});callbacks.checked({entitlement:{},view:{kind:'active',source:'plan'}});return {reason:'admitted',plan:{view:{kind:'active'}},identity:{userId:OWNER,organizationId:ORG,credentialId},endsAt:null};}});
 const connectResident=async(signal,admission)=>{signal.throwIfAborted();log.push('connectResident:'+admission.binding);};
 let work=async(_message,action)=>{operation=new AbortController();try{await action(operation.signal);}finally{operation=null;}};
 eval(code);
 const connectionController={cancel(){operation?.abort(new DOMException('Cancelled','AbortError'));cloud.cancelLogin();},close(){},subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);}};
 const actions=eval(methods);
 return {actions,state,log,genericAbort(){operation.abort(new DOMException('Cancelled','AbortError'));},supersede(){googleSignInGeneration++;for(const listener of listeners)listener();},get adopted(){return !!state.cloudAccount;},get operation(){return operation;},get cloud(){return cloud;}};
 `)(client,store,makeCloud,code,methods,crypto,serviceSlot[1].slice(1,-1),resident,owner,org);
}
