import {registerPlugin} from '../platform-plugins';
import {isAndroid} from '../native';
export interface GmailBackgroundStatus {status:string;lastSyncAt?:number;incompleteCatchup?:boolean;uncertainNotices?:number;deniedNotices?:number;notificationsAllowed?:boolean;grantId?:string}
export interface GmailNoticeTap {token:string;grantId:string;credentialId:string;userId:string;generation:string;question?:boolean;messageId?:string;threadId?:string}
const native=registerPlugin<{
 configure(input:{credentialId:string;grantId:string}):Promise<GmailBackgroundStatus>;
 withdraw(input?:{grantId?:string}):Promise<void>;
 status():Promise<GmailBackgroundStatus>;
 pending():Promise<Partial<GmailNoticeTap>>;
 releaseQuestion(input:{token:string}):Promise<void>;
 consume(input:{token:string}):Promise<void>;
 notificationSettings():Promise<void>;
 addListener(name:'pendingMail',handler:()=>void):Promise<{remove():Promise<void>}>;
}>('AlphaGmail');
export const GMAIL_BACKGROUND_CHANGED='alpha:gmail-background-changed';
const changed=()=>window.dispatchEvent(new Event(GMAIL_BACKGROUND_CHANGED));
export async function configureGmailBackground(credentialId:string,grantId:string):Promise<void>{if(!isAndroid)return;try{if(grantId)await native.configure({credentialId,grantId});else await native.withdraw();}finally{changed();}}
export async function withdrawGmailBackground(grantId?:string):Promise<void>{if(!isAndroid)return;await native.withdraw(grantId?{grantId}:undefined);changed();}
/**
 * Retire native state for a grant around an explicit revoke without letting local
 * bookkeeping block it. Starts immediately; `settled` retries once after the revoke
 * and never rejects (native sync and taps re-verify the grant and fail closed).
 */
export function retireGmailBackground(grantId:string):{settled():Promise<void>}{
 const first=withdrawGmailBackground(grantId).then(()=>true,()=>false);
 return {async settled(){if(!(await first))await withdrawGmailBackground(grantId).catch(()=>{});}};
}
export async function gmailBackgroundStatus():Promise<GmailBackgroundStatus>{if(!isAndroid)return {status:'web-unavailable'};try{return await native.status();}catch{return {status:'unavailable'};}}
export function gmailBackgroundMessage(value:GmailBackgroundStatus):string{
 const checked=value.lastSyncAt?` Last successful check: ${new Date(value.lastSyncAt).toLocaleString()}.`:' No successful background check yet.';
 const suffix=checked+' Android may delay checks in Doze or battery saver. Open Inbox to check current mail.';
 if(value.status==='web-unavailable')return 'Background Gmail notices are available in the Android app.';
 if(value.status==='provider-unsupported')return 'Background Gmail checks currently require Cloud as this phone\'s agent inference provider. Inbox still checks mail while it is open.';
 if(value.status==='disabled')return 'Open Inbox and select a connected Gmail account to enable background checks.';
 if(value.status==='unsupported')return 'Background Gmail is unavailable on this server. Open Inbox to check mail.'+checked;
 if(value.status==='grant-unavailable')return 'Gmail background checks need the matching Cloud sign-in and Google read access. Recheck the account in Inbox.';
 if(value.status==='capacity-reached')return 'Gmail notice history is full. Background catch-up is incomplete; open Inbox to review current mail.';
 if(value.status==='retrying'||value.status==='unavailable')return 'Gmail background checks are unavailable or waiting to retry. Saved progress is retained.'+suffix;
 const phase=value.status==='history-expired'?'Gmail history expired. Earlier missed messages were not reconciled.':value.status==='catching-up'?'Gmail changes are still being reconciled.':'Watching for new unread Inbox messages. Earlier mailbox changes were not backfilled.';
 return phase+(value.notificationsAllowed===false?' Android notifications or this channel are disabled.':'')+(value.uncertainNotices?' Some notification attempts have unknown outcomes and will not be repeated.':'')+suffix;
}
export const gmailNotificationSettings=()=>native.notificationSettings();
/** Native validates the persisted owner/grant again before returning a tap; renderer validates current UI ownership too. */
export async function pendingGmailNotice():Promise<GmailNoticeTap|null>{if(!isAndroid)return null;const tap=await native.pending();return typeof tap.token==='string'&&typeof tap.grantId==='string'&&typeof tap.credentialId==='string'&&typeof tap.userId==='string'&&typeof tap.generation==='string'?tap as GmailNoticeTap:null;}
export async function consumeGmailNotice(token:string){if(isAndroid)await native.consume({token});}
const noListener={remove:async()=>{}};
/** A missing native bridge (older shell, test fixture) means no background taps, never an unhandled rejection. */
export function onGmailNotice(handler:()=>void):Promise<{remove():Promise<void>}>{if(!isAndroid)return Promise.resolve(noListener);try{return Promise.resolve(native.addListener('pendingMail',handler)).catch(()=>noListener);}catch{return Promise.resolve(noListener);}}

export async function releaseGmailQuestion(token:string){if(isAndroid)await native.releaseQuestion({token});}
