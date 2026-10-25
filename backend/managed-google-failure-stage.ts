/** Private diagnostic correlation only. No request, identity, or provider data. */
export type ManagedGoogleFailureStage='credential'|'signal'|'client'|'identity'|'accounts'|'account-projection'|'credential-recheck'|'permission-recheck'|'calendar-sources'|'request-validation'|'fetch'|'response-json';
const stages=new WeakMap<object,ManagedGoogleFailureStage>();
export function recordManagedGoogleFailure(error:unknown,stage:ManagedGoogleFailureStage):void {
 try{if(error!==null&&(typeof error==='object'||typeof error==='function')&&!stages.has(error))stages.set(error,stage);}catch{/* Diagnostics never change the original error. */}
}
export function managedGoogleFailureStage(error:unknown):ManagedGoogleFailureStage|undefined {
 try{return error!==null&&(typeof error==='object'||typeof error==='function')?stages.get(error):undefined;}catch{return;}
}
/** Exact transport constants only; never serialize error/cause objects or messages. */
const transportCodes=[
 'ERR_INVALID_ARG_TYPE','ERR_INVALID_ARG_VALUE','ERR_INVALID_THIS','ERR_INVALID_URL','ERR_UNESCAPED_CHARACTERS',
 'ERR_PROXY_TUNNEL','ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ECONNRESET','ETIMEDOUT','EHOSTUNREACH','ENETUNREACH','EPIPE',
 'ConnectionRefused','ConnectionClosed','Timeout',
 'CERT_HAS_EXPIRED','CERT_NOT_YET_VALID','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN',
 'UNABLE_TO_GET_ISSUER_CERT','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','UNABLE_TO_VERIFY_LEAF_SIGNATURE',
 'ERR_TLS_CERT_ALTNAME_INVALID','CERT_SIGNATURE_FAILURE',
] as const;
export type ManagedGoogleTransportCode=typeof transportCodes[number];
const allowedTransportCodes=new Set<string>(transportCodes);
function ownData(value:unknown,key:'code'|'cause'):unknown {
 try{if(value===null||(typeof value!=='object'&&typeof value!=='function'))return;const property=Object.getOwnPropertyDescriptor(value,key);return property&&'value'in property?property.value:undefined;}catch{return;}
}
export function managedGoogleTransportCodes(error:unknown):{transportCode?:ManagedGoogleTransportCode;causeTransportCode?:ManagedGoogleTransportCode} {
 const code=ownData(error,'code'),causeCode=ownData(ownData(error,'cause'),'code');
 return {
  ...(typeof code==='string'&&allowedTransportCodes.has(code)?{transportCode:code as ManagedGoogleTransportCode}:{}),
  ...(typeof causeCode==='string'&&allowedTransportCodes.has(causeCode)?{causeTransportCode:causeCode as ManagedGoogleTransportCode}:{}),
 };
}
