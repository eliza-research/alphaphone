import test from 'node:test';
import assert from 'node:assert/strict';
import {currentClockTimeZone, clockTimeZone, assertClockTimeZone} from '../apps/app/src/runtime/clock-contract.ts';
function withDefault(zone, run) {
 const Original = Intl.DateTimeFormat;
 Intl.DateTimeFormat = function(...args) { return args.length ? new Original(...args) : {resolvedOptions:()=>({timeZone:zone})}; };
 try {run();} finally {Intl.DateTimeFormat = Original;}
}
test('Android GMT zero-offset default initializes a canonical UTC clock',()=>{
 for(const zone of ['+00:00','-00:00'])withDefault(zone,()=>{
  assert.equal(currentClockTimeZone(),'UTC');
  assert.doesNotThrow(()=>assertClockTimeZone({type:'clock_handoff',action:'set',hour:9,minute:0,label:'test',timeZone:'UTC'},'UTC'));
 });
});
test('named zones remain unchanged and invalid defaults never silently become UTC',()=>{
 for(const zone of ['UTC','GMT','America/Los_Angeles'])withDefault(zone,()=>assert.equal(currentClockTimeZone(),zone));
 for(const zone of [undefined,'Invalid/Zone','+99:99'])withDefault(zone,()=>assert.throws(currentClockTimeZone,/Invalid Clock time zone/));
 assert.throws(()=>clockTimeZone('+00:00'),/Invalid Clock time zone/);
 withDefault('America/Los_Angeles',()=>assert.throws(()=>assertClockTimeZone({type:'clock_handoff',action:'set',hour:9,minute:0,label:'test',timeZone:'UTC'},'UTC'),/changed/));
});
