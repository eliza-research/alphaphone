import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {admitCuttlefish,keyguardReadyFromPolicy} from './cuttlefish-contract.mjs';
import {activeLeaseStatus,deviceLeasePath,deviceLeaseStateDir,readDeviceLease} from '../vendor/eliza/packages/app/scripts/lib/device-lease.ts';

/** Fresh-user lifecycle for an owned Cuttlefish guest. Package cleanup is an
 * explicit callback receipt; uncertain callbacks retain their user for recovery. */
export async function withCuttlefishUser({execute,serial,deviceLease,expectedFingerprint,homePackage='com.android.launcher3',name,run,record,env=process.env,signal,waitMs=60000,pollMs=150}) {
 const key=`android:${serial}`,stateDir=deviceLeaseStateDir(env);
 assert.equal(deviceLease?.path,deviceLeasePath(key,stateDir));
 assert.equal(deviceLease.lease.pid,process.pid);assert.equal(deviceLease.lease.ttlMs,Number.MAX_SAFE_INTEGER);
 assert.deepEqual(readDeviceLease(key,{stateDir}),deviceLease.lease);assert.ok(activeLeaseStatus(deviceLease.lease).active);
 assert.match(name,/^[A-Za-z0-9_.-]{1,80}$/);assert.match(homePackage,/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/);
 for(const n of [waitMs,pollMs])assert.ok(Number.isSafeInteger(n)&&n>0);
 const call=async(args,cleanup=false)=>{if(!cleanup)signal?.throwIfAborted();return String(await execute(args,{signal:cleanup?undefined:signal})).trim();};
 const wait=async(predicate,message,cleanup=false)=>{const end=Date.now()+waitMs;do{if(!cleanup)signal?.throwIfAborted();if(await predicate())return;await delay(Math.min(pollMs,Math.max(1,end-Date.now())),undefined,{signal:cleanup?undefined:signal});}while(Date.now()<end);throw Error(message);};
 const property=async key=>call(['shell','getprop',key]);
 const ownerHome=async(cleanup=false)=>({holders:await call(['shell','cmd','role','get-role-holders','--user','0','android.app.role.HOME'],cleanup),component:await call(['shell','cmd','package','resolve-activity','--brief','--user','0','-a','android.intent.action.MAIN','-c','android.intent.category.HOME'],cleanup)});
 admitCuttlefish(serial,{hardware:await property('ro.hardware'),device:await property('ro.product.device'),fingerprint:await property('ro.build.fingerprint'),bootCompleted:await property('sys.boot_completed'),userState:await call(['shell','am','get-started-user-state','0']),keyguardReady:keyguardReadyFromPolicy(await call(['shell','dumpsys','window','policy']))},expectedFingerprint);
 assert.equal(await call(['shell','am','get-current-user']),'0');
 const before=await call(['shell','pm','list','users']);assert.deepEqual([...before.matchAll(/UserInfo\{(\d+):/g)].map(m=>m[1]),['0'],'Recover existing secondary users before another campaign');
 const original=await ownerHome();assert.equal(original.holders,homePackage);assert.ok(original.component.split(/\r?\n/).at(-1).startsWith(homePackage+'/'));
 const report={user:null,name,ownerRestored:false,cleanupDeferred:true,removed:false};let failure,result,entered=false;
 try{
  const created=await call(['shell','pm','create-user',name]);const user=Number(created.match(/^Success: created user id (\d+)$/m)?.[1]);assert.ok(Number.isSafeInteger(user)&&user>0,'Owned user creation unconfirmed');report.user=user;await record({...report});const id=String(user);
  assert.ok((await call(['shell','pm','list','users'])).includes(`UserInfo{${user}:${name}:`),'Created user identity differs');
  await call(['shell','am','start-user','-w',id]);
  const home=(await call(['shell','cmd','package','resolve-activity','--brief','--user',id,'-a','android.intent.action.MAIN','-c','android.intent.category.HOME','-p',homePackage])).split(/\r?\n/).at(-1);
  assert.ok(home.startsWith(homePackage+'/')&&/^[A-Za-z0-9_.$/]+$/.test(home),'Stock HOME unavailable');
  assert.match(await call(['shell','cmd','package','set-home-activity','--user',id,home]),/Success/);
  await call(['shell','am','switch-user',id]);await wait(async()=>await call(['shell','am','get-current-user'])===id,'Secondary user not foreground');
  await call(['shell','input','keyevent','KEYCODE_WAKEUP']);await call(['shell','wm','dismiss-keyguard']);
  await wait(async()=>await call(['shell','am','get-started-user-state',id])==='RUNNING_UNLOCKED','Secondary user not unlocked');
  const resumed=new RegExp(`topResumedActivity=.*\\bu${user}\\b.*${homePackage.replaceAll('.','\\.')}/`);
  await wait(async()=>resumed.test(await call(['shell','dumpsys','activity','activities'])),'Secondary HOME not resumed');
  entered=true;result=await run({user,signal});
 }catch(error){failure=error;report.error=error.message;}
 finally{
  if(report.user!==null){try{
   await call(['shell','am','switch-user','0'],true);await wait(async()=>await call(['shell','am','get-current-user'],true)==='0','Owner not restored',true);
   await call(['shell','input','keyevent','KEYCODE_WAKEUP'],true);await call(['shell','wm','dismiss-keyguard'],true);await call(['shell','input','keyevent','KEYCODE_HOME'],true);
   const resumed=new RegExp(`topResumedActivity=.*\\bu0\\b.*${homePackage.replaceAll('.','\\.')}/`);
   await wait(async()=>resumed.test(await call(['shell','dumpsys','activity','activities'],true)),'Owner HOME not resumed',true);
   assert.deepEqual(await ownerHome(true),original,'Owner HOME changed');report.ownerRestored=true;
   report.cleanupDeferred=entered&&(result?.cleaned!==true||result?.cleanupDeferred===true);
   if(!report.cleanupDeferred){
    const id=String(report.user);assert.ok((await call(['shell','pm','list','users'],true)).includes(`UserInfo{${report.user}:${name}:`),'Owned user identity changed before cleanup');
    await call(['shell','am','stop-user','-w',id],true);await wait(async()=>await call(['shell','am','is-user-stopped',id],true)==='true','Owned user did not stop',true);
    assert.match(await call(['shell','pm','remove-user','--wait',id],true),/^Success\b/);
    assert.equal(await call(['shell','pm','list','users'],true),before,'User removal not confirmed');report.removed=true;
   }
  }catch(error){failure??=error;report.cleanupError=error.message;report.cleanupDeferred=true;}}
  try{await record({...report});}catch(error){failure??=error;}
 }
 if(failure)throw failure;assert.equal(report.cleanupDeferred,false,'Owned user cleanup deferred; recover explicitly');assert.equal(report.removed,true,'Owned user removal unconfirmed');return {result,...report};
}
