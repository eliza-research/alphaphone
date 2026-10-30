import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {transformSync} from 'esbuild';
const source=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
const between=(text,start,end)=>{const a=text.indexOf(start),b=text.indexOf(end,a);assert.ok(a>=0&&b>a);return text.slice(a,b);};
test('automatic readiness probes once per unresolved entry, rearms after a form closes and never initiates sign-in',()=>{
 const code=between(source,'  const automaticSignInProbe =','  const visible=');
 let ref,effects=[],count=0;
 const apply=new Function('useRef','useEffect','signInEntryRequired','snapshot','connectionController','residentEnvironment','isAndroid','cloudSignIn','update',transformSync(code,{loader:'tsx'}).code);
 const draw=(required,busy=false,signIn=null,rest={})=>{effects=[];apply(()=>ref??=( {current:false}),fn=>{effects.push(fn);},required,{busy,signIn,...rest},{beginSignIn(...args){assert.deepEqual(args,['production',false,true]);count++;},signInGoogle(){throw Error('Unexpected Google');},signInEmail(){throw Error('Unexpected email');}},()=> 'production',false,undefined,()=>{throw Error('Unexpected native recovery update in browser');});assert.equal(effects.length,2,'execute both real startup effects in React order');for(const effect of effects)effect();};
 draw(true,false,null,{startupResolved:false});assert.equal(count,0);
 draw(true,false,null,{automaticRestore:true});assert.equal(count,0);
 draw(true,true);assert.equal(count,0);draw(true);draw(true);assert.equal(count,1);
 draw(true,false,{step:'choose'});assert.equal(count,1);
 // Cloud can refuse a newly issued key after the form closes. Probe its fresh entry once.
 draw(true,true);assert.equal(count,1);draw(true);draw(true);assert.equal(count,2);
 draw(false);draw(true);assert.equal(count,3);
});

test('the host routes cancellation to the shared attempt and keeps the required idle chooser',()=>{
 const code=between(source,'  cancelSignIn() {','  async signInGoogle()');
 const compile=transformSync('const target={'+code+'};',{loader:'ts'}).code;
 const calls=[],current={step:{kind:'methods'},busy:false,stage:'choosing'};
 const attempt={getSnapshot:()=>current,leave:()=>calls.push('leave'),chooseAnotherMethod:()=>calls.push('choose')};
 let required=true;const target=new Function('signInAttempt','productionCloudSignInRequired','state',compile+';return target;')(attempt,()=>required,{});
 target.cancelSignIn();assert.deepEqual(calls,[]);required=false;target.cancelSignIn();assert.deepEqual(calls,['leave']);
 current.step={kind:'code'};target.cancelSignIn();assert.deepEqual(calls,['leave','choose']);current.stage='activating';target.cancelSignIn();assert.deepEqual(calls,['leave','choose','leave']);
});
