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
  ViewNavigationClient:class {constructor(request,current,context){this.current=current;this.context=context;}connectRenderer(){return()=>{};}}});
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

// Execute the actual controller preflights. Stop send immediately after its
// normal conversation binding, before preferences, transport or model work.
const preflightSource = [
  section('function residentSignInRequired()', '\n'),
  'const preflightController = {',
  section('  close() {', '  cancel() {'),
  section('  async prepareVoiceConversation(', '  async send('),
  section('  async send(', '      if(expectedConversationId!==undefined&&id!==expectedConversationId)'),
  '      return id;',
  '    } finally { signal.removeEventListener("abort", cancel); if (sending === controller) sending = null; }',
  '  },',
  '}; globalThis.preflightController = preflightController;',
].join('\n');
const preflightCode = stripTypeScriptTypes(preflightSource, {mode: 'transform'});
function preflightFixture(balance, options = {}) {
  const f = fixture({purpose: 'plan', ...options});
  let bindings = 0;
  Object.assign(f.context, {
    AbortController, DOMException, document: {hidden: false}, navigator: {onLine: true},
    residentCloudFlow: () => true, residentAlwaysPresent: true,
    residentStartInBackground: false, pendingBillingReview: null,
    operation: null, requestedCameraContinuation: undefined,
    NO_AGENT_SEND: 'No selected session', NO_AGENT_VOICE: 'No selected session',
    INFERENCE_OFFLINE_NOTICE: 'Offline',
    noSessionError: () => Error('No selected session'),
    phoneContextMessage: (text, context) => ({text, context}),
    boundNavigation: () => undefined, cancelStoppedReply: () => {},
    clearPersonalSetup: () => {},
    ensureSelectedConversation: async (_selected, _session, _signal, current) => {
      current(); bindings++; return 'conversation-1';
    },
  });
  f.context.state = {...f.snapshot(), open: false, membershipBalance: balance,
    membershipDismissed: false, session: {sessionId: 'session-1'}};
  f.context.active = {kind: 'remote', remote: {session: {expiresAt: Date.now() + 60000}}};
  vm.runInContext(preflightCode, f.context);
  f.context.connectionController = f.context.preflightController;
  return {...f, get bindings() {return bindings;},
    voice: () => f.context.preflightController.prepareVoiceConversation(new AbortController().signal),
    send: () => f.context.preflightController.send('Hello', {}, 'request-1', new AbortController().signal),
    close: () => f.context.preflightController.close()};
}
for (const balance of ['zero', 'checking', 'unavailable', undefined, 'funded', 'member']) {
  test(`voice and send preflights distinguish ${String(balance)} from verified zero`, async () => {
    for (const method of ['voice', 'send']) {
      const f = preflightFixture(balance);
      if (balance === 'zero') {
        await assert.rejects(f[method](), error => {
          assert.match(error.message, /Add funds or an active membership/);
          if (method === 'send') assert.equal(error.notDispatched, true);
          return true;
        });
        assert.equal(f.bindings, 0);
      } else {
        const result = await f[method]();
        assert.equal(method === 'voice' ? result.conversationId : result, 'conversation-1');
        assert.equal(f.bindings, 1);
        assert.equal(f.context.operation, null);
        assert.equal(f.context.sending, null);
      }
    }
  });
}
test('unknown balance does not bypass missing, expired or busy conversation guards', async () => {
  for (const balance of ['checking', 'unavailable', undefined]) {
    for (const method of ['voice', 'send']) {
      const missing = preflightFixture(balance, {account: null});
      missing.context.active = null; missing.context.state.session = null;
      await assert.rejects(missing[method](), /No selected session/);
      assert.equal(missing.bindings, 0);
      const expired = preflightFixture(balance);
      expired.context.active.remote.session.expiresAt = Date.now() - 1;
      await assert.rejects(expired[method](), /session.*expired/i);
      assert.equal(expired.bindings, 0);
      const busy = preflightFixture(balance);
      busy.context.operation = new AbortController();
      await assert.rejects(busy[method](), /Finish the.*operation/);
      assert.equal(busy.bindings, 0);
    }
  }
});
test('closing unknown balance uses ordinary close rules without claiming zero balance', () => {
  for (const balance of ['checking', 'unavailable', undefined, 'funded', 'member']) {
    const f = preflightFixture(balance);
    f.context.state.open = true;
    f.close();
    assert.equal(f.snapshot().open, false);
    assert.equal(f.snapshot().membershipDismissed, false);
    const busy = preflightFixture(balance);
    busy.context.state.open = true; busy.context.state.busy = true;
    busy.close();
    assert.equal(busy.snapshot().open, true);
  }
  const zero = preflightFixture('zero');
  zero.context.state.open = true; zero.close();
  assert.equal(zero.snapshot().open, false);
  assert.equal(zero.snapshot().membershipDismissed, true);
});
test('closing unknown balance preserves required sign-in for signed-out and expired accounts', () => {
  for (const balance of ['checking', 'unavailable', undefined]) {
    for (const account of [null, {expiresAt: Date.now() - 1}]) {
      const f = preflightFixture(balance, {account});
      f.context.state.open = true; f.close();
      assert.equal(f.snapshot().open, true);
      assert.equal(f.snapshot().membershipDismissed, false);
      assert.equal(f.context.productionCloudSignInRequired(f.snapshot()), true);
    }
  }
});
