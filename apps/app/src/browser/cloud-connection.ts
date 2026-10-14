import {googleAuthorizationUrlAllowed} from '../runtime/google-authorization';
import {WebPlugin} from '@capacitor/core';

const endpoint='/__alpha-browser-cloud';
const references=new Map<string,string|null>();
export async function browserCloudCall(data:Record<string,unknown>,signal?:AbortSignal):Promise<Response>{
 return fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Alpha-Browser-Cloud':'1'},body:JSON.stringify(data),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000),redirect:'error'});
}
async function rpc(data:Record<string,unknown>,signal?:AbortSignal){const response=await browserCloudCall(data,signal);if(!response.ok)throw Object.assign(Error('Cloud development connection unavailable.'),{status:response.status});return response.json();}
/** Development host storage references only. Cloud bearers never enter browser storage. */
export class BrowserCloudConnection extends WebPlugin {
 async request(input:{requestId:string;url:string;method:string;headers:Record<string,string>;body?:string;credentialReference?:string}){
  const host=new URL(input.url).hostname,environment=host==='api.eliza.app'?'production':host==='api-staging.eliza.app'?'staging':undefined;
  if(!environment)throw Error('Cloud development authority unavailable');
  const response=await browserCloudCall({operation:'request',requestId:input.requestId,environment,input}),data=await response.json();
  return response.ok?data:{status:response.status,data};
 }
 async cancel(input:{requestId:string}){await rpc({operation:'cancel',requestId:input.requestId});}
 async secureRead(input:{slot:string}){
  const result=await rpc({operation:'secureRead',...input});
  references.set(input.slot,result.value===null?null:JSON.parse(result.value).credentialReference);return result;
 }
 async secureWrite(input:{slot:string;value:string}){
  await rpc({operation:'secureWrite',...input,previousReference:references.get(input.slot)??null});references.set(input.slot,JSON.parse(input.value).credentialReference);
 }
 async secureRemove(input:{slot:string}){await rpc({operation:'secureRemove',...input,previousReference:references.get(input.slot)??null});references.set(input.slot,null);}
 async secureCompareExchange(input:{slot:string;expectedValue:string|null;value:string|null}){
  const result=await rpc({operation:'secureCompareExchange',...input,previousReference:references.get(input.slot)??null});if(result.status==='saved')references.set(input.slot,input.value===null?null:JSON.parse(input.value).credentialReference);return result;
 }
 async openExternal(input:{url:string;requestId:string}){
  const url=new URL(input.url),login=['eliza.app','staging.eliza.app'].includes(url.hostname)&&url.pathname==='/auth/cli-login'&&/^[0-9a-f-]{36}$/i.test(url.searchParams.get('session')??'')&&[...url.searchParams.keys()].every(k=>k==='session');
  const billing=['cloud.eliza.app','cloud-staging.eliza.app'].includes(url.hostname)&&url.pathname==='/cloud/billing'&&!url.search;
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.port||!login&&!billing&&!googleAuthorizationUrlAllowed(url.href))throw Error('Unsupported Cloud browser destination');
  const opened=window.open(url.href,'_blank');if(!opened)throw Error('Allow the Cloud sign-in window, then try again.');opened.opener=null;
 }
}
/** Binds native-compatible voice calls to the current host reference and account generation. */
export async function browserCloudCredential(environment:string,credentialId:string,signal:AbortSignal){
 const stored=await rpc({operation:'secureRead',slot:'cloud:'+environment},signal),credential=stored.value===null?null:JSON.parse(stored.value);signal.throwIfAborted();
 if(!credential?.credentialReference)throw Object.assign(Error('Sign in to Eliza Cloud before using voice.'),{code:'voice-http-401',status:401});
 if(credential.credentialId!==credentialId)throw new DOMException('Cloud account changed','AbortError');return credential;
}
export async function browserCloudVoice(input:{environment:string;credentialId:string;requestId:string},operation:'stt'|'tts',payload:Blob|string,signal:AbortSignal):Promise<Response>{
 const credential=await browserCloudCredential(input.environment,input.credentialId,signal);
 const values={operation,environment:input.environment,credentialId:input.credentialId,requestId:input.requestId,credentialReference:credential.credentialReference};let response:Response;
 if(operation==='stt'){
  if(!(payload instanceof Blob))throw Error('Recorded audio required');const form=new FormData();for(const [key,value]of Object.entries(values))form.append(key,value);form.append('audio',payload,'recording');
  response=await fetch(endpoint,{method:'POST',headers:{'X-Alpha-Browser-Cloud':'1'},body:form,signal:AbortSignal.any([signal,AbortSignal.timeout(120000)]),redirect:'error'});
 }else response=await browserCloudCall({...values,text:payload},signal);
 signal.throwIfAborted();if(!response.ok){await response.body?.cancel();throw Object.assign(Error('Cloud voice request failed.'),{code:'voice-http-'+response.status,status:response.status});}return response;
}
