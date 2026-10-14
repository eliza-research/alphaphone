import {test,expect,type Page} from '@playwright/test';
import {createServer,type ViteDevServer} from 'vite';
import {resolve} from 'node:path';
import {webcrypto} from 'node:crypto';

// Actual normal Android chooser/controller composition (flag-off build flags); only native ports are
// synthetic. No device, account, real code, provider, billing purchase, microphone or playback is
// used. Entitlements are signed here with a throwaway ES256 key; plan names, codes and allowance
// numbers are synthetic test data, not product prices, quotas or real grant codes.
let server:ViteDevServer,origin:string;
test.beforeAll(async()=>{
 const previous=process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;process.env.ELIZA_DEV_ALLOW_TEST_MOCKS='';
 try{server=await createServer({configFile:resolve('vite.config.ts'),configLoader:'native',cacheDir:resolve('test-results/native-cloud-subscription/vite-cache'),server:{host:'127.0.0.1',port:0},define:{'import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS':JSON.stringify('')},plugins:[{name:'native-subscription-composition',resolveId(id){if(id==='/subscription-entry.tsx')return '\0subscription-entry';},load(id){if(id==='\0subscription-entry')return `
 import React,{useSyncExternalStore} from 'react';
 import {createRoot} from 'react-dom/client';
 import '/src/prototype/prototype.css';
 import {Capacitor} from '@capacitor/core';
 Capacitor.getPlatform=()=> 'android';Capacitor.isNativePlatform=()=>true;
 const {ConnectionChooser,connectionController}=await import('/src/runtime/connection-ui.tsx');
 const {StartupPermissions}=await import('/src/startup-permissions.tsx');
 const flags=await import('/src/build-flags.ts');window.planFlags={native:Capacitor.getPlatform(),mocks:flags.testMocksEnabled};
 window.planController=connectionController;
 document.body.insertAdjacentHTML('afterbegin','<div class="os" style="position:fixed;inset:0;background:var(--bg)" aria-hidden="true"></div>');
 function Composition(){const state=useSyncExternalStore(connectionController.subscribe,connectionController.getSnapshot);return React.createElement(React.Fragment,null,React.createElement(ConnectionChooser),!state.open&&React.createElement(StartupPermissions));}
 createRoot(document.getElementById('root')).render(React.createElement(Composition));
 `;},configureServer(s){s.middlewares.use('/subscription-composition',async(_request,response)=>{response.setHeader('Content-Type','text/html');response.end(await s.transformIndexHtml('/subscription-composition','<div id="root"></div><script type="module" src="/subscription-entry.tsx"></script>'));});}}]});}finally{if(previous===undefined)delete process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;else process.env.ELIZA_DEV_ALLOW_TEST_MOCKS=previous;}
 await server.listen();origin=`http://127.0.0.1:${(server.httpServer!.address()as {port:number}).port}`;
});
test.afterAll(async()=>{await server?.close();});

const USER='22222222-2222-4222-8222-222222222222';
const CREDENTIAL='11111111-1111-4111-8111-111111111111';
// Synthetic, never a real grant code. 16 Crockford characters once normalized.
const CODE='synt-hetc-0de0-0001',NORMALIZED='SYNTHETC0DE00001';
const b64=(bytes:Uint8Array)=>Buffer.from(bytes).toString('base64url');
async function signer(){
 const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const jwk={...await webcrypto.subtle.exportKey('jwk',pair.publicKey),kid:'synthetic-key-1'};
 const sign=async(claims:Record<string,unknown>,kid='synthetic-key-1')=>{
  const input=`${b64(Buffer.from(JSON.stringify({alg:'ES256',typ:'eliza-entitlement+jwt',kid})))}.${b64(Buffer.from(JSON.stringify(claims)))}`;
  const signature=new Uint8Array(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,Buffer.from(input)));
  return `${input}.${b64(signature)}`;
 };
 return {jwk,sign};
}
/** Tokens for every plan status, signed with one throwaway key. */
async function entitlements(overrides:Record<string,unknown>={}){
 const {jwk,sign}=await signer();const now=Math.floor(Date.now()/1000);
 const claims=(status:string)=>({iss:'https://api.eliza.app',aud:'eliza-alpha-phone',sub:USER,jti:'synthetic-entitlement-'+status,iat:now,exp:now+600,
  plan:{id:'synthetic-plan',name:'Synthetic plan',status},allowance:{unit:'requests',period:'month',limit:40,used:3},services:['inference'],...overrides});
 const tokens:Record<string,string>={};for(const status of ['active','trialing','past_due','canceled','none'])tokens[status]=await sign(claims(status));
 return {keys:[jwk],tokens};
}

type Fixture={plan?:string;route?:'signed'|'absent'|'503'|'401'|'offline';limits?:'active'|'none'|'canceled'|'absent'|'503';identity?:'ok'|'offline'|'401';
 redeem?:'ok'|'invalid'|'rate'|'already'|'transport-once';redeemPlan?:string;saved?:boolean;expiresAt?:number;holdProvider?:boolean;storage?:Record<string,string>};
async function boot(page:Page,initial:Fixture&{tokens?:Record<string,string>;keys?:unknown[]}={}){
 page.on('pageerror',(error:Error)=>console.error('Composition page error:',error.message));
 await page.route('https://**',route=>route.abort());
 await page.addInitScript(initial=>{
  const w=window as any;
  if(!sessionStorage.getItem('plan-fixture-seeded')){sessionStorage.setItem('plan-fixture-seeded','1');for(const [key,value] of Object.entries(initial.storage||{}))localStorage.setItem(key,value as string);}
  const f=w.planFixture={plan:'active',route:'signed',limits:'absent',identity:'ok',redeem:'ok',redeemPlan:'active',saved:true,holdProvider:true,...initial,calls:[]as any[],bodies:[]as any[],releaseProvider:null as null|(()=>void)};
  const credential={credentialId:'11111111-1111-4111-8111-111111111111',token:'synthetic-plan-token',expiresAt:initial.expiresAt??Date.now()+60*24*3600*1000};
  const names={AlphaConnection:['secureRead','secureWrite','secureRemove','request','cancel','openExternal'],Agent:['stop','getStatus','configureCloudProvider'],DailyApps:['addListener','removeListener'],AlphaNotifications:['status'],AlphaVoiceCloud:['checkPermissions']};
  w.Capacitor={PluginHeaders:Object.entries(names).map(([name,methods])=>({name,methods:methods.map(name=>({name,rtype:'promise'}))})),nativePromise:async(plugin:string,method:string,input:any)=>{
   f.calls.push({plugin,method,path:input?.url?new URL(input.url).pathname:undefined,url:input?.url,httpMethod:input?.method});
   if(plugin==='Agent'){
    if(method==='getStatus')return {packaged:true,state:'stopped',serviceActive:false,socketListening:false};
    if(method==='configureCloudProvider'){if(f.holdProvider)await new Promise<void>(resolve=>f.releaseProvider=resolve);return {};}
    return {};
   }
   if(plugin==='AlphaNotifications')return {permissionGranted:false,appEnabled:false};
   if(plugin==='AlphaVoiceCloud')return {microphone:'prompt'};
   if(plugin==='DailyApps')return {remove:async()=>{}};
   if(plugin!=='AlphaConnection')throw Error('Unexpected native plan fixture port');
   if(method==='secureRead')return {value:f.saved&&input.slot==='cloud:production'?JSON.stringify(credential):null};
   if(method==='secureRemove'){if(input.slot==='cloud:production')f.saved=false;return {};}
   if(method!=='request')return {};
   const path=new URL(input.url).pathname;
   if(path==='/api/v1/user'){if(f.identity==='offline')throw Error('Connection request failed');return f.identity==='401'?{status:401,data:{}}:{status:200,data:{success:true,data:{id:'22222222-2222-4222-8222-222222222222',email:'synthetic-plan@example.invalid'}}};}
   if(path==='/api/v1/subscription/entitlement-keys')return {status:200,data:{keys:f.keys??[]}};
   if(path==='/api/v1/subscription/entitlement'){
    if(f.route==='signed')return {status:200,data:{entitlement:f.tokens[f.plan]}};
    if(f.route==='401')return {status:401,data:{}};
    if(f.route==='503')return {status:503,data:{success:false,code:'service_unavailable'}};
    if(f.route==='offline')throw Error('Connection request failed');
    return {status:404,data:{}};
   }
   if(path==='/api/v1/billing/limits'){
    if(f.limits==='absent')return {status:404,data:{}};
    if(f.limits==='503')return {status:503,data:{}};
    const subscription=f.limits==='none'?{status:'not_applicable',reason:'no_organization_subscription'}:{status:'available',value:{planKey:'plus_monthly',state:f.limits,currentPeriodEnd:'2099-01-01T00:00:00.000Z'}};
    return {status:200,data:{success:true,data:{schemaVersion:2,v2:{subscription}}}};
   }
   if(path==='/api/v1/subscription/redeem'){
    const body=JSON.parse(input.body);f.bodies.push(body);
    if(f.redeem==='transport-once'&&f.bodies.length===1)throw Error('Connection request failed');
    if(f.redeem==='invalid')return {status:400,data:{success:false,error:'This subscription code cannot be redeemed.',code:'invalid_subscription_code'}};
    if(f.redeem==='rate')return {status:429,data:{success:false,code:'rate_limit_exceeded',retryAfterSeconds:840}};
    if(f.redeem==='already')return {status:409,data:{success:false,code:'subscription_grant_already_redeemed'}};
    f.plan=f.redeemPlan;f.route='signed';
    return {status:200,data:{success:true,replayed:f.bodies.length>1,grant:{id:'synthetic-grant',planKey:'plus_monthly',startsAt:'2026-10-13T00:00:00.000Z',endsAt:'2027-04-14T00:00:00.000Z',revoked:false,paidPlanTakesPrecedence:false},entitlement:{plan:{id:'plus_monthly',name:'Plus',status:'active'},source:'grant',effectiveUntil:'2027-04-14T00:00:00.000Z'}}};
   }
   if(path==='/api/auth/cli-session')return {status:503,data:{}};
   throw Error('Unexpected Cloud route '+path);
  }};
 },initial);
 await page.goto(origin+'/subscription-composition');
 await expect.poll(()=>page.evaluate(()=>(window as any).planFlags)).toEqual({native:'android',mocks:false});
}
type Call={plugin:string;method:string;path?:string;url?:string;httpMethod?:string};
const calls=(page:Page)=>page.evaluate(()=>(window as any).planFixture.calls as Call[]);
const admitted=(page:Page)=>expect.poll(()=>page.evaluate(()=>typeof(window as any).planFixture.releaseProvider)).toBe('function');
const configured=async(page:Page)=>(await calls(page)).filter(c=>c.method==='configureCloudProvider').length;
const idle=(page:Page)=>expect.poll(()=>page.evaluate(()=>(window as any).planController.getSnapshot().busy)).toBe(false);
/** Ends the held admission (the fixture has no runnable agent) without leaving work behind. */
async function release(page:Page){await page.evaluate(()=>{const w=window as any;w.planController.cancel();w.planFixture.releaseProvider?.();});await idle(page);}
const fixture=(page:Page,patch:Record<string,unknown>)=>page.evaluate(patch=>Object.assign((window as any).planFixture,patch),patch);

test.describe('first run requires Eliza Cloud sign-in',()=>{
 test('a phone without a saved sign-in shows the sign-in gate and no local-only bypass',async({page},info)=>{
  await boot(page,{saved:false});
  const dialog=page.getByRole('dialog',{name:'Welcome to Alpha',exact:true});await expect(dialog).toBeVisible();
  await expect(page.getByRole('button',{name:'Sign in with Eliza Cloud',exact:true})).toBeEnabled();
  await expect(page.getByText('Your agent runs on this phone. Sign in to Eliza Cloud to continue; Alpha Phone needs an account with a plan.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Use local apps without AI',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:/Close/})).toHaveCount(0);
  // Back and Escape cannot dismiss the gate.
  await page.keyboard.press('Escape');await expect(dialog).toBeVisible();
  await page.evaluate(()=>{(window as any).planController.close();(window as any).planController.offline();});
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('alpha.connection.selection.v1')??'')).not.toContain('localApps');
  await expect(page.getByRole('dialog',{name:'Set up Alpha access'})).toHaveCount(0);
  expect((await calls(page)).some(c=>c.method==='request'||c.method==='configureCloudProvider'||c.method==='openExternal')).toBe(false);
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('first-run-sign-in-gate.png'),animations:'disabled'});
 });

 test('an earlier "local apps without AI" choice migrates to the gate on the next launch and keeps local data',async({page})=>{
  const seeded={'alpha.connection.selection.v1':JSON.stringify({kind:'offline',localApps:true}),'alpha.synthetic.local-data':'kept'};
  await boot(page,{saved:false,storage:seeded});
  await expect(page.getByRole('dialog',{name:'Welcome to Alpha',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Use local apps without AI',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.connection.selection.v1')!))).toEqual({kind:'none'});
  expect(await page.evaluate(()=>localStorage.getItem('alpha.synthetic.local-data'))).toBe('kept');
 });

 test('a migrated phone with a saved sign-in and an active plan starts the agent without the bypass',async({page})=>{
  const signed=await entitlements();
  await boot(page,{...signed,storage:{'alpha.connection.selection.v1':JSON.stringify({kind:'offline',localApps:true})}});
  await admitted(page);
  expect(await configured(page)).toBe(1);
  await expect(page.getByRole('button',{name:'Use local apps without AI',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>localStorage.getItem('alpha.connection.selection.v1'))).not.toContain('localApps');
  await release(page);
 });

 test('an expired saved sign-in exposes the real sign-in action without a plan or permission bypass',async({page},info)=>{
  await boot(page,{identity:'401'});await expect(page.getByRole('dialog',{name:'Sign in to Eliza Cloud',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Sign in with Eliza Cloud',exact:true})).toBeEnabled();await expect(page.getByRole('alert')).toContainText('no longer valid');
  await expect(page.getByRole('button',{name:'Retry saved connection',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Continue',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Choose a plan',exact:true})).toHaveCount(0);await expect(page.getByRole('dialog',{name:'Set up Alpha access'})).toHaveCount(0);
  expect((await calls(page)).some(c=>c.method==='configureCloudProvider'||c.method==='openExternal')).toBe(false);await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('expired-saved-sign-in.png'),animations:'disabled'});
 });
});

test.describe('plan gate',()=>{
 test('an active entitlement shows the plan and its Cloud allowance and admits the agent',async({page},info)=>{
  const signed=await entitlements();
  await page.setViewportSize({width:320,height:640});await boot(page,signed);
  await admitted(page);
  await expect(page.getByText('Synthetic plan',{exact:true})).toBeVisible();
  await expect(page.getByText(/3 of 40 requests used this month/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Manage plan in Eliza Cloud',exact:true})).toHaveCount(0);
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('signed-plan-resume.png'),animations:'disabled'});
  const routes=(await calls(page)).filter(c=>c.method==='request').map(c=>c.path);
  expect(routes.filter(p=>p==='/api/v1/subscription/entitlement')).toHaveLength(1);
  expect(routes.filter(p=>p==='/api/v1/subscription/entitlement-keys')).toHaveLength(1);
  expect(routes).not.toContain('/api/v1/credits/balance');
  expect(routes).not.toContain('/api/v1/billing/limits');
  await release(page);
 });

 test('a trialing plan is admitted',async({page})=>{
  await boot(page,{...await entitlements(),plan:'trialing'});
  await admitted(page);await expect(page.getByText('Synthetic plan · trial',{exact:true})).toBeVisible();await release(page);
 });

 test('a past-due plan is admitted with a clear warning and the hosted plan page',async({page},info)=>{
  await boot(page,{...await entitlements(),plan:'past_due'});
  await admitted(page);
  await expect(page.getByText('Synthetic plan · payment due',{exact:true})).toBeVisible();
  await expect(page.getByText(/Payment is past due\. Update payment in Eliza Cloud to keep AI available\./)).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('past-due-warning.png'),animations:'disabled'});
  await release(page);
  await page.getByRole('button',{name:'Manage plan in Eliza Cloud',exact:true}).click();
  await expect.poll(async()=>(await calls(page)).filter(c=>c.method==='openExternal').map(c=>c.url)).toEqual(['https://cloud.eliza.app/cloud/billing']);
 });

 for(const [status,heading,headline] of [['canceled','Your plan has ended','Synthetic plan has ended'],['none','Choose a plan','No active plan']] as const)test(`a ${status} plan shows "needs plan" and never starts the agent`,async({page},info)=>{
  await boot(page,{...await entitlements(),plan:status});
  await expect(page.getByRole('dialog',{name:heading,exact:true})).toBeVisible();
  await expect(page.getByText(headline,{exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Subscription code'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Redeem code',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Check plan again',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Use local apps without AI',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:/Close/})).toHaveCount(0);
  expect(await configured(page)).toBe(0);
  expect((await calls(page)).filter(c=>c.plugin==='Agent').map(c=>c.method)).not.toContain('start');
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath(`needs-plan-${status}.png`),animations:'disabled'});
  // Choose a plan opens exactly the allowlisted hosted page in the system browser.
  await page.getByRole('button',{name:'Choose a plan',exact:true}).click();
  await expect.poll(async()=>(await calls(page)).filter(c=>c.method==='openExternal').map(c=>c.url)).toEqual(['https://cloud.eliza.app/cloud/billing']);
  expect(await configured(page)).toBe(0);
 });

 test('returning from Eliza Cloud checks the plan again and admits a plan chosen there',async({page})=>{
  await boot(page,{...await entitlements(),plan:'none'});
  await expect(page.getByRole('dialog',{name:'Choose a plan',exact:true})).toBeVisible();await idle(page);
  await page.getByRole('button',{name:'Choose a plan',exact:true}).click();await idle(page);
  await fixture(page,{plan:'active'});
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await admitted(page);expect(await configured(page)).toBe(1);await release(page);
 });

 test('a plan that ends while admitted applies the gate on the next check',async({page})=>{
  await boot(page,{...await entitlements(),holdProvider:false});
  await expect.poll(()=>configured(page)).toBe(1);await idle(page);
  await fixture(page,{plan:'canceled'});
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('dialog',{name:'Your plan has ended',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).planController.getSnapshot().residentGate)).toBe('needs-plan');
 });

 test('an entitlement for another account is refused and the agent is not admitted',async({page})=>{
  await boot(page,await entitlements({sub:'33333333-3333-4333-8333-333333333333'}));
  await expect(page.getByRole('alert')).toContainText('different account');
  expect(await configured(page)).toBe(0);
 });

 test('a tampered entitlement is never trusted: needs plan with a retry, no agent',async({page})=>{
  const signed=await entitlements(),other=await entitlements();
  await boot(page,{tokens:signed.tokens,keys:other.keys});
  await expect(page.getByRole('dialog',{name:'Choose a plan',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).planController.getSnapshot().residentSubscription)).toEqual({kind:'unavailable',reason:'invalid'});
  await expect(page.getByText('Synthetic plan',{exact:true})).toHaveCount(0);
  expect(await configured(page)).toBe(0);
 });
});

test.describe('entitlement route unavailable: billing snapshot fallback, never credits',()=>{
 for(const limits of ['active','past_due'] as const)test(`a ${limits} billing snapshot admits the agent`,async({page})=>{
  await boot(page,{route:'absent',limits});
  await admitted(page);
  await expect(page.getByText(limits==='active'?'Plus':'Plus · payment due',{exact:true})).toBeVisible();
  const routes=(await calls(page)).filter(c=>c.method==='request').map(c=>c.path);
  expect(routes).toEqual(expect.arrayContaining(['/api/v1/subscription/entitlement','/api/v1/billing/limits']));
  expect(routes).not.toContain('/api/v1/credits/balance');
  await release(page);
 });
 for(const [limits,heading] of [['none','Choose a plan'],['canceled','Your plan has ended']] as const)test(`a billing snapshot with plan ${limits} needs a plan`,async({page})=>{
  await boot(page,{route:'absent',limits});
  await expect(page.getByRole('dialog',{name:heading,exact:true})).toBeVisible();expect(await configured(page)).toBe(0);
 });
 test('no plan source at all is unknown: needs plan with a retry, never admitted',async({page})=>{
  await boot(page,{route:'absent',limits:'absent'});
  await expect(page.getByRole('dialog',{name:'Choose a plan',exact:true})).toBeVisible();
  await expect(page.getByText('Plan status unavailable',{exact:true})).toBeVisible();
  await expect(page.getByText(/did not report a plan for this account/)).toBeVisible();
  expect(await configured(page)).toBe(0);
  // Check plan again reads Cloud again and admits once a plan is reported.
  await fixture(page,{limits:'active'});
  await page.getByRole('button',{name:'Check plan again',exact:true}).click();
  await admitted(page);await release(page);
 });
});

test.describe('outages and offline use',()=>{
 test('a billing outage without a recent plan is "needs plan" with a retry',async({page})=>{
  await boot(page,{route:'503'});
  await expect(page.getByRole('dialog',{name:'Choose a plan',exact:true})).toBeVisible();
  await expect(page.getByText(/could not confirm a plan for this account right now/)).toBeVisible();
  expect(await configured(page)).toBe(0);
 });
 test('a billing outage after a recent verified plan keeps the agent',async({page})=>{
  const signed=await entitlements();
  await boot(page,{...signed,holdProvider:false});
  await expect.poll(()=>configured(page)).toBe(1);await idle(page);
  const record=await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.connection.plan-admission.v1')!));
  expect(record).toMatchObject({version:1,environment:'production',credentialId:CREDENTIAL,userId:USER,status:'active',planName:'Synthetic plan'});
  await fixture(page,{route:'503',holdProvider:true});
  await page.evaluate(()=>{void (window as any).planController.startLocal();});
  await admitted(page);
  expect(await page.evaluate(()=>(window as any).planController.getSnapshot().residentSubscription)).toEqual({kind:'unavailable',reason:'outage'});
  await release(page);
 });
 test('offline with a recent plan keeps local apps available and starts nothing',async({page},info)=>{
  const recent=JSON.stringify({version:1,environment:'production',credentialId:CREDENTIAL,userId:USER,organizationId:null,status:'active',planName:'Synthetic plan',verifiedAt:Date.now()-3600_000,endsAt:null});
  await boot(page,{identity:'offline',storage:{'alpha.connection.plan-admission.v1':recent}});
  const dialog=page.getByRole('dialog',{name:'Offline',exact:true});await expect(dialog).toBeVisible();
  await expect(page.getByText(/Local apps and on-device speech keep working with your recent plan/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Try again',exact:true})).toBeVisible();
  expect(await configured(page)).toBe(0);
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('offline-recent-plan.png'),animations:'disabled'});
  await page.getByRole('button',{name:'Close connection settings'}).click();
  await expect(dialog).toHaveCount(0);
 });
 for(const age of ['stale','other-credential'] as const)test(`offline without a recent plan for this sign-in keeps the gate (${age})`,async({page})=>{
  const record=JSON.stringify({version:1,environment:'production',credentialId:age==='other-credential'?'99999999-9999-4999-8999-999999999999':CREDENTIAL,userId:USER,organizationId:null,status:'active',planName:'Synthetic plan',verifiedAt:Date.now()-(age==='stale'?8:0)*24*3600_000,endsAt:null});
  await boot(page,{identity:'offline',storage:{'alpha.connection.plan-admission.v1':record}});
  await expect(page.getByRole('alert')).toContainText('Connection request failed');
  await expect(page.getByRole('button',{name:'Close connection settings'})).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await configured(page)).toBe(0);
 });
});

test.describe('redeem a subscription code',()=>{
 test('success redeems once with a fresh key, refreshes the entitlement and admits the agent',async({page},info)=>{
  await boot(page,{...await entitlements(),plan:'none'});
  await expect(page.getByRole('dialog',{name:'Choose a plan',exact:true})).toBeVisible();await idle(page);
  await page.getByRole('textbox',{name:'Subscription code'}).fill(CODE);
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('redeem-code.png'),animations:'disabled'});
  await page.getByRole('button',{name:'Redeem code',exact:true}).click();
  await admitted(page);
  const bodies=await page.evaluate(()=>(window as any).planFixture.bodies);
  expect(bodies).toHaveLength(1);
  expect(bodies[0].code).toBe(NORMALIZED);
  expect(bodies[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  const redeem=(await calls(page)).filter(c=>c.path==='/api/v1/subscription/redeem');
  expect(redeem.map(c=>[c.httpMethod,c.url])).toEqual([['POST','https://api.eliza.app/api/v1/subscription/redeem']]);
  // The entitlement is read again after redemption.
  const reads=(await calls(page)).filter(c=>c.path==='/api/v1/subscription/entitlement');expect(reads.length).toBe(2);
  await expect(page.getByText(/^Code redeemed for Plus\. It runs until /)).toBeVisible();
  await expect(page.getByText(/Plan runs until/)).toBeVisible();
  // The code is not kept anywhere the renderer can read back.
  const stored=await page.evaluate(()=>JSON.stringify({...localStorage})+JSON.stringify({...sessionStorage})+document.body.innerText);
  expect(stored).not.toContain(NORMALIZED);expect(stored.toLowerCase()).not.toContain(CODE);
  await release(page);
 });

 test('an invalid code gets one generic answer, keeps the gate and is not retried',async({page})=>{
  await boot(page,{...await entitlements(),plan:'none',redeem:'invalid'});
  await expect(page.getByRole('dialog',{name:'Choose a plan',exact:true})).toBeVisible();await idle(page);
  await page.getByRole('textbox',{name:'Subscription code'}).fill(CODE);
  await page.getByRole('button',{name:'Redeem code',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('This code could not be redeemed. Check the code and try again.');
  expect(await page.evaluate(()=>(window as any).planFixture.bodies.length)).toBe(1);
  await expect(page.getByRole('textbox',{name:'Subscription code'})).toHaveValue('');
  expect(await configured(page)).toBe(0);
  // Text that cannot be a code is refused locally with the same answer; nothing is sent.
  await page.getByRole('textbox',{name:'Subscription code'}).fill('not-a-code');
  await page.getByRole('button',{name:'Redeem code',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('This code could not be redeemed. Check the code and try again.');
  expect(await page.evaluate(()=>(window as any).planFixture.bodies.length)).toBe(1);
 });

 test('a rate-limited redemption shows the Cloud retry time',async({page},info)=>{
  await boot(page,{...await entitlements(),plan:'none',redeem:'rate'});
  await expect(page.getByRole('dialog',{name:'Choose a plan',exact:true})).toBeVisible();await idle(page);
  await page.getByRole('textbox',{name:'Subscription code'}).fill(CODE);
  await page.getByRole('button',{name:'Redeem code',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('Too many attempts. Try again in about 14 minutes.');
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('redeem-rate-limited.png'),animations:'disabled'});
  expect(await configured(page)).toBe(0);
 });

 test('a lost response is replayed once with the same key; a new submission uses a new key',async({page})=>{
  await boot(page,{...await entitlements(),plan:'none',redeem:'transport-once'});
  await expect(page.getByRole('dialog',{name:'Choose a plan',exact:true})).toBeVisible();await idle(page);
  await page.getByRole('textbox',{name:'Subscription code'}).fill(CODE);
  await page.getByRole('button',{name:'Redeem code',exact:true}).click();
  await admitted(page);
  const bodies=await page.evaluate(()=>(window as any).planFixture.bodies);
  expect(bodies).toHaveLength(2);
  expect(bodies[1].idempotencyKey).toBe(bodies[0].idempotencyKey);
  await release(page);
  // A second owner submission (from the plan panel) is a new attempt with a new key.
  await page.evaluate(()=>(window as any).planController.openPlan());
  await page.getByRole('textbox',{name:'Subscription code'}).fill(CODE);
  await page.getByRole('button',{name:'Redeem code',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).planFixture.bodies.length)).toBe(3);
  const all=await page.evaluate(()=>(window as any).planFixture.bodies);
  expect(all[2].idempotencyKey).not.toBe(all[0].idempotencyKey);
  await release(page);
 });

 test('an account that already holds the grant is told so without a new grant',async({page})=>{
  await boot(page,{...await entitlements(),plan:'none',redeem:'already'});
  await expect(page.getByRole('dialog',{name:'Choose a plan',exact:true})).toBeVisible();await idle(page);
  await page.getByRole('textbox',{name:'Subscription code'}).fill(CODE);
  await page.getByRole('button',{name:'Redeem code',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('This account has already received this subscription. Check your plan again.');
 });
});

test.describe('account, plan and sign-in expiry',()=>{
 test('Settings data and the plan panel show account, plan, Redeem code, Manage plan and Sign out',async({page},info)=>{
  await boot(page,{...await entitlements(),holdProvider:false});
  await expect.poll(()=>configured(page)).toBe(1);await idle(page);
  const settings=await page.evaluate(()=>(window as any).planController.residentPlanSettings());
  expect(settings).toMatchObject({signedIn:true,account:'synthetic-plan@example.invalid',plan:'Synthetic plan',status:'active',keyExpiring:false});
  await page.evaluate(()=>(window as any).planController.openPlan());
  const dialog=page.getByRole('dialog',{name:'Eliza Cloud account & plan',exact:true});await expect(dialog).toBeVisible();
  await expect(dialog.getByText('synthetic-plan@example.invalid',{exact:true})).toBeVisible();
  for(const name of ['Redeem code','Manage plan in Eliza Cloud','Sign out'])await expect(dialog.getByRole('button',{name,exact:true})).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('plan-panel.png'),animations:'disabled'});
  await dialog.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Welcome to Alpha',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('alpha.connection.plan-admission.v1'))).toBeNull();
  expect(await page.evaluate(()=>(window as any).planController.residentPlanSettings())).toMatchObject({signedIn:false,plan:'Not signed in'});
 });

 test('a sign-in key that expires within 14 days is warned about and offers re-approval',async({page},info)=>{
  await boot(page,{...await entitlements(),expiresAt:Date.now()+5*24*3600_000});
  await admitted(page);
  await expect(page.getByText(/Your Eliza Cloud sign-in on this phone expires .*\. Approve this phone again to keep AI available\./)).toBeVisible();
  expect(await page.evaluate(()=>(window as any).planController.residentPlanSettings().keyExpiring)).toBe(true);
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('sign-in-expiry-warning.png'),animations:'disabled'});
  await release(page);
  await page.getByRole('button',{name:'Approve this phone again',exact:true}).click();
  // Re-approval is the real Cloud CLI sign-in (the fixture refuses it here).
  await expect.poll(async()=>(await calls(page)).some(c=>c.path==='/api/auth/cli-session'&&c.httpMethod==='POST')).toBe(true);
 });

 test('a key with more than 14 days left shows no expiry warning',async({page})=>{
  await boot(page,await entitlements());
  await admitted(page);
  await expect(page.getByRole('button',{name:'Approve this phone again',exact:true})).toHaveCount(0);
  await release(page);
 });
});
