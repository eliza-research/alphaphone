import {formatDeviceRecordDateTime} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/device-record-presentation.ts';
import {CALENDAR_AVAILABILITY_MAX_CALENDARS,type CalendarAvailabilityOperation,type CalendarAvailabilityResult} from '../../../../.eliza/client-features/packages/contracts/src/device-reviews.ts';
import type {AvailabilityReview,AvailabilitySource} from '../runtime/calendar-availability';
import {holdPhoneInert} from '../runtime/modal-inert';

type Parts={content:HTMLElement;footer:HTMLElement;close:(value:unknown,error?:unknown)=>void};
/** One modal review over an inert phone. Cancel, Back, abort, background and page hide all
 * resolve null, so leaving the review can never count as a choice. */
function openReview<T>(label:string,region:string,signal:AbortSignal,build:(parts:Parts)=>HTMLElement|null):Promise<T|null>{
 return new Promise((resolve,reject)=>{
  const previous=document.activeElement as HTMLElement|null,dialog=document.createElement('dialog');dialog.className='note-source-dialog';dialog.setAttribute('aria-label',label);
  const theme=document.querySelector('.os');if(theme){const style=getComputedStyle(theme);for(const token of ['bg','fg'])dialog.style.setProperty('--source-'+token,style.getPropertyValue('--'+token));}
  const content=document.createElement('div');content.className='note-source-content';content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label',region);
  const footer=document.createElement('footer');
  let done=false;const release=holdPhoneInert(document.querySelector<HTMLElement>('.os'));
  const close=(value:unknown,error?:unknown)=>{if(done)return;done=true;signal.removeEventListener('abort',abort);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',abort);window.removeEventListener('alpha-back',back,true);dialog.remove();release();if(previous?.isConnected)previous.focus();error?reject(error):resolve(value as T|null);};
  const abort=()=>close(null),visibility=()=>{if(document.hidden)close(null);},back=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();close(null);};
  dialog.oncancel=event=>{event.preventDefault();close(null);};dialog.onclose=()=>close(null);
  signal.addEventListener('abort',abort,{once:true});document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',abort);window.addEventListener('alpha-back',back,true);
  try{const focus=build({content,footer,close});dialog.append(content,footer);document.body.append(dialog);dialog.showModal();(focus??content).focus();if(signal.aborted)close(null);}catch(error){close(null,error);}
 });
}
function element<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
const windowText=(window:{start:string;end:string;timeZone:string})=>`${formatDeviceRecordDateTime(window.start,window.timeZone)} to ${formatDeviceRecordDateTime(window.end,window.timeZone)} (${window.timeZone})`;

/** Step one: the owner ticks the calendars this phone may read. Nothing is preselected,
 * and the calendar names never leave this dialog. */
export function chooseAvailabilityCalendars(sources:readonly AvailabilitySource[],operation:CalendarAvailabilityOperation,signal:AbortSignal,current:()=>void):Promise<string[]|null>{
 current();
 return openReview<string[]>('Choose calendars to check','Calendars on this phone',signal,({content,footer,close})=>{
  const list=element('fieldset');list.style.border='0';list.style.padding='0';list.style.margin='0';list.append(element('legend','Calendars on this phone'));
  const boxes:HTMLInputElement[]=[];
  for(const source of sources){
   const row=element('label');row.style.display='flex';row.style.alignItems='center';row.style.gap='12px';row.style.minHeight='44px';
   const box=element('input');box.type='checkbox';box.value=source.id;box.style.width='24px';box.style.height='24px';box.style.flexShrink='0';
   row.append(box,element('span',`${source.name} · ${source.account}`));list.append(row);boxes.push(box);
  }
  const status=element('p');status.setAttribute('role','status');
  const check=element('button','Check these calendars');check.disabled=true;const cancel=element('button','Cancel');
  const picked=()=>boxes.filter(box=>box.checked).map(box=>box.value);
  const refresh=()=>{const count=picked().length,over=count>CALENDAR_AVAILABILITY_MAX_CALENDARS;check.disabled=count===0||over;status.textContent=over?`Choose at most ${CALENDAR_AVAILABILITY_MAX_CALENDARS} calendars.`:count===0?'Choose at least one calendar.':`${count} calendar${count===1?'':'s'} chosen.`;};
  for(const box of boxes)box.onchange=refresh;refresh();
  check.onclick=()=>{try{current();const ids=picked();if(!ids.length||ids.length>CALENDAR_AVAILABILITY_MAX_CALENDARS)return;close(ids);}catch(error){close(null,error);}};
  cancel.onclick=()=>close(null);
  content.append(element('h2','Check availability'),element('p',`Check whether you are free from ${windowText(operation)}.`),element('p','Choose the calendars this phone reads for this check. Calendars you leave unticked are not read. Calendar names and event titles are not shared with the agent.'),list,status);
  footer.append(cancel,check);return boxes[0]??content;
 });
}
/** Step two: the exact answer that would be shared, shown before it leaves the phone. */
export async function confirmAvailabilityResult(result:CalendarAvailabilityResult,chosen:readonly AvailabilitySource[],signal:AbortSignal,current:()=>void):Promise<boolean>{
 current();
 const approved=await openReview<boolean>('Review availability to share','Availability result',signal,({content,footer,close})=>{
  const share=element('button','Share with agent'),cancel=element('button','Cancel');
  share.onclick=()=>{try{current();close(true);}catch(error){close(null,error);}};cancel.onclick=()=>close(null);
  content.append(element('h2',result.status==='free'?'You are free':'You are busy'),element('p',windowText(result.window)));
  if(result.busy.length){
   content.append(element('p',`Busy time${result.busy.length===1?'':'s'} that would be shared:`));
   const list=element('ul');
   for(const interval of result.busy)list.append(element('li',`${formatDeviceRecordDateTime(interval.start,result.window.timeZone)} to ${formatDeviceRecordDateTime(interval.end,result.window.timeZone)}${interval.allDay?' · all day':''}${interval.tentative?' · tentative':''}`));
   content.append(list);
  }else content.append(element('p','No busy times were found in the calendars you chose.'));
  if(result.transparentIgnored)content.append(element('p',`${result.transparentIgnored} event${result.transparentIgnored===1?'':'s'} marked free ${result.transparentIgnored===1?'was':'were'} ignored.`));
  content.append(element('p',`Read from: ${chosen.map(source=>`${source.name} · ${source.account}`).join('; ')}.`),element('p',`The agent receives only these times and the number of calendars read (${result.calendarCount}). Calendar names, event titles and details stay on this phone.`));
  footer.append(cancel,share);return share;
 });
 return approved===true;
}
export const availabilityReview:AvailabilityReview={chooseCalendars:chooseAvailabilityCalendars,confirmResult:confirmAvailabilityResult};
