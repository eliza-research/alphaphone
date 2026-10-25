import { requestAuthCode } from './auth-code-prompt';
import { CloudLogin, type LoginResult } from './cloud-login';
import { cloudCredentialSlot } from './cloud-deployment.ts';
import { authenticateAlpha, AlphaAuthError, type AlphaAuthPending, type AlphaAuthHost } from './alpha-auth';
import { registerPlugin } from '../platform-plugins';
import type { CloudNativeRequest, CloudCredentialStore, CloudCredential } from './cloud-protocol';
import type { RemoteRequester, RemoteCredentialStore } from './remote-protocol';
import type { GmailReturnHost, GmailPending } from './alpha-gmail';

const native = registerPlugin<{
  request(input: { requestId: string; url: string; method: string; headers: Record<string,string>; body?: string }): Promise<{status:number;data:unknown}>;
  cancel(input:{requestId:string}):Promise<void>;
  secureRead(input:{slot:string}):Promise<{value:string|null}>;
  secureWrite(input:{slot:string;value:string}):Promise<void>;
  secureCompareExchange(input:{slot:string;expectedValue:string|null;value:string|null}):Promise<{status:"saved"|"conflict"}>;
  secureRemove(input:{slot:string}):Promise<void>;
  openAuth(input:{url:string}):Promise<void>;
  readAuthCallback():Promise<{url:string|null}>;
  clearAuthCallback():Promise<void>;
  readGmailCallback():Promise<{url:string|null}>;
  clearGmailCallback():Promise<void>;
  openExternal(input:{url:string}):Promise<void>;
}>('AlphaConnection');

export const secureConnectionStore = {
  async read<T>(slot:string):Promise<T|null> {
    const result=await native.secureRead({slot});
    return result.value===null ? null : JSON.parse(result.value) as T;
  },
  async write(slot:string,value:unknown) { await native.secureWrite({slot,value:JSON.stringify(value)}); },
  async compareExchange(slot:string,expected:unknown|null,value:unknown|null) { return native.secureCompareExchange({slot,expectedValue:expected===null?null:JSON.stringify(expected),value:value===null?null:JSON.stringify(value)}); },
  async remove(slot:string) { await native.secureRemove({slot}); },
};
// Serialize credential operations so a cancellation cleanup cannot erase a later login.
let storageQueue:Promise<unknown>=Promise.resolve();
function serial<T>(operation:()=>Promise<T>):Promise<T> {
  const result=storageQueue.then(operation,operation);storageQueue=result.catch(()=>{});return result;
}
export const cloudCredentialStore:CloudCredentialStore={
  read:environment=>serial(async()=>{
    const value=await secureConnectionStore.read<CloudCredential>(cloudCredentialSlot(environment));
    if(value&&!value.credentialId){value.credentialId=crypto.randomUUID();await secureConnectionStore.write(cloudCredentialSlot(environment),value);}
    return value;
  }),
  write:(environment,value,signal)=>serial(async()=>{
    signal.throwIfAborted();
    await secureConnectionStore.write(cloudCredentialSlot(environment),{...value,credentialId:crypto.randomUUID()});
    if(signal.aborted){await secureConnectionStore.remove(cloudCredentialSlot(environment));signal.throwIfAborted();}
  }),
  clear:environment=>serial(()=>secureConnectionStore.remove(cloudCredentialSlot(environment))),
};
export const remoteCredentialStore:RemoteCredentialStore={
  read:origin=>serial(()=>secureConnectionStore.read(`remote:${origin}`)),
  write:record=>serial(()=>secureConnectionStore.write(`remote:${record.origin}`,record)),
  remove:origin=>serial(()=>secureConnectionStore.remove(`remote:${origin}`)),
};
export const nativeCloudRequest:CloudNativeRequest=async input=>{
  input.signal.throwIfAborted();
  const requestId=crypto.randomUUID();
  let rejectAbort:(reason:unknown)=>void=()=>{};
  const interrupted=new Promise<never>((_,reject)=>{rejectAbort=reject;});
  const cancel=()=>{void native.cancel({requestId}).catch(()=>{});rejectAbort(input.signal.reason||new DOMException('Cancelled','AbortError'));};
  input.signal.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(()=>{void native.cancel({requestId}).catch(()=>{});rejectAbort(new Error('Connection timed out'));},input.timeoutMs);
  try {
    // Issue first, then check again: native cancel targets an already-dispatched ID.
    const response=native.request({requestId,url:input.url,method:input.method,headers:input.headers,...(input.body===undefined?{}:{body:JSON.stringify(input.body)})});
    if(input.signal.aborted)cancel();
    return await Promise.race([response,interrupted]);
  }finally{clearTimeout(timer);input.signal.removeEventListener('abort',cancel);}
};
export const nativeRemoteRequest:RemoteRequester=async input=>{
  const response=await nativeCloudRequest({url:input.url,method:input.method,headers:input.headers,
    body:input.body===undefined?undefined:JSON.parse(input.body),signal:input.signal||new AbortController().signal,timeoutMs:120000,redirect:'error'});
  return {status:response.status,body:response.data};
};
export async function openConnectionBrowser(url:string,signal:AbortSignal) {
  signal.throwIfAborted();await native.openExternal({url});signal.throwIfAborted();
}

export const alphaAuthHost: AlphaAuthHost = {
  read: () => secureConnectionStore.read<AlphaAuthPending>('alpha-auth:pending:v1'),
  write: value => secureConnectionStore.write('alpha-auth:pending:v1', value),
  clear: () => secureConnectionStore.remove('alpha-auth:pending:v1'),
  open: url => native.openAuth({url}),
  callback: async () => (await native.readAuthCallback()).url,
  clearCallback: () => native.clearAuthCallback(),
};
export const alphaGmailHost: GmailReturnHost = {
  read: () => secureConnectionStore.read<GmailPending>('alpha-gmail:pending:v1'),
  replace: async (expected,value) => (await secureConnectionStore.compareExchange('alpha-gmail:pending:v1',expected,value)).status==='saved',
  callback: async () => (await native.readGmailCallback()).url,
  clearCallback: () => native.clearGmailCallback(),
  open: url => native.openAuth({url}),
};
let interactiveAuthenticationActive = false;
export async function clearAlphaAuthenticationPurpose(purpose: string) {
  if (interactiveAuthenticationActive) return;
  interactiveAuthenticationActive = true;
  try {
    const pending = await alphaAuthHost.read();
    if (!pending || pending.purpose !== purpose) return;
    const result = await secureConnectionStore.compareExchange('alpha-auth:pending:v1', pending, null);
    if (result.status === 'saved') await alphaAuthHost.clearCallback();
  } finally { interactiveAuthenticationActive = false; }
}
export async function nativeAlphaAuthenticate(environment: 'production' | 'staging', signal: AbortSignal, purpose = 'account') {
  if (interactiveAuthenticationActive) throw new AlphaAuthError('unavailable');
  interactiveAuthenticationActive = true;
  try { return await authenticateAlpha(environment, nativeCloudRequest, {...alphaAuthHost, completeMfa: async (challenge, authSignal) => {
    const client = new CloudLogin(environment, nativeCloudRequest);
    let result: LoginResult = {mfa:challenge};
    while ('mfa' in result) {
      const code = await requestAuthCode(result.mfa.type, result.mfa.expiresAt, authSignal);
      authSignal.throwIfAborted();
      result = await client.completeMfa(result.mfa, code.value, authSignal, code.recovery);
    }
    authSignal.throwIfAborted();return result.token;
  }}, signal, purpose); }
  finally { interactiveAuthenticationActive = false; }
}
