import assert from 'node:assert/strict';
import test from 'node:test';
import {AgentCalendar,calendarSourceKey,type CalendarPreservation} from '../apps/app/src/runtime/agent-calendar';
import type {AppRecordPort} from '../apps/app/src/runtime/agent-calendar-client';

function deferred<T>(){
 let resolve!:(value:T)=>void, reject!:(error:Error)=>void;
 const promise=new Promise<T>((ok,fail)=>{resolve=ok;reject=fail;});
 return {promise,resolve,reject};
}
async function fixture(){
 const snapshot={fingerprint:'unchanged',present:false,readable:true,pending:false,records:[]};
 let capture:CalendarPreservation['capture']=async()=>snapshot;
 const preservation:CalendarPreservation={capture:signal=>capture(signal),retainedReadOnly:async()=>true};
 const source={provider:'google',side:'owner',grantId:'test-grant',connectorAccountId:'test-account',calendarId:'primary',selectionVersion:1};
 const port={identity:{origin:'https://calendar.example',ownerId:'test-owner',agentId:'test-agent'},sessionId:'test-session',scope:'owner',current:()=>true} as unknown as AppRecordPort;
 const writes:string[]=[];
 const api={
  getLifeOpsCalendarFeed:async()=>({state:'complete',events:[]}),
  getLifeOpsCalendars:async()=>({calendars:[source]}),
  getLifeOpsNextCalendarEventContext:async()=>({event:null}),
  createLifeOpsCalendarEvent:async(request:{idempotencyKey:string})=>{writes.push(request.idempotencyKey);return {outcome:'accepted_without_readback'};},
 };
 const calendar=new AgentCalendar(()=>port,preservation,()=>api as never);
 await calendar.refresh({});
 const create=(key:string)=>calendar.create(calendarSourceKey(source as never),{idempotencyKey:key,title:'Synthetic test',startAt:'2026-10-25T09:00:00Z',endAt:'2026-10-25T10:00:00Z'} as Parameters<AgentCalendar['create']>[1]);
 return {calendar,api,snapshot,writes,create,setCapture:(next:CalendarPreservation['capture'])=>{capture=next;}};
}

test('pending reservation covers the first await and refuses a concurrent write',async()=>{
 const f=await fixture(),held=deferred<typeof f.snapshot>();let captures=0;
 f.setCapture(()=>{captures++;return held.promise;});
 const first=f.create('first');
 assert.equal(f.calendar.state.mutating,true,'disable writes while preservation is unresolved');
 await assert.rejects(f.create('overlap'),/Wait for the current Calendar source/);
 assert.equal(captures,1,'the refused request must not enter preservation');
 assert.deepEqual(f.writes,[],'preservation must precede the accepted write');
 held.resolve(f.snapshot);await first;
 assert.deepEqual(f.writes,['first']);
 assert.equal(f.calendar.state.mutating,false);
 f.calendar.retire();
});

test('preservation rejection releases pending and permits a later explicit write',async()=>{
 const f=await fixture(),held=deferred<typeof f.snapshot>();
 f.setCapture(()=>held.promise);
 const failed=f.create('failed');
 const rejected=assert.rejects(failed,/Synthetic preservation failure/);
 assert.equal(f.calendar.state.mutating,true);
 held.reject(new Error('Synthetic preservation failure'));await rejected;
 assert.equal(f.calendar.state.mutating,false);
 assert.deepEqual(f.writes,[],'failed preservation must not send a write');
 f.setCapture(async()=>f.snapshot);
 await f.create('later-explicit-request');
 assert.deepEqual(f.writes,['later-explicit-request']);
 assert.equal(f.calendar.state.mutating,false);
 f.calendar.retire();
});

test('a failed read keeps the last verified next event instead of blanking the Home card',async()=>{
 const f=await fixture(),next={event:{id:'standup',agentId:'test-agent',title:'Standup',endAt:'2999-01-01T10:00:00Z'}};
 f.api.getLifeOpsNextCalendarEventContext=async()=>next as never;await f.calendar.refresh({});
 assert.equal(f.calendar.state.next,next);
 f.api.getLifeOpsNextCalendarEventContext=async()=>{throw Error('Synthetic next-context failure');};await f.calendar.refresh({});
 assert.equal(f.calendar.state.status,'ready','the feed still renders');assert.equal(f.calendar.state.next,next);
 f.api.getLifeOpsCalendarFeed=async()=>{throw Error('Synthetic feed failure');};await f.calendar.refresh({});
 assert.equal(f.calendar.state.status,'error');assert.equal(f.calendar.state.feed,null);assert.equal(f.calendar.state.next,next);
 f.api.getLifeOpsCalendarFeed=async()=>({state:'complete',events:[]}) as never;
 f.api.getLifeOpsNextCalendarEventContext=async()=>({event:{...next.event,endAt:'2000-01-01T10:00:00Z'}}) as never;await f.calendar.refresh({});
 f.api.getLifeOpsNextCalendarEventContext=async()=>{throw Error('Synthetic next-context failure');};await f.calendar.refresh({});
 assert.equal(f.calendar.state.next,null,'an event that has ended is not kept as the next one');
 f.calendar.retire();assert.equal(f.calendar.state.next,null);
});
