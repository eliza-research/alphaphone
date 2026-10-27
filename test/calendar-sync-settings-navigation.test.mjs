import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {JSDOM}=require('jsdom');
const source=stripTypeScriptTypes(fs.readFileSync(new URL('../apps/app/src/runtime/calendar-sync-settings.ts',import.meta.url),'utf8'),{mode:'transform'}).replace(/^import .*;\n/gm,'').replace('export function openCalendarSyncSettings','function openCalendarSyncSettings');
const settle=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
function fixture(state={status:'Sync is off.',enabled:false,running:false},review=async()=>{throw Error('Choose a Google calendar in Google accounts first.');}){
 const env=new JSDOM('<div class="os"></div><button id="prior">Calendar settings</button>',{pretendToBeVisual:true});
 env.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};env.window.document.getElementById('prior').focus();
 const calls={open:0,cancel:0,release:0,writes:0,unsubscribe:0};
 const host={snapshot:()=>state,destination:()=>({account:'',calendar:''}),subscribe:()=>()=>calls.unsubscribe++,settings:async()=>{},cancel:()=>calls.cancel++,review,enable:async()=>calls.writes++,sync:async()=>calls.writes++,pause:async()=>calls.writes++};
 const context=vm.createContext({window:env.window,document:env.window.document,getComputedStyle:env.window.getComputedStyle.bind(env.window),calendarSyncHost:host,googleConnectionController:{open(){assert.equal(env.window.document.querySelector('dialog'),null,'Close the sync modal before opening account selection');assert.equal(calls.release,1,'Release modal inert state before opening the existing manager');calls.open++;}},holdPhoneInert:()=>()=>calls.release++});
 vm.runInContext(source+'\nopenCalendarSyncSettings();',context);
 const button=name=>[...env.window.document.querySelectorAll('button')].find(el=>el.textContent===name);
 return {env,calls,button};
}
{
 const f=fixture();await settle();f.button('Review sync').click();await settle();f.button('Choose Google calendar').click();
 assert.equal(f.calls.open,1);assert.equal(f.calls.cancel,1);assert.equal(f.calls.unsubscribe,1);assert.equal(f.calls.writes,0);assert.equal(f.env.window.document.activeElement.id,'prior');f.env.window.close();
}
{
 let resolve;const f=fixture(undefined,()=>new Promise(done=>resolve=done));await settle();f.button('Review sync').click();
 assert.equal(f.button('Choose Google calendar').disabled,true);f.button('Choose Google calendar').click();assert.equal(f.calls.open,0);
 resolve({events:[]});await settle();assert.equal(f.button('Choose Google calendar').disabled,false);f.button('Close').click();assert.equal(f.calls.writes,0);f.env.window.close();
}
{
 const f=fixture({status:'Sync enabled.',enabled:true,running:false});await settle();assert.equal(f.button('Choose Google calendar').hidden,true);f.button('Close').click();assert.equal(f.calls.writes,0);f.env.window.close();
}
console.log('PASS 3 actual calendar-sync dialog cases: missing destination recovery, pending review gating, enabled destination retention. Synthetic host/controller only; no Google/model/native calls.');

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
