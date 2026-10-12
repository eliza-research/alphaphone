import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {acquireDeviceLease} from '../vendor/eliza/packages/app/scripts/lib/device-lease.ts';
import {withCuttlefishUser} from '../scripts/cuttlefish-user.mjs';
const serial='127.0.0.1:6550',fingerprint='owned-fixture';
async function fixture(options={},run=async()=>({cleaned:true})){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-cvd-user-'));const lease=await acquireDeviceLease(`android:${serial}`,{stateDir:dir,waitMs:0,ttlMs:Number.MAX_SAFE_INTEGER});
 let current='0',exists=false,stopped=false;const commands=[],records=[];
 const owner='Users:\n\tUserInfo{0:Owner:4c13} running';
 const execute=async args=>{
  const command=args.join(' ');commands.push(command);
  if(args[1]==='getprop')return {'ro.hardware':'cutf_cvm','ro.product.device':'vsoc_x86_64_only','ro.build.fingerprint':options.wrongImage?'other':fingerprint,'sys.boot_completed':'1'}[args[2]];
  if(command==='shell dumpsys window policy')return 'KeyguardServiceDelegate\n showing=false\n inputRestricted=false\n';
  if(command.startsWith('shell am get-started-user-state'))return 'RUNNING_UNLOCKED';
  if(command==='shell am get-current-user')return current;
  if(command==='shell pm list users')return owner+(options.otherUser?'\n\tUserInfo{9:unowned:10}':exists?'\n\tUserInfo{10:fixture-user:10}':'');
  if(command.startsWith('shell cmd role get-role-holders'))return 'com.android.launcher3';
  if(command.startsWith('shell cmd package resolve-activity'))return 'com.android.launcher3/.Launcher';
  if(command==='shell pm create-user fixture-user'){exists=true;return 'Success: created user id 10';}
  if(command.startsWith('shell am start-user'))return 'Success';
  if(command.startsWith('shell cmd package set-home-activity'))return 'Success';
  if(command.startsWith('shell am switch-user')){if(args.at(-1)==='0'&&options.restoreFailure)throw Error('restore failed');current=args.at(-1);return '';}
  if(command.startsWith('shell input ')||command==='shell wm dismiss-keyguard')return '';
  if(command==='shell dumpsys activity activities')return options.secondaryHomeFailure&&current==='10'?'none':`topResumedActivity=Activity u${current} com.android.launcher3/.Launcher`;
  if(command==='shell am stop-user -w 10'){if(options.stopFailure)throw Error('stop failed');stopped=true;return '';}
  if(command==='shell am is-user-stopped 10')return String(stopped);
  if(command==='shell pm remove-user --wait 10'){exists=false;return 'Success: removed user';}
  throw Error('Unexpected command '+command);
 };
 let result,error;
 try{result=await withCuttlefishUser({serial,deviceLease:lease,env:{ELIZA_DEVICE_LEASE_DIR:dir},execute,expectedFingerprint:fingerprint,name:'fixture-user',run,record:value=>records.push(value),waitMs:5,pollMs:1});}catch(e){error=e;}
 finally{lease.release();fs.rmSync(dir,{recursive:true,force:true});}
 return {result,error,commands,records,current,exists};
}
test('Cuttlefish user is removed only after callback cleanup and owner HOME restoration',async()=>{
 const r=await fixture({},async({user})=>{assert.equal(user,10);return {cleaned:true};});assert.ifError(r.error);assert.equal(r.result.removed,true);assert.equal(r.current,'0');assert.equal(r.exists,false);
 assert.ok(r.commands.indexOf('shell am switch-user 0')<r.commands.indexOf('shell pm remove-user --wait 10'));
});
test('uncertain or thrown callbacks restore the owner and retain their user',async()=>{
 for(const run of [async()=>({cleaned:false}),async()=>({cleaned:true,cleanupDeferred:true}),async()=>{throw Error('instrumentation unresolved');}]){const r=await fixture({},run);assert.ok(r.error);assert.equal(r.current,'0');assert.equal(r.exists,true);assert.equal(r.records.at(-1).cleanupDeferred,true);assert.ok(!r.commands.some(c=>c.startsWith('shell pm remove-user')));}
});
test('identity mismatch and existing users refuse before creation',async()=>{
 for(const option of [{wrongImage:true},{otherUser:true}]){const r=await fixture(option);assert.ok(r.error);assert.ok(!r.commands.some(c=>c.startsWith('shell pm create-user')));}
});
test('failed startup before callback still restores and removes only its empty user',async()=>{
 let called=false;const r=await fixture({secondaryHomeFailure:true},async()=>{called=true;return {cleaned:true};});assert.ok(r.error);assert.equal(called,false);assert.equal(r.current,'0');assert.equal(r.exists,false);assert.equal(r.records.at(-1).removed,true);
});
test('restore or stop failure retains the user instead of claiming removal',async()=>{
 for(const option of [{restoreFailure:true},{stopFailure:true}]){const r=await fixture(option);assert.ok(r.error);assert.equal(r.exists,true);assert.equal(r.records.at(-1).removed,false);assert.equal(r.records.at(-1).cleanupDeferred,true);assert.ok(!r.commands.includes('shell pm remove-user --wait 10'));}
});
