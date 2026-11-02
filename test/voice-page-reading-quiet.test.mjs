import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {load} from './fixtures/cloud-voice-view.mjs';

// The actual Android page reading method and the actual voicemail reader with closed ports: a speech
// failure ends with no text; the page's own refusals keep their line; a reading that plays is unchanged.
const adapter=readFileSync('apps/app/src/prototype/browser-adapter.ts','utf8');
const between=(start,end)=>{const a=adapter.indexOf(start),b=adapter.indexOf(end,a);assert.ok(a>=0&&b>a,start);return adapter.slice(a,b);};
const code=stripTypeScriptTypes(`let reading;\n${between('  const report = (error','  let reading:')}\n${between('  function stopReading()','  const unsubscribeReading')}\n${between('  async function readPage()','  async function askPage()')}`,{mode:'transform'})+'\nreturn readPage;';
const TOKEN={readingToken:'one-use-token'};
function reader({voice=()=>({binding:{},isCurrent:()=>true,ready:async()=>true,speak:async()=>{}}),review=async()=>TOKEN,session=true,page={committed:true,url:'https://example.test/',navigation:1}}={}){
 const toasts=[],logged=[],cancels=[];
 const shell={toast:text=>toasts.push(text),vset(){},vget:()=>({cur:'tab'}),S:()=>({view:'browser'})};
 const Browser={reviewReading:review,cancelReading:async()=>{cancels.push(1);}};
 const ports={shell,Browser,Capacitor:{isNativePlatform:()=>true},tabs:{revision:()=>1},tabInfo:()=>page,readingUnsupported:async()=>false,createNativeReadingVoice:voice,connectionController:{getSnapshot:()=>({session:session?{}:null,open:false}),subscribe:()=>()=>{}},browserErrorMessage:error=>error.message,disposed:false,agentPendingText:()=>'Your agent is starting.',session:'browser-session',lastGeometry:'',update:async()=>{},logVoiceFailure:failure=>logged.push(failure),state:()=>shell.vget(),document:{hidden:false}};
 const readPage=new Function(...Object.keys(ports),code)(...Object.values(ports));
 return {readPage,toasts,logged,cancels};
}
const speech=speak=>()=>({binding:{},isCurrent:()=>true,ready:async()=>true,speak});
for(const [name,options] of [
 ['speech that is not ready',{voice:()=>({binding:{},isCurrent:()=>true,ready:async()=>false})}],
 ['speech that fails',{voice:speech(async()=>{throw Error('PRIVATE_ENGINE_TEXT');})}],
 ['a speech route the agent does not offer',{voice:()=>null}],
 ['a review with no speech route',{review:async()=>{throw Error('Select an available speech route before reading');}}],
 ['a cancelled review',{review:async()=>{throw Error('Reading cancelled or page unavailable');}}],
])test(`phone Browser: ${name} ends reading with no text`,async()=>{
 const f=reader(options);await f.readPage();
 assert.deepEqual(f.toasts.filter(text=>text!=='Preparing reviewed page speech'),[],'the status lines are the owner\'s call');
});
test('phone Browser: a speech failure reaches only the dev log and Read page works again',async()=>{
 let reads=0;const failure=Error('PRIVATE_ENGINE_TEXT'),f=reader({voice:speech(async()=>{reads++;if(reads===1)throw failure;})});
 await f.readPage();assert.deepEqual(f.logged,[failure]);assert.equal(f.cancels.length,1);
 await f.readPage();assert.equal(reads,2);
});
for(const [code,message] of [['sensitive-page','Reading unavailable on a sensitive or unverified page'],['reading-not-ready','This page is not ready for private reading. Reload this page, then try again.'],['isolated-world-unavailable','Isolated page reading is unavailable. Update Android System WebView, then reload this page.']])
test(`phone Browser: the page refusal ${code} keeps its line`,async()=>{
 const f=reader({review:async()=>{throw Object.assign(Error(message),{code});}});await f.readPage();
 assert.deepEqual(f.toasts,[message]);
});
test('phone Browser: a page that is not loaded keeps its refusal, and no agent keeps its line',async()=>{
 const unloaded=reader({page:{loading:true}});await unloaded.readPage();assert.deepEqual(unloaded.toasts,['Load an HTTPS page before reading.']);
 const absent=reader({voice:()=>null,session:false});await absent.readPage();assert.deepEqual(absent.toasts,['Your agent is starting.']);
});
test('phone Browser: a reading that plays speaks the reviewed token with its status unchanged',async()=>{
 const tokens=[],f=reader({voice:speech(async token=>{tokens.push(token);})});await f.readPage();
 assert.deepEqual(tokens,['one-use-token']);assert.deepEqual(f.toasts,['Preparing reviewed page speech','Reading finished']);assert.deepEqual(f.logged,[]);
});

function voicemail(speakLocalText){
 const box={devSurfacesEnabled:true,speakLocalText,AbortController,window:{addEventListener(){},removeEventListener(){}},document:{addEventListener(){},removeEventListener(){}}};
 load('browser/simulated-voicemail.ts',box,['installSimulatedVoicemail']);
 const state={vms:[{id:'vm',text:'Call me back'}],playing:null,vpos:0},toasts=[],api={get:()=>state,set:patch=>Object.assign(state,patch),toast:text=>toasts.push(text)};
 const phone={render:()=>({vms:[{toggle(){},del(){},call(){},msg(){}}],tabs:[]}),onLeave(){},back(){}};
 box.installSimulatedVoicemail(phone);
 return {state,toasts,play:()=>phone.render(state,api).vms[0].play(),tick:()=>new Promise(resolve=>setTimeout(resolve,0))};
}
test('voicemail: speech that fails ends quietly with Read voicemail ready again',async()=>{
 const f=voicemail(async()=>{throw Error('PRIVATE_ENGINE_TEXT');});f.play();await f.tick();
 assert.deepEqual(f.toasts,[]);assert.equal(f.state.playing,null);assert.equal(f.state.vpos,0);
});
test('voicemail: speech that plays ends at the end of the bar',async()=>{
 const f=voicemail(async()=>{});f.play();assert.equal(f.state.playing,'vm');await f.tick();
 assert.deepEqual(f.toasts,[]);assert.equal(f.state.playing,null);assert.equal(f.state.vpos,1);
});
