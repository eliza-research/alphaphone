import {Capacitor} from '@capacitor/core';
import type {BrowserDomainDocument} from '../browser/domain-document';
export const mediaCopyIntentKey='alpha.photos.pending-copy.v1';
export type MediaCopyIntent={token:string;revision?:string};
import {createMediaCopyJournal,createBrowserMediaCopyJournal} from '../product/photos-upstream';
let document:Promise<BrowserDomainDocument>|undefined;
export async function mediaCopyIntentDocument(){
 if(Capacitor.getPlatform()==='android')throw Error('Saved-copy recovery is unavailable on this device');
 return document??=Promise.all([import('../browser/domain-document'),import('../browser/documents')]).then(([{BrowserDomainDocument},{browserDocuments}])=>new BrowserDomainDocument(browserDocuments,mediaCopyIntentKey,()=>{const raw=localStorage.getItem(mediaCopyIntentKey);return raw===null?null:JSON.stringify({raw});}));
}
async function journal(){return Capacitor.getPlatform()==='android'?createMediaCopyJournal(localStorage,mediaCopyIntentKey):createBrowserMediaCopyJournal(await mediaCopyIntentDocument());}
export async function readMediaCopyIntent(signal?:AbortSignal){return (await journal()).read(signal);}
export async function admitMediaCopyIntent(token:string,signal?:AbortSignal){return (await journal()).reserve(token,signal);}
export async function acknowledgeMediaCopyIntent(expected:MediaCopyIntent,signal?:AbortSignal){await (await journal()).acknowledge(expected,signal);}
