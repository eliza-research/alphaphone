/** Actual connection state/ownership functions; no renderer, network, credential or phone. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=await readFile(process.env.ALPHA_PRESENTATION_SOURCE||new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return source.slice(a,b).replace(/^export /gm,'');}
const functions=[
 section('function update(', '// P-43: where'),
 section('export function productionCloudSignInRequired(', 'export function ConnectionChooser('),
 section('async function refreshActionReview(', 'function boundNavigation('),
 section('function boundNavigation(', '/*\n * DEVELOPMENT INFRASTRUCTURE'),
].join('\n');
const code=stripTypeScriptTypes(functions,{mode:'transform'});
function fixture({android=true,dev=false,account={expiresAt:Date.now()+60000},purpose='agent',open=false}={}){
 const entries=[{id:'review-1',state:'reconciliation_required'}];let release;
 const selected={request(){},actions:{}};
 const context=vm.createContext({isAndroid:android,testMocksEnabled:dev,developmentPageSuspended:false,sending:null,flushConversationEvents:()=>{},listeners:new Set(),state:{open,automaticRestore:false,busy:false,error:'',cloudAccount:account,purpose,signIn:null,message:'Finish signing in in your browser.',session:{}},active:selected,epoch:1,navigationContext:()=>({view:'home'}),errorMessage:()=> 'Sign-in expired',readActionHistory:async()=>entries,Date,
  ViewNavigationClient:class {constructor(request,current,context){this.current=current;this.context=context;}}});
 vm.runInContext(code,context);
 return {context,entries,update:patch=>context.update(patch),snapshot:()=>context.state,review:()=>context.refreshActionReview(new AbortController().signal),navigation:()=>context.boundNavigation()};
}
test('hidden production agent state cannot block navigation; owner/session/epoch guards remain',()=>{
 const f=fixture();f.update({open:true});assert.equal(f.snapshot().open,false);
 const nav=f.navigation();assert.equal(nav.current(),true);
 f.context.epoch++;assert.equal(nav.current(),false);f.context.epoch--;
 f.context.state={...f.snapshot(),session:{}};assert.equal(nav.current(),false);
});
test('signed-out and expired production accounts remain modal even after close',()=>{
 for(const account of [null,{expiresAt:Date.now()-1000}]){const f=fixture({account});f.update({open:false});assert.equal(f.snapshot().open,true);assert.equal(f.navigation().current(),false);}
});
test('explicit account, plan and sign-in panels still block navigation',()=>{
 for(const purpose of ['cloud-account','plan']){const f=fixture({purpose});f.update({open:true});assert.equal(f.snapshot().open,true);assert.equal(f.navigation().current(),false);f.update({open:false});assert.equal(f.navigation().current(),true);}
 const f=fixture();f.update({open:true,signIn:{step:'choose'}});assert.equal(f.snapshot().open,true);assert.equal(f.navigation().current(),false);
});
test('automatic restore preserves explicit panel intent while rendering is suppressed',()=>{
 const f=fixture({purpose:'cloud-account'});f.update({open:true,automaticRestore:true,busy:true});assert.equal(f.snapshot().open,true);assert.equal(f.context.connectionChooserVisible(f.snapshot()),false);f.update({busy:false});assert.equal(f.context.connectionChooserVisible(f.snapshot()),true);
});
test('production review history refresh preserves browser instructions and modal ownership',async()=>{
 for(const account of [null,{expiresAt:Date.now()+60000}]){const f=fixture({account});f.update({});const before=f.snapshot();await f.review();assert.equal(f.snapshot().actionHistory,f.entries);assert.equal(f.snapshot().message,before.message);assert.equal(f.snapshot().open,before.open);}
});
test('stale action history replies cannot mutate the current connection',async()=>{
 const f=fixture();let resolve;f.context.readActionHistory=()=>new Promise(r=>{resolve=r;});const result=f.review();f.context.epoch++;resolve(f.entries);await result;assert.equal(f.snapshot().actionHistory,undefined);assert.equal(f.snapshot().message,'Finish signing in in your browser.');
});
test('development and non-Android presentation retain their explicit review notice',async()=>{
 for(const options of [{dev:true},{android:false}]){const f=fixture(options);f.update({open:true});assert.equal(f.snapshot().open,true);await f.review();assert.equal(f.snapshot().actionHistory,f.entries);assert.match(f.snapshot().message,/phone action needs your review/);}
});

test('unresolved saved-session restore does not start the earlier automatic sign-in probe',()=>{
 const f=fixture({account:null});f.update({startupResolved:false,automaticRestore:true,busy:false});
 const a=source.indexOf('  useEffect(() => {\n    if (!productionSignInRequired)'),b=source.indexOf('  }, [productionSignInRequired, snapshot.busy, snapshot.signIn]);',a);assert.ok(a>=0&&b>a);
 let probes=0,automaticSignInProbe={current:false};
 const callback=source.slice(a,b).replace('  useEffect(() => {','(()=>{')+'})';
 const evaluate=()=>{f.context.snapshot=f.snapshot();f.context.productionSignInRequired=f.context.productionCloudSignInRequired(f.snapshot());f.context.automaticSignInProbe=automaticSignInProbe;f.context.residentEnvironment=()=> 'production';f.context.connectionController={beginSignIn:()=>{probes++;}};vm.runInContext(stripTypeScriptTypes('var runProbe='+callback+';runProbe();',{mode:'transform'}),f.context);};
 evaluate();assert.equal(probes,0,'the sign-in effect is declared first but must leave restore alone');assert.equal(f.context.connectionChooserVisible(f.snapshot()),false);
 f.update({cloudAccount:{expiresAt:Date.now()+60000},startupResolved:true,automaticRestore:false});evaluate();assert.equal(probes,0);assert.equal(f.context.connectionChooserVisible(f.snapshot()),false);
});
test('resolved signed-out and sign-out transitions still request sign-in',()=>{
 const f=fixture({account:null});f.update({startupResolved:false,automaticRestore:true});assert.equal(f.context.productionCloudSignInRequired(f.snapshot()),false);
 f.update({startupResolved:true,automaticRestore:false});assert.equal(f.context.productionCloudSignInRequired(f.snapshot()),true);assert.equal(f.snapshot().open,true);
 const returning=fixture();returning.update({startupResolved:true,cloudAccount:null});assert.equal(returning.context.productionCloudSignInRequired(returning.snapshot()),true);
});
test('expired and rejected restored sessions still require authentication; valid offline account stays nonmodal',()=>{
 for(const patch of [{cloudAccount:{expiresAt:Date.now()-1000},startupResolved:true},{cloudAccount:null,startupResolved:true,error:'Sign-in expired'},{cloudAccount:null,startupResolved:false,error:'Sign-in expired'}]){const f=fixture();f.update(patch);assert.equal(f.context.productionCloudSignInRequired(f.snapshot()),true);}
 const f=fixture();f.update({startupResolved:true,inferenceOffline:true});assert.equal(f.context.productionCloudSignInRequired(f.snapshot()),false);assert.equal(f.snapshot().open,false);
});
