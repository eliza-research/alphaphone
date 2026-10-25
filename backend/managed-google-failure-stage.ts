/** Private diagnostic correlation only. No request, identity, or provider data. */
export type ManagedGoogleFailureStage='credential'|'signal'|'client'|'identity'|'accounts'|'account-projection'|'credential-recheck'|'permission-recheck'|'calendar-sources'|'request-validation'|'fetch'|'response-json';
const stages=new WeakMap<object,ManagedGoogleFailureStage>();
export function recordManagedGoogleFailure(error:unknown,stage:ManagedGoogleFailureStage):void {
 try{if(error!==null&&(typeof error==='object'||typeof error==='function')&&!stages.has(error))stages.set(error,stage);}catch{/* Diagnostics never change the original error. */}
}
export function managedGoogleFailureStage(error:unknown):ManagedGoogleFailureStage|undefined {
 try{return error!==null&&(typeof error==='object'||typeof error==='function')?stages.get(error):undefined;}catch{return;}
}
