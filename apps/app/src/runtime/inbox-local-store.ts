import {Capacitor} from '@capacitor/core';
import {secureConnectionStore} from './native-connection';
import {BrowserJsonDomainDocument} from '../browser/json-domain-document';

/** Mail drafts and operation receipts use browser documents on web and encrypted secure slots on Android.
 * The owner includes Cloud environment, user, organization and the exact Gmail grant. */
async function browserMailDocument(slot:string) {
  if(/^inbox-operation:v1:[a-f0-9]{64}$/.test(slot))return new BrowserJsonDomainDocument('alpha.browser.'+slot);
  if(!slot.startsWith('inbox-drafts:v1:'))throw Error('Invalid Inbox draft slot');
  const owner=JSON.parse(slot.slice('inbox-drafts:v1:'.length));
  if(!Array.isArray(owner)||owner.length!==4||owner.some(value=>typeof value!=='string'||value.length>256)||!owner[0]||!owner[1]||!owner[3])throw Error('Invalid Inbox draft owner');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(owner)))),byte=>byte.toString(16).padStart(2,'0')).join('');
  return new BrowserJsonDomainDocument('alpha.browser.inbox-saved-drafts:v1:'+hash);
}
export const inboxLocalStore = {
  async read<T>(slot:string):Promise<T|null> {
    if(Capacitor.isNativePlatform())return secureConnectionStore.read<T>(slot);
    return (await browserMailDocument(slot)).readJson<T>();
  },
  async compareExchange(slot:string,expected:unknown|null,value:unknown|null):Promise<{status:'saved'|'conflict'}> {
    if(Capacitor.isNativePlatform())return secureConnectionStore.compareExchange(slot,expected,value);
    if(value!==null&&new TextEncoder().encode(JSON.stringify(value)).length>8*1024*1024)throw Error('Local draft is too large');
    const document=await browserMailDocument(slot);
    let status:'saved'|'conflict'='conflict';
    await document.editJson(actual=>{
      if(JSON.stringify(actual)!==JSON.stringify(expected))return actual;
      status='saved';return value;
    });
    return {status};
  },
};
