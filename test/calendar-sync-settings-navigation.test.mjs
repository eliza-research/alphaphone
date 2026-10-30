import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {JSDOM}=require('jsdom');
const source=stripTypeScriptTypes(fs.readFileSync(new URL('../apps/app/src/runtime/calendar-sync-settings.ts',import.meta.url),'utf8'),{mode:'transform'}).replace(/^import .*;\n/gm,'').replace('export function openCalendarSyncSettings','function openCalendarSyncSettings');
const settle=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
function fixture(state={status:'Sync is off.',enabled:false,running:false},review=async()=>{throw Error('Choose a Google calendar for sync first.');},offered=[{connectionId:'connection',sourceId:'google:connection:owner%40example.test',providerCalendarId:'owner@example.test',name:'owner@example.test',account:'owner@example.test'},{connectionId:'connection',sourceId:'google:connection:team',providerCalendarId:'team',name:'Team',account:'owner@example.test'}]){
 const env=new JSDOM('<div class="os"></div><button id="prior">Calendar settings</button>',{pretendToBeVisual:true});
 env.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};env.window.document.getElementById('prior').focus();
 const calls={lists:0,saved:[],cancel:0,release:0,writes:0,unsubscribe:0};
 const host={snapshot:()=>state,destination:()=>({account:'',calendar:''}),subscribe:()=>()=>calls.unsubscribe++,settings:async()=>{},cancel:()=>calls.cancel++,review,enable:async()=>calls.writes++,sync:async()=>calls.writes++,pause:async()=>calls.writes++};
 // The sync destination is chosen in this dialog; Google accounts no longer offers a calendar choice.
 const context=vm.createContext({window:env.window,document:env.window.document,AbortController,getComputedStyle:env.window.getComputedStyle.bind(env.window),calendarSyncHost:host,googleCalendarSyncDestinations:async()=>{calls.lists++;return offered;},googleCalendarAccountKey:()=>({environment:'production',userId:'owner',organizationId:'tenant'}),saveGoogleCalendarSelection:(key,destination)=>{calls.saved.push([key,destination]);return true;},holdPhoneInert:()=>()=>calls.release++});
 vm.runInContext(source+'\nopenCalendarSyncSettings();',context);
 const button=name=>[...env.window.document.querySelectorAll('button')].find(el=>el.textContent===name);
 return {env,calls,button};
}
{
 const f=fixture();await settle();f.button('Review sync').click();await settle();f.button('Choose Google calendar').click();await settle();
 assert.equal(f.calls.lists,1);assert.equal(f.calls.cancel,0,'the dialog stays open');assert.equal(f.calls.writes,0);
 const team=f.button('Team · owner@example.test');assert.ok(f.button('owner@example.test')&&team,'each writable calendar is offered once, account calendar first');
 team.click();await settle();
 assert.deepEqual(f.calls.saved.map(([,destination])=>destination.providerCalendarId),['team']);
 assert.equal(f.button('Team · owner@example.test'),undefined,'choices close after a pick');
 assert.match(f.env.window.document.querySelector('dialog').textContent,/Sync destination: Team · owner@example.test\. Review sync to continue\./);
 assert.equal(f.calls.writes,0);f.button('Close').click();assert.equal(f.env.window.document.activeElement.id,'prior');f.env.window.close();
}
{
 const f=fixture(undefined,undefined,[]);await settle();f.button('Choose Google calendar').click();await settle();
 assert.match(f.env.window.document.querySelector('dialog').textContent,/No Google calendar accepts Calendar changes/);assert.equal(f.calls.saved.length,0);f.button('Close').click();f.env.window.close();
}
{
 let resolve;const f=fixture(undefined,()=>new Promise(done=>resolve=done));await settle();f.button('Review sync').click();
 assert.equal(f.button('Choose Google calendar').disabled,true);f.button('Choose Google calendar').click();await settle();assert.equal(f.calls.lists,0);
 resolve({events:[]});await settle();assert.equal(f.button('Choose Google calendar').disabled,false);f.button('Close').click();assert.equal(f.calls.writes,0);f.env.window.close();
}
{
 const f=fixture({status:'Sync enabled.',enabled:true,running:false});await settle();assert.equal(f.button('Choose Google calendar').hidden,true);f.button('Close').click();assert.equal(f.calls.writes,0);f.env.window.close();
}
console.log('PASS 4 actual calendar-sync dialog cases: in-dialog destination choice, no writable calendar, pending review gating, enabled destination retention. Synthetic host/controller only; no Google/model/native calls.');

async function canonicalFixture({draft=false,delay=false}={}){
 const env=new JSDOM('<div class="os"></div><button id="prior">Calendar settings</button>',{pretendToBeVisual:true});env.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 const destinationSource={provider:'google',side:'owner',grantId:'alpha-google:'+ 'a'.repeat(64),connectorAccountId:'alpha-google:'+ 'a'.repeat(64),calendarId:'primary',selectionVersion:1,accessRole:'owner',summary:'Reviewed Google',accountEmail:'owner@acme.com'};
 let control={revision:0,paused:true,destination:null,pendingDispatch:null},current=true,resolveReview;
 const calls={legacy:0,changes:[],reviews:0};
 const reviewed=()=>({binding:'canonical-owner',control:{...control},sources:[destinationSource],visibleLocalEventIds:['canonical-event-id']});
 const calendar={subscribe:()=>()=>{},reviewSync:async()=>{calls.reviews++;return delay?new Promise(done=>resolveReview=done):reviewed();},changeSync:async(review,operation,key,valid,sourceKey)=>{assert(valid(),'draft/owner fence must reach controller');calls.changes.push({operation,revision:review.control.revision,sourceKey});control={...control,revision:control.revision+1,...(operation==='select'?{destination:{connectorAccountId:destinationSource.connectorAccountId,providerCalendarId:'primary'}}:operation==='resume'?{paused:false}:operation==='pause'?{paused:true}:{})};}};
 const context=vm.createContext({window:env.window,document:env.window.document,crypto:globalThis.crypto,getComputedStyle:env.window.getComputedStyle.bind(env.window),calendarSourceKey:s=>JSON.stringify([s.provider,s.side,s.grantId,s.connectorAccountId,s.calendarId]),calendarSyncHost:new Proxy({}, {get(){calls.legacy++;throw Error('Canonical dialog read legacy host');}}),holdPhoneInert:()=>()=>{},scope:{calendar,current:()=>current,canChange:()=>!draft}});
 vm.runInContext(source+'\nopenCalendarSyncSettings(scope);',context);
 const button=name=>[...env.window.document.querySelectorAll('button')].find(el=>el.textContent===name);
 const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};await flush();
 return {env,calls,button,flush,retire:()=>{current=false;},resolve:()=>resolveReview(reviewed())};
}
{
 const f=await canonicalFixture();assert.equal(f.calls.legacy,0);assert.equal(f.calls.changes.length,0);
 const select=f.env.window.document.querySelector('select');select.value=select.options[1].value;select.dispatchEvent(new f.env.window.Event('change'));
 assert.equal(f.button('Enable sync').disabled,true,'selection is not an enabled destination');f.button('Save destination').click();await f.flush();
 assert.deepEqual(f.calls.changes.map(c=>c.operation),['select']);assert.equal(f.button('Enable sync').disabled,false);
 f.button('Enable sync').click();await f.flush();assert.deepEqual(f.calls.changes.map(c=>c.operation),['select','resume']);assert.equal(f.calls.legacy,0);f.button('Close').click();f.env.window.close();
}
{
 const f=await canonicalFixture({draft:true});const select=f.env.window.document.querySelector('select');select.value=select.options[1].value;select.dispatchEvent(new f.env.window.Event('change'));
 assert.equal(f.button('Save destination').disabled,true);assert.equal(f.button('Enable sync').disabled,true);assert.equal(f.calls.changes.length,0);f.button('Close').click();f.env.window.close();
}
{
 const f=await canonicalFixture({delay:true});f.retire();f.resolve();await f.flush();assert.equal(f.env.window.document.querySelector('dialog'),null);assert.equal(f.calls.changes.length,0);assert.equal(f.calls.legacy,0);f.env.window.close();
}
console.log('PASS 3 canonical sync dialog cases: same-source review/select/resume, retained draft blocks changes, owner retirement drops stale review; zero legacy host reads.');
// Execute the real Settings row callback, leaving the connected/native/legacy fences intact.
{
 const settings=fs.readFileSync(new URL('../apps/app/src/prototype/settings-adapter.ts',import.meta.url),'utf8');
 const start=settings.indexOf("groups.push({...group([",settings.indexOf("cap:'Calendar sources'"));assert(start>=0);
 const begin=start+"groups.push({...group([".length,end=settings.indexOf("]),cap:'Sync'",begin);assert(end>begin);
 const rowExpression=settings.slice(begin,end);
 function row({native=false,mocks=false,authority='canonical',calendar=null}={}){
  const calls={pages:[],connections:0,sync:[],toasts:[]};const api={set:x=>calls.pages.push(x),toast:x=>calls.toasts.push(x)};const shell={live:true,agentCalendar:calendar,vget:()=>({calendarAuthority:authority}),canonicalDraftText:'',canonicalDraftInvalid:false};
  const browserCalendarScope=owner=>mocks&&!!owner&&!native&&owner.vget('calendar').calendarAuthority==='browser-local';
  const info=(label,val)=>({kInfo:true,label,val,hasVal:true,noAB:true});
  const prefix=settings.slice(settings.lastIndexOf('          const syncAuthority',begin),begin);
  const setup=prefix.startsWith('          const syncAuthority')?prefix.split('          groups.push')[0]:'';
  const value=new Function('owner','api','native','testMocksEnabled','connectionController','openCalendarSyncSettings','browserCalendarScope','info',`${setup}return (${rowExpression});`)(shell,api,native,mocks,{open:()=>calls.connections++},x=>calls.sync.push(x),browserCalendarScope,info);return{value,go:value.go,calls,shell};
 }
 for(const native of [false,true]){const f=row({native});assert.equal(f.value.kInfo,true);assert.match(f.value.val,/Connect to Agent Calendar/);assert.equal(f.go,undefined);assert.equal(f.calls.connections,0);}
 const native=row({authority:'android-native'});assert.equal(native.value.kNav,true);native.go();assert.equal(native.calls.sync.length,1);assert.equal(native.calls.connections,0);
 const browser=row({authority:'browser-local',mocks:true});assert.equal(browser.value.kNav,true);browser.go();assert.equal(browser.calls.sync.length,1);assert.equal(browser.calls.connections,0);
 const notBrowser=row({authority:'browser-local',mocks:true,native:true});assert.equal(notBrowser.value.kInfo,true);assert.equal(notBrowser.go,undefined);
 for(const authority of ['legacy']){const f=row({authority,calendar:{state:{ownerKey:'owner'}}});assert.equal(f.value.kInfo,true);assert.match(f.value.val,/Retained calendars stay read only/);assert.equal(f.go,undefined);assert.equal(f.calls.sync.length,0);assert.equal(f.calls.toasts.length,0);}
 const calendar={state:{ownerKey:'owner'}};const f=row({calendar});f.go();assert.equal(f.calls.sync.length,1);const review=f.calls.sync[0];assert.equal(review.calendar,calendar);assert(review.current());assert(review.canChange());f.shell.canonicalDraftText='unsent';assert.equal(review.canChange(),false);calendar.state.ownerKey='other';assert.equal(review.current(),false);assert.equal(f.calls.connections,0);
 console.log('PASS real Settings sync row: offline connection recovery, native/legacy routing, connected owner and draft fences');
}
