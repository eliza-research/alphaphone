import {writeFileSync} from 'node:fs';
import {test,expect,type Page} from '@playwright/test';
// Production lane only: the flag-off bundle that the APKs package, with only the Android IPC
// boundary replaced. These prove what the shipped renderer reads, shows and sends. They do not
// prove what a phone's Android Settings does; device qualification of each handoff is separate.
test.describe.configure({timeout:240_000});
test.beforeEach(async({},testInfo)=>{test.skip(testInfo.project.name!=='production','Production lane only (flag-off build)');});

type Fixture={snapshot?:Record<string,unknown>;drop?:string[]};
async function nativeStub(page:Page,fixture:Fixture={}){
 await page.addInitScript(({snapshot,drop})=>{
  const w=window as any;w.androidBridge={};
  try{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));}catch{/* covered elsewhere */}
  const now=Date.now(),store=new Map<string,string>();
  const listeners:Array<{plugin:string;event:string;callback:(value:unknown)=>void}>=[];
  const state={
   // Android's answers. Tests change these, then resume, to prove the renderer reads them again.
   snapshot:{readAt:now,model:'Stub phone',manufacturer:'Stub maker',appVersion:'0.1.0',appVersionCode:7,appUpdatedAt:Date.UTC(2026,8,1),androidRelease:'16',build:'stub-build',securityPatch:'2026-09-05',
    permissions:{Microphone:true,Location:false,Camera:false,Calendar:true},locationAccess:'denied',batteryPercent:64,charging:false,powerSave:false,
    wifiActive:true,cellularActive:false,wifiEnabled:true,bluetoothEnabled:false,airplaneMode:false,locationEnabled:true,mobileDataEnabled:true,interruptionFilter:'all',adaptiveBrightness:true,textScalePercent:100,...snapshot} as Record<string,unknown>,
   status:{permissionGranted:true,appEnabled:true,interruption:'all',scope:'alpha-phone',channels:[{id:'c-reminders',name:'Reminders',importance:4,blocked:false,groupBlocked:false},{id:'c-results',name:'Scheduled digest results',importance:3,blocked:false,groupBlocked:false}]} as Record<string,any>,
   cross:{revision:'r1',enabled:false,paused:false,accessGranted:false,connected:false,history:true,apps:[]} as Record<string,unknown>,
   history:[{appLabel:'Stub Mail',state:'posted',at:now-60_000}] as unknown[],
   items:[] as unknown[],openFails:false,unspecific:[] as string[],unavailable:[] as string[],torch:true,shadeOutcome:'opened' as string,
  };
  for(const key of drop)delete state.snapshot[key];
  w.truth={calls:[] as any[],shared:[] as string[],state,resume:()=>listeners.filter(l=>l.plugin==='DailyApps'&&l.event==='appResumed').forEach(l=>l.callback({}))};
  const methods=(names:string[])=>names.map(name=>({name,rtype:'promise'}));
  w.Capacitor={
   PluginHeaders:[
        { name: 'AlphaDeletions', methods: methods(['pending']) },
    {name:'AlphaNotifications',methods:methods(['status','crossAppStatus','notificationHistory','list','open','dismiss','clear','openChannelSettings','openAppSettings','addListener','removeListener'])},
    {name:'AlphaVoiceCloud',methods:methods(['checkPermissions'])},
    {name:'Agent',methods:methods(['getStatus','start','stop','providerStatus'])},
    {name:'AlphaConnection',methods:methods(['secureRead','secureWrite','secureCompareExchange','secureRemove','addListener','removeListener'])},
    {name:'DeviceApps',methods:methods(['buildInfo'])},
    {name:'ElizaSystem',methods:methods(['getStatus','requestRole','getDeviceSettings','setFlashlight'])},
    {name:'AlphaDevice',methods:methods(['snapshot','crashLog','clearCrashLog','recordRendererFailure','diagnosticsFacts','shareDiagnostics','openSettings','openNotificationShade'])},
    {name:'DailyApps',methods:[{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'callback'}]},
   ],
   nativeCallback:(plugin:string,method:string,options:any,callback:(value:unknown)=>void)=>{if(method==='addListener'){listeners.push({plugin,event:options?.eventName,callback});return String(listeners.length);}return '0';},
   nativePromise:async(plugin:string,method:string,input:any)=>{
        if (plugin === 'AlphaDeletions' && method === 'pending') return { deletions: [] };
    w.truth.calls.push({plugin,method,input});
    if(plugin==='AlphaNotifications'){
     if(method==='status')return JSON.parse(JSON.stringify(state.status));
     if(method==='crossAppStatus')return state.cross;
     if(method==='notificationHistory')return {items:state.history};
     if(method==='list')return {items:state.items,scope:'alpha-phone'};
     if(method==='open'){if(state.openFails)throw Error('This notification is no longer available to open');return {};}
     if(method==='openChannelSettings'||method==='openAppSettings')return {status:'opened'};
     return {};
    }
    if(plugin==='AlphaVoiceCloud')return {microphone:'granted'};
    if(plugin==='Agent')return method==='providerStatus'?{configured:false}:{packaged:true,state:'stopped',serviceActive:false,socketListening:false};
    if(plugin==='AlphaConnection'){
     if(method==='secureRead')return {value:store.get(input.slot)??null};
     if(method==='secureCompareExchange'){if((store.get(input.slot)??null)!==input.expectedValue)return {status:'conflict'};if(input.value===null)store.delete(input.slot);else store.set(input.slot,input.value);return {status:'saved'};}
     if(method==='secureWrite'){store.set(input.slot,input.value);return {};}
     return {};
    }
    if(plugin==='DeviceApps')return {launcher:true,version:'0.1.0'};
    if(plugin==='ElizaSystem'){
     if(method==='getStatus')return {packageName:'ai.elizaresearch.alphaphone',roles:['home','assistant'].map(role=>({role,androidRole:'android.app.role.'+role.toUpperCase(),available:true,held:false,holders:[]}))};
     if(method==='getDeviceSettings')return {volumes:[{stream:'music',current:6,max:15},{stream:'ring',current:7,max:7},{stream:'alarm',current:0,max:7}]};
     if(method==='setFlashlight'){if(!state.torch)return {available:false,enabled:false};return {available:true,enabled:input.enabled===true};}
     if(method==='requestRole')return {role:input.role,held:false,resultCode:0};
    }
    if(plugin==='AlphaDevice'){
     if(method==='snapshot')return {...state.snapshot};
     if(method==='crashLog')return {exitHistory:true,entries:[]};
     if(method==='diagnosticsFacts')return {appVersion:'0.1.0',versionCode:7,variant:'launcher',buildType:'release',testMocks:false,sdkInt:36,androidRelease:'16',securityPatch:'2026-09-05',runtimeHashes:{'agent/alpha-source.json':'c'.repeat(64)},apiKey:'csk-synthetic-provider-key'};
     if(method==='shareDiagnostics'){w.truth.shared.push(input.text);return {status:'opened'};}
     if(method==='clearCrashLog'||method==='recordRendererFailure')return {};
     // Android's answer to launcher Home asking for its shade (SystemShade.java); 'throw' stands for a lost bridge.
     if(method==='openNotificationShade'){if(state.shadeOutcome==='throw')throw Error('Bridge unavailable');return {status:state.shadeOutcome};}
     if(method==='openSettings'){if(state.unavailable.includes(input.page))throw Error('This Android settings page is unavailable');return {status:'opened',page:input.page,specific:!state.unspecific.includes(input.page)};}
    }
    throw Error('Unexpected native operation '+plugin+'.'+method);
   },
  };
 },{snapshot:fixture.snapshot??{},drop:fixture.drop??[]});
}
const app=(page:Page)=>page.locator('[data-alpha-layer="app"]');
const current=(page:Page)=>page.locator('[data-settings-page]:not([inert])').last();
const set=(page:Page,patch:Record<string,unknown>)=>page.evaluate(patch=>{const state=(window as any).truth.state;for(const [key,value] of Object.entries(patch))if(value&&typeof value==='object'&&!Array.isArray(value)&&state[key]&&typeof state[key]==='object'&&!Array.isArray(state[key]))Object.assign(state[key],value);else state[key]=value;},patch);
const resume=(page:Page)=>page.evaluate(()=>(window as any).truth.resume());
const opened=(page:Page)=>page.evaluate(()=>(window as any).truth.calls.filter((c:any)=>c.plugin==='AlphaDevice'&&c.method==='openSettings').map((c:any)=>c.input.page as string));
const callNames=(page:Page)=>page.evaluate(()=>[...new Set((window as any).truth.calls.map((c:any)=>c.plugin+'.'+c.method))] as string[]);
/** Production Android starts with the Welcome dialog. Choose the option that needs no account. */
async function start(page:Page){
 await page.goto('/');
 if(await page.evaluate(()=>!!(window as any).truth)){
  await page.getByRole('button',{name:'Use local apps without AI',exact:true}).click();
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
 }
 await page.getByRole('button',{name:'Settings',exact:true}).waitFor({state:'visible'});
}
async function openSettings(page:Page){
 await start(page);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-active-view','settings');
}
/** Android's shade is the one notification and quick-settings surface (#416, #417): no Alpha panel or tile exists. */
const alphaShade=(page:Page)=>page.locator('[data-alpha-layer="shade"]');
const shadeRequests=(page:Page)=>page.evaluate(()=>(window as any).truth.calls.filter((c:any)=>c.plugin==='AlphaDevice'&&c.method==='openNotificationShade').length as number);
/** A real pointer drag in the 412px phone canvas. */
async function drag(page:Page,from:{x:number;y:number},dy:number){
 const box=(await page.locator('[data-screen]').boundingBox())!,scale=box.width/412;
 await page.mouse.move(box.x+from.x*scale,box.y+from.y*scale);await page.mouse.down();
 await page.mouse.move(box.x+from.x*scale,box.y+(from.y+dy)*scale,{steps:10});await page.mouse.up();
}
/** Values that exist only in the reference fixtures or as prototype simulations. */
const fixtureValues=['you@gmail.example','you@alpha.example','Alpha Home','Studio 5G','Ritual Coffee','Neighbors_2.4','Pixel Buds Pro 2','Keyboard K3','Kitchen Speaker','Vision 2B','Core 7B','elizaOS 2.1','AC1.260915','Alpha Compute phone','Powered by elizaOS','Alpha Mobile','3.2 of 20 GB','2,418 items','About 1 day','Redaction on','Redaction receipt','Enclave lock','Memory wiped','Wipe memory','Up to date','Check for updates','Cloud fallback','Charge to 80%','Verbose logs','Agent summaries','Last sync','Export logs','Logs saved','Pair new device','Tap to pair','Hey Alpha','Speak replies','Proactive briefings','Roaming','This month','Device uptime','NPU'];
const noFixtures=(text:string,where:string)=>{for(const value of fixtureValues)expect(text,`${where} shows the fixture value "${value}"`).not.toContain(value);};

test('launcher Home asks Android for its own shade and draws no Alpha shade, tiles or brightness',async({page})=>{
 await nativeStub(page);
 await start(page);
 // The shipped renderer has no Alpha notification panel and no quick-settings tiles at all.
 await expect(alphaShade(page)).toHaveCount(0);
 for(const name of ['Wi-Fi','Bluetooth','Do not disturb','Agent can listen','Airplane mode','Flashlight','Display settings','Clear all'])
  await expect(page.getByRole('button',{name:new RegExp('^'+name+'(, |$)')}),name).toHaveCount(0);
 const button=page.getByRole('button',{name:'Open notifications',exact:true});
 await expect(button).toBeVisible();
 await expect(button).not.toHaveAttribute('aria-controls',/.*/);
 // Android accepted the request: no message, nothing else drawn.
 await button.click();
 await expect.poll(()=>shadeRequests(page)).toBe(1);
 await expect(alphaShade(page)).toHaveCount(0);
 await expect(page.getByText(/Swipe down from the top edge/)).toHaveCount(0);
 await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
 // A pull down on empty Home asks the same way.
 await drag(page,{x:206,y:420},240);
 await expect.poll(()=>shadeRequests(page)).toBe(2);
 // A pull with the composer focused (keyboard up) does not.
 await page.locator('textarea[data-alpha-composer]').focus();
 await drag(page,{x:206,y:420},240);
 await page.waitForTimeout(300);
 expect(await shadeRequests(page)).toBe(2);
 await page.locator('textarea[data-alpha-composer]').blur();
 // Every other outcome says how to reach Android's notifications and never claims they opened.
 const fallback:Record<string,string>={
  'permission-missing':'Android did not open its notifications from Alpha. Swipe down from the top edge of the screen instead.',
  'unsupported':'Android did not open its notifications from Alpha. Swipe down from the top edge of the screen instead.',
  'not-in-front':'Alpha is not in front. Swipe down from the top edge of the screen for Android notifications.',
  'throw':'Android did not open its notifications from Alpha. Swipe down from the top edge of the screen instead.',
 };
 for(const [outcome,text] of Object.entries(fallback)){
  await set(page,{shadeOutcome:outcome});
  const before=await shadeRequests(page);
  await button.click();
  await expect.poll(()=>shadeRequests(page)).toBe(before+1);
  await expect(page.getByText(text,{exact:true}).last()).toBeVisible();
  await expect(alphaShade(page)).toHaveCount(0);
 }
 // Nothing in the session asked Android to change a radio, sensor or sound switch.
 const names=await callNames(page);
 expect(names.filter(name=>/\.set|\.toggle|\.enable|\.disable/i.test(name))).toEqual([]);
});

test('switches Android does not report are shown as a handoff, never as off, and a broader page is named',async({page})=>{
 await nativeStub(page,{drop:['wifiEnabled','bluetoothEnabled','airplaneMode','locationEnabled','mobileDataEnabled','interruptionFilter','adaptiveBrightness','appVersionCode','appUpdatedAt'],snapshot:{wifiActive:false}});
 await openSettings(page);
 await expect(current(page).getByRole('button',{name:'Bluetooth',exact:true})).toContainText('Manage in Android');
 await expect(current(page).getByRole('button',{name:'Wi-Fi',exact:true})).toContainText('Not active');
 await current(page).getByRole('button',{name:'Mobile data',exact:true}).click();
 const mobile=await current(page).innerText();
 expect(mobile).toMatch(/Mobile data\s*Not reported by Android/);
 expect(mobile).toMatch(/Airplane mode\s*Not reported by Android/);
 // A Settings row that only reached the broader page says so too.
 await set(page,{unspecific:['airplane']});
 await current(page).getByRole('button',{name:'Airplane mode in Android',exact:true}).click();
 await expect(page.getByText('Opened Android network settings. This phone has no separate page for that switch.',{exact:true}).last()).toBeVisible();
 await page.getByRole('button',{name:'Back to Settings',exact:true}).click();
 await current(page).getByRole('button',{name:'About',exact:true}).click();
 const about=await current(page).innerText();
 expect(about).toMatch(/Alpha Phone\s*0\.1\.0\s/);
 expect(about).not.toContain('Installed or last updated');
 expect(about).toMatch(/Updates\s*Alpha does not check for updates/);
});

test('every Settings page shows native facts or an honest handoff, with no fixture value or simulated switch',async({page})=>{
 page.on('dialog',dialog=>void dialog.dismiss());
 await nativeStub(page);
 await openSettings(page);
 const top=await current(page).innerText();
 for(const [label,value] of [['Wi-Fi','On · connected'],['Bluetooth','Off'],['Mobile data','On'],['Battery','64%'],['Notifications','App notifications allowed'],['About','0.1.0']])
  await expect(current(page).getByRole('button',{name:label,exact:true})).toContainText(value);
 const labels=await current(page).getByRole('button').evaluateAll(list=>list.map(e=>e.getAttribute('aria-label')||e.textContent?.trim()||'').filter(Boolean));
 // Each Android row and the page it must ask AlphaDevice.openSettings for.
 const handoffs:Record<string,Array<[string,string]>>={
  'Accounts':[['Device accounts in Android','accounts']],'Wi-Fi':[['Manage Wi-Fi networks','wifi']],'Bluetooth':[['Pair or manage devices','bluetooth']],
  'Mobile data':[['Manage mobile networks','mobile'],['Airplane mode in Android','airplane']],'Display':[['Manage brightness in Android','display']],
  'Sound & vibration':[['Do Not Disturb in Android','dnd'],['Manage sound in Android','sound']],'Notifications':[['Manage Alpha notifications','notifications']],
  'Battery':[['Manage battery in Android','battery']],'Privacy & data':[['Location in Android','location'],['Manage Alpha permissions','privacy']],
  'Developer':[['Android developer settings','developer']],'About':[['Android device information','about']],
 };
 const shown:Record<string,RegExp[]>={
  'Wi-Fi':[/On · connected/],'Bluetooth':[/Bluetooth\s*Off/],'Mobile data':[/Mobile data\s*On/,/Airplane mode\s*Off/],'Display':[/Adaptive brightness on/],
  'Sound & vibration':[/Media\s*40%/,/Ring\s*100%/,/Alarm\s*0%/,/Do Not Disturb\s*No DND suppression reported/],
  'Notifications':[/Reminders\s*Channel allowed/,/Scheduled digest results\s*Channel allowed/],'Battery':[/64%/,/On battery/,/Battery saver\s*Off/],
  'Privacy & data':[/Device location\s*On/,/Microphone\s*Allowed for Alpha/,/Camera\s*Not allowed/],
  'About':[/Stub phone/,/Alpha Phone\s*0\.1\.0 \(7\)/,/Installed or last updated/,/Updates\s*Alpha does not check for updates/,/Android\s*16/,/Security patch\s*2026-09-05/,/Inference model\s*Not reported by agent/],
  'Developer':[/App version\s*0\.1\.0/,/Agent memory\s*Not connected/],'Models':[/Inference model\s*Not reported by agent/],
 };
 const report:string[]=[`Settings: ${top.replace(/\s+/g,' ')}`];
 noFixtures(top,'Settings');
 // Each reload starts a fresh native stub, so the calls are gathered page by page.
 const visited:string[]=[],asked:string[]=[],names:string[]=[];
 for(const label of labels){
  if(!(label in handoffs)&&!(label in shown)&&!['Connections','Calendar','Password manager'].includes(label))continue;
  await openSettings(page);
  await current(page).getByRole('button',{name:label,exact:true}).first().click();
  await expect(page.getByRole('button',{name:'Back to Settings',exact:true})).toBeVisible();
  const text=await current(page).innerText();visited.push(label);
  report.push(`${label}: ${text.replace(/\s+/g,' ')}`);
  noFixtures(text,label);
  for(const pattern of shown[label]||[])expect(text,`${label} shows ${pattern}`).toMatch(pattern);
  // A switch must be backed by something this app owns. Only the calendar and theme controls qualify.
  const switches=await current(page).locator('[role="switch"],[aria-pressed],[aria-checked],input[type="checkbox"],input[type="range"]').evaluateAll(list=>list.map(e=>e.getAttribute('aria-label')||e.textContent?.trim()||e.tagName));
  const owned=label==='Display'?['Theme: Light','Theme: Dark','Text size']:[];
  expect(switches.filter(name=>!owned.includes(name)),`${label} has a switch that nothing backs`).toEqual([]);
  for(const [row,target] of handoffs[label]||[]){
   const before=(await opened(page)).length;
   await current(page).getByRole('button',{name:row,exact:true}).click();
   await expect.poll(async()=>(await opened(page)).slice(before),`${label} > ${row}`).toEqual([target]);
  }
  asked.push(...await opened(page));names.push(...await callNames(page));
 }
 await test.info().attach('settings-rows',{body:report.join('\n\n'),contentType:'text/plain'});
 writeFileSync(test.info().outputPath('settings-rows.txt'),report.join('\n\n'));
 expect(visited).toEqual(expect.arrayContaining(Object.keys(handoffs)));
 // Every allowlisted Android page was asked for by name; the generic Settings action was never used.
 expect([...new Set(asked)].sort()).toEqual(['about','accounts','airplane','battery','bluetooth','developer','display','dnd','location','mobile','notifications','privacy','sound','wifi']);
 expect(names.filter(name=>/\.set(?!Flashlight)|\.perform$/i.test(name))).toEqual([]);

 // A page Android refuses to open says so; the row never reports success.
 await openSettings(page);
 await set(page,{unavailable:['battery']});
 await current(page).getByRole('button',{name:'Battery',exact:true}).click();
 await current(page).getByRole('button',{name:'Manage battery in Android',exact:true}).click();
 await expect(page.getByText('This Android settings page is unavailable.',{exact:true})).toBeVisible();
});

test('notification denial and re-enable are read back from Android, and local history stays available',async({page})=>{
 page.on('dialog',dialog=>void dialog.dismiss());
 await nativeStub(page);
 await openSettings(page);
 const row=current(page).getByRole('button',{name:'Notifications',exact:true});
 await expect(row).toContainText('App notifications allowed');
 // The owner blocks one channel in Android. Alpha shows it only after reading Android again.
 await page.evaluate(()=>{(window as any).truth.state.status.channels[0].blocked=true;(window as any).truth.state.status.channels[0].importance=0;});
 await expect(row).toContainText('App notifications allowed');
 await resume(page);
 await expect(row).toContainText('Some channels blocked');
 await row.click();
 await expect(current(page)).toContainText(/Reminders\s*Channel blocked/);
 await expect(current(page)).toContainText(/Scheduled digest results\s*Channel allowed/);
 await current(page).getByRole('button',{name:'Manage Reminders',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).truth.calls.filter((c:any)=>c.method==='openChannelSettings').map((c:any)=>c.input.id))).toEqual(['c-reminders']);
 // Opening Android's page changes nothing here until Android reports the change.
 await expect(current(page)).toContainText(/Reminders\s*Channel blocked/);
 // Retained history does not depend on the channel: it is still listed while delivery is blocked.
 await current(page).getByRole('button',{name:'View local metadata history',exact:true}).click();
 await expect(current(page)).toContainText(/Stub Mail\s*posted/);
 await page.evaluate(()=>{(window as any).truth.state.status.channels[0].blocked=false;(window as any).truth.state.status.channels[0].importance=4;});
 await resume(page);
 await expect(current(page)).toContainText(/Reminders\s*Channel allowed/);
 // The whole app is denied, then a silent channel and a blocked group.
 await set(page,{status:{appEnabled:false}});
 await resume(page);
 await expect(current(page)).toContainText(/Alpha notifications\s*App notifications off/);
 await expect(current(page)).toContainText(/Reminders\s*App notifications off/);
 await expect(current(page)).toContainText(/Stub Mail\s*posted/);
 await set(page,{status:{appEnabled:true,permissionGranted:false}});
 await resume(page);
 await expect(current(page)).toContainText(/Alpha notifications\s*App notifications off/);
 await set(page,{status:{permissionGranted:true,interruption:'none'}});
 await page.evaluate(()=>{const channels=(window as any).truth.state.status.channels;channels[0].importance=2;channels[1].groupBlocked=true;});
 await resume(page);
 await expect(current(page)).toContainText(/Reminders\s*Silent channel/);
 await expect(current(page)).toContainText(/Scheduled digest results\s*Channel group blocked/);
 await expect(current(page)).toContainText(/Do Not Disturb\s*Interruptions suppressed/);
 // Android cannot be read: the state is unavailable, never "allowed".
 await page.evaluate(()=>{const truth=(window as any).truth,original=(window as any).Capacitor.nativePromise;(window as any).Capacitor.nativePromise=async(plugin:string,method:string,input:unknown)=>{if(plugin==='AlphaNotifications'&&method==='status'){truth.calls.push({plugin,method,input});throw Error('Notification delivery settings could not be read');}return original(plugin,method,input);};});
 await resume(page);
 await expect(current(page)).toContainText(/Alpha notifications\s*Unavailable/);
 await expect(current(page)).not.toContainText('Channel allowed');
});

test('the flag-off build exports redacted diagnostics with the real version and no update claim',async({page})=>{
 await nativeStub(page);
 await openSettings(page);
 await current(page).getByRole('button',{name:'About',exact:true}).click();
 await current(page).getByRole('button',{name:'Export diagnostics',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).truth.shared.length)).toBe(1);
 const shared=await page.evaluate(()=>(window as any).truth.shared[0] as string);
 const report=JSON.parse(shared);
 expect(report.format).toBe('alpha-diagnostics/v1');
 expect(report.app).toEqual({version:'0.1.0',versionCode:7,variant:'launcher',buildType:'release',testMocks:false});
 expect(report.permissions).toEqual({Microphone:true,Location:false,Camera:false,Calendar:true,Notifications:true});
 expect(Object.keys(report).sort()).toEqual(['app','connection','crashes','format','generatedAt','os','permissions','platform','roles','runtimeHashes','upstreamPin']);
 for(const leak of ['csk-synthetic','Stub phone','Stub maker','stub-build','Stub Mail','update','Update'])expect(shared).not.toContain(leak);
});

test('the browser build of Settings shows no fixture value and no radio or sensor switch',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await openSettings(page);
 const labels=await current(page).getByRole('button').evaluateAll(list=>list.map(e=>e.getAttribute('aria-label')||e.textContent?.trim()||'').filter(Boolean));
 const report:string[]=[`Settings: ${(await current(page).innerText()).replace(/\s+/g,' ')}`];
 noFixtures(report[0],'Settings');
 for(const label of labels.filter(name=>['Accounts','Connections','Privacy & data','Display','Notifications','Models','Developer','About','Calendar'].includes(name))){
  await openSettings(page);
  await current(page).getByRole('button',{name:label,exact:true}).first().click();
  await expect(page.getByRole('button',{name:'Back to Settings',exact:true})).toBeVisible();
  const text=await current(page).innerText();
  report.push(`${label}: ${text.replace(/\s+/g,' ')}`);
  noFixtures(text,label);
  expect(text).not.toMatch(/Wi-Fi\s*(On|Off)\b|Bluetooth\s*(On|Off)\b|Airplane mode\s*(On|Off)\b/);
 }
 await test.info().attach('browser-settings-rows',{body:report.join('\n\n'),contentType:'text/plain'});
 const about=report.find(row=>row.startsWith('About: '))||'';
 expect(about).toMatch(/Updates Alpha does not check for updates/);
 expect(about).not.toContain('Installed or last updated');
 // The browser build is the standalone app: no Alpha shade, no tiles and no notifications button (#416, #417).
 await page.goto('/');
 await page.getByRole('button',{name:'Settings',exact:true}).waitFor({state:'visible'});
 await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
 await expect(alphaShade(page)).toHaveCount(0);
 await expect(page.locator('[data-alpha-shade-handle]')).toHaveCount(0);
 await drag(page,{x:206,y:420},240);
 await expect(alphaShade(page)).toHaveCount(0);
 expect(await page.locator('[aria-pressed]').evaluateAll(list=>list.map(e=>e.getAttribute('aria-label')))).toEqual([]);
});
