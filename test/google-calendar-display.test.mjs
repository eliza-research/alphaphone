import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

// Actual Calendar renderer + local provider geometry + Google display adapter.
// No browser, credentials, provider requests, or local Calendar writes.
const model=readFileSync('apps/app/src/prototype/model.js','utf8');
const calendar=model.slice(model.indexOf('/* ===== module: calendar ===== */'),model.indexOf('/* ===== module: browser ===== */'));
const source=stripTypeScriptTypes(readFileSync('apps/app/src/prototype/google-calendar-view-adapter.ts','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'transform'});
const nativeSource=stripTypeScriptTypes(readFileSync('apps/app/src/prototype/calendar-adapter.ts','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'transform'});
const at=(day,hour)=>new Date(2026,9,day,hour).getTime();
const instant=at(13,12);
class FixedDate extends Date {constructor(...args){super(...(args.length?args:[instant]));}static now(){return instant;}}
const event=(patch={})=>({id:'google:grant:calendar:event',calendarId:'google:grant:calendar',providerEventId:'event',title:'Owned Google event',body:'Owned body',location:'',begin:at(13,12),end:at(13,13),allDay:false,timeZone:'UTC',revision:'synthetic',source:'google',readOnly:true,...patch});
async function harness(events,{day=0,personal=true}={}){
  let view='calendar',allowRead=true,pendingRead=null;
  let selected={connectionId:'grant',sourceId:'google:grant:calendar',name:'Owned Google calendar',account:'owner@example.test'};
  const listeners=new EventTarget(),writes=[],cloud={client:{},sessionId:'session',credentialId:'credential'};
  const state={events:[],day,month:null,open:null,form:null,calPrefs:{personal:{on:personal}}};
  const localCalendar={async list(){return {status:'ready',events:[],calendars:[{id:'local',local:true,visible:personal,color:'acc'}]};},async pendingCreations(){return {status:'ready',creations:[]};}};
  const ctx=vm.createContext({Date:FixedDate,console,AbortController,DOMException,Intl,Event,
    IC:{},CAL_SEED:[],PEOPLE:[],DAYS:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],MONS:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],copy:()=>({}),
    formatHours:value=>String(value),fmtT:value=>String(value),formatHoursRange:(a,b)=>`${a}–${b}`,formatHour:value=>String(value),formatShortDate:date=>date.toISOString().slice(0,10),formatMonthTitle:date=>String(date.getMonth()),
    registerView:(_key,value)=>{ctx.view=value;},window:listeners,document:{hidden:false},queueMicrotask,
    registerPlugin:()=>localCalendar,Capacitor:{getPlatform:()=> 'web',isNativePlatform:()=>false,isPluginAvailable:()=>true},
    DailyApps:{async addListener(){return {remove(){}};}},
    openCalendarRecovery(){},openReminderRecovery(){},openReminderCreationRecovery(){},openReminderActionRecovery(){},
    connectionController:{getCloudClient:()=>cloud,subscribe:()=>()=>{},rejectCloudSession:()=>{}},
    googleCalendarAccountKey:()=>({environment:'production',userId:'owned',organizationId:'owned'}),readGoogleCalendarSelection:()=>selected,
    currentGoogleCalendarBinding:()=>({}),googleConnectionController:{open(){}},GOOGLE_ACCOUNTS_CHANGED:'accounts',GOOGLE_CALENDAR_SELECTION_CHANGED:'selection',
    GoogleCalendarReader:class{invalidate(){}selectSource(){}async listSources(){return allowRead?{status:'ready',calendars:[{id:selected.sourceId}]}:{status:'not-connected',message:'Disconnected'};}async read(){if(pendingRead)await pendingRead;return {status:'ready',events};}},
  });
  vm.runInContext(calendar+'\n{'+nativeSource+'\nglobalThis.installNative=installCalendarAdapter;}\n{'+source+'\nglobalThis.install=installGoogleCalendarViewAdapter;}',ctx);
  class Shell{live=true;S(){return {view};}vget(){return state;}vset(_key,patch){Object.assign(state,patch);}async refreshReminders(){}componentDidMount(){}componentDidUpdate(){}componentWillUnmount(){}}
  ctx.installNative(Shell,{calendar:ctx.view});ctx.install(Shell,{calendar:ctx.view});const shell=new Shell();shell.componentDidMount();shell.componentDidUpdate();
  for(let i=0;i<12;i++)await Promise.resolve();
  const api={now:new FixedDate(),get:key=>key==='calendar'?state:{},set:patch=>{writes.push(patch);Object.assign(state,patch);},sw:()=>({}),track:()=>'',kx:()=>0,swallowed:()=>false,toast:()=>{},person:()=>null};
  return {render:()=>ctx.view.render(state,api),state,writes,holdNextRead(){let release;pendingRead=new Promise(resolve=>{release=resolve;});return()=>{release();pendingRead=null;};},async startRefresh(){listeners.dispatchEvent(new Event('accounts'));for(let i=0;i<8;i++)await Promise.resolve();},leave(){view='home';},revoke(){allowRead=false;listeners.dispatchEvent(new Event('accounts'));},async returnToCalendar(){view='calendar';shell.componentDidUpdate();for(let i=0;i<12;i++)await Promise.resolve();},clear(){selected=null;listeners.dispatchEvent(new Event('selection'));},close:()=>shell.componentWillUnmount()};
}
test('Google visibility is independent of the local Personal calendar toggle',async()=>{
  const h=await harness([event()],{personal:false});try{assert.equal(h.render().events.length,1);}finally{h.close();}
});
test('Google all-day dates render in the all-day area rather than outside the timeline',async()=>{
  const h=await harness([event({allDay:true,begin:Date.parse('2026-10-13T00:00:00Z'),end:Date.parse('2026-10-15T00:00:00Z')})]);
  try{const out=h.render();assert.equal(out.hasNativeAllDay,true);assert.equal(out.nativeAllDay[0].title,'Owned Google event');assert.equal(out.events.length,0);}finally{h.close();}
});
test('a multi-day Google all-day event remains visible on its second date',async()=>{
  const h=await harness([event({allDay:true,begin:Date.parse('2026-10-13T00:00:00Z'),end:Date.parse('2026-10-15T00:00:00Z')})],{day:1});
  try{assert.equal(h.render().hasNativeAllDay,true);}finally{h.close();}
});
test('Google events before 7am have visible timeline positions',async()=>{
  const h=await harness([event({begin:at(13,5),end:at(13,6)})]);
  try{const out=h.render();assert.equal(out.events.length,1);assert.ok(out.events[0].top>=0,`negative timeline position: ${out.events[0].top}`);}finally{h.close();}
});
test('Google events spanning midnight render on the following date',async()=>{
  const h=await harness([event({begin:at(13,23),end:at(14,2)})],{day:1});
  try{assert.equal(h.render().events.length,1);}finally{h.close();}
});
test('Google detail blocks writes and clearing its selection removes it without writing local events',async()=>{
  const h=await harness([event()]);try{
    const out=h.render();out.events[0].open();const detail=h.render();
    assert.equal(detail.ev.readOnly,true);assert.equal(detail.ev.busy,true);detail.ev.edit();detail.ev.del();
    assert.deepEqual(h.state.events,[]);assert.ok(h.writes.every(patch=>!Object.hasOwn(patch,'events')));
    h.clear();assert.equal(h.render().events.length,0);
  }finally{h.close();}
});

test('grant revocation outside Calendar clears cached events before returning',async()=>{const h=await harness([event()]);try{assert.equal(h.render().events.length,1);h.leave();h.revoke();assert.equal(h.render().events.length,0);await h.returnToCalendar();assert.equal(h.render().events.length,0);}finally{h.close();}});

test('leaving during a pending Google read allows automatic reload on return',async()=>{const h=await harness([event()]);try{const release=h.holdNextRead();await h.startRefresh();h.leave();release();for(let i=0;i<8;i++)await Promise.resolve();await h.returnToCalendar();assert.equal(h.render().events.length,1);}finally{h.close();}});
