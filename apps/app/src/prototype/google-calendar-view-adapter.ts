import type {ServiceReadCache} from '../runtime/service-read-cache';
import {serviceReadCache} from '../runtime/service-read-cache-store';
import {calendarSyncHost,startCalendarSyncHost} from '../runtime/calendar-sync-host';
import {connectionController} from '../runtime/connection-ui';
import {GoogleCalendarReader,type GoogleCalendarRecord} from '../runtime/google-calendar';
import {GOOGLE_ACCOUNTS_CHANGED} from '../runtime/google-accounts';
import {googleCalendarAccountKey,currentGoogleCalendarBinding} from '../runtime/google-connection-ui';
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
export function installGoogleCalendarViewAdapter(Component:any,views:Bag,options:{active?:(shell:any)=>boolean;preserveReadOnly?:boolean}={}){
 const active=(shell:any)=>options.active?.(shell)??true;
 const p=Component.prototype,mount=p.componentDidMount,update=p.componentDidUpdate,unmount=p.componentWillUnmount,render=views.calendar.render;
 let owner:any,reader:GoogleCalendarReader|undefined,abort:AbortController|undefined,epoch=0,attempted='',loaded='',rows:Bag[]=[],message='',cachedRead=false,lastReadAt=0,reading=false;
 let calendarCache:ServiceReadCache|null=null;
 const cacheOwnerKey=()=>{const account=connectionController.getSnapshot().cloudAccount,cloud=connectionController.getCloudClient();return account&&cloud?JSON.stringify([account.environment,account.userId,account.organizationId,cloud.credentialId]):null;};
 const selection=()=>{const key=googleCalendarAccountKey();return key?readGoogleCalendarSelection(key):null;};
 const bindingKey=()=>{const selected=selection(),cloud=connectionController.getCloudClient();return JSON.stringify([googleCalendarAccountKey(),cloud?.sessionId,cloud?.credentialId,selected]);};
 const range=(state:Bag)=>{const today=new Date(),date=new Date(today.getFullYear(),today.getMonth(),today.getDate()+Number(state.day||0));date.setDate(1);if(state.month!=null)date.setMonth(date.getMonth()+Number(state.month));return {begin:new Date(date.getFullYear(),date.getMonth()-1,1).getTime(),end:new Date(date.getFullYear(),date.getMonth()+2,1).getTime()};};
 const changed=()=>{if(owner?.live)owner.vset('calendar',{});};
 const reset=()=>{++epoch;abort?.abort();abort=undefined;reader?.invalidate();reader=undefined;attempted='';loaded='';rows=[];message='';cachedRead=false;lastReadAt=0;if(owner)owner.googleCalendarRows=[];changed();};
 async function refresh(force=false){
  if(!owner?.live||!active(owner)||owner.S().view!=='calendar')return;
  const selected=selection(),cloud=connectionController.getCloudClient();if(!selected||!cloud)return;
  const dates=range(owner.vget('calendar')),identity=bindingKey(),key=JSON.stringify([identity,dates]);if(!force&&attempted===key)return;
  abort?.abort();reader?.invalidate();const signal=(abort=new AbortController()).signal,token=++epoch,shell=owner;attempted=key;reading=true;if(loaded!==key){loaded='';rows=[];shell.googleCalendarRows=[];}message='Loading Google Calendar…';changed();
  const current=()=>!signal.aborted&&owner===shell&&shell.live&&active(shell)&&shell.S().view==='calendar'&&!document.hidden&&token===epoch&&bindingKey()===identity;
  const client=reader=new GoogleCalendarReader(cloud.client,()=>current()?currentGoogleCalendarBinding(selected.connectionId):null);
  try{
   const account=connectionController.getSnapshot().cloudAccount;
   const cache=account?.organizationId?await serviceReadCache({environment:account.environment,userId:account.userId,organizationId:account.organizationId,credentialId:cloud.credentialId}).catch(()=>null):null;
   if(!current())return;calendarCache=cache;
   const cacheKey=JSON.stringify(['calendar',selected.connectionId,selected.providerCalendarId,dates]);
   const saved=force?null:await cache?.get<GoogleCalendarRecord[]>(cacheKey).catch(()=>null);if(!current())return;
   if(saved&&Array.isArray(saved.value)&&saved.value.every(event=>event?.source==='google'&&event.readOnly===true&&event.calendarId===selected.sourceId&&typeof event.id==='string'&&Number.isFinite(event.begin)&&Number.isFinite(event.end))){
    let linked=new Set<string>();if(!options.preserveReadOnly)try{linked=await calendarSyncHost.linkedProviderEvents();}catch{}
    if(!current())return;rows=saved.value.filter(event=>!linked.has(event.providerEventId)).map(googleCalendarDisplayRecord);loaded=key;shell.googleCalendarRows=rows;cachedRead=true;message='Showing saved Calendar · Updating…';changed();if(Date.now()-saved.at<300000){lastReadAt=saved.at;message='Saved Calendar';return;}
   }
   const list=await client.listSources(signal);if(!current())return;if(list.status!=='ready'){if(list.status!=='unavailable'){void cache?.clear().catch(()=>{});loaded='';rows=[];shell.googleCalendarRows=[];}message=list.message;changed();return;}
   if(!list.calendars.some(source=>source.id===selected.sourceId)){void cache?.clear().catch(()=>{});loaded='';rows=[];shell.googleCalendarRows=[];message='The selected Google calendar is unavailable. Choose a calendar again.';changed();return;}
   client.selectSource(selected.sourceId);
   const result=await client.read({timeMin:new Date(dates.begin).toISOString(),timeMax:new Date(dates.end).toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone},signal);if(!current())return;
   if(result.status!=='ready'){if(result.status!=='unavailable'){void cache?.clear().catch(()=>{});loaded='';rows=[];shell.googleCalendarRows=[];}message=result.message;changed();return;}
   let linked=new Set<string>();if(!options.preserveReadOnly)try{linked=await calendarSyncHost.linkedProviderEvents();}catch{/* Keep both readable copies when link metadata cannot be verified. */}if(!current())return;rows=result.events.filter(event=>!linked.has(event.providerEventId)).map(googleCalendarDisplayRecord);loaded=key;shell.googleCalendarRows=rows;void cache?.put(cacheKey,result.events).catch(()=>{});cachedRead=false;lastReadAt=Date.now();message=`${selected.name} · ${selected.account} · Read only`;changed();
  }catch(error){if(current()){message='Google Calendar could not be verified. Retry before relying on this schedule.';connectionController.rejectCloudSession(cloud.sessionId,error);changed();}}
  finally{if(token===epoch){reading=false;changed();}if(token===epoch&&!current()){attempted='';reader?.invalidate();}}
 }
 p.componentDidMount=function(){mount.call(this);owner=this;this.calendarSyncDispose=options.preserveReadOnly?()=>{}:startCalendarSyncHost();let previous=bindingKey(),previousOwner=cacheOwnerKey();const accountChanged=(event:Event)=>{previous=bindingKey();reset();const account=connectionController.getSnapshot().cloudAccount,cloud=connectionController.getCloudClient();if(!options.preserveReadOnly&&event.type===GOOGLE_ACCOUNTS_CHANGED&&account?.organizationId&&cloud)void serviceReadCache({environment:account.environment,userId:account.userId,organizationId:account.organizationId,credentialId:cloud.credentialId}).then(cache=>cache.clear()).catch(()=>{}).finally(()=>void refresh(true));else void refresh(true);};this.googleCalendarUnsubscribe=connectionController.subscribe(()=>{const nextOwner=cacheOwnerKey();if(!options.preserveReadOnly&&previousOwner&&nextOwner!==previousOwner)void calendarCache?.clear().catch(()=>{});previousOwner=nextOwner;const next=bindingKey();if(next!==previous){previous=next;reset();void refresh();}});this.googleCalendarResume=()=>{if(!document.hidden&&!reading&&lastReadAt>0&&Date.now()-lastReadAt>=300000)void refresh(true);};document.addEventListener('visibilitychange',this.googleCalendarResume);this.googleCalendarChanged=accountChanged;window.addEventListener(GOOGLE_ACCOUNTS_CHANGED,accountChanged);window.addEventListener(GOOGLE_CALENDAR_SELECTION_CHANGED,accountChanged);};
 p.componentDidUpdate=function(...args:any[]){update?.apply(this,args);const entered=this.S().view==='calendar'&&this.calendarSyncPreviousView!=='calendar';this.calendarSyncPreviousView=this.S().view;if(entered){if(!options.preserveReadOnly)void calendarSyncHost.resume();void refresh(lastReadAt>0&&Date.now()-lastReadAt>=300000);}else void refresh();};
 p.componentWillUnmount=function(){document.removeEventListener('visibilitychange',this.googleCalendarResume);this.calendarSyncDispose?.();this.googleCalendarUnsubscribe?.();window.removeEventListener(GOOGLE_ACCOUNTS_CHANGED,this.googleCalendarChanged);window.removeEventListener(GOOGLE_CALENDAR_SELECTION_CHANGED,this.googleCalendarChanged);if(owner===this){const previous=owner;owner=null;reset();previous.googleCalendarRows=[];}unmount.call(this);};
 views.calendar.render=(state:Bag,api:Bag)=>{
  if(!owner||!active(owner))return render(state,api);
  const selected=selection(),dates=range(state),key=JSON.stringify([bindingKey(),dates]);const ready=!!selected&&loaded===key;
  const merged=ready?[...(state.events||[]),...rows]:state.events||[];
  const out=render({...state,googleCalendarName:selected?.name,events:merged,calPrefs:{...state.calPrefs,google:{on:true,color:'acc'}}},api);
  out.canRefreshGoogleCalendar=!!selected;out.googleCalendarRefreshing=!!selected&&reading;out.googleCalendarNotice=selected&&(cachedRead||!ready)?(message||'Google Calendar has not been checked.'):'';out.refreshGoogleCalendar=()=>void refresh(true);
  if(ready&&(out.events?.length||out.hasNativeAllDay))out.empty=false;
  const chosen=merged.find((row:Bag)=>row.id===state.open&&row.googleCalendarRecord);
  if(chosen&&out.ev){const event=chosen.googleCalendarRecord as GoogleCalendarRecord;out.ev.busy=true;out.ev.readOnly=true;out.ev.readOnlyLabel='Google Calendar · Read only';const options:Intl.DateTimeFormatOptions={weekday:'short',month:'short',day:'numeric',year:'numeric',...(event.allDay?{timeZone:'UTC'}:{})};const begin=new Date(event.begin),end=new Date(event.allDay?event.end-DAY:event.end);out.ev.day=begin.toLocaleDateString(undefined,options)+(begin.toLocaleDateString(undefined,options)!==end.toLocaleDateString(undefined,options)?' – '+end.toLocaleDateString(undefined,options):'');out.ev.when=event.allDay?'All day':begin.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})+' – '+new Date(event.end).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});out.ev.calName=selected?.name||'Google Calendar';out.ev.notes=event.body;out.ev.hasNotes=!!event.body;out.ev.edit=()=>api.toast('Google Calendar display is read only.');out.ev.del=()=>api.toast('Google Calendar display is read only.');out.ev.share=()=>api.toast('Google Calendar sharing is unavailable here.');out.ev.close=()=>api.set({open:null,openDay:null});}
  if(selected&&!ready&&!state.open&&!state.form)out.emptyText=message||'Google Calendar has not been checked. Local events remain separate.';
  return out;
 };
}
