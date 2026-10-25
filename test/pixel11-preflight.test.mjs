import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseOptions,readDevice,evaluateDevice,verifyFactory,audit} from '../scripts/pixel11-preflight.mjs';
const lock=JSON.parse(fs.readFileSync(new URL('../vendor/eliza/packages/os/android/pixel11pro.lock.json',import.meta.url)));
test('preflight rejects write switches, duplicates and unscoped mode',()=>{
 for(const args of [['--execute'],['--unlock'],['--mode','fastboot'],['--device','x','--device','y'],['--device','-s'],['--device','x;reboot'],['--device','x','--mode','recovery']]) assert.throws(()=>parseOptions(args));
 assert.deepEqual(parseOptions(['--device','abc']),{device:'abc',mode:'adb'});
});
test('every physical query is explicitly serial-bound and read-only',()=>{
 for(const mode of ['adb','fastboot']) {
  const calls=[];
  readDevice('explicit-serial',mode,(cmd,args,opts)=>{calls.push({cmd,args,opts});return {status:0,stdout:'unknown',stderr:''};});
  assert.ok(calls.length>10);
  for(const {cmd,args,opts}of calls){assert.equal(cmd,mode);assert.deepEqual(args.slice(0,2),['-s','explicit-serial']);assert.deepEqual(args.slice(2,-1),mode==='adb'?['shell','getprop']:['getvar']);assert.equal(opts.timeout,10000);}
 }
});
test('failed and ambiguous queries remain unknown',()=>{
 const failed=readDevice('abc','adb',()=>({status:1,stdout:'grizzly'}));assert.equal(Object.keys(failed.facts).length,0);assert.ok(failed.errors.length);
 const protocol=readDevice('abc','fastboot',(_c,args)=>({status:0,stdout:`${args.at(-1)}: grizzly\nFAILED (remote failure)`}));assert.equal(Object.keys(protocol.facts).length,0);
 const ambiguous=readDevice('abc','fastboot',(_c,args)=>({status:0,stdout:`${args.at(-1)}: grizzly\n${args.at(-1)}: kodiak`}));assert.equal(Object.keys(ambiguous.facts).length,0);
});
test('wrong devices, newer firmware and pending snapshots cannot qualify',()=>{
 for(const device of ['kodiak','cubs','yogi','vsoc_x86_64_only','emu64xa'])assert.ok(evaluateDevice({mode:'adb',facts:{'ro.product.device':device},errors:[]},lock).some(x=>x.includes('not grizzly')));
 const errors=evaluateDevice({mode:'fastboot',facts:{product:'grizzly',sku:'G7SWN','version-bootloader':'newer','snapshot-update-status':'merging','battery-soc':'49 %'},errors:[]},lock);
 for(const pattern of ['firmware','Snapshot','Battery','Slot'])assert.ok(errors.some(x=>x.includes(pattern)));
});
test('recovery verifies exact bytes, rejects tampering, truncation and symlinks',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-recovery-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'factory.zip'),bytes=Buffer.from('fixture, not a real archive');fs.writeFileSync(file,bytes);
 const pin={sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 assert.equal((await verifyFactory(file,pin)).restorationTested,false);
 const link=path.join(dir,'link');fs.symlinkSync(file,link);await assert.rejects(verifyFactory(link,pin));
 fs.writeFileSync(file,Buffer.alloc(bytes.length));await assert.rejects(verifyFactory(file,pin),/hash/);
 fs.writeFileSync(file,'short');await assert.rejects(verifyFactory(file,pin),/size/);
});
test('default audit makes no device calls and cannot authorize deployment',async()=>{
 const calls=[];
 const report=await audit(parseOptions([]),undefined,(cmd,args)=>{calls.push(cmd);return {status:0,stdout:args.includes('rev-parse')?JSON.parse(fs.readFileSync(new URL('../upstream.lock.json',import.meta.url))).commit:''};});
 assert.deepEqual(calls,['git','git']);assert.equal(report.deployReady,false);assert.equal(report.execution,false);assert.equal(report.device,null);assert.ok(report.blockers.some(x=>x.includes('Alpha-specific')));
});
test('recovery rejects path replacement after opening even with identical bytes',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-recovery-swap-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'factory.zip'),bytes=Buffer.from('same bytes in two different files');fs.writeFileSync(file,bytes);
 const pin={sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 const open=fs.promises.open.bind(fs.promises);
 t.mock.method(fs.promises,'open',async(...args)=>{
  const handle=await open(...args);
  fs.renameSync(file,file+'.original');fs.writeFileSync(file,bytes);
  return handle;
 });
 await assert.rejects(verifyFactory(file,pin),/file changed/);
});
