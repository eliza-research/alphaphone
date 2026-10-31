import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';

// Execute the complete adapter with only its platform/service dependencies
// replaced. No Calendar write API is supplied: handoff must only open a form.
const code=stripTypeScriptTypes(readFileSync('apps/app/src/prototype/agent-calendar-adapter.ts','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'transform'});
function fixture({status='ready',sources=1,authority='canonical',platform='web',form=null,provider='eliza',recordPort=null,pendingText=()=> 'Synthetic pending',testMocks=false,calendars=null,empty=false,events=[],error=null}={}){
 const state={status,ownerKey:'owner-A',error,feed:{events},calendars:calendars??Array.from({length:sources},(_,i)=>({summary:`Source ${i}`,provider,side:'owner',calendarId:String(i),includeInFeed:true,accessRole:'owner'}))};
 const refreshes=[],creates=[],listeners={};let published;
 class Calendar{state=state;subscribe(fn){published=fn;return()=>{};}refresh(window){refreshes.push(window);}create(_sourceKey,input){creates.push(input);return {outcome:'created',event:null};}invalidateNext(){state.nextFresh=false;if(state.next?.event&&Date.parse(state.next.event.endAt)<=Date.now())state.next=null;}retire(){}sourceHandle(key){return 'handle:'+key;}sourceKeyForHandle(handle){return handle.slice('handle:'.length);}}
 const connection={subscribe:()=>()=>{},getAppRecordClient:()=>recordPort};
 const install=new Function('AgentCalendar','Capacitor','connectionController','calendarSourceKey','presentCalendarIntervals','calendarFormCreate','getZonedDateParts','addDaysToLocalDate','calendarOwnerKey','agentPendingText','testMocksEnabled','canonicalCalendarRow','calendarRange',code+';return installAgentCalendarAdapter;')(Calendar,{getPlatform:()=>platform},connection,c=>c.calendarId,()=>{},draft=>draft,()=>({}),()=>({}),()=>state.ownerKey,pendingText,testMocks,e=>({id:e.id,title:e.title}),records=>({events:records}));

 const opened=[];const calendar={calendarAuthority:authority,form};
 class Shell{live=true;componentDidMount(){}componentWillUnmount(){}vget(){return calendar;}vset(_view,patch){Object.assign(calendar,patch);}openView(...args){opened.push(args);}setState(){}}
 const views={calendar:{render:state=>({empty,emptyText:'Free all day',renderedRows:state.events,f:{cals:[],repeats:[{label:'Weekly'}],alerts:[{label:'10 min'}]}})}};install(Shell,views,{});
 const oldWindow=globalThis.window;globalThis.window={addEventListener(){},removeEventListener(){}};
 globalThis.document={hidden:false,addEventListener(type,fn){listeners[type]=fn;},removeEventListener(type,fn){if(listeners[type]===fn)delete listeners[type];}};
 const shell=new Shell();try{shell.componentDidMount();}finally{globalThis.window=oldWindow;}
 return {shell,opened,state,calendar,views,refreshes,creates,listeners,publish:()=>published()};
}
const draft={id:null,creationId:'scan-operation',title:'Reviewed event',notes:'Exact OCR text',off:2,t:18.5,d:1.5,where:'Main hall',cal:'native:local',repeat:'none',allDay:false};
test('scanned event binds to current canonical owner and source without saving',()=>{
 const f=fixture();assert.equal(f.shell.reviewScannedCalendarDraft(draft),true);
 const [view,payload]=f.opened[0];assert.equal(view,'calendar');
 assert.equal(payload.form.canonicalOwnerKey,'owner-A');assert.equal(payload.form.cal,'handle:0');
 for(const field of ['title','notes','off','t','d','where','repeat','allDay'])assert.equal(payload.form[field],draft[field]);
 assert.notEqual(payload.form.creationId,draft.creationId);assert.equal(draft.cal,'native:local');
});
test('multiple authorized sources require an explicit Calendar selection',()=>{
 const f=fixture({sources:2});assert.equal(f.shell.reviewScannedCalendarDraft(draft),true);assert.equal(f.opened[0][1].form.cal,'');
});
test('unavailable sources, preservation review and existing drafts retain camera review',()=>{
 for(const options of [{sources:0},{status:'disconnected'},{status:'transition-required'},{status:'legacy-recovery'},{authority:'legacy'},{form:{title:'Keep me'}}]){
  const f=fixture(options);assert.equal(f.shell.reviewScannedCalendarDraft(draft),false,JSON.stringify(options));assert.deepEqual(f.opened,[]);
 }
});
test('the one merged Calendar offers only feed calendars that accept events',()=>{
 const source=(calendarId,includeInFeed,accessRole)=>({summary:calendarId,provider:'google',calendarId,includeInFeed,accessRole});
 // Holidays is shown but read only, and Birthdays is not in the feed: the owner's calendar is the only destination.
 const f=fixture({calendars:[source('owner',true,'owner'),source('holidays',true,'reader'),source('birthdays',false,'owner')]});
 assert.equal(f.shell.reviewScannedCalendarDraft(draft),true);assert.equal(f.opened[0][1].form.cal,'handle:owner');
 assert.deepEqual(f.views.calendar.displaySources().sources.map(row=>[row.name,row.on,row.writable]),[['owner',true,true],['holidays',true,false]]);
 const readOnly=fixture({calendars:[source('holidays',true,'reader')]});assert.equal(readOnly.shell.reviewScannedCalendarDraft(draft),false);
});
test('a saved "Previously connected calendars" choice reopens the one merged Calendar',()=>{
 const f=fixture({authority:'legacy-google'});assert.equal(f.calendar.calendarAuthority,'canonical');
 assert.equal(f.shell.reviewScannedCalendarDraft(draft),true);assert.equal(f.opened[0][1].calendarAuthority,'canonical');
});
test('explicit Android Calendar handoff preserves the native draft',()=>{
 const f=fixture({authority:'android-native',platform:'android',status:'disconnected',sources:0});assert.equal(f.shell.reviewScannedCalendarDraft(draft),true);assert.equal(f.opened[0][1].form,draft);assert.equal(f.opened[0][1].calendarAuthority,'android-native');
});
test('Calendar is read again on return to the foreground and when the next event ends',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.parse('2026-10-27T09:00:00Z')});
 const f=fixture();assert.equal(f.refreshes.length,1);
 document.hidden=true;f.listeners.visibilitychange();assert.equal(f.refreshes.length,1,'nothing is read in the background');
 document.hidden=false;f.listeners.visibilitychange();assert.equal(f.refreshes.length,2);
 f.state.next={event:{endAt:'2026-10-27T09:30:00Z'}};f.publish();f.publish();
 t.mock.timers.tick(30*60_000-1);assert.equal(f.refreshes.length,2);
 t.mock.timers.tick(1);assert.equal(f.refreshes.length,3,'one read when the Home card event ends');
 f.state.next={event:{endAt:'2026-10-27T09:00:00Z'}};f.publish();t.mock.timers.tick(24*3600_000);assert.equal(f.refreshes.length,3,'an ended event arms nothing');
 const listener=f.listeners.visibilitychange;globalThis.window={removeEventListener(){}};try{f.shell.componentWillUnmount();}finally{delete globalThis.window;}assert.equal(f.listeners.visibilitychange,undefined);listener();assert.equal(f.refreshes.length,3);
});
test('event end while hidden invalidates the card and waits for one foreground read',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.parse('2026-10-27T09:00:00Z')});
 const f=fixture();f.state.next={event:{endAt:'2026-10-27T09:01:00Z'}};f.state.nextFresh=true;f.publish();document.hidden=true;t.mock.timers.tick(60_000);
 assert.equal(f.refreshes.length,1);assert.equal(f.state.next,null);assert.equal(f.state.nextFresh,false);document.hidden=false;f.listeners.visibilitychange();assert.equal(f.refreshes.length,2);
 globalThis.window={removeEventListener(){}};try{f.shell.componentWillUnmount();}finally{delete globalThis.window;}
});
test('only supported sources offer Repeat and unsupported event-alert controls stay absent',()=>{
 for(const provider of ['eliza','google']){const f=fixture({provider}),out=f.views.calendar.render({form:{id:null,cal:'handle:0',canonicalOwnerKey:'owner-A',repeat:'none'}},{set(){},toast(){}});assert.deepEqual(out.f.repeats,provider==='eliza'?null:[{label:'Weekly'}]);assert.equal(out.f.alerts,null);}
});
test('unsupported retained recurrence refuses without saving or altering the draft; Google keeps the rule',async()=>{
 for(const provider of ['eliza','google']){
  const f=fixture({provider}),toasts=[],form={id:null,cal:'handle:0',canonicalOwnerKey:'owner-A',creationId:'op',title:'Standup',off:0,t:9,d:1,repeat:'weekly',alert:null,who:[]},before=structuredClone(form);
  const out=f.views.calendar.render({form},{set(){},get:()=>({form}),toast:message=>toasts.push(message)});await out.f.save();assert.deepEqual(form,before);
  if(provider==='eliza'){assert.deepEqual(f.creates,[]);assert.match(toasts[0],/does not support repeating events.*draft is kept/);assert.equal(out.f.repeats[0].label,'Remove requested repeat');}
  else{assert.deepEqual(toasts,[]);assert.deepEqual(f.creates.map(draft=>draft.recurrence),[['RRULE:FREQ=WEEKLY']]);}
 }
});
test('the owner can explicitly remove a retained repeat before saving a once-only event',async()=>{
 const f=fixture(),original={id:null,cal:'handle:0',canonicalOwnerKey:'owner-A',creationId:'op',title:'Standup',off:0,t:9,d:1,repeat:'weekly',alert:null,who:[]};let form=original;const toasts=[],api={set:patch=>form=patch.form,get:()=>({form}),toast:message=>toasts.push(message)};
 const review=f.views.calendar.render({form},api);assert.equal(f.creates.length,0);review.f.repeats[0].pick();assert.equal(original.repeat,'weekly');assert.equal(form.repeat,'none');const confirmed=f.views.calendar.render({form},api);assert.equal(confirmed.f.repeats,null);await confirmed.f.save();assert.deepEqual(toasts,[]);assert.equal(f.creates.length,1);assert.equal(f.creates[0].recurrence,undefined);
});
test('native Android Calendar keeps its own repeat and alert controls',()=>{
 const f=fixture({platform:'android',authority:'android-native'}),out=f.views.calendar.render({form:{repeat:'weekly'}},{set(){},toast(){}});assert.deepEqual(out.f.repeats,[{label:'Weekly'}]);assert.deepEqual(out.f.alerts,[{label:'10 min'}]);
});
test('New Event with no current port explains pending state and does not replace a retained draft',()=>{
 const source=readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8'),pendingCode=stripTypeScriptTypes(source.slice(source.indexOf('export function residentPendingText('),source.indexOf('/** Passive surfaces')).replace(/^export /gm,''),{mode:'transform'});
 for(const [kind,expected] of [['starting',/starting/],['recovering',/stopped/],['offline',/unavailable for this agent connection/]])for(const recordPort of [null,{current:()=>false}]){
  const pendingText=new Function('state','residentAlwaysPresent','RESIDENT_RECOVERY_PENDING','PENDING_FALLBACK',pendingCode+';return agentPendingText;')({kind},kind!=='offline','Recovery review.','Unavailable.');
  const f=fixture({recordPort,pendingText}),before=structuredClone(f.calendar),toasts=[],api={get:()=>f.calendar,set:patch=>Object.assign(f.calendar,patch),toast:x=>toasts.push(x)};f.views.calendar.render(f.calendar,api).newEvent();assert.deepEqual(f.calendar,before);assert.deepEqual(f.creates,[]);assert.equal(toasts.length,1);assert.match(toasts[0],expected);
  f.calendar.form={title:'Keep my exact draft',repeat:'weekly',cal:'handle:0',canonicalOwnerKey:'owner-A'};const draft=f.calendar.form;f.views.calendar.render(f.calendar,api).newEvent();assert.equal(f.calendar.form,draft);assert.match(toasts.at(-1),/Keep or finish/);
 }
});
test('an available private Mac canonical port can open New Event and preserves an existing draft',()=>{
 const f=fixture({platform:'web',recordPort:{current:()=>true,identity:{origin:'http://localhost:5229',ownerId:'mac-owner',agentId:'mac-agent'}}}),toasts=[],api={get:()=>f.calendar,set:patch=>Object.assign(f.calendar,patch),toast:x=>toasts.push(x)};
 f.views.calendar.render(f.calendar,api).newEvent();assert.equal(f.calendar.form.canonicalOwnerKey,'owner-A');assert.equal(f.creates.length,0);assert.deepEqual(toasts,[]);const draft=f.calendar.form;f.views.calendar.render(f.calendar,api).newEvent();assert.equal(f.calendar.form,draft);assert.match(toasts.at(-1),/Keep or finish/);
});
test('browser provider requires the test-mocks gate and a web platform',()=>{
 for(const options of [{testMocks:false,platform:'web'},{testMocks:true,platform:'android'}]){
  const f=fixture({...options,authority:'browser-local',status:'disconnected',sources:0});
  assert.equal(f.shell.reviewScannedCalendarDraft(draft),false);
  assert.deepEqual(f.opened,[]);
 }
 const f=fixture({testMocks:true,platform:'web',authority:'browser-local',status:'disconnected',sources:0});
 assert.equal(f.shell.reviewScannedCalendarDraft(draft),true);
 assert.equal(f.opened[0][1].form,draft);
 assert.equal(f.opened[0][1].calendarAuthority,'browser-local');

});

// Canonical warning presentation stays in the header, which keeps its retry action.
test('an empty partial Calendar shows its warning once without claiming no events',()=>{
 const f=fixture({status:'partial',empty:true}),before=structuredClone(f.state);
 const out=f.views.calendar.render({},{});
 assert.match(out.nativeStatusLabel,/Some Calendar sources could not be verified/);
 assert.equal(typeof out.nativeStatusRetry,'function');
 assert.equal(out.empty,false);
 assert.doesNotMatch(out.emptyText,/No events/);
 assert.deepEqual(f.state,before);
 const template=readFileSync('apps/app/src/prototype/template.html','utf8');
 assert.ok(template.includes('aria-label="Retry calendar and reminders" aria-description="{{calendar.nativeStatusLabel}}"'));
 assert.ok(!template.includes('aria-label="{{calendar.nativeStatusLabel}} Retry calendar and reminders"'));
});
test('a verified empty Calendar retains its ordinary empty state',()=>{
 const f=fixture({status:'ready',empty:true}),out=f.views.calendar.render({},{});
 assert.equal(out.nativeStatusLabel,'');assert.equal(out.empty,true);
 assert.equal(out.emptyText,'No events in this Calendar window');
});

// The full adapter still filters provider rows against the existing current-owner catalog.
const presentationEvent=(id,calendarId)=>({id,title:id,provider:'eliza',side:'owner',calendarId,startAt:'2026-10-31T12:00:00Z',endAt:'2026-10-31T13:00:00Z'});
test('ready with an unverified event source warns once and does not claim verified empty',()=>{
 const f=fixture({status:'ready',empty:true,events:[presentationEvent('unverified','unknown')]}),before=structuredClone(f.state);
 const out=f.views.calendar.render({},{});
 assert.match(out.nativeStatusLabel,/Some event sources could not be verified/);
 assert.deepEqual(out.renderedRows,[]);assert.equal(out.empty,false);
 assert.doesNotMatch(out.emptyText,/No events|Free all day/);assert.deepEqual(f.state,before);
});
test('unverified rows stay hidden while verified rows and display preferences are retained',()=>{
 const f=fixture({events:[presentationEvent('verified','0'),presentationEvent('unverified','unknown')]}),before=structuredClone(f.state);
 const out=f.views.calendar.render({},{});
 assert.deepEqual(out.renderedRows.map(row=>row.id),['verified']);assert.match(out.nativeStatusLabel,/could not be verified/);
 const hidden=f.views.calendar.render({calPrefs:{'handle:0':{on:false}}},{});
 assert.deepEqual(hidden.renderedRows,[]);assert.deepEqual(f.state,before);
});
test('unavailable uses natural recovery copy once and retry uses the existing refresh',()=>{
 const f=fixture({status:'unavailable',empty:true,error:'Implementation-only fallback'}),before=structuredClone(f.state),reads=f.refreshes.length;
 const out=f.views.calendar.render({},{});
 assert.equal(out.nativeStatusLabel,'Calendar is unavailable. Retry to load your schedule.');
 assert.equal(out.empty,false);assert.doesNotMatch(out.emptyText,/Implementation-only|Free all day|No events/);
 out.nativeStatusRetry();assert.equal(f.refreshes.length,reads+1);assert.deepEqual(f.state,before);
});
test('partial empty selected day cannot claim free even when another day has a verified event',()=>{
 const f=fixture({status:'partial',empty:true,events:[presentationEvent('verified elsewhere','0')]}),before=structuredClone(f.state);
 const out=f.views.calendar.render({day:2},{});
 assert.deepEqual(out.renderedRows.map(row=>row.id),['verified elsewhere']);
 assert.match(out.nativeStatusLabel,/Some Calendar sources could not be verified/);
 assert.doesNotMatch(out.emptyText,/Free all day|Free on these days|Nothing scheduled|No events/);
 assert.equal(out.empty,false);assert.deepEqual(f.state,before);
});

test('explicit legacy and transition recovery retain their existing empty-day presentation and actions',()=>{
 for(const options of [{authority:'legacy',status:'partial'},{authority:'legacy',status:'unavailable',error:'Saved calendar recovery detail'},{authority:'canonical',status:'transition-required'}]){
  const f=fixture({...options,empty:true});
  f.state.legacy={present:true,readable:true,records:[{id:'retained',title:'Retained event',begin:Date.parse('2026-10-31T12:00:00Z'),end:Date.parse('2026-10-31T13:00:00Z')} ]};
  const before=structuredClone(f.state),reads=f.refreshes.length,toasts=[];
  const out=f.views.calendar.render({}, {toast:message=>toasts.push(message)});
  assert.equal(out.calendarSourceLabel,'Saved app calendar · Read only');
  if(options.error)assert.equal(out.nativeStatusLabel,options.error,'legacy recovery detail is retained');
  assert.equal(out.empty,true);assert.equal(out.emptyText,'Free all day','existing legacy renderer presentation is unchanged');
  assert.deepEqual(out.renderedRows.map(row=>row.id),['legacy-calendar:retained']);
  assert.equal(out.canConfirmCalendarTransition,options.status==='transition-required');
  assert.equal(typeof out.confirmCalendarTransition,'function');
  out.newEvent();assert.deepEqual(toasts,['Choose Agent Calendar to create an event.']);
  assert.equal(f.refreshes.length,reads);assert.deepEqual(f.state,before);
 }
});
