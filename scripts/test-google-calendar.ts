// Synthetic Cloud transport only: no OAuth, provider traffic, native calendars or account writes.
import assert from 'node:assert/strict';
import { GoogleCalendarReader, type GoogleCalendarBinding, type GoogleCalendarClient } from '../apps/app/src/runtime/google-calendar.ts';
import { CloudProtocolError, type GmailAccount, type GoogleCalendarEvent, type GoogleCalendarSummary } from '../apps/app/src/runtime/cloud-protocol.ts';
const binding: GoogleCalendarBinding = { environment:'production',userId:'owner',organizationId:'org',credentialId:'credential-generation',sessionId:'session-generation',connectionId:'grant' };
const summary: GoogleCalendarSummary = { calendarId:'primary@example.test',summary:'My calendar',description:null,primary:true,accessRole:'owner',backgroundColor:null,foregroundColor:null,timeZone:'America/Los_Angeles',selected:true };
const account: GmailAccount = { configured:true,connected:true,reason:'connected',connectionId:'grant',grantedCapabilities:['google.calendar.read'],label:'owner@example.test' };
const range = { timeMin:'2026-10-13T00:00:00Z',timeMax:'2026-10-16T00:00:00Z',timeZone:'America/Los_Angeles' };
const event: GoogleCalendarEvent = { externalId:'event',calendarId:summary.calendarId,title:'Appointment',description:'Read-only detail',location:'Office',status:'confirmed',startAt:'2026-10-13T18:00:00Z',endAt:'2026-10-13T19:00:00Z',isAllDay:false,timezone:'America/Los_Angeles',htmlLink:null,conferenceLink:null,organizer:null,attendees:[],metadata:{} };
const signal = () => new AbortController().signal;
function fixture(expectedRange = range) {
  let active: GoogleCalendarBinding|null = {...binding};
  const state = { accounts:[structuredClone(account)], calendars:[structuredClone(summary)], events:[structuredClone(event)], reads:[] as string[], listCount:0, fail:null as Error|null, duringFeed:undefined as (()=>void|Promise<void>)|undefined, duringList:undefined as (()=>void)|undefined };
  const client: GoogleCalendarClient = {
    gmailAccounts: async () => structuredClone(state.accounts),
    googleCalendars: async grant => { assert.equal(grant,'grant'); state.listCount++; state.duringList?.(); if(state.fail)throw state.fail;return structuredClone(state.calendars); },
    googleCalendarFeed: async (grant,id,input) => { assert.equal(grant,'grant');assert.deepEqual(input,expectedRange);state.reads.push(id);await state.duringFeed?.();if(state.fail)throw state.fail;return {calendarId:id,events:structuredClone(state.events),syncedAt:'2026-10-13T20:00:00Z'}; },
  };
  const reader = new GoogleCalendarReader(client,()=>active);
  return { reader,state,setBinding:(value:GoogleCalendarBinding|null)=>{active=value;}, async select(){const result=await reader.listSources(signal());assert.equal(result.status,'ready');if(result.status!=='ready')throw Error('fixture');reader.selectSource(result.calendars[0].id);return result;} };
}
let passed=0;
async function check(name:string,run:()=>Promise<void>) {await run();passed++;console.log(`ok ${passed} - ${name}`);}
await check('explicit source choice; Google selected flag does not authorize reading',async()=>{
  const f=fixture();assert.equal((await f.reader.read(range,signal())).status,'selection-required');
  await f.reader.listSources(signal());assert.equal((await f.reader.read(range,signal())).status,'selection-required');assert.deepEqual(f.state.reads,[]);
  assert.throws(()=>f.reader.selectSource('local'),/currently listed/);
});
await check('maps one explicitly selected source without modifying local calendars',async()=>{
  const f=fixture(),local=[{id:'local',title:'Preserved'}],before=structuredClone(local);const list=await f.select();
  const result=await f.reader.read(range,signal());assert.equal(result.status,'ready');if(result.status!=='ready')return;
  assert.equal(result.events[0].calendarId,list.status==='ready'?list.calendars[0].id:'');assert.equal(result.events[0].begin,Date.parse(event.startAt));
  assert.equal(result.events[0].readOnly,true);assert.equal(result.events[0].source,'google');assert.equal(result.events[0].body,'Read-only detail');
  assert.deepEqual(f.state.reads,[summary.calendarId]);assert.deepEqual(local,before);assert.equal(result.truncated,false);
});
await check('empty feed remains ready; failed request is unavailable',async()=>{
  const f=fixture();await f.select();f.state.events=[];const empty=await f.reader.read(range,signal());assert.equal(empty.status,'ready');if(empty.status==='ready')assert.deepEqual(empty.events,[]);
  f.state.fail=new Error('network failed');assert.equal((await f.reader.read(range,signal())).status,'unavailable');
});
await check('signed out and calendar permission absent are separate states',async()=>{
  const f=fixture();f.setBinding(null);assert.equal((await f.reader.listSources(signal())).status,'not-connected');
  f.setBinding({...binding});f.state.accounts[0].grantedCapabilities=['google.gmail.triage'];assert.equal((await f.reader.listSources(signal())).status,'permission-required');assert.equal(f.state.listCount,0);
});
await check('free busy-only source does not imply event detail permission',async()=>{
  const f=fixture();f.state.calendars[0].accessRole='freeBusyReader';const list=await f.reader.listSources(signal());assert.equal(list.status,'ready');if(list.status==='ready')assert.deepEqual(list.calendars,[]);
});
await check('account, organization, credential, session, environment and connection changes reject late data',async()=>{
  for(const field of Object.keys(binding) as (keyof GoogleCalendarBinding)[]){const f=fixture();await f.select();f.state.duringFeed=()=>f.setBinding({...binding,[field]:field==='environment'?'staging':'other'});await assert.rejects(f.reader.read(range,signal()),{name:'AbortError'});}
});
await check('explicit source change and unmount/disconnect invalidation reject late data',async()=>{
  for(const invalidate of [false,true]){const f=fixture();await f.select();f.state.duringFeed=()=>invalidate?f.reader.invalidate():f.reader.selectSource(null);await assert.rejects(f.reader.read(range,signal()),{name:'AbortError'});}
});
await check('provider grant revoked during read removes stale event content',async()=>{
  const f=fixture();await f.select();f.state.duringFeed=()=>{f.state.accounts=[];};assert.equal((await f.reader.read(range,signal())).status,'not-connected');
  assert.equal((await f.reader.read(range,signal())).status,'selection-required');
});
await check('calendar permission removed during read removes stale event content',async()=>{
  const f=fixture();await f.select();f.state.duringFeed=()=>{f.state.accounts[0].grantedCapabilities=[];};assert.equal((await f.reader.read(range,signal())).status,'permission-required');
});
await check('source removed or restricted during read rejects stale events',async()=>{
  for(const restrict of [false,true]){const f=fixture();await f.select();f.state.duringFeed=()=>{if(restrict)f.state.calendars[0].accessRole='freeBusyReader';else f.state.calendars=[];};assert.equal((await f.reader.read(range,signal())).status,'permission-required');}
});
await check('source refresh that removes the selected source cancels an in-flight read',async()=>{
  const f=fixture();await f.select();let release!:()=>void,started!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});
  f.state.duringFeed=async()=>{started();await pending;};const read=f.reader.read(range,signal());await entered;
  f.state.calendars=[];const sources=await f.reader.listSources(signal());assert.equal(sources.status,'ready');release();
  await assert.rejects(read,{name:'AbortError'});
});
await check('abort signal rejects late success even when a transport ignores it',async()=>{
  const f=fixture();await f.select();const controller=new AbortController();f.state.duringFeed=()=>controller.abort();await assert.rejects(f.reader.read(range,controller.signal),{name:'AbortError'});
});
await check('all-day spans keep exclusive UTC civil-date boundary through DST',async()=>{
  const dstRange={...range,timeMin:'2026-10-31T00:00:00Z',timeMax:'2026-11-03T00:00:00Z'};
  const f=fixture(dstRange);await f.select();f.state.events=[{...event,isAllDay:true,timezone:'UTC',startAt:'2026-10-31T00:00:00Z',endAt:'2026-11-02T00:00:00Z'}];const result=await f.reader.read(dstRange,signal());assert.equal(result.status,'ready');if(result.status==='ready'){assert.equal(result.events[0].end-result.events[0].begin,2*86400000);assert.equal(result.events[0].timeZone,'UTC');assert.equal(result.events[0].allDay,true);}
  f.state.events[0].timezone='Invalid/Calendar';assert.equal((await f.reader.read(dstRange,signal())).status,'unavailable');
});
await check('actual Los Angeles all-day offsets become UTC civil dates with exclusive end',async()=>{
  const holidayRange={...range,timeMin:'2026-09-01T00:00:00Z',timeMax:'2026-09-10T00:00:00Z'};
  const f=fixture(holidayRange);await f.select();f.state.events=[{...event,isAllDay:true,startAt:'2026-09-07T07:00:00Z',endAt:'2026-09-08T07:00:00Z'}];
  const result=await f.reader.read(holidayRange,signal());assert.equal(result.status,'ready');if(result.status==='ready'){assert.equal(result.events[0].begin,Date.parse('2026-09-07T00:00:00Z'));assert.equal(result.events[0].end,Date.parse('2026-09-08T00:00:00Z'));}
});
await check('spring and fall DST all-day boundaries use calendar dates, not elapsed duration',async()=>{
  for(const [startAt,endAt,startDay,endDay] of [
    ['2026-03-08T08:00:00Z','2026-03-09T07:00:00Z','2026-03-08','2026-03-09'],
    ['2026-11-01T07:00:00Z','2026-11-02T08:00:00Z','2026-11-01','2026-11-02'],
    ['2026-10-31T07:00:00Z','2026-11-02T08:00:00Z','2026-10-31','2026-11-02'],
  ]){
    const window={...range,timeMin:startDay+'T00:00:00Z',timeMax:endDay+'T23:59:59Z'},f=fixture(window);await f.select();
    f.state.events=[{...event,isAllDay:true,timezone:null,startAt,endAt}]; // calendar timezone fallback
    const result=await f.reader.read(window,signal());assert.equal(result.status,'ready');if(result.status==='ready'){assert.equal(result.events[0].begin,Date.parse(startDay+'T00:00:00Z'));assert.equal(result.events[0].end,Date.parse(endDay+'T00:00:00Z'));}
  }
});
await check('unknown all-day timezone and zero civil-date span fail closed',async()=>{
  const f=fixture();await f.select();f.state.events=[{...event,isAllDay:true,timezone:'Invalid/Calendar'}];assert.equal((await f.reader.read(range,signal())).status,'unavailable');
  f.state.events=[{...event,isAllDay:true}];assert.equal((await f.reader.read(range,signal())).status,'unavailable');
});
await check('cancelled and out-of-window events excluded; recurrence instances stay individual',async()=>{
  const f=fixture();await f.select();f.state.events=[{...event,externalId:'cancelled',status:'cancelled'}, {...event,externalId:'past',startAt:'2026-10-12T00:00:00Z',endAt:range.timeMin}, {...event,externalId:'occ1',metadata:{recurringEventId:'series'}},{...event,externalId:'occ2',startAt:'2026-10-14T18:00:00Z',endAt:'2026-10-14T19:00:00Z',metadata:{recurringEventId:'series'}}];
  const result=await f.reader.read(range,signal());assert.equal(result.status,'ready');if(result.status==='ready'){assert.deepEqual(result.events.map(row=>row.providerEventId),['occ1','occ2']);assert.ok(result.events.every(row=>row.repeat===undefined&&row.seriesId===undefined));}
});
await check('cross-source or duplicate records cannot enter selected calendar',async()=>{
  for(const duplicate of [false,true]){const f=fixture();await f.select();f.state.events=duplicate?[event,event]:[{...event,calendarId:'other'}];assert.equal((await f.reader.read(range,signal())).status,'unavailable');}
});
await check('protocol credential switch is cancellation; denied scope is permission-required',async()=>{
  const f=fixture();await f.select();f.state.fail=new CloudProtocolError('account-changed');await assert.rejects(f.reader.read(range,signal()),{name:'AbortError'});
  f.state.fail=new CloudProtocolError('http',403);assert.equal((await f.reader.read(range,signal())).status,'permission-required');
});
await check('invalid ranges rejected without provider reads',async()=>{
  const f=fixture();await f.select();await assert.rejects(f.reader.read({...range,timeMax:range.timeMin},signal()),TypeError);await assert.rejects(f.reader.read({...range,timeZone:'invalid/zone'},signal()),RangeError);assert.deepEqual(f.state.reads,[]);
});
console.log(`${passed} synthetic Google Calendar adapter checks passed; no live provider acceptance claimed.`);
