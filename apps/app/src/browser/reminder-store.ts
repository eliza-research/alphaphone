import {guardPendingReminderChanges,type ReminderDeletionState} from './reminder-deletions';
import {browserDocuments} from './documents';
import {BrowserDomainDocument,type DomainRecovery} from './domain-document';

export const reminderStorageKey='alpha.browser.reminders.v1';
const domain=new BrowserDomainDocument(browserDocuments,reminderStorageKey,()=>localStorage.getItem(reminderStorageKey));
const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('alpha.browser.documents.v1');
const refresh=()=>window.dispatchEvent(new Event('alpha:reminders-document-changed'));
if(channel)channel.onmessage=event=>{if(event.data?.key===reminderStorageKey)refresh();};
// The originating action owns its completion UI, including delayed receipts.
const changed=()=>{channel?.postMessage({key:reminderStorageKey});};

export const reminderDocument={
 read:<T>(initial:()=>T|Promise<T>,signal?:AbortSignal)=>domain.read(initial,signal),
 readRaw:(signal?:AbortSignal)=>domain.readRaw(signal),
 capture:(signal?:AbortSignal)=>domain.capture(signal),
 async reset(expected:DomainRecovery,signal?:AbortSignal){await domain.reset(expected,signal);changed();},
 async edit<T,R>(initial:()=>T|Promise<T>,edit:(data:T)=>R|Promise<R>,signal?:AbortSignal):Promise<R>{
  let modified=false;
  const result=await domain.edit(initial,async data=>{
   const before=JSON.stringify(data),result=await edit(data);
   guardPendingReminderChanges(JSON.parse(before) as ReminderDeletionState,data as ReminderDeletionState);
   modified=before!==JSON.stringify(data);return result;
  },signal);
  // Only changed domain bytes need a cross-tab refresh.
  if(modified)changed();return result;
 },
};
