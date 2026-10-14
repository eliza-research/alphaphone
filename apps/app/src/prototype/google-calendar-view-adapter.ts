import {connectionController} from '../runtime/connection-ui';
import {GoogleCalendarReader,type GoogleCalendarRecord} from '../runtime/google-calendar';
import {GOOGLE_ACCOUNTS_CHANGED} from '../runtime/google-accounts';
import {googleCalendarAccountKey,currentGoogleCalendarBinding,googleConnectionController} from '../runtime/google-connection-ui';
import {readGoogleCalendarSelection,GOOGLE_CALENDAR_SELECTION_CHANGED} from '../runtime/google-calendar-selection';
type Bag=Record<string,any>;
const DAY=86400000;
/** Google display is read-only and never enters the local/native Calendar write or agent-grant paths. */
export function googleCalendarDisplayRecord(event:GoogleCalendarRecord){
 const begin=new Date(event.begin),end=new Date(event.end),today=new Date();
 const civil=(date:Date,utc=false)=>Date.UTC(utc?date.getUTCFullYear():date.getFullYear(),utc?date.getUTCMonth():date.getMonth(),utc?date.getUTCDate():date.getDate());
 const off=(civil(begin,!!event.allDay)-civil(today))/DAY;
 return {id:event.id,googleCalendarRecord:event,nativeEvent:event,off,t:event.allDay?0:begin.getHours()+begin.getMinutes()/60,d:event.allDay?0:Math.max(.25,(event.end-event.begin)/3600000),nativeAllDayEndOff:event.allDay?off+Math.max(1,Math.ceil((event.end-event.begin)/DAY)):undefined,title:event.title,notes:event.body,where:event.location,cal:'google',who:[],video:false,repeat:'none',alert:null,allDay:!!event.allDay};
}
export function installGoogleCalendarViewAdapter(Component:any,views:Bag){
 const p=Component.prototype,mount=p.componentDidMount,update=p.componentDidUpdate,unmount=p.componentWillUnmount,render=views.calendar.render;
 let owner:any,reader:GoogleCalendarReader|undefined,abort:AbortController|undefined,epoch=0,attempted='',loaded='',rows:Bag[]=[],message='';
 const selection=()=>{const key=googleCalendarAccountKey();return key?readGoogleCalendarSelection(key):null;};
 const bindingKey=()=>{const selected=selection(),cloud=connectionController.getCloudClient();return JSON.stringify([googleCalendarAccountKey(),cloud?.sessionId,cloud?.credentialId,selected]);};
 const range=(state:Bag)=>{const today=new Date(),date=new Date(today.getFullYear(),today.getMonth(),today.getDate()+Number(state.day||0));date.setDate(1);if(state.month!=null)date.setMonth(date.getMonth()+Number(state.month));return {begin:new Date(date.getFullYear(),date.getMonth()-1,1).getTime(),end:new Date(date.getFullYear(),date.getMonth()+2,1).getTime()};};
 const changed=()=>{if(owner?.live)owner.vset('calendar',{});};
 const reset=()=>{++epoch;abort?.abort();abort=undefined;reader?.invalidate();reader=undefined;attempted='';loaded='';rows=[];message='';if(owner)owner.googleCalendarRows=[];changed();};
 async function refresh(force=false){
  if(!owner?.live||owner.S().view!=='calendar')return;
  const selected=selection(),cloud=connectionController.getCloudClient();if(!selected||!cloud)return;
  const dates=range(owner.vget('calendar')),identity=bindingKey(),key=JSON.stringify([identity,dates]);if(!force&&attempted===key)return;
  abort?.abort();reader?.invalidate();const signal=(abort=new AbortController()).signal,token=++epoch,shell=owner;attempted=key;loaded='';rows=[];shell.googleCalendarRows=[];message='Loading Google Calendar…';changed();
  const current=()=>!signal.aborted&&owner===shell&&shell.live&&shell.S().view==='calendar'&&!document.hidden&&token===epoch&&bindingKey()===identity;
  const client=reader=new GoogleCalendarReader(cloud.client,()=>current()?currentGoogleCalendarBinding(selected.connectionId):null);
  try{
   const list=await client.listSources(signal);if(!current())return;if(list.status!=='ready'){message=list.message;changed();return;}
   if(!list.calendars.some(source=>source.id===selected.sourceId)){message='The selected Google calendar is unavailable. Choose a calendar again.';changed();return;}
   client.selectSource(selected.sourceId);
   const result=await client.read({timeMin:new Date(dates.begin).toISOString(),timeMax:new Date(dates.end).toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone},signal);if(!current())return;
   if(result.status!=='ready'){message=result.message;changed();return;}
   rows=result.events.map(googleCalendarDisplayRecord);loaded=key;shell.googleCalendarRows=rows;message=`${selected.name} · ${selected.account} · Read only`;changed();
  }catch(error){if(current()){message='Google Calendar could not be verified. Retry before relying on this schedule.';connectionController.rejectCloudSession(cloud.sessionId,error);changed();}}
  finally{if(token===epoch&&!current()){attempted='';reader?.invalidate();}}
 }
 p.componentDidMount=function(){mount.call(this);owner=this;let previous=bindingKey();const accountChanged=()=>{previous=bindingKey();reset();void refresh(true);};this.googleCalendarUnsubscribe=connectionController.subscribe(()=>{const next=bindingKey();if(next!==previous){previous=next;reset();void refresh();}});this.googleCalendarChanged=accountChanged;window.addEventListener(GOOGLE_ACCOUNTS_CHANGED,accountChanged);window.addEventListener(GOOGLE_CALENDAR_SELECTION_CHANGED,accountChanged);};
 p.componentDidUpdate=function(...args:any[]){update?.apply(this,args);void refresh();};
 p.componentWillUnmount=function(){this.googleCalendarUnsubscribe?.();window.removeEventListener(GOOGLE_ACCOUNTS_CHANGED,this.googleCalendarChanged);window.removeEventListener(GOOGLE_CALENDAR_SELECTION_CHANGED,this.googleCalendarChanged);if(owner===this){const previous=owner;owner=null;reset();previous.googleCalendarRows=[];}unmount.call(this);};
 views.calendar.render=(state:Bag,api:Bag)=>{
  const selected=selection(),dates=range(state),key=JSON.stringify([bindingKey(),dates]);const ready=!!selected&&loaded===key;
  const merged=ready?[...(state.events||[]),...rows]:state.events||[];
  const out=render({...state,googleCalendarName:selected?.name,events:merged,calPrefs:{...state.calPrefs,google:{on:true,color:'acc'}}},api);
  out.canManageGoogleCalendars=true;out.manageGoogleCalendars=()=>googleConnectionController.open();out.googleCalendarStatus=selected?(ready?message:message||'Google Calendar has not been checked.'):'Connect Google Calendar';out.refreshGoogleCalendar=()=>void refresh(true);
  if(ready&&(out.events?.length||out.hasNativeAllDay))out.empty=false;
  const chosen=merged.find((row:Bag)=>row.id===state.open&&row.googleCalendarRecord);
  if(chosen&&out.ev){const event=chosen.googleCalendarRecord as GoogleCalendarRecord;out.ev.busy=true;out.ev.readOnly=true;const options:Intl.DateTimeFormatOptions={weekday:'short',month:'short',day:'numeric',year:'numeric',...(event.allDay?{timeZone:'UTC'}:{})};const begin=new Date(event.begin),end=new Date(event.allDay?event.end-DAY:event.end);out.ev.day=begin.toLocaleDateString(undefined,options)+(begin.toLocaleDateString(undefined,options)!==end.toLocaleDateString(undefined,options)?' – '+end.toLocaleDateString(undefined,options):'');out.ev.when=event.allDay?'All day':begin.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})+' – '+new Date(event.end).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});out.ev.calName=selected?.name||'Google Calendar';out.ev.notes=event.body;out.ev.hasNotes=!!event.body;out.ev.edit=()=>api.toast('Google Calendar display is read only.');out.ev.del=()=>api.toast('Google Calendar display is read only.');out.ev.share=()=>api.toast('Google Calendar sharing is unavailable here.');out.ev.close=()=>api.set({open:null,openDay:null});}
  if(selected&&!ready&&!state.open&&!state.form)out.emptyText=message||'Google Calendar has not been checked. Local events remain separate.';
  return out;
 };
}
