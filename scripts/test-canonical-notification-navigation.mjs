import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
const source=(await readFile(new URL('../apps/app/src/prototype/notifications-adapter.ts',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replaceAll('export function','function')+'\nglobalThis.install=installNotificationsAdapter;';
const tick=async()=>{for(let n=0;n<20;n++)await Promise.resolve();};
function fixture(){
 let pending={},restoreHook;const acknowledgments=[],restores=[],views=[];
 const session={ownerId:'owner',agentId:'agent',sessionId:'session'};
 const connection={session,busy:false,open:false,history:undefined};
 const state={draft:'',typing:false,recording:false,view:'home',chat:false,shade:false};
 const native={addListener:async()=>({remove:async()=>{}}),canonicalPending:async()=>({...pending}),acknowledgeCanonical:async({token})=>{if(token!==pending.token)throw Error('Changed tap');acknowledgments.push(token);pending={};return {ok:true};}};
 const controller={getSnapshot:()=>connection,subscribe:()=>()=>{},restoreHistory:async(id,canCommit)=>{restores.push(id);if(restoreHook)await restoreHook();if(canCommit())connection.history={conversationId:id,messages:[{id:'message'}]};}};
 const sandbox={connectionController:controller,registerPlugin:()=>native,Capacitor:{isNativePlatform:()=>true},queueMicrotask,window:{addEventListener(){},removeEventListener(){},setInterval:()=>1,clearInterval(){}},document:{hidden:false,addEventListener(){},removeEventListener(){}},reviewContentQuestion(){},sensitiveReadingText:()=>false,noticeCurrent:()=>true,noticeExcerpt:()=>'',noticeReviewable:()=>true};
 vm.createContext(sandbox);vm.runInContext(stripTypeScriptTypes(source,{mode:'transform'}),sandbox);
 class Component{};Component.prototype.renderVals=()=>({});sandbox.install(Component);
 const shell=new Component();shell.S=()=>state;shell.setState=(patch,done)=>{Object.assign(state,patch);done?.();};shell.openView=view=>{views.push(view);state.view=view;};shell.componentDidMount();
 return {shell,state,connection,acknowledgments,restores,views,setTap:(extra={})=>{pending={token:'tap-a',ownerId:'owner',agentId:'agent',view:'chat',conversationId:'conversation',messageId:'message',...extra};},hook:fn=>{restoreHook=fn;}};
}
{
 const f=fixture();await tick();f.setTap();await f.shell.alphaCanonicalTap();await tick();assert.equal(f.state.chat,'full');assert.deepEqual(f.acknowledgments,['tap-a']);assert.deepEqual(f.restores,['conversation']);
}
{
 const f=fixture();await tick();f.setTap({ownerId:'other'});await f.shell.alphaCanonicalTap();assert.equal(f.acknowledgments.length,0);assert.equal(f.restores.length,0);
}
for(const active of ['draft','recording','typing']){
 const f=fixture();await tick();f.setTap();f.state[active]=active==='draft'?'Keep my draft':true;await f.shell.alphaCanonicalTap();assert.equal(f.restores.length,0);assert.equal(f.acknowledgments.length,0);
}
{
 const f=fixture();await tick();f.setTap({view:'automations'});await f.shell.alphaCanonicalTap();await tick();assert.deepEqual(f.views,['workflows']);assert.deepEqual(f.acknowledgments,['tap-a']);assert.equal(f.restores.length,0);
}
{
 const f=fixture();await tick();f.setTap({view:'clock'});await f.shell.alphaCanonicalTap();assert.equal(f.acknowledgments.length,0);assert.equal(f.views.length,0);
}
{
 const f=fixture();await tick();f.setTap();let release;f.hook(()=>new Promise(resolve=>{release=resolve;}));const opening=f.shell.alphaCanonicalTap();await tick();f.state.draft='Typed while loading';release();await opening;assert.equal(f.state.draft,'Typed while loading');assert.equal(f.connection.history,undefined);assert.equal(f.acknowledgments.length,0);
}
{
 const f=fixture();await tick();f.setTap();let release;f.hook(()=>new Promise(resolve=>{release=resolve;}));const opening=f.shell.alphaCanonicalTap();await tick();f.setTap({token:'tap-b'});f.shell.alphaCanonicalWake();f.hook(undefined);release();await opening;await tick();assert.deepEqual(f.acknowledgments,['tap-b']);
}
console.log('PASS canonical notification navigation: current owner, restored message, no draft/voice interruption, supported routes, atomic token and next tap drain');
