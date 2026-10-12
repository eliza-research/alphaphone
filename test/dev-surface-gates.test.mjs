// Source-level checks of the ELIZA_DEV_ALLOW_TEST_MOCKS gates for developer and
// simulation surfaces. Modules are loaded through Vite's SSR transform so that
// import.meta.env carries the flag exactly as the renderer build does; production
// bundle contents are audited separately by scripts/audit-production-bundle.mjs.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';

const root=new URL('..',import.meta.url);
const servers={};
async function server(flag){
 // Vite exposes VITE_* from the process environment when the server starts.
 if(flag)process.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS='1';else delete process.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS;
 // Static SSR fixtures never reload; watching also scans large generated runtime trees.
 try{return await createServer({configFile:false,plugins:[{name:'model-without-dom-renderer',enforce:'pre',resolveId(id){if(id.endsWith('/dc-lite.js'))return '\0policy-test-renderer';},load(id){if(id==='\0policy-test-renderer')return 'export class DCLogic {}';}}],resolve:{alias:{"@elizaos/contracts/native-notes-query":fileURLToPath(new URL(".eliza/client-features/packages/contracts/src/native-notes-query.ts",root))}},root:root.pathname,logLevel:'silent',appType:'custom',server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true,include:[]}});}
 finally{delete process.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS;}
}
before(async()=>{servers.on=await server(true);servers.off=await server(false);});
after(async()=>{await Promise.all(Object.values(servers).map(s=>s.close()));});
const load=(flag,path)=>servers[flag?'on':'off'].ssrLoadModule('/apps/app/src/'+path);

test('remote agents accept plain-HTTP loopback development origins only with test mocks',async()=>{
 for(const flag of [true,false]){
  const {normalizeRemoteOrigin}=await load(flag,'runtime/remote-protocol.ts');
  for(const origin of ['http://127.0.0.1:31337','http://10.0.2.2:31337','http://localhost:31337']){
   if(flag)assert.equal(normalizeRemoteOrigin(origin,[origin]),origin);
   else assert.throws(()=>normalizeRemoteOrigin(origin,[origin]),error=>error.code==='https_required');
   // Undeclared development origins are always rejected.
   assert.throws(()=>normalizeRemoteOrigin(origin,[]),error=>error.code==='https_required');
  }
  assert.equal(normalizeRemoteOrigin('https://agent.example/'),'https://agent.example');
  // A caller cannot re-enable loopback HTTP in a flag-off build.
  if(!flag)assert.throws(()=>normalizeRemoteOrigin('http://127.0.0.1:31337',['http://127.0.0.1:31337'],true),error=>error.code==='https_required');
  assert.throws(()=>normalizeRemoteOrigin('http://agent.example/',['http://agent.example']),error=>error.code==='https_required');
 }
});

test('verified sessions accept plain-HTTP loopback origins only with test mocks',async()=>{
 for(const flag of [true,false]){
  const {AlphaClient,developmentSessionOrigin}=await load(flag,'runtime/alpha-client.ts');
  const origin='http://127.0.0.1:31337',session={ownerId:'owner',agentId:'agent',sessionId:'session',origin};
  assert.equal(developmentSessionOrigin(new URL(origin),origin),flag);
  assert.equal(developmentSessionOrigin(new URL(origin),undefined),false);
  assert.equal(developmentSessionOrigin(new URL(origin),origin,true),flag,'flag-off builds have no development hosts');
  const client=new AlphaClient(),transport={session,send:async()=>({text:''})};
  if(flag)client.attachVerifiedTransport(transport,{developmentOrigin:origin});
  else assert.throws(()=>client.attachVerifiedTransport(transport,{developmentOrigin:origin}),/Invalid verified session metadata/);
  new AlphaClient().attachVerifiedTransport({...transport,session:{...session,origin:'https://agent.example'}});
 }
});

test('Eliza Cloud staging exists only with test mocks',async()=>{
 for(const flag of [true,false]){
  const {CloudProtocol,cloudEnvironmentAvailable}=await load(flag,'runtime/cloud-protocol.ts');
  assert.equal(cloudEnvironmentAvailable('production'),true);
  assert.equal(cloudEnvironmentAvailable('staging'),flag);
  const requests=[],client=new CloudProtocol('staging',async input=>{requests.push(input.url);return {status:200,data:{sessionId:'s',status:'pending',expiresAt:new Date(Date.now()+1000).toISOString()}};},{read:async()=>null,write:async()=>{},clear:async()=>{}},async()=>{});
  const login=client.login(AbortSignal.timeout(50)).catch(error=>error);
  const result=await login;
  if(flag)assert.ok(requests.every(url=>url.startsWith('https://api-staging.eliza.app/')),'staging routes to the staging authority');
  else{assert.equal(requests.length,0,'no staging request leaves a flag-off build');assert.match(String(result?.message),/unavailable in this build/);}
 }
});

test('the development profile and deferred apps need test mocks',async()=>{
 globalThis.location??={search:'?mode=dev',href:'http://127.0.0.1/?mode=dev'};
 const off={features:await load(false,'prototype/mvp-features.ts'),dev:await load(false,'browser/dev-profile.ts')};
 assert.equal(off.dev.browserDevProfile,false,'?mode=dev is ignored without the flag');
 for(const view of ['phone','messages','contacts','wallet'])assert.equal(off.features.isMvpView(view),false,view+' stays deferred');
 const on={features:await load(true,'prototype/mvp-features.ts'),dev:await load(true,'browser/dev-profile.ts')};
 assert.equal(on.dev.browserDevProfile,true);for(const view of ['phone','wallet'])assert.equal(on.features.isMvpView(view),true);
});

test('the local agent host bridge is unavailable without test mocks',async()=>{
 const calls=[];const fetch=globalThis.fetch;globalThis.fetch=async url=>{calls.push(String(url));return new Response('{}');};
 try{
  const local=await load(false,'runtime/local-agent.ts'),storage=await load(false,'runtime/local-agent-storage.ts');
  assert.equal(local.browserLocalAgentEnabled,false);
  await assert.rejects(new local.LocalAgentProtocol().connect(new AbortController().signal),/unavailable here/);
  await assert.rejects(storage.developmentDeviceStore.read('slot'),/unavailable here/);
  assert.deepEqual(calls,[],'no request reaches /__alpha-local-agent');
 }finally{globalThis.fetch=fetch;}
});

// regional-provider composes the upstream provider at module load; evaluate it
// with explicit flag bindings and a synthetic transport.
async function regional({testMocks,devSurfaces,baseUrl,native=false,developmentBuild=true}){
 const {createRegionalMaps}=await servers.off.ssrLoadModule('/.eliza/client-features/plugins/plugin-maps/src/client/regional-provider.ts');
 const source=fs.readFileSync(new URL('apps/app/src/maps/regional-provider.ts',root),'utf8')
  .replace(/^import [\s\S]*?;\n/gm,'').replace(/^export type \{[^}]*\} from .*;\n/gm,'')
  .replaceAll('import.meta.env.VITE_MAPS_BASE_URL','__env.VITE_MAPS_BASE_URL')
  .replace(/^export (const|function|interface)/gm,'$1');
 const fetched=[],configured=[];
 const context={createRegionalMaps,testMocksEnabled:testMocks,devSurfacesEnabled:devSurfaces,__env:{VITE_MAPS_BASE_URL:baseUrl},
  Capacitor:{isNativePlatform:()=>native},DailyApps:{surfaceInfo:async()=>({developmentBuild})},
  registerPlugin:()=>({request:async()=>{throw Error('native transport not expected');},cancel:async()=>{}}),
  configureMapsProvider:config=>configured.push(config),
  fetch:async url=>{fetched.push(String(url));throw Error('offline');},URL,TextDecoder,Uint8Array,JSON,Error,Number,Array,Object,crypto,atob};
 vm.runInNewContext(stripTypeScriptTypes(source,{mode:'transform'})+'\nglobalThis.result={regionalDataset,regionalDiagnostics,initializeRegionalMaps};',context);
 // The upstream provider runs in this realm and uses the global fetch.
 const realFetch=globalThis.fetch;globalThis.fetch=context.fetch;
 try{await context.result.initializeRegionalMaps();}finally{globalThis.fetch=realFetch;}
 return {...context.result,diagnostic:context.result.regionalDiagnostics(),fetched,configured};
}

test('regional Maps accepts loopback HTTP and the emulator gateway only with test mocks',async()=>{
 const unset=await regional({testMocks:false,devSurfaces:false,baseUrl:undefined});
 assert.equal(unset.diagnostic.stage,'no-configuration');assert.equal(unset.diagnostic.configured,false);assert.deepEqual(unset.fetched,[]);
 assert.equal(unset.regionalDataset.providerId,'alpha-osm-monaco');assert.equal(unset.regionalDataset.coverage.region,'Monaco');
 for(const baseUrl of ['http://127.0.0.1:47850','http://10.0.2.2:47850']){
  const off=await regional({testMocks:false,devSurfaces:false,baseUrl});
  assert.equal(off.diagnostic.error!==''||off.diagnostic.stage!=='ready',true);assert.deepEqual(off.fetched,[],'flag-off builds reject loopback HTTP before any request');
  const nativeOff=await regional({testMocks:false,devSurfaces:false,baseUrl,native:true});assert.deepEqual(nativeOff.fetched,[]);
 }
 const devWeb=await regional({testMocks:true,devSurfaces:true,baseUrl:'http://127.0.0.1:47850'});
 assert.deepEqual(devWeb.fetched,['http://127.0.0.1:47850/capabilities'],'development server may use the loopback gateway');
 const releaseNative=await regional({testMocks:true,devSurfaces:false,baseUrl:'http://10.0.2.2:47850',native:true,developmentBuild:false});
 assert.deepEqual(releaseNative.fetched,[],'a non-development native build never uses the emulator gateway');
 const https=await regional({testMocks:false,devSurfaces:false,baseUrl:'https://maps.example/'});
 assert.deepEqual(https.fetched,['https://maps.example/capabilities']);
});

test('production Wallet saved routes and direct open/pay requests cannot enter the prototype payment flow',async()=>{
 const {Component,ORDER}=await load(false,'prototype/model.js');
 const {validateDeviceOperation}=await load(false,'runtime/device-actions.ts');
 const notices=[],changes=[];
 const savedWallet={cards:[{id:'owned-reference',label:'kept'}],pay:true,stage:'auth'};
 const shell=Object.create(Component.prototype);
 shell.props={};shell.state={view:'wallet',stack:['notes','wallet','files'],vs:{wallet:savedWallet},msgs:[],draft:''};
 shell.toast=message=>notices.push(message);
 shell.setState=value=>{changes.push(value);Object.assign(shell.state,typeof value==='function'?value(shell.state):value);};
 shell.later=()=>{throw Error('A payment timer must never start');};
 assert.equal(shell.S().view,null,'restored Wallet route falls back to Home');
 assert.deepEqual([...shell.S().stack],['notes','files']);
 assert.equal(shell.state.vs.wallet,savedWallet,'saved unrelated/user data is not deleted');
 assert.equal(ORDER.includes('wallet'),false,'Wallet absent from discovery');
 for(const options of [{},{keepState:true},{keepStack:true}])shell.openView('wallet',{pay:true,stage:'auth'},undefined,options);
 for(const prompt of ['open wallet','show the wallet','pay rent'])shell.send(prompt);
 assert.equal(changes.length,0,'no view mutation, simulated payment or queued callback');
 assert.equal(notices.length,6,'every attempted entry refused');
 for(const proposal of [{type:'open_view',view:'wallet'},{type:'pay',amount:50},{type:'wallet_pay',card:'owned-reference'}])assert.throws(()=>validateDeviceOperation(proposal),/Unsupported device operation/);
 assert.equal(validateDeviceOperation({type:'open_view',view:'notes'}).view,'notes','unrelated navigation remains enabled');
});
