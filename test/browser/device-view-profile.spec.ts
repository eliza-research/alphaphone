import {test,expect} from '@playwright/test';

// Real chooser and IPC serializer; authenticated host responses are controlled.
// The upstream HTTP/PGlite suite separately proves persistence and server enforcement.
for(const scenario of ['supported','legacy','unsupported','malformed','lost','retained'] as const){
 test(`enabled views via native resident enrollment: ${scenario}`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(scenario=>{
   const w=window as any;w.androidBridge={};localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
   const store=new Map();const f=w.viewProfileFixture={reads:0,writes:[] as any[],headers:[] as any[],profile:null as any};
   const methods=(names:string[])=>names.map(name=>({name,rtype:'promise'}));
   const supported=['home','notes','reminders','browser','settings','wallet'];
   if(scenario==='retained')f.profile={version:1,revision:'11111111-1111-4111-8111-111111111111',views:['browser','home','notes','reminders','settings']};
   w.Capacitor={PluginHeaders:[
    {name:'AlphaNotifications',methods:methods(['status','crossAppStatus','addListener','removeListener'])},
    {name:'AlphaVoiceCloud',methods:methods(['checkPermissions'])},
    {name:'Agent',methods:methods(['getStatus','start','request','subscribeViewEvents','unsubscribeViewEvents','addListener','removeListener'])},
    {name:'AlphaConnection',methods:methods(['secureRead','secureWrite','secureCompareExchange','secureRemove','cancel','addListener','removeListener','pauseNotificationCollection'])},
    {name:'AlphaActionJournal',methods:methods(['list'])},
    {name:'DeviceApps',methods:methods(['buildInfo'])},
    {name:'AlphaHostedResults',methods:methods(['configureBackground','disableBackground','cancelBackground','inboxHistory','status','pendingResult','addListener','removeListener'])},
   ],nativePromise:async(plugin:string,method:string,input:any)=>{
    if(plugin==='AlphaNotifications')return {permissionGranted:true,appEnabled:true};
    if(plugin==='AlphaVoiceCloud')return {microphone:'granted'};
    if(plugin==='Agent'){
     if(method==='getStatus')return {packaged:true,state:'ready'};
     if(method==='start')return {state:'ready'};
     // Every Capacitor plugin has listeners; the renderer command channel subscribes once per foreground session.
     if(method==='addListener'||method==='removeListener'||method==='unsubscribeViewEvents')return {};
     if(method==='subscribeViewEvents')return {subscriptionId:input.subscriptionId};
     const path=input.path;let body:any;
     if(path==='/api/auth/me')body={identity:{kind:'owner',id:'fixture-owner'},access:{role:'OWNER',mode:'session'}};
     else if(path==='/api/agents')body={agents:[{id:'fixture-agent',name:'Profile fixture',status:'running'}]};
     else if(path==='/api/client-devices/register')body={installationId:input.headers['X-Eliza-Device-Id'],enrollmentId:'fixture-enrollment',capabilities:[],...(scenario==='legacy'?{}:{viewProfileVersion:scenario==='unsupported'?2:1})};
     else if(path==='/api/client-devices/view-profile'){
      f.headers.push(input.headers);if(input.method==='GET'){f.reads++;body={version:1,supportedViews:scenario==='malformed'?['notes','notes']:supported,profile:f.profile};}
      else{const value=JSON.parse(input.body);f.writes.push(value);f.profile={version:1,revision:'22222222-2222-4222-8222-222222222222',views:value.views};if(scenario==='lost')throw Error('Synthetic committed response loss');body={version:1,profile:f.profile};}
     }
     else if(path==='/api/conversations')body={conversations:[]};
     else if(path==='/api/client-devices/proposals')body={proposals:[]};
     else return {status:404,body:'{}'};
     return {status:200,body:JSON.stringify(body)};
    }
    if(plugin==='AlphaConnection'){
     if(method==='secureRead')return {value:store.get(input.slot)??null};
     if(method==='secureCompareExchange'){if((store.get(input.slot)??null)!==input.expectedValue)return {status:'conflict'};if(input.value===null)store.delete(input.slot);else store.set(input.slot,input.value);return {status:'saved'};}
     if(method==='secureWrite'){store.set(input.slot,input.value);return {};}
     if(method==='secureRemove'){store.delete(input.slot);return {};}
     return {};
    }
    if(plugin==='DeviceApps')return {launcher:false,version:'fixture'};
    if(plugin==='AlphaActionJournal')return {entries:[]};
    return {};
   }};
  },scenario);
  await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:/Agent connection/}).click();await page.getByRole('button',{name:'Start local agent',exact:true}).click();await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);

  await page.getByRole('button',{name:/Agent connection/}).click();
  const snapshot=await page.evaluate(async()=>{const {connectionController}=await import('/src/runtime/connection-ui.tsx');return connectionController.getSnapshot();});
  expect(snapshot.session?.ownerId).toBe('fixture-owner');
  const f=await page.evaluate(()=>(window as any).viewProfileFixture);
  if(scenario==='supported'){
   expect(snapshot.phoneActionsAvailable).toBe(true);expect(snapshot.phoneCapabilityReason).toBe('');
   expect(f.writes).toEqual([{version:1,views:['browser','home','notes','reminders','settings'],expectedRevision:null}]);
  }else if(scenario==='retained'){expect(snapshot.phoneActionsAvailable).toBe(true);expect(f.writes).toEqual([]);expect(f.reads).toBe(1);}
  else if(scenario==='legacy'){expect(snapshot.phoneActionsAvailable).toBe(true);expect(f.reads).toBe(0);expect(f.writes).toEqual([]);await expect(page.getByText('This agent does not negotiate enabled views. Phone actions still use local view checks.')).toBeVisible();}
  else {expect(snapshot.phoneActionsAvailable).toBe(false);await expect(page.getByText(/Local chat connected. Device actions are unavailable:/)).toBeVisible();expect(f.writes).toHaveLength(scenario==='lost'?1:0);}
  for(const headers of f.headers){expect(headers['X-Eliza-Device-Key']).toMatch(/^[a-f0-9]{64}$/);expect(headers['X-Eliza-Device-Id']).toMatch(/^[a-f0-9-]{36}$/);expect(Object.keys(headers).some(k=>/view-profile/i.test(k))).toBe(false);}
  if(scenario==='lost'){
   // Reconnect reads the committed profile; it must not repeat the unknown write.
   await page.getByRole('button',{name:'Disconnect agent',exact:true}).click();
   await page.getByRole('button',{name:'Start local agent',exact:true}).click();
   await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
   const restored=await page.evaluate(async()=>{const {connectionController}=await import('/src/runtime/connection-ui.tsx');return connectionController.getSnapshot();});
   expect(restored.phoneActionsAvailable).toBe(true);
   expect(await page.evaluate(()=>(window as any).viewProfileFixture.writes.length)).toBe(1);
  }
  expect(errors).toEqual([]);
 });
}
