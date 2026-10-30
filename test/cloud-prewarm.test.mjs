// Inference pre-warm: when the owner is about to talk, Alpha asks the resident agent (POST /api/cloud/warm) to open
// its Cloud inference connection with one no-model request. Renderer source and the development bridge, in Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
if(!process.execArgv.includes('tsx')){const child=spawnSync(process.execPath,['--import','tsx',process.argv[1]],{stdio:'inherit',timeout:60000});process.exit(child.status??1);}
const {localAgentPathAllowed}=await import('../scripts/local-agent-dev-bridge.ts');
const source=path=>readFileSync(new URL('../apps/app/src/'+path,import.meta.url),'utf8');

function warmer(context){
 const text=source('runtime/connection-ui.tsx'),method=text.slice(text.indexOf('  warmInference(){'),text.indexOf('  async readCloudInferenceFailure(')).trim().replace(/,$/,'');
 assert.ok(method.startsWith('warmInference(){'));
 vm.runInNewContext(stripTypeScriptTypes('function '+method,{mode:'strip'})+'\nglobalThis.warm=warmInference;',context);
 return context.warm;
}

test('one POST /api/cloud/warm per minute, only for a verified resident session, failures ignored',async()=>{
 const calls=[];let now=1_000_000,fail=false;
 const remote={request:async(path,body,signal,headers,method)=>{calls.push({path,body:JSON.stringify(body),method});assert.ok(signal instanceof AbortSignal);if(fail)throw Error('offline');return {warmed:true};}};
 const context={active:{kind:'resident',remote},state:{session:{sessionId:'s'}},lastInferenceWarm:Number.NEGATIVE_INFINITY,INFERENCE_WARM_INTERVAL_MS:60000,AbortSignal,Date:{now:()=>now}};
 const warm=warmer(context);
 warm();warm();
 assert.deepEqual(calls,[{path:'/api/cloud/warm',body:'{}',method:undefined}]);// POST with an empty JSON body: no prompt
 now+=59_999;warm();assert.equal(calls.length,1);
 now+=1;fail=true;warm();assert.equal(calls.length,2);
 await new Promise(resolve=>setImmediate(resolve));// the rejected warm is swallowed, not an unhandled rejection
 now+=60_000;context.state.session=null;warm();
 context.state.session={sessionId:'s'};context.active={kind:'cloud'};warm();
 context.active=null;warm();
 assert.equal(calls.length,2);
});

test('a new connection resets the debounce and warms while visible; triggers are wired',()=>{
 const ui=source('runtime/connection-ui.tsx'),activate=ui.slice(ui.indexOf('function activate('),ui.indexOf('\n}\n',ui.indexOf('function activate(')));
 assert.match(activate,/lastInferenceWarm=Number\.NEGATIVE_INFINITY;\n\s*if\(typeof document!=='undefined'&&!document\.hidden\)connectionController\.warmInference\(\);/);
 const adapter=source('prototype/agent-adapter.ts');
 assert.match(adapter,/this\.visibilityHandler = \(\) => \{ if\(document\.hidden\)connectionController\.cancelViewNavigation\(\);else connectionController\.warmInference\(\);/);
 assert.match(adapter,/const chatOpen=this\.S\(\)\.chat==='sheet'\|\|this\.S\(\)\.chat==='full';if\(chatOpen&&!this\.chatWasOpen\)connectionController\.warmInference\(\);this\.chatWasOpen=chatOpen;/);
 const voice=source('prototype/voice-adapter.ts'),start=voice.slice(voice.indexOf('Component.prototype.startVoice = async function'),voice.indexOf('function conversationRecorderView('));
 assert.match(start,/connectionController\.warmInference\(\);/);
 // Nothing schedules a warm on its own.
 for(const text of [ui,adapter,voice])assert.doesNotMatch(text,/set(?:Interval|Timeout)\([^)]*warmInference/);
});

test('the development bridge admits exactly the warm route',()=>{
 assert.equal(localAgentPathAllowed('/api/cloud/warm'),true);
 for(const path of ['/api/cloud/warm/x','/api/cloud/warmer','/api/cloud/login','/api/cloud/status','/api/cloud/warm?x=1'])assert.equal(localAgentPathAllowed(path),false,path);
});

test('the Android resident gate admits exactly the warm route',()=>{
 const java=readFileSync(new URL('../android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java',import.meta.url),'utf8');
 const literal=java.match(/!path\.matches\("(\^\/api\/\(auth\/me\|[^"]+)"\)/);
 assert.ok(literal,'native resident route pattern');
 const gate=new RegExp(literal[1].replace(/\\\\/g,'\\'));
 assert.equal(gate.test('/api/cloud/warm'),true);
 for(const path of ['/api/cloud/warm/x','/api/cloud/warmer','/api/cloud/login','/api/cloud/status'])assert.equal(gate.test(path),false,path);
});
