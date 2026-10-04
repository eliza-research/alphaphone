import { registerPlugin } from '../platform-plugins';
import { isAndroid } from '../native';
type Facts = Record<string, any>;
const device = registerPlugin<{snapshot():Promise<Facts>;setManagedSetting(input:Record<string,unknown>):Promise<{status:string}>}>('AlphaDevice');
let facts:Facts={}, activeDialog:HTMLDialogElement|undefined;

/** Actual Android readings only; this surface is absent in ordinary app installations. */
export function installManagedDevice(Component:any) {
 if(!isAndroid)return;
 const p=Component.prototype,mount=p.componentDidMount,unmount=p.componentWillUnmount,render=p.renderVals;
 p.renderVals=function(){const out=render.call(this);if(facts.kioskEnabled){out.showStatus=false;out.showIndicator=false;out.tiles=(out.tiles||[]).map((tile:any)=>({...tile,toggle:()=>void openManagedDeviceSettings(({'Wi-Fi':'wifi','Bluetooth':'bluetooth','Location':'privacy','Agent can listen':'privacy','Do not disturb':'sound'} as Record<string,string>)[tile.label]||'about')}));out.onBright=()=>void openManagedDeviceSettings('display');}return out;};
 p.componentDidMount=function(){
  mount.call(this);
  const bar=document.createElement('div');bar.className='alpha-device-status';bar.setAttribute('aria-label','Device status');
  bar.style.cssText='position:fixed;top:0;left:0;right:0;height:36px;padding:0 20px;display:none;align-items:center;justify-content:space-between;background:var(--connection-bg,#fff);color:var(--connection-fg,#111);z-index:150;font:600 12px system-ui;pointer-events:none;box-sizing:border-box';
  (document.getElementById('root')||document.body).append(bar);let disposed=false,busy=false;
  const refresh=async()=>{if(busy||document.hidden)return;busy=true;try{const next=await device.snapshot();if(disposed)return;facts=next;bar.style.display=facts.kioskEnabled?'flex':'none';if(!facts.kioskEnabled)return;const time=document.createElement('span'),signals=document.createElement('span');time.textContent=new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});const pieces:string[]=[];
   if(facts.cellularActive)pieces.push(`${facts.cellularType||'Cellular'} ${typeof facts.cellularSignal==='number'?`${facts.cellularSignal}/4`:''}`.trim());
   if(facts.wifiActive)pieces.push(`Wi-Fi ${typeof facts.wifiSignal==='number'?`${facts.wifiSignal}/4`:''}`.trim());
   if(!facts.internetValidated)pieces.push('Offline');
   pieces.push(typeof facts.batteryPercent==='number'?`${facts.charging?'ϟ ':''}${facts.batteryPercent}%`:'Battery unavailable');
   signals.textContent=pieces.join(' · ');bar.replaceChildren(time,signals);
  }catch{if(!disposed&&facts.kioskEnabled)bar.textContent='Device status unavailable';}finally{busy=false;}};
  void refresh();const timer=setInterval(()=>void refresh(),2000);this.disposeManagedDevice=()=>{disposed=true;clearInterval(timer);bar.remove();activeDialog?.close();activeDialog?.remove();};
 };
 p.componentWillUnmount=function(){this.disposeManagedDevice?.();unmount.call(this);};
}

export async function openManagedDeviceSettings(page:string) {
 if(activeDialog){activeDialog.close();activeDialog.remove();}
 const dialog=document.createElement('dialog');activeDialog=dialog;dialog.className='alpha-managed-settings';
 dialog.style.cssText='position:fixed;inset:42px 12px 18px;margin:0;width:auto;max-width:none;max-height:none;border:1px solid var(--connection-line,#ddd);border-radius:24px;padding:24px;background:var(--connection-bg,#fff);color:var(--connection-fg,#111);font:16px system-ui;box-sizing:border-box;overflow:auto';
 const title=document.createElement('h2');title.textContent=({'wifi':'Wi-Fi','bluetooth':'Bluetooth','display':'Display','sound':'Sound','battery':'Battery','developer':'Development','privacy':'App permissions','notifications':'Notifications','about':'Device information','mobile':'Mobile network'} as Record<string,string>)[page]||'Device controls';
 const body=document.createElement('div'),status=document.createElement('p');status.setAttribute('role','status');
 const close=document.createElement('button');close.textContent='Done';close.onclick=()=>dialog.close();
 dialog.append(title,body,status,close);(document.getElementById('root')||document.body).append(dialog);dialog.addEventListener('close',()=>{dialog.remove();if(activeDialog===dialog)activeDialog=undefined;},{once:true});dialog.showModal();close.focus();
 const info=(label:string,value:unknown)=>{const p=document.createElement('p');p.textContent=`${label}: ${value??'Unavailable'}`;body.append(p);};
 const change=async(input:Record<string,unknown>)=>{status.textContent='Applying…';body.querySelectorAll('input,button,select').forEach(e=>(e as HTMLInputElement).disabled=true);try{await device.setManagedSetting(input);await refresh();status.textContent='Change requested. Values show the latest device reading.';}catch{status.textContent='This setting could not be changed. No change is confirmed.';await refresh();}};
 const toggle=(label:string,field:string,value:boolean|undefined)=>{const row=document.createElement('label'),input=document.createElement('input');row.style.cssText='display:flex;justify-content:space-between;padding:14px 0';row.textContent=label;input.type='checkbox';input.checked=!!value;input.disabled=typeof value!=='boolean';input.onchange=()=>void change({field,enabled:input.checked});row.append(input);body.append(row);};
 const slider=(label:string,field:string,value:number)=>{const row=document.createElement('label'),input=document.createElement('input');row.style.cssText='display:block;margin:20px 0';row.textContent=`${label}: ${value}%`;input.type='range';input.min=field==='brightness'?'2':'0';input.max='100';input.value=String(value);input.setAttribute('aria-label',label);input.style.cssText='display:block;width:100%;margin-top:12px';input.onchange=()=>void change({field,percent:Number(input.value)});row.append(input);body.append(row);};
 async function refresh(){const state=await device.snapshot();if(!dialog.isConnected)return;body.replaceChildren();if(!state.kioskEnabled){info('Controls','This launcher has not been enrolled');return;}
  if(page==='wifi') {toggle('Wi-Fi enabled','wifi',state.wifiEnabled);info('Connection',state.wifiActive?'Connected':'Not connected');info('Signal',typeof state.wifiSignal==='number'?`${state.wifiSignal}/4`:'Unavailable');for(const network of state.savedNetworks||[]){const button=document.createElement('button');button.textContent=`Connect to ${network.name}`;button.onclick=()=>void change({field:'wifiNetwork',networkId:network.id});body.append(button);}info('New networks','Provision a Wi-Fi profile through development ADB; saved networks can be selected here.');}
  else if(page==='bluetooth'){toggle('Bluetooth enabled','bluetooth',state.bluetoothAvailable===false?undefined:state.bluetoothEnabled);info('Paired devices',(state.pairedDevices||[]).join(', ')||'None');info('Pairing','New device pairing is not available in this development image.');}
  else if(page==='display'){slider('Brightness','brightness',state.brightness);info('Theme','Use Light or Dark in Alpha Settings → Display. Your selection is saved on this phone.');}
  else if(page==='sound')for(const key of ['media','ring','alarm'])slider(key[0].toUpperCase()+key.slice(1),key,state[key+'Volume']);
  else if(page==='battery'){info('Battery',state.batteryPercent===undefined?'Unavailable':`${state.batteryPercent}%`);info('Charging',state.charging?'Yes':'No');info('Battery saver',state.powerSave?'On':'Off');}
  else if(page==='mobile'){info('Mobile connection',state.cellularActive?'Connected':'Not connected');info('Network',state.cellularType);info('Signal',state.cellularSignal===undefined?'Unavailable':`${state.cellularSignal}/4`);info('SIM and APN','Hardware-specific provisioning is not supported by this Cuttlefish control panel.');}
  else if(page==='developer'){info('Developer options',state.developerEnabled?'On':'Off');info('ADB',state.adbEnabled?'Enabled':'Disabled');info('Launcher lock','Managed · recovery through ADB');info('Build',state.build);info('Time zone',state.timeZone);const label=document.createElement('label');label.textContent='Time zone ';const input=document.createElement('input');input.value=state.timeZone;input.setAttribute('aria-label','Time zone');label.append(input);const apply=document.createElement('button');apply.textContent='Set time zone';apply.onclick=()=>void change({field:'timeZone',value:input.value});body.append(label,apply);}
  else if(page==='privacy'||page==='notifications'){for(const [name,value]of Object.entries(state.permissions||{}))info(name,value?'Allowed':'Not allowed');info('Permissions','Requests appear when a feature is used. ADB can repair grants without opening Android Settings.');}
  else {info('Phone',state.model);info('Android',state.androidRelease);info('Security patch',state.securityPatch);info('Build',state.build);info('Time zone',state.timeZone);}
 }
 try{await refresh();}catch{status.textContent='Device controls are unavailable.';}
}
