import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';

// Execute the complete adapter with only its platform/service dependencies
// replaced. No Calendar write API is supplied: handoff must only open a form.
const code=stripTypeScriptTypes(readFileSync('apps/app/src/prototype/agent-calendar-adapter.ts','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'transform'});
function fixture({status='ready',sources=1,authority='canonical',platform='web',form=null}={}){
 const state={status,ownerKey:'owner-A',calendars:Array.from({length:sources},(_,i)=>({summary:`Source ${i}`,provider:'eliza',calendarId:String(i)}))};
 class Calendar{state=state;subscribe(){return()=>{};}refresh(){}sourceHandle(key){return 'handle:'+key;}}
 const connection={subscribe:()=>()=>{},getAppRecordClient:()=>null};
 const install=new Function('AgentCalendar','Capacitor','connectionController','calendarSourceKey',code+';return installAgentCalendarAdapter;')(Calendar,{getPlatform:()=>platform},connection,c=>c.calendarId);
 const opened=[];const calendar={calendarAuthority:authority,form};
 class Shell{live=true;componentDidMount(){}vget(){return calendar;}openView(...args){opened.push(args);}setState(){}}
 install(Shell,{calendar:{render(){}}},{});
 const oldWindow=globalThis.window;globalThis.window={addEventListener(){}};
 const shell=new Shell();try{shell.componentDidMount();}finally{globalThis.window=oldWindow;}
 return {shell,opened,state,calendar};
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
 const f=fixture({authority:'android-native',platform:'android',status:'disconnected',sources:0});assert.equal(f.shell.reviewScannedCalendarDraft(draft),true);assert.equal(f.opened[0][1].form,draft);
});
