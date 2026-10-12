/** Used only inside the admitted guest's device lease. Restores settings even on test failure. */
export class OfflineNetworkFixture {
 constructor(adb,{sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  this.adb=adb;this.sleep=sleep;this.touched=false;
  const before=this.read();
  if(!['enabled','disabled'].includes(before.airplane)||!['0','1'].includes(before.wifi))throw Error('Unknown original network settings; no network mutation attempted');
  this.receipt={before,offlineObserved:false,restored:false};
 }
 read(){return {airplane:this.adb(['shell','cmd','connectivity','airplane-mode']).trim(),wifi:this.adb(['shell','settings','get','global','wifi_on']).trim()};}
 async enter(){
  this.touched=true;
  this.adb(['shell','cmd','connectivity','airplane-mode','enable']);
  this.adb(['shell','cmd','wifi','set-wifi-enabled','disabled']);
  for(let i=0;i<20;i++){
   const states=[...this.adb(['shell','dumpsys','connectivity']).matchAll(/Active default network:\s*(none|\d+)/g)];
   if(states.length===1&&states[0][1]==='none'){this.receipt.offlineObserved=true;return;}
   await this.sleep(1000);
  }
  throw Error('Offline speech requires no active default network; no test started');
 }
 restore(){
  if(!this.touched)return;
  const {before}=this.receipt,errors=[];
  // Attempt both restorations even if one command fails.
  for(const args of [['shell','cmd','connectivity','airplane-mode',before.airplane==='enabled'?'enable':'disable'],['shell','cmd','wifi','set-wifi-enabled',before.wifi==='1'?'enabled':'disabled']]){
   try{this.adb(args);}catch(error){errors.push(error.message);}
  }
  try{this.receipt.after=this.read();if(JSON.stringify(this.receipt.after)!==JSON.stringify(before))errors.push('Network setting readback differs from original');}catch(error){errors.push(error.message);}
  this.receipt.errors=errors;this.receipt.restored=errors.length===0;
  if(errors.length)throw Error('Network settings were not proven restored: '+errors.join('; '));
 }
}
