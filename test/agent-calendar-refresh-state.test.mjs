import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';
// Entire real controller, with only its external client/editor imports replaced.
// Reads and accepted writes use injected synthetic ports; zero provider/native I/O.
const text=readFileSync('apps/app/src/runtime/agent-calendar.ts','utf8');
const code=stripTypeScriptTypes(text.replace(/^import .*;\n/gm,'').replace(/^export /gm,''),{mode:'transform'});
const unexpected=()=>{throw Error('Unexpected editor/default client dependency');};
const {AgentCalendar}=new Function('agentCalendarClient','eventEditorMutability','cancellationModeForEditorEvent',code+';return {AgentCalendar};')(unexpected,unexpected,unexpected);
const view=readFileSync('apps/app/src/runtime/agent-calendar-view.ts','utf8');
const homeCode=stripTypeScriptTypes(view.slice(view.indexOf('export function canonicalHomeCalendar(')).replace(/^export /,''),{mode:'transform'});
const home=new Function(homeCode+';return canonicalHomeCalendar;')();
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
async function fixture(){
 let active=true,capture=async()=>({fingerprint:'same',present:false,readable:true,pending:false,records:[]});
 const source={provider:'google',side:'owner',grantId:'grant',connectorAccountId:'account',calendarId:'primary',selectionVersion:1};
 const event={id:'event',agentId:'agent',provider:'google',side:'owner',grantId:'grant',connectorAccountId:'account',calendarId:'primary',endAt:'2999-01-01T10:00:00Z'};
 const next={event,calendarFeedState:'complete',readScope:{timeMin:'2026-01-01',timeMax:'2999-01-02'}};
 const port={identity:{origin:'https://fixture.invalid',ownerId:'owner',agentId:'agent'},sessionId:'session',scope:'owner',current:()=>active};
 const reads=[],writes=[],api={getLifeOpsCalendarFeed:async()=>{reads.push('feed');return{state:'complete',events:[]};},getLifeOpsCalendars:async()=>({calendars:[source]}),getLifeOpsNextCalendarEventContext:async()=>next,createLifeOpsCalendarEvent:async x=>{writes.push(x);return{outcome:'accepted_without_readback'};}};
 const calendar=new AgentCalendar(()=>port,{capture:s=>capture(s),retainedReadOnly:async()=>true},()=>api);
 await calendar.refresh({});return{calendar,source,event,next,port,api,reads,writes,capture:fn=>capture=fn,retire:()=>{active=false;calendar.retire();}};
}
test('next read failure keeps a same-source cached event but never presents it as verified',async()=>{
 const f=await fixture();assert.equal(f.calendar.state.nextFresh,true);assert.equal(home(f.calendar.state.next,f.calendar.state.nextFresh).verified,true);
 f.api.getLifeOpsNextCalendarEventContext=async()=>{throw Error('Unavailable');};await f.calendar.refresh({});
 assert.equal(f.calendar.state.status,'ready');assert.equal(f.calendar.state.next,f.next);assert.equal(f.calendar.state.nextFresh,false);assert.equal(home(f.calendar.state.next,f.calendar.state.nextFresh).verified,false);assert.match(f.calendar.state.error,/unverified/);f.retire();
});
test('partial coverage and feed failure never mark next as verified',async()=>{
 const f=await fixture();f.api.getLifeOpsCalendarFeed=async()=>({state:'partial',events:[]});await f.calendar.refresh({});assert.equal(f.calendar.state.nextFresh,false);
 f.api.getLifeOpsCalendarFeed=async()=>{throw Error('Feed unavailable');};await f.calendar.refresh({});assert.equal(f.calendar.state.feed,null);assert.equal(f.calendar.state.nextFresh,false);assert.equal(home(f.calendar.state.next,f.calendar.state.nextFresh).verified,false);f.retire();
});
test('source failure, removed source and another agent cannot publish a verified next event',async()=>{
 const f=await fixture();f.api.getLifeOpsNextCalendarEventContext=async()=>{throw Error('Unavailable');};f.api.getLifeOpsCalendars=async()=>({calendars:[]});await f.calendar.refresh({});assert.equal(f.calendar.state.next,null);
 const g=await fixture();g.api.getLifeOpsCalendars=async()=>{throw Error('Sources unavailable');};await g.calendar.refresh({});assert.equal(g.calendar.state.next,null);
 const h=await fixture();h.api.getLifeOpsNextCalendarEventContext=async()=>({...h.next,event:{...h.event,agentId:'other'}});await h.calendar.refresh({});assert.equal(h.calendar.state.next,null);assert.equal(h.calendar.state.nextFresh,false);f.retire();g.retire();h.retire();
});
test('session and query changes cannot keep another binding cached after a failed read',async()=>{
 for(const sessionChange of [true,false]){const f=await fixture();if(sessionChange)f.port.sessionId='new-session';f.api.getLifeOpsNextCalendarEventContext=async()=>{throw Error('Unavailable');};await f.calendar.refresh(sessionChange?{}:{timeZone:'UTC'});assert.equal(f.calendar.state.next,null);assert.equal(f.calendar.state.nextFresh,false);f.retire();}
});
test('all refresh triggers coalesce behind a pending mutation without aborting its signal',async()=>{
 const f=await fixture(),held=defer(),snapshot={fingerprint:'same',present:false,readable:true,pending:false,records:[]};let mutationSignal,captures=0;
 f.capture(async signal=>{if(++captures===1){mutationSignal=signal;return held.promise;}return snapshot;});
 const create=f.calendar.create(JSON.stringify([f.source.provider,f.source.side,f.source.grantId,f.source.connectorAccountId,f.source.calendarId]),{idempotencyKey:'one',title:'One'});create.catch(()=>{});
 try{
  assert.equal(f.calendar.state.mutating,true);const count=f.reads.length;
  await f.calendar.refresh({timeZone:'UTC'});await f.calendar.refresh({timeZone:'Europe/London'});assert.equal(f.reads.length,count);assert.equal(mutationSignal.aborted,false);
  held.resolve(snapshot);await create;await flush();assert.equal(f.writes.length,1);assert.equal(f.reads.length,count+1);
 }finally{held.resolve(snapshot);await Promise.allSettled([create]);f.retire();}
});
test('retirement drops delayed replies and pending reads',async()=>{
 const f=await fixture(),held=defer();f.api.getLifeOpsCalendarFeed=()=>held.promise;const read=f.calendar.refresh({});await flush();f.retire();held.resolve({state:'complete',events:[]});await read;assert.equal(f.calendar.state.ownerKey,null);assert.equal(f.calendar.state.next,null);assert.equal(f.calendar.state.nextFresh,false);
});
test('event end invalidates the cached card without I/O',async()=>{
 const f=await fixture(),count=f.reads.length;f.event.endAt='2000-01-01T00:00:00Z';f.calendar.invalidateNext();assert.equal(f.calendar.state.next,null);assert.equal(f.calendar.state.nextFresh,false);assert.equal(f.reads.length,count);f.retire();
});
