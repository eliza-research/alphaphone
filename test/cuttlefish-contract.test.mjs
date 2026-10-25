import test from 'node:test';
import assert from 'node:assert/strict';
import {admitCuttlefish,instrumentationResult} from '../scripts/cuttlefish-contract.mjs';
const properties={hardware:'cutf_cvm',device:'vsoc_x86_64_only',bootCompleted:'1'};
test('Cuttlefish admission rejects physical, remote and unbooted targets',()=>{
 assert.equal(admitCuttlefish('127.0.0.1:6520',properties),properties);
 for(const serial of ['emulator-5554','device-id','192.168.1.2:6520'])assert.throws(()=>admitCuttlefish(serial,properties));
 assert.throws(()=>admitCuttlefish('127.0.0.1:6520',{...properties,hardware:'tensor'}));
 assert.throws(()=>admitCuttlefish('127.0.0.1:6520',{...properties,bootCompleted:'0'}));
});
const event=(code,name='case')=>`INSTRUMENTATION_STATUS: class=AppTest\nINSTRUMENTATION_STATUS: test=${name}\nINSTRUMENTATION_STATUS_CODE: ${code}\n`;
test('instrumentation distinguishes actual success, assumptions, incomplete and duplicate cases',()=>{
 const good=event(1)+event(0)+'OK (1 test)';
 assert.equal(instrumentationResult(good).passed,true);
 const skipped=instrumentationResult(good.replace('OK (1 test)',event(1,'live')+event(-4,'live')+'OK (2 tests)'));
 assert.equal(skipped.passed,true);assert.equal(skipped.allExecuted,false);assert.equal(skipped.counts.skipped,1);
 for(const log of ['OK (0 tests)',event(1)+'OK (1 test)',good+'\n'+event(0),event(0)+'OK (1 test)',good+'\nINSTRUMENTATION_FAILED'])assert.equal(instrumentationResult(log).passed,false);
 assert.equal(instrumentationResult(event(1)+event(-2)+'OK (1 test)').passed,false);
});
