import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {randomUUID} from 'node:crypto';
const root=process.env.ALPHA_RECEIPT_SOURCE_ROOT||'.';
const read=p=>fs.readFileSync(root+'/'+p,'utf8');
const agent=read('apps/app/src/prototype/agent-adapter.ts'),browser=read('apps/app/src/prototype/browser-adapter.ts'),device=read('apps/app/src/runtime/device-actions.ts');
const ts=s=>stripTypeScriptTypes(s,{mode:'transform'});
const navigateCode=ts(browser.slice(browser.indexOf('  async function navigate('),browser.indexOf('  async function command(')));
const browserCode=ts(browser.slice(browser.indexOf('    this.browserNavigateApproved ='),browser.indexOf('    // Identity only:')));
const executorCode=agent.slice(agent.indexOf("      if (!this.browserNavigateApproved) return"),agent.indexOf('\n    });\n    context(this);',agent.indexOf("      if (!this.browserNavigateApproved) return")));
const approveCode=ts('({'+device.slice(device.indexOf('  async approve(proposalId:'),device.indexOf('  async completeReadReply('))+'})');
const cancelCode=ts(agent.slice(agent.indexOf('    if(shell.pendingActionApproval&&'),agent.indexOf('\n    const blocked=',agent.indexOf('    if(shell.pendingActionApproval&&'))));
function harness({native=false,origin='notes',receiptFailure=false,dispatchFailure=false,finishFailure=false,beforeReceipt,afterDispatch}={}){
 const journalResults=[],receiptBodies=[],events=[],controller=new AbortController(),session={sessionId:'s',ownerId:'o',agentId:'a'},initial={view:origin,sensitive:false,revision:1,...(origin==='browser'?{selectedObject:{kind:'browser-tab',id:'existing',revision:'0'}}:{})};
 let currentContext=initial,live=true,disposed=false,selected='existing';
 const state={cur:selected,tabs:[{id:selected,hist:['newtab'],pos:0}]},created=new Map([[selected,Promise.resolve()]]),document={hidden:false},metadata=new Map(),documentRevisions=new Map();
 const shell={pendingActionApproval:controller,pendingActionApprovalContext:initial,pendingActionApprovalSession:session,
  vset(_key,patch){Object.assign(state,patch);if(origin==='browser'&&state.cur!==initial.selectedObject.id){currentContext={...initial,revision:2,selectedObject:{kind:'browser-tab',id:state.cur,revision:String(documentRevisions.get(state.cur)||0)}};cancel();}},
  openView(){events.push('present');currentContext={view:'browser',sensitive:false,revision:2};cancel();}};
 const connection={session,open:false},connectionController={getSnapshot:()=>connection},alphaClient={getState:()=>({context:currentContext})};
 const cancel=()=>vm.runInNewContext(cancelCode,{shell,document,connection,currentContext});
 const browserContext={URL,Error,document,Capacitor:{isNativePlatform:()=>native},session:'native-session',state:()=>state,created,shell,get disposed(){return disposed;},profileUnsupportedTab:undefined,newTabId:()=> 'new-tab',isPrivate:()=>false,restored:new Map(),metadata,documentRevisions,restoreAttempts:new Map(),
 ensure(id){const promise=Promise.resolve();created.set(id,promise);return promise;},
 Browser:{async navigate(){controller.signal.throwIfAborted();events.push('dispatch');if(dispatchFailure)throw Error('dispatch failed');afterDispatch?.({controller,changeTab:()=>{created.set('foreign',Promise.resolve());state.cur='foreign';},dispose:()=>disposed=true});},async close(){}},refresh(){},report(){}};
 const browserNavigateApproved=vm.runInNewContext('(function(){'+navigateCode+'\n'+browserCode+';return this.browserNavigateApproved;}).call({})',browserContext);
 const executor=vm.runInNewContext(ts('(async function(operation,signal,expectedContext){'+executorCode+'})'),{connectionController,alphaClient,document}).bind({browserNavigateApproved,get live(){return live;}});
 const p={id:'proposal',digest:'digest',operation:{type:'browser_navigate',url:'https://example.com'},expiresAt:Date.now()+60000};
 const globals={Error,Date,JSON,crypto:{randomUUID},contextKey:JSON.stringify,actionScope:async()=> 'hash',assertProposalContext(){}};
 for(const name of ['isClockOperation','isNativeNotesQuery','isSmsSend','isMapsOperation','isCameraCapture','isLibraryOperation','isReminderCreate','isReminderOperation','isNotesOperation','isCalendarOperation','isForegroundReview','isOriginalDeviceReadOperationType'])globals[name]=()=>false;
 const approve=vm.runInNewContext(approveCode,globals).approve;
 const journal={async reserve(){events.push('reserve');return {created:true};},async markApplying(){events.push('applying');},async finish(record){journalResults.push(record);events.push('finish');if(finishFailure)throw Error('journal failed');}};
 const owner={busy:false,scope:'scope',session,credential:{installationId:'i',enrollmentId:'e'},proposals:new Map([[p.id,{proposal:p,context:initial}]]),readReplies:new Map(),journal,
  execute:async(op,_id,context,signal)=>executor(op,signal,context),
  async mutation(proposal,suffix,body){if(suffix==='receipt')receiptBodies.push(body);events.push(suffix);if(suffix==='receipt')await beforeReceipt?.({controller,document,session:connection,externalView(){currentContext={view:'calendar',sensitive:false,revision:3};cancel();}});controller.signal.throwIfAborted();if(suffix==='receipt'&&receiptFailure)throw Error('network unavailable');return {...proposal,state:suffix==='claim'?'executing':'done',attemptId:'attempt'};}};
 return {journalResults,receiptBodies,events,controller,document,owner,async run(){return approve.call(owner,p.id,initial,controller.signal);},setLive:v=>live=v};
}
for(const native of [false,true])for(const origin of ['notes','browser']){
 const label=(native?'native':'web')+' from '+origin;
 test(`${label}: exact action journals and uploads its receipt before Browser presentation`,async()=>{
  const h=harness({native,origin}),r=await h.run();
  assert.equal(r.status,'succeeded');assert.doesNotMatch(r.summary,/pending/);
  assert.deepEqual(h.events,['reserve','decision','claim','applying','dispatch','finish','receipt','present']);
  assert.equal(h.controller.signal.aborted,true,'self-presentation may retire context only after receipt');
  assert.equal(h.events.filter(e=>e==='dispatch').length,1);
  assert.equal(h.journalResults.length,1);assert.equal(h.receiptBodies.length,1);
  assert.deepEqual(Object.keys(h.journalResults[0].result),['operationId']);
  assert.deepEqual(Object.keys(h.receiptBodies[0].receipt),['outcome','operationId']);
  assert.equal(h.receiptBodies[0].attemptId,'attempt');assert.equal(h.receiptBodies[0].receipt.outcome,'applied');
 });
 test(`${label}: genuine receipt failure remains pending with one dispatch and no automatic retry`,async()=>{
  const h=harness({native,origin,receiptFailure:true}),r=await h.run();assert.match(r.summary,/Server receipt is pending/);assert.equal(h.events.filter(e=>e==='receipt').length,1);assert.equal(h.events.filter(e=>e==='dispatch').length,1);assert.equal(h.events.at(-1),'present');
 });
 test(`${label}: pre-effect cancellation never dispatches or presents`,async()=>{const h=harness({native,origin});h.controller.abort();const r=await h.run();assert.equal(r.status,'unknown');assert.deepEqual(h.events,[]);});
 test(`${label}: cancelled external view change during receipt never forces Browser foreground`,async()=>{const h=harness({native,origin,beforeReceipt:({externalView})=>externalView()}),r=await h.run();assert.match(r.summary,/pending/);assert.equal(h.events.filter(e=>e==='dispatch').length,1);assert.ok(!h.events.includes('present'));});
 test(`${label}: durable journal failure never presents or uploads`,async()=>{const h=harness({native,origin,finishFailure:true}),r=await h.run();assert.equal(r.status,'unknown');assert.ok(!h.events.includes('present'));assert.ok(!h.events.includes('receipt'));});
 test(`${label}: failed dispatch never presents and is not repeated`,async()=>{const h=harness({native,origin,dispatchFailure:true}),r=await h.run();assert.equal(r.status,'unknown');assert.equal(h.events.filter(e=>e==='dispatch').length,1);assert.ok(!h.events.includes('present'));});
 for(const change of ['changeTab','dispose'])test(`${label}: ${change} after dispatch cannot redirect presentation`,async()=>{const h=harness({native,origin,afterDispatch:args=>args[change]()}),r=await h.run();assert.equal(r.status,'succeeded');assert.ok(!h.events.includes('present'));});
 test(`${label}: changed owner session before receipt completion cannot present`,async()=>{const h=harness({native,origin,beforeReceipt:({session})=>session.session={sessionId:'different'}}),r=await h.run();assert.equal(r.status,'succeeded');assert.ok(!h.events.includes('present'));});
 test(`${label}: hidden foreground cannot present after receipt`,async()=>{const h=harness({native,origin,beforeReceipt:({document})=>document.hidden=true}),r=await h.run();assert.equal(r.status,'succeeded');assert.ok(!h.events.includes('present'));});
}
