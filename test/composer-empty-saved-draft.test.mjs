import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import {stripTypeScriptTypes} from 'node:module';
// The chat composer's own wiring (agent-adapter.ts: its draft helpers, the controller it builds on
// mount and the draft lines of componentDidUpdate and render) over the shared controller and the
// shared compare-and-exchange rows, exactly as the pin projects them. Only the React state queue and
// the device slot are stand-ins. Two fixtures over one map of rows are two windows (the app and
// AlphaAssistActivity) on the same device slot.
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const ts=source=>stripTypeScriptTypes(source,{mode:'transform'});
const load=path=>import('data:text/javascript;base64,'+Buffer.from(ts(read(path))).toString('base64'));
const {DurableDraftController,DEFAULT_DURABLE_DRAFT_MESSAGES}=await load('.eliza/client-features/packages/ui/src/state/durable-draft-controller.ts');
const {compareExchangeDraftStore}=await load('.eliza/client-features/packages/ui/src/state/durable-draft.ts');
const adapter=read('apps/app/src/prototype/agent-adapter.ts');
const between=(source,start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b);};
const helpers=between(adapter,'function createdFromSlot(','const preDispatchRefusals=');
const mount=between(adapter,'    this.composerDraft=new AssistantDraftController(','    this.refreshDraftBinding=');
const update=between(adapter,"this.composerDraft?.edit(String(this.S().draft||''));",'const shade=');
const savedCopy=between(adapter,'out.draftSavedText=',';out.draftOpening=').slice('out.draftSavedText='.length);
const SAVED_AVAILABLE='A saved draft is available. Review both copies.',NOT_SAVED='Draft was not saved. Review the saved copy before replacing it.';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(raws=new Map()){
 // One raw compare-and-exchange slot per binding, like the Android secure slot; `before` runs
 // inside the next exchange, before it compares, as another window writing first would.
 const exchanges=[];let before,failing=false;
 const slot=binding=>({async read(){return raws.get(binding)??null;},async compareExchange(expected,value){if(failing){exchanges.push({binding,expected,value,failed:true});throw Error('Secure storage write failed');}const run=before;before=undefined;run?.();const saved=(raws.get(binding)??null)===expected;exchanges.push({binding,expected,value,saved});if(saved)raws.set(binding,value);return {status:saved?'saved':'conflict'};}});
 const stores=new Map(),assistantDraftStore=async binding=>{if(!stores.has(binding))stores.set(binding,compareExchangeDraftStore(binding,slot(binding)));return stores.get(binding);};
 const pending=[],prompts=[];let refreshes=0;
 const shell={live:true,state:{draft:''},startupDraft:null,reviewedSourceDraft:null,firstSendReview:undefined,S(){return this.state;},refreshDraftBinding(){refreshes++;},
  setState(update,callback){
   // Every render the composer gets: a conflict here is the review prompt above the composer.
   const draft=this.composerDraft?.state;if(draft?.conflict)prompts.push({savedText:draft.savedText,message:draft.message});
   pending.push(()=>{const patch=typeof update==='function'?update(this.state):update;if(patch)Object.assign(this.state,patch);this.componentDidUpdate();callback?.();});
  }};
 const context=vm.createContext({AssistantDraftController:DurableDraftController,DEFAULT_DURABLE_DRAFT_MESSAGES,assistantDraftStore,shell});
 vm.runInContext(ts(`${helpers}\n(function(){${mount}}).call(shell);\nshell.componentDidUpdate=function(){${update}};\nshell.savedCopy=function(draft){return ${savedCopy};};`),context);
 const draft=shell.composerDraft;
 const flush=async()=>{for(let n=0;n<40;n++){while(pending.length)pending.shift()();await tick();}};
 return {draft,shell,prompts,exchanges,flush,raws,
  refreshes:()=>refreshes,
  // The composer's input event: its state update renders, and componentDidUpdate records the text.
  type(text){shell.state.draft=text;shell.componentDidUpdate();},
  async seed(binding,...texts){const store=await assistantDraftStore(binding);let row=await store.read();for(const text of texts)row=await store.save(row,text);return row;},
  row:binding=>{const raw=raws.get(binding);return raw==null?null:JSON.parse(raw);},
  raw:binding=>raws.get(binding)??null,
  setRaw:(binding,value)=>raws.set(binding,value),
  beforeNextExchange(run){before=run;},
  failWrites(value){failing=value;},
  // A send from this window: held, dispatched, and its saved copy cleared.
  async send(text){shell.state.draft=text;await draft.hold(text);shell.state.draft='';await draft.commit();await flush();},
  async open(binding){const opening=draft.open(binding);await flush();await opening;await flush();}};
}
const otherWindowRow=(binding,text,revision)=>JSON.stringify({version:1,binding,revision,text});
const BLANKS=[' ','\n','  \n\t'];

test('an empty saved copy is never offered over typed text; the text is kept and saved over it',async()=>{
 const f=fixture(),key=JSON.stringify(['origin','owner','agent','room']);
 // A sent message leaves a revisioned empty row behind (the commit's clear).
 const cleared=await f.seed(key,'Sent earlier','');
 f.shell.state.draft='hi';await f.open(key);
 assert.deepEqual(f.prompts,[],'no review prompt is rendered, not even for one update');
 assert.equal(f.draft.state.conflict,false);assert.equal(f.draft.state.message,'');assert.equal(f.draft.state.error,false);
 assert.equal(f.shell.state.draft,'hi');
 assert.equal(f.row(key).text,'hi');assert.notEqual(f.row(key).revision,cleared.revision);
 // The binding stays writable: later typing saves without a review.
 f.type('hi there');await f.flush();
 assert.equal(f.row(key).text,'hi there');assert.deepEqual(f.prompts,[]);
 // Opening the same binding again over another empty row (a conversation switch and back) is
 // not offered either: keeping an empty copy once does not use up keeping the next one.
 f.setRaw(key,otherWindowRow(key,'','cleared-again'));f.draft.retire();await f.open(key);
 assert.deepEqual(f.prompts,[]);assert.equal(f.row(key).text,'hi there');assert.equal(f.shell.state.draft,'hi there');
});

test('a saved copy of only whitespace is empty too: never offered, and shown as empty',async()=>{
 for(const blank of BLANKS){
  const f=fixture(),key=JSON.stringify(['origin','owner','agent','blank']);
  f.setRaw(key,otherWindowRow(key,blank,'blank-row'));
  f.shell.state.draft='hi';await f.open(key);
  assert.deepEqual(f.prompts,[],JSON.stringify(blank));
  assert.equal(f.draft.state.conflict,false);assert.equal(f.shell.state.draft,'hi');assert.equal(f.row(key).text,'hi');
  // With nothing typed, opening it offers nothing either.
  const g=fixture();g.setRaw(key,otherWindowRow(key,blank,'blank-row'));await g.open(key);
  assert.deepEqual(g.prompts,[]);assert.equal(g.draft.state.conflict,false);
  // Wherever such a copy is still shown (a write that keeps failing), it reads as empty, not blank.
  assert.equal(f.shell.savedCopy({savedText:blank}),'(Empty saved draft)');
 }
 const f=fixture();assert.equal(f.shell.savedCopy({savedText:'Earlier words'}),'Earlier words');assert.equal(f.shell.savedCopy({savedText:''}),'(Empty saved draft)');
});

test('an empty saved copy found while a restore is queued is not offered either',async()=>{
 const f=fixture(),key='["origin","owner","agent","queued"]';
 await f.seed(key,'');
 const opening=f.draft.open(key);await tick();await tick();
 f.shell.state.draft='typed during restore';f.draft.edit('typed during restore');
 await f.flush();await opening;await f.flush();
 assert.deepEqual(f.prompts,[]);assert.equal(f.draft.state.conflict,false);
 assert.equal(f.shell.state.draft,'typed during restore');assert.equal(f.row(key).text,'typed during restore');
});

test('an empty saved copy with no typed text gives no prompt',async()=>{
 const f=fixture(),key='["origin","owner","agent","empty"]';
 await f.seed(key,'');await f.open(key);
 assert.deepEqual(f.prompts,[]);assert.equal(f.shell.state.draft,'');
 // Another window sends the draft this one restored and clears the row; this window then clears
 // its composer too. Its clear is refused (stale receipt) and the newer copy it reads is empty.
 const g=fixture(),room='["origin","owner","agent","shared"]';
 await g.seed(room,'Old words');await g.open(room);assert.equal(g.shell.state.draft,'Old words');
 const other=otherWindowRow(room,'','other-window-clear');g.setRaw(room,other);
 g.type('');await g.flush();
 assert.deepEqual(g.prompts,[],'an empty copy beside an empty composer is not a choice');
 assert.equal(g.draft.state.conflict,false);assert.equal(g.draft.state.message,'');assert.equal(g.shell.state.draft,'');
 assert.equal(g.raw(room),other,'nothing is written over the other window\'s clear');
 // The fresh receipt it read is the one the next edit saves with.
 g.type('Next message');await g.flush();
 assert.equal(g.row(room).text,'Next message');assert.deepEqual(g.prompts,[]);
});

test('a non-empty saved copy that differs from the typed text is still offered for review',async()=>{
 const f=fixture(),key='["origin","owner","agent","kept"]';
 await f.seed(key,'Earlier words');
 f.shell.state.draft='hi';await f.open(key);
 assert.equal(f.draft.state.conflict,true);assert.equal(f.draft.state.savedText,'Earlier words');assert.equal(f.draft.state.message,SAVED_AVAILABLE);
 assert.deepEqual(f.prompts.at(-1),{savedText:'Earlier words',message:SAVED_AVAILABLE});
 assert.equal(f.shell.state.draft,'hi');assert.equal(f.row(key).text,'Earlier words','neither copy is overwritten');
 // Whitespace around real words does not make the copy empty.
 const w=fixture();w.setRaw(key,otherWindowRow(key,'  Earlier words\n','padded'));w.shell.state.draft='hi';await w.open(key);
 assert.equal(w.draft.state.conflict,true);assert.equal(w.draft.state.savedText,'  Earlier words\n');assert.equal(w.row(key).text,'  Earlier words\n');
 // A message that may already have been sent is reviewed too, even an empty one.
 const g=fixture();g.setRaw(key,JSON.stringify({version:1,binding:key,revision:'held',text:'In flight elsewhere',sending:true}));
 g.shell.state.draft='hi';await g.open(key);
 assert.equal(g.draft.state.conflict,true);assert.equal(g.draft.state.unsettled,true);assert.equal(g.draft.state.savedText,'In flight elsewhere');
 const u=fixture();u.setRaw(key,JSON.stringify({version:1,binding:key,revision:'held-empty',text:'',sending:true}));
 u.shell.state.draft='hi';await u.open(key);
 assert.equal(u.draft.state.conflict,true);assert.equal(u.draft.state.unsettled,true);
});

test('another window clearing the row never makes this window prompt: its typing is kept on the newer row',async()=>{
 // The app and the assistant surface share one slot. The assistant window sends; the app window's
 // receipt is now old, so its next keystroke is refused and the copy it reads is the empty clear.
 const raws=new Map(),key='["origin","owner","agent","assist"]',app=fixture(raws),assist=fixture(raws);
 await app.seed(key,'Earlier message','');
 await app.open(key);await assist.open(key);
 assist.type('What is the weather');await assist.flush();await assist.send('What is the weather');
 const cleared=app.raw(key);assert.equal(app.row(key).text,'');
 app.type('hi');await app.flush();
 assert.deepEqual(app.prompts,[],'no review over the other window\'s empty row');
 assert.equal(app.draft.state.conflict,false);assert.equal(app.draft.state.message,'');assert.equal(app.shell.state.draft,'hi');
 assert.equal(app.row(key).text,'hi');
 // The refused write named the old row; the kept text replaced only the row it read.
 const writes=app.exchanges.filter(w=>w.value.includes('"hi"'));
 assert.deepEqual(writes.map(w=>w.saved),[false,true]);assert.notEqual(writes[0].expected,cleared);assert.equal(writes[1].expected,cleared);
 // The other window's own receipt is now old: it cannot overwrite the text this window admitted,
 // and it is offered that text for review instead.
 assist.type('Something else');await assist.flush();
 assert.equal(app.row(key).text,'hi');assert.equal(assist.draft.state.conflict,true);assert.equal(assist.draft.state.savedText,'hi');
 // The other window typing and then clearing (a newer empty row) is no choice either.
 const raws2=new Map(),a=fixture(raws2),b=fixture(raws2);
 await a.seed(key,'Sent','');await a.open(key);await b.open(key);
 b.type('B typing');await b.flush();b.type('');await b.flush();
 a.type('hi');await a.flush();
 assert.deepEqual(a.prompts,[]);assert.equal(a.row(key).text,'hi');assert.equal(a.shell.state.draft,'hi');
});

test('keeping text over an empty copy uses only the receipt it read, for its own binding',async()=>{
 // Another window admits its own draft first: this window's save is refused, nothing is
 // overwritten, and the admitted copy is offered for review.
 const a=fixture(),key='["origin","owner","agent","race"]';
 await a.seed(key,'Sent','');
 const admitted=otherWindowRow(key,'Window B words','window-b');
 a.beforeNextExchange(()=>a.setRaw(key,admitted));
 a.shell.state.draft='hi';await a.open(key);
 assert.equal(a.raw(key),admitted);assert.equal(a.shell.state.draft,'hi');
 assert.equal(a.draft.state.conflict,true);assert.equal(a.draft.state.savedText,'Window B words');
 // Another window clears again (a newer empty row): the old empty receipt is refused, never
 // matched by its text, and the text is saved only against the newer row it then read.
 const b=fixture();
 await b.seed(key,'Sent','');const oldEmpty=b.raw(key),newerEmpty=otherWindowRow(key,'','newer-clear');
 b.beforeNextExchange(()=>b.setRaw(key,newerEmpty));
 b.shell.state.draft='hi';await b.open(key);
 assert.deepEqual(b.exchanges.slice(2).map(w=>[w.expected,w.saved]),[[oldEmpty,false],[newerEmpty,true]]);
 assert.deepEqual(b.prompts,[]);assert.equal(b.row(key).text,'hi');assert.equal(b.shell.state.draft,'hi');assert.equal(b.draft.state.conflict,false);
 // No write named for the old empty row was ever admitted, and the receipt this window holds now
 // is refused in turn when a third window writes words first: those are offered, not replaced.
 b.setRaw(key,otherWindowRow(key,'Third window words','third'));
 b.type('hi again');await b.flush();
 assert.equal(b.row(key).text,'Third window words');assert.equal(b.draft.state.conflict,true);assert.equal(b.draft.state.savedText,'Third window words');
 assert.ok(!b.exchanges.some(w=>w.saved&&w.expected===oldEmpty),'the old empty receipt never matched');
 // The text is saved for the binding that opened; another conversation's draft is untouched.
 const c=fixture(),one='["origin","owner","agent","one"]',two='["origin","owner","agent","two"]';
 await c.seed(one,'');await c.seed(two,'Other conversation');const otherRaw=c.raw(two);
 c.shell.state.draft='hi';await c.open(one);
 assert.equal(c.row(one).text,'hi');assert.equal(c.row(one).binding,one);assert.equal(c.raw(two),otherRaw);
 assert.ok(c.exchanges.filter(w=>w.binding===two).length===1,'only the seed wrote the other binding');
});

test('a write that keeps failing is kept once more, then keeps its notice and explicit retry',async()=>{
 const f=fixture(),key='["origin","owner","agent","full"]';
 await f.seed(key,'Sent','');const cleared=f.raw(key);
 f.failWrites(true);f.shell.state.draft='hi';await f.open(key);
 // The keep when the draft opens, and one more after it failed: no loop, however often it renders.
 assert.equal(f.exchanges.filter(w=>w.failed).length,2);
 for(let n=0;n<3;n++){f.shell.componentDidUpdate();f.shell.setState({});await f.flush();}
 assert.equal(f.exchanges.filter(w=>w.failed).length,2,'no retry loop');
 assert.equal(f.draft.state.conflict,true);assert.equal(f.draft.state.message,NOT_SAVED);
 assert.equal(f.shell.state.draft,'hi');assert.equal(f.raw(key),cleared);
 // The explicit retry saves once storage works again.
 f.failWrites(false);f.draft.keepCurrent();await f.flush();
 assert.equal(f.row(key).text,'hi');assert.equal(f.draft.state.conflict,false);
 // The bound is for the same text in a row only: later typing that is refused by another window's
 // clear is kept again.
 f.setRaw(key,otherWindowRow(key,'','another-clear'));
 f.type('hi, later');await f.flush();
 assert.equal(f.row(key).text,'hi, later');assert.equal(f.draft.state.conflict,false);
});

test('clearing the composer beside an empty copy that could not be saved over dismisses it',async()=>{
 const f=fixture(),key='["origin","owner","agent","cleared"]';
 await f.seed(key,'Sent','');const cleared=f.raw(key);await f.open(key);
 f.failWrites(true);f.type('x');await f.flush();
 assert.equal(f.draft.state.conflict,true);assert.equal(f.draft.state.savedText,'');
 const failed=f.exchanges.filter(w=>w.failed).length;
 f.type('');await f.flush();
 assert.equal(f.draft.state.conflict,false);assert.equal(f.draft.state.message,'');assert.equal(f.shell.state.draft,'');
 assert.equal(f.exchanges.filter(w=>w.failed).length,failed,'nothing is written to dismiss it');assert.equal(f.raw(key),cleared);
 // A non-empty copy beside a cleared composer is still a choice.
 const g=fixture();await g.seed(key,'Sent','');await g.open(key);
 g.beforeNextExchange(()=>g.setRaw(key,otherWindowRow(key,'Other window words','ow')));
 g.type('abc');await g.flush();g.type('');await g.flush();
 assert.equal(g.draft.state.conflict,true);assert.equal(g.draft.state.savedText,'Other window words');assert.equal(g.row(key).text,'Other window words');
});
