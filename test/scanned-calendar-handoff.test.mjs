import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';

// Execute the complete adapter with only its platform/service dependencies
// replaced. No Calendar write API is supplied: handoff must only open a form.
const code=stripTypeScriptTypes(readFileSync('apps/app/src/prototype/agent-calendar-adapter.ts','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'transform'});
function fixture({status='ready',sources=1,authority='canonical',platform='web',form=null,testMocks=false}={}){
 const state={status,ownerKey:'owner-A',calendars:Array.from({length:sources},(_,i)=>({summary:`Source ${i}`,provider:'eliza',calendarId:String(i)}))};
 const refreshes=[],listeners={};let published;
 class Calendar{state=state;subscribe(fn){published=fn;return()=>{};}refresh(window){refreshes.push(window);}retire(){}sourceHandle(key){return 'handle:'+key;}}
 const connection={subscribe:()=>()=>{},getAppRecordClient:()=>null};
 const install=new Function('AgentCalendar','Capacitor','connectionController','calendarSourceKey','testMocksEnabled',code+';return installAgentCalendarAdapter;')(Calendar,{getPlatform:()=>platform},connection,c=>c.calendarId,testMocks);
 const opened=[];const calendar={calendarAuthority:authority,form};
 class Shell{live=true;componentDidMount(){}componentWillUnmount(){}vget(){return calendar;}openView(...args){opened.push(args);}setState(){}}
 install(Shell,{calendar:{render(){}}},{});
 const oldWindow=globalThis.window;globalThis.window={addEventListener(){},removeEventListener(){}};
 globalThis.document={hidden:false,addEventListener(type,fn){listeners[type]=fn;},removeEventListener(type,fn){if(listeners[type]===fn)delete listeners[type];}};
 const shell=new Shell();try{shell.componentDidMount();}finally{globalThis.window=oldWindow;}
 return {shell,opened,state,calendar,refreshes,listeners,publish:()=>published()};
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
 for(const options of [{sources:0},{status:'disconnected'},{status:'transition-required'},{status:'legacy-recovery'},{authority:'legacy'},{authority:'legacy-google'},{form:{title:'Keep me'}}]){
  const f=fixture(options);assert.equal(f.shell.reviewScannedCalendarDraft(draft),false,JSON.stringify(options));assert.deepEqual(f.opened,[]);
 }
});
test('explicit Android Calendar handoff preserves the native draft',()=>{
 const f=fixture({authority:'android-native',platform:'android',status:'disconnected',sources:0});assert.equal(f.shell.reviewScannedCalendarDraft(draft),true);assert.equal(f.opened[0][1].form,draft);assert.equal(f.opened[0][1].calendarAuthority,'android-native');
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
test('Calendar is read again on return to the foreground and when the next event ends',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.parse('2026-10-27T09:00:00Z')});
 const f=fixture();assert.equal(f.refreshes.length,1);
 document.hidden=true;f.listeners.visibilitychange();assert.equal(f.refreshes.length,1,'nothing is read in the background');
 document.hidden=false;f.listeners.visibilitychange();assert.equal(f.refreshes.length,2);
 f.state.next={event:{endAt:'2026-10-27T09:30:00Z'}};f.publish();f.publish();
 t.mock.timers.tick(30*60_000-1);assert.equal(f.refreshes.length,2);
 t.mock.timers.tick(1);assert.equal(f.refreshes.length,3,'one read when the Home card event ends');
 f.state.next={event:{endAt:'2026-10-27T09:00:00Z'}};f.publish();t.mock.timers.tick(24*3600_000);assert.equal(f.refreshes.length,3,'an ended event arms nothing');
 f.state.mutating=true;f.listeners.visibilitychange();f.publish();assert.equal(f.refreshes.length,3,'an unfinished save or delete is not aborted');
 f.state.mutating=false;f.publish();f.publish();assert.equal(f.refreshes.length,4,'the read follows once the mutation settles');
 const listener=f.listeners.visibilitychange;globalThis.window={removeEventListener(){}};try{f.shell.componentWillUnmount();}finally{delete globalThis.window;}assert.equal(f.listeners.visibilitychange,undefined);listener();assert.equal(f.refreshes.length,4);
});
