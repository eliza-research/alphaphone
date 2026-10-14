import {test,expect,type Page} from '@playwright/test';
import {createServer,type ViteDevServer} from 'vite';
import {resolve} from 'node:path';
import {webcrypto} from 'node:crypto';

// Actual normal Android chooser/controller composition; only native ports are synthetic.
// No device, account, provider, billing purchase, microphone or playback is used. Entitlements
// are signed here with a throwaway ES256 key; plan names and allowance numbers are synthetic test
// data, not product prices or quotas.
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
async function entitlement(status:string,overrides:Record<string,unknown>={}){
 const {jwk,sign}=await signer();const now=Math.floor(Date.now()/1000);
 const claims={iss:'https://api.eliza.app',aud:'eliza-alpha-phone',sub:USER,jti:'synthetic-entitlement',iat:now,exp:now+600,
  plan:{id:'synthetic-plan',name:'Synthetic plan',status},allowance:{unit:'requests',period:'month',limit:40,used:3},services:['inference','maps'],...overrides};
 return {keys:[jwk],token:await sign(claims)};
}

type Mode='legacy-zero'|'legacy-positive'|'signed'|'503'|'offline'|'malformed'|'401';
async function boot(page:Page,initial:{mode?:Mode;holdIdentity?:boolean;saved?:boolean;token?:string;keys?:unknown[]}={}){
 page.on('pageerror',(error:Error)=>console.error('Composition page error:',error.message));
 await page.route('https://**',route=>route.abort());
 await page.addInitScript(initial=>{
  const w=window as any;const f=w.planFixture={mode:'legacy-zero',saved:true,holdIdentity:false,hold:false,...initial,calls:[]as any[],releasePlan:null as null|(()=>void),releaseProvider:null as null|(()=>void),releaseIdentity:null as null|(()=>void)};
  const credential={credentialId:'11111111-1111-4111-8111-111111111111',token:'synthetic-plan-token',expiresAt:Date.now()+600000};
  const names={AlphaConnection:['secureRead','secureWrite','secureRemove','request','cancel','openExternal'],Agent:['stop','getStatus','configureCloudProvider'],DailyApps:['addListener','removeListener'],AlphaNotifications:['status'],AlphaVoiceCloud:['checkPermissions']};
  w.Capacitor={PluginHeaders:Object.entries(names).map(([name,methods])=>({name,methods:methods.map(name=>({name,rtype:'promise'}))})),nativePromise:async(plugin:string,method:string,input:any)=>{
   f.calls.push({plugin,method,path:input?.url?new URL(input.url).pathname:undefined,url:input?.url});
   if(plugin==='Agent'){
    if(method==='getStatus')return {packaged:true,state:'stopped',serviceActive:false,socketListening:false};
    if(method==='configureCloudProvider'){await new Promise<void>(resolve=>f.releaseProvider=resolve);return {};}
    return {};
   }
   if(plugin==='AlphaNotifications')return {permissionGranted:false,appEnabled:false};
   if(plugin==='AlphaVoiceCloud')return {microphone:'prompt'};
   if(plugin==='DailyApps')return {remove:async()=>{}};
   if(plugin!=='AlphaConnection')throw Error('Unexpected native plan fixture port');
   if(method==='secureRead')return {value:f.saved&&input.slot==='cloud:production'?JSON.stringify(credential):null};
   if(method!=='request')return {};
   const path=new URL(input.url).pathname;
   if(path==='/api/v1/user'){if(f.holdIdentity)await new Promise<void>(resolve=>f.releaseIdentity=resolve);return f.mode==='401'?{status:401,data:{}}:{status:200,data:{success:true,data:{id:'22222222-2222-4222-8222-222222222222',email:'synthetic-plan@example.invalid'}}};}
   if(path==='/api/v1/subscription/entitlement-keys')return {status:200,data:{keys:f.keys??[]}};
   if(path==='/api/v1/subscription/entitlement'){
    if(f.mode==='signed')return {status:200,data:{entitlement:f.token}};
    if(f.mode==='401')return {status:401,data:{}};
    return {status:404,data:{}};
   }
   if(path!=='/api/v1/credits/balance')throw Error('Unexpected Cloud route '+path);
   if(f.mode==='legacy-zero')return {status:200,data:{balance:0}};
   if(f.mode==='legacy-positive')return {status:200,data:{balance:4}};
   await new Promise<void>(resolve=>f.releasePlan=resolve);
   if(f.mode==='offline')throw Error('Synthetic offline plan request');
   return f.mode==='503'?{status:503,data:{}}:{status:200,data:{balance:'invalid'}};
  }};
 },initial);
 await page.goto(origin+'/subscription-composition');
 await expect.poll(()=>page.evaluate(()=>(window as any).planFlags)).toEqual({native:'android',mocks:false});
}
const calls=(page:Page)=>page.evaluate(()=>(window as any).planFixture.calls as Array<{plugin:string;method:string;path?:string;url?:string}>);
// Deployed Cloud (no entitlement route) with an unusable account: neutral account copy, not a plan.
async function noPlan(page:Page){
 await boot(page);
 await expect.poll(()=>page.evaluate(()=>typeof(window as any).planFixture.releaseProvider)).toBe('function');
 await page.evaluate(()=>{const w=window as any;w.planController.cancel();w.planFixture.releaseProvider();});
 await expect.poll(()=>page.evaluate(()=>(window as any).planController.getSnapshot().busy)).toBe(false);
 await expect(page.getByRole('dialog',{name:'Your Cloud account',exact:true})).toBeVisible();
 await expect(page.getByText('AI is unavailable for this Eliza Cloud account',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Open Eliza Cloud billing',exact:true})).toBeVisible();
}

test('the account panel never shows a credit balance or a top-up',async({page})=>{
 await noPlan(page);
 await expect(page.getByText(/credit/i)).toHaveCount(0);
 await expect(page.getByRole('button',{name:/top.?up|add credits|buy/i})).toHaveCount(0);
 await expect(page.getByText(/Nothing is purchased automatically/)).toBeVisible();
 await expect(page.getByText(/Local apps and on-device speech keep working/)).toBeVisible();
});

for(const failure of ['503','offline','malformed'] as const)test(`no plan then a ${failure} billing check is an outage, never a stale gate`,async({page})=>{
 await noPlan(page);await page.evaluate(mode=>(window as any).planFixture.mode=mode,failure);
 await page.getByRole('button',{name:'Check plan again',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>typeof(window as any).planFixture.releasePlan)).toBe('function');
 await expect(page.getByText('Checking your plan…',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Open Eliza Cloud billing',exact:true})).toHaveCount(0);
 await page.evaluate(()=>(window as any).planFixture.releasePlan());
 // An outage admits the resident agent: Cloud still decides each AI request on its side.
 await expect.poll(()=>page.evaluate(()=>typeof(window as any).planFixture.releaseProvider)).toBe('function');
 await expect(page.getByText('Plan status unavailable',{exact:true})).toBeVisible();
 await expect(page.getByText('AI is unavailable for this Eliza Cloud account',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Open Eliza Cloud billing',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).planController.getSnapshot().residentSubscription)).toEqual({kind:'unavailable',reason:'outage'});
 expect((await calls(page)).some(c=>c.method==='openExternal'||c.path?.includes('/personal')||c.path?.includes('/agents'))).toBe(false);
 await page.evaluate(()=>{const w=window as any;w.planController.cancel();w.planFixture.releaseProvider();});
 await expect.poll(()=>page.evaluate(()=>(window as any).planController.getSnapshot().busy)).toBe(false);
});

test('a signed active entitlement shows the plan and its Cloud allowance and admits the agent',async({page},info)=>{
 const signed=await entitlement('active');
 await page.setViewportSize({width:320,height:640});await boot(page,{mode:'signed',...signed,holdIdentity:true});
 const dialog=page.getByRole('dialog',{name:'Opening Alpha',exact:true});await expect(dialog).toBeVisible();await expect(dialog).toHaveAttribute('aria-busy','true');
 await page.evaluate(()=>(window as any).planFixture.releaseIdentity());
 await expect.poll(()=>page.evaluate(()=>typeof(window as any).planFixture.releaseProvider)).toBe('function');
 await expect(page.getByText('Synthetic plan',{exact:true})).toBeVisible();
 await expect(page.getByText(/3 of 40 requests used this month/)).toBeVisible();
 await expect(page.getByRole('button',{name:'Manage plan in Eliza Cloud',exact:true})).toHaveCount(0);
 await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('signed-plan-resume.png'),animations:'disabled'});
 const routes=(await calls(page)).filter(c=>c.method==='request').map(c=>c.path);
 // One entitlement and one key read at admission; nothing about credits.
 expect(routes.filter(p=>p==='/api/v1/subscription/entitlement')).toHaveLength(1);
 expect(routes.filter(p=>p==='/api/v1/subscription/entitlement-keys')).toHaveLength(1);
 expect(routes).not.toContain('/api/v1/credits/balance');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.evaluate(()=>(window as any).planFixture.releaseProvider());await expect.poll(()=>page.evaluate(()=>(window as any).planController.getSnapshot().busy)).toBe(false);
});

test('a signed canceled entitlement preserves resident admission and only opens hosted plan management',async({page})=>{
 const signed=await entitlement('canceled');
 await boot(page,{mode:'signed',...signed});
 await expect.poll(()=>page.evaluate(()=>typeof(window as any).planFixture.releaseProvider)).toBe('function');
 // This stopped-runtime fixture uses the normal stop/configure/start binding path.
 expect((await calls(page)).filter(c=>c.method==='configureCloudProvider')).toHaveLength(1);
 await page.evaluate(()=>{const w=window as any;w.planController.cancel();w.planFixture.releaseProvider();});
 await expect.poll(()=>page.evaluate(()=>(window as any).planController.getSnapshot().busy)).toBe(false);
 await expect(page.getByText('Synthetic plan has ended',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Use local apps without AI',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Manage plan in Eliza Cloud',exact:true}).click();
 await expect.poll(async()=>(await calls(page)).filter(c=>c.method==='openExternal').map(c=>c.url)).toEqual(['https://cloud.eliza.app/cloud/billing']);
 expect((await calls(page)).some(c=>c.method==='configureCloudProvider')).toBe(true);
});

test('a tampered entitlement is reported unavailable and never trusted as a plan',async({page})=>{
 const signed=await entitlement('canceled');const other=await entitlement('active');
 // Signed by a different key under the same key id: the signature fails.
 await boot(page,{mode:'signed',token:signed.token,keys:other.keys});
 await expect.poll(()=>page.evaluate(()=>typeof(window as any).planFixture.releaseProvider)).toBe('function');
 expect(await page.evaluate(()=>(window as any).planController.getSnapshot().residentSubscription)).toEqual({kind:'unavailable',reason:'invalid'});
 await expect(page.getByText('Synthetic plan has ended',{exact:true})).toHaveCount(0);
 await page.evaluate(()=>{const w=window as any;w.planController.cancel();w.planFixture.releaseProvider();});
});

test('an entitlement for another account is refused and the agent is not admitted',async({page})=>{
 const signed=await entitlement('active',{sub:'33333333-3333-4333-8333-333333333333'});
 await boot(page,{mode:'signed',...signed});
 await expect(page.getByRole('alert')).toContainText('different account');
 expect((await calls(page)).some(c=>c.method==='configureCloudProvider')).toBe(false);
});

test('an expired saved sign-in exposes the real sign-in action without a plan or permission bypass',async({page},info)=>{
 await boot(page,{mode:'401'});await expect(page.getByRole('dialog',{name:'Sign in to Eliza Cloud',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Sign in with Eliza Cloud',exact:true})).toBeEnabled();await expect(page.getByRole('alert')).toContainText('no longer valid');
 await expect(page.getByRole('button',{name:'Retry saved connection',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Continue',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Open Eliza Cloud billing',exact:true})).toHaveCount(0);await expect(page.getByRole('dialog',{name:'Set up Alpha access'})).toHaveCount(0);
 expect((await calls(page)).some(c=>c.method==='configureCloudProvider'||c.method==='openExternal')).toBe(false);await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('expired-saved-sign-in.png'),animations:'disabled'});
});

test('a missing saved credential keeps the original first-run sign-in gate',async({page})=>{
 await boot(page,{saved:false});await expect(page.getByRole('dialog',{name:'Welcome to Alpha',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Sign in with Eliza Cloud',exact:true})).toBeEnabled();await expect(page.getByText('Your agent runs on this phone. Sign in to Eliza Cloud to use your plan for AI.',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Sign in with Eliza Cloud',exact:true})).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
 await expect(page.getByRole('button',{name:'Continue',exact:true})).toHaveCount(0);await expect(page.getByRole('dialog',{name:'Set up Alpha access'})).toHaveCount(0);expect((await calls(page)).some(c=>c.method==='request'||c.method==='configureCloudProvider'||c.method==='openExternal')).toBe(false);
});

test('401 after a prior plan check replaces stale account copy with sign-in',async({page})=>{
 await noPlan(page);await page.evaluate(()=>(window as any).planFixture.mode='401');await page.getByRole('button',{name:'Check plan again',exact:true}).click();await expect(page.getByRole('dialog',{name:'Sign in to Eliza Cloud',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Sign in with Eliza Cloud',exact:true})).toBeEnabled();await expect(page.getByText('AI is unavailable for this Eliza Cloud account',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Open Eliza Cloud billing',exact:true})).toHaveCount(0);expect((await calls(page)).filter(c=>c.method==='configureCloudProvider')).toHaveLength(1);
});

test('a legacy account without a plan preserves resident admission and a usable retry shows no balance',async({page})=>{
 await noPlan(page);
 expect((await calls(page)).some(c=>c.method==='configureCloudProvider')).toBe(true);
 // This stopped-runtime fixture uses the normal stop/configure/start binding path.
 expect((await calls(page)).filter(c=>c.method==='configureCloudProvider')).toHaveLength(1);
 await expect(page.getByText('AI is unavailable for this Eliza Cloud account',{exact:true})).toBeVisible();
 await page.evaluate(()=>(window as any).planFixture.mode='legacy-positive');
 await page.getByRole('button',{name:'Check plan again',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>typeof(window as any).planFixture.releaseProvider)).toBe('function');
 await expect(page.getByText('Plan status unavailable',{exact:true})).toBeVisible();
 await expect(page.getByText(/has not published plan status/)).toBeVisible();
 expect(await page.evaluate(()=>(window as any).planController.getSnapshot().residentSubscription)).toEqual({kind:'unavailable',reason:'not-published'});

 await expect(page.getByRole('button',{name:'Open Eliza Cloud billing',exact:true})).toHaveCount(0);
 await expect(page.getByRole('dialog',{name:'Set up Alpha access'})).toHaveCount(0);
 await page.evaluate(()=>{const w=window as any;w.planController.cancel();w.planFixture.releaseProvider();});
 await expect.poll(()=>page.evaluate(()=>(window as any).planController.getSnapshot().busy)).toBe(false);
});
