import type {CloudEnvironment, GmailAccount} from './cloud-protocol';
export type GmailPermission = 'read' | 'send' | 'drafts' | 'mailbox';
export interface GmailOwner {environment: CloudEnvironment; userId: string; organizationId?: string; credentialId: string}
export interface GmailPending extends GmailOwner {state: string; permission: GmailPermission; expiresAt: number}
export interface GmailReturnHost {
  read(): Promise<GmailPending | null>;
  replace(expected: GmailPending | null, value: GmailPending | null): Promise<boolean>;
  callback(): Promise<string | null>;
  clearCallback(): Promise<void>;
  open(url: string): Promise<void>;
}
export function gmailReturnURL(environment: CloudEnvironment, state?: string) {
  const url = new URL(`https://alphacompute.ai/alphaphone/gmail/${environment === 'staging' ? 'staging/' : ''}callback`);
  if (state !== undefined) { if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw Error('Invalid Gmail return state'); url.searchParams.set('state', state); }
  return url.href;
}
function valid(p: GmailPending | null): p is GmailPending {
  return !!p && ['production','staging'].includes(p.environment) && typeof p.userId === 'string' && !!p.userId && typeof p.credentialId === 'string' && !!p.credentialId && ['read','send','drafts','mailbox'].includes(p.permission) && /^[A-Za-z0-9_-]{43}$/.test(p.state) && Number.isFinite(p.expiresAt) && p.expiresAt > Date.now() && p.expiresAt <= Date.now()+600_000;
}
function sameOwner(p: GmailOwner, owner: GmailOwner) { return p.environment===owner.environment && p.userId===owner.userId && p.organizationId===owner.organizationId && p.credentialId===owner.credentialId; }
export async function activeGmailAttempt(owner: GmailOwner, host: GmailReturnHost) {
  const pending=await host.read();return valid(pending)&&sameOwner(pending,owner)?pending:null;
}
export async function cancelAlphaGmail(owner: GmailOwner, host: GmailReturnHost) {
  const pending=await host.read();
  if(!pending||!sameOwner(pending,owner))return false;
  if(!await host.replace(pending,null))throw Error('Gmail authorization changed');
  await host.clearCallback();return true;
}
export type GmailCallback = {result: 'connected'; connectionId: string} | {result: 'denied'|'failed'; connectionId: null};
export function parseGmailReturn(raw: string, pending: GmailPending): GmailCallback|null {
  try {
    const url=new URL(raw), expected=new URL(gmailReturnURL(pending.environment));
    const exact=url.origin===expected.origin && url.pathname===expected.pathname;
    const fallback=url.protocol==='alphaphone:' && url.hostname==='gmail' && url.pathname===`/${pending.environment}`;
    if ((!exact&&!fallback)||url.username||url.password||url.port||url.search||!url.hash) return null;
    const p=new URLSearchParams(url.hash.slice(1)), keys=[...p.keys()];
    if(new Set(keys).size!==keys.length||p.get('state')!==pending.state) return null;
    const result=p.get('result'),connectionId=p.get('connectionId');
    if(result==='connected'&&keys.length===3&&connectionId&&/^[A-Za-z0-9_-]{1,128}$/.test(connectionId))return {result,connectionId};
    return (result==='denied'||result==='failed')&&keys.length===2?{result,connectionId:null}:null;
  } catch {return null;}
}
export async function pendingGmailReturn(owner: GmailOwner, host: GmailReturnHost) {
  const pending=await activeGmailAttempt(owner,host);
  if(!pending)return null;
  const raw=await host.callback(), result=raw?parseGmailReturn(raw,pending):null;
  return result?{pending,...result}:null;
}
export async function beginAlphaGmail(owner: GmailOwner, permission: GmailPermission, host: GmailReturnHost, initiate: (state: string)=>Promise<string>, signal: AbortSignal) {
  signal.throwIfAborted();const prior=await host.read();signal.throwIfAborted();
  if(valid(prior))throw Error('A Gmail authorization is already pending. Finish it or try again after it expires.');
  const state=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const pending:GmailPending={...owner,permission,state,expiresAt:Date.now()+600_000};
  if(!await host.replace(prior,pending))throw Error('Gmail authorization changed');
  try {
    signal.throwIfAborted();await host.clearCallback();signal.throwIfAborted();
    const url=await initiate(state);signal.throwIfAborted();
    await host.open(url);signal.throwIfAborted();
  } catch(error) {await host.replace(pending,null);throw error;}
}
export async function finishAlphaGmail(owner: GmailOwner, host: GmailReturnHost, refresh: ()=>Promise<GmailAccount[]>, signal: AbortSignal) {
  signal.throwIfAborted();const returned=await pendingGmailReturn(owner,host);signal.throwIfAborted();if(!returned)return null;
  const {pending,result,connectionId}=returned;
  // A return URL is never evidence of permissions. A failed read keeps the pending
  // return so a later foreground check can retry this read-only verification.
  const accounts=result==='connected'?await refresh():null;
  signal.throwIfAborted();
  if(!await host.replace(pending,null))throw Error('Gmail authorization changed');
  await host.clearCallback();signal.throwIfAborted();
  const capability=pending.permission==='read'?'google.gmail.triage':`google.gmail.${pending.permission}`;
  const connected=accounts?.some(a=>a.connectionId===connectionId && a.connected && a.grantedCapabilities.includes('google.gmail.triage') && a.grantedCapabilities.includes(capability));
  return {result:result==='connected'?(connected?'connected' as const:'missing-permission' as const):result,accounts,connectionId};
}
