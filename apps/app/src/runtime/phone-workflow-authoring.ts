import {assertPhoneWorkflowCapabilities,describePhoneWorkflowTrigger,parsePhoneWorkflowCatalog,validatePhoneWorkflowSpec,type PhoneTimeTrigger,type PhoneWorkflowCatalog,type PhoneWorkflowSaveReceipt,type PhoneWorkflowTrigger} from '../../../../.eliza/client-features/packages/contracts/src/phone-workflow.ts';
import {browserDevProfile} from '../browser/dev-profile';
import type {WorkflowDeviceTarget} from './workflow-device-contract';
/** Typed phone workflows use the shared upstream contract (`@elizaos/contracts/phone-workflow`): the agent
 * normalizes, digests and compiles exactly the bytes this phone reviews. Only editor typing and the
 * development-profile enrollment label stay here. */
export type {PhoneTimeTrigger};
export type PhoneTrigger=PhoneWorkflowTrigger;
/** Editor view of the shared step union: loosely indexed so the authoring form can edit any variant. */
export interface PhoneStep {id:string;kind:'Read'|'If'|'Write'|'Notify'|'Speak';operation:string;[key:string]:any}
export interface PhoneSpec {device?:WorkflowDeviceTarget;version:1;name:string;description:string;trigger:PhoneTrigger;steps:PhoneStep[]}
export type PhoneCatalog=PhoneWorkflowCatalog;
export type PhoneSaveReceipt=PhoneWorkflowSaveReceipt;
const DEVELOPMENT_ENROLLMENT=/^development-cloud\.(first|second)-enrollment$/;
export function normalizePhoneSpec(value:unknown):PhoneSpec{
 const raw=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:null;
 const device=raw?.device&&typeof raw.device==='object'&&!Array.isArray(raw.device)?raw.device as Record<string,unknown>:null;
 // Preserve the public development enrollment labels (test-mocks builds only) without broadening native identifiers.
 const label=browserDevProfile&&typeof device?.enrollmentId==='string'&&DEVELOPMENT_ENROLLMENT.test(device.enrollmentId)?device.enrollmentId:undefined;
 if(!label)return validatePhoneWorkflowSpec(value) as PhoneSpec;
 const spec=validatePhoneWorkflowSpec({...raw,device:{...device,enrollmentId:label.replace('.','-')}}) as PhoneSpec;
 return {...spec,device:{...spec.device!,enrollmentId:label}};
}
export const parsePhoneCatalog=(value:unknown):PhoneCatalog=>parsePhoneWorkflowCatalog(value);
export function assertPhoneCapabilities(spec:PhoneSpec,catalog:PhoneCatalog){assertPhoneWorkflowCapabilities(spec as Parameters<typeof assertPhoneWorkflowCapabilities>[0],catalog);}
export const describePhoneTrigger=(trigger:PhoneTrigger):string=>describePhoneWorkflowTrigger(trigger);
const zoneFormats=new Map<string,Intl.DateTimeFormat>();
/** UTC offset in minutes of `timeZone` at instant `ms` (whole seconds). */
function zoneOffsetMinutes(ms:number,timeZone:string):number{
 let format=zoneFormats.get(timeZone);
 if(!format){format=new Intl.DateTimeFormat('en-US',{timeZone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});zoneFormats.set(timeZone,format);}
 const p=Object.fromEntries(format.formatToParts(ms).map(part=>[part.type,part.value]));
 const at=Math.floor(ms/1000)*1000;
 return Math.round((Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)-at)/60000);
}
const DAY=86400000,MINUTE=60000;
const wall=(localMs:number)=>new Date(localMs).toISOString().slice(11,16);
/**
 * A scheduled local time that does not exist on a clock-change day (the hour skipped when clocks move
 * forward) never comes due that day: no run starts. Names the next such day within a year, or ''.
 * Review copy only; the agent's own schedule admission is unchanged.
 */
export function phoneTriggerClockChangeNote(trigger:PhoneTimeTrigger,now=Date.now()):string{
 try{
  const [hour,minute]=trigger.localTime.split(':').map(Number);const target=hour*60+minute;
  let at=Math.floor(now/MINUTE)*MINUTE,offset=zoneOffsetMinutes(at,trigger.timeZone);
  for(let day=0;day<371;day++){
   const next=at+DAY,nextOffset=zoneOffsetMinutes(next,trigger.timeZone);
   if(nextOffset>offset){
    // Minute-precise transition instant: the first minute already on the later offset.
    let low=at,high=next;while(high-low>MINUTE){const mid=low+Math.floor((high-low)/MINUTE/2)*MINUTE;if(zoneOffsetMinutes(mid,trigger.timeZone)===offset)low=mid;else high=mid;}
    const gapStart=high+offset*MINUTE,gapEnd=high+nextOffset*MINUTE;
    for(const edge of [gapStart,gapEnd-MINUTE]){
     const midnight=Math.floor(edge/DAY)*DAY,candidate=midnight+target*MINUTE;
     if(candidate>=gapStart&&candidate<gapEnd&&trigger.days.includes(new Date(midnight).getUTCDay()))
      return `On ${new Date(midnight).toISOString().slice(0,10)} the clock in ${trigger.timeZone} moves forward from ${wall(gapStart)} to ${wall(gapEnd)}, so ${trigger.localTime} does not occur and this workflow does not run that day.`;
    }
   }
   at=next;offset=nextOffset;
  }
 }catch{/* An unknown zone is refused by the shared contract; no note. */}
 return '';
}
