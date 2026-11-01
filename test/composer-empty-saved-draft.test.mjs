import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import {stripTypeScriptTypes} from 'node:module';
// The chat composer's own wiring (agent-adapter.ts: its draft helpers and the controller it builds
// on mount) over the shared controller and the shared compare-and-exchange rows, exactly as the pin
// projects them. Only the React state queue and the device slot are stand-ins.
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const ts=source=>stripTypeScriptTypes(source,{mode:'transform'});
const load=path=>import('data:text/javascript;base64,'+Buffer.from(ts(read(path))).toString('base64'));
const {DurableDraftController,DEFAULT_DURABLE_DRAFT_MESSAGES}=await load('.eliza/client-features/packages/ui/src/state/durable-draft-controller.ts');
const {compareExchangeDraftStore}=await load('.eliza/client-features/packages/ui/src/state/durable-draft.ts');
const adapter=read('apps/app/src/prototype/agent-adapter.ts');
const between=(source,start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b);};
const helpers=between(adapter,'function createdFromSlot(','const preDispatchRefusals=');
const mount=between(adapter,'    this.composerDraft=new AssistantDraftController(','    this.refreshDraftBinding=');
const SAVED_AVAILABLE='A saved draft is available. Review both copies.',NOT_SAVED='Draft was not saved. Review the saved copy before replacing it.';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(){
 // One raw compare-and-exchange slot per binding, like the Android secure slot; `before` runs
 // inside the next exchange, before it compares, as another window writing first would.
 const raws=new Map(),exchanges=[];let before,failing=false;
 const slot=binding=>({async read(){return raws.get(binding)??null;},async compareExchange(expected,value){if(failing){exchanges.push({binding,expected,value,failed:true});throw Error('Secure storage write failed');}const run=before;before=undefined;run?.();const saved=(raws.get(binding)??null)===expected;exchanges.push({binding,expected,value,saved});if(saved)raws.set(binding,value);return {status:saved?'saved':'conflict'};}});
 const stores=new Map(),assistantDraftStore=async binding=>{if(!stores.has(binding))stores.set(binding,compareExchangeDraftStore(binding,slot(binding)));return stores.get(binding);};
 const pending=[],prompts=[];let refreshes=0;
 const shell={live:true,state:{draft:''},startupDraft:null,reviewedSourceDraft:null,firstSendReview:undefined,S(){return this.state;},refreshDraftBinding(){refreshes++;},
  setState(update,callback){
   // Every render the composer gets: a conflict here is the review prompt above the composer.
   const draft=this.composerDraft?.state;if(draft?.conflict)prompts.push({savedText:draft.savedText,message:draft.message});
   pending.push(()=>{const patch=typeof update==='function'?update(this.state):update;if(patch)Object.assign(this.state,patch);callback?.();});
  }};
 const context=vm.createContext({AssistantDraftController:DurableDraftController,DEFAULT_DURABLE_DRAFT_MESSAGES,assistantDraftStore,shell});
 vm.runInContext(ts(`${helpers}\n(function(){${mount}}).call(shell);`),context);
 const draft=shell.composerDraft;
 const flush=async()=>{for(let n=0;n<40;n++){while(pending.length)pending.shift()();await tick();}};
 return {draft,shell,prompts,exchanges,flush,
  refreshes:()=>refreshes,
  type(text){shell.state.draft=text;draft.edit(text);},
  async seed(binding,...texts){const store=await assistantDraftStore(binding);let row=await store.read();for(const text of texts)row=await store.save(row,text);return row;},
  row:binding=>{const raw=raws.get(binding);return raw==null?null:JSON.parse(raw);},
  raw:binding=>raws.get(binding)??null,
  setRaw:(binding,value)=>raws.set(binding,value),
  beforeNextExchange(run){before=run;},
  failWrites(value){failing=value;},
  async open(binding){const opening=draft.open(binding);await flush();await opening;await flush();}};
}
const otherWindowRow=(binding,text,revision)=>JSON.stringify({version:1,binding,revision,text});

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
 // A message that may already have been sent is reviewed too.
 const g=fixture();g.setRaw(key,JSON.stringify({version:1,binding:key,revision:'held',text:'In flight elsewhere',sending:true}));
 g.shell.state.draft='hi';await g.open(key);
 assert.equal(g.draft.state.conflict,true);assert.equal(g.draft.state.unsettled,true);assert.equal(g.draft.state.savedText,'In flight elsewhere');
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
 // matched by its text or retried behind the owner's back, and the text is saved only against
 // the newer row once the owner keeps it.
 const b=fixture();
 await b.seed(key,'Sent','');const oldEmpty=b.raw(key),newerEmpty=otherWindowRow(key,'','newer-clear');
 b.beforeNextExchange(()=>b.setRaw(key,newerEmpty));
 b.shell.state.draft='hi';await b.open(key);
 assert.deepEqual(b.exchanges.slice(2).map(w=>[w.expected,w.saved]),[[oldEmpty,false]]);
 assert.equal(b.raw(key),newerEmpty);assert.equal(b.shell.state.draft,'hi');assert.equal(b.draft.state.message,NOT_SAVED);
 b.draft.keepCurrent();await b.flush();
 assert.deepEqual(b.exchanges.slice(2).map(w=>[w.expected,w.saved]),[[oldEmpty,false],[newerEmpty,true]]);
 assert.equal(b.row(key).text,'hi');assert.equal(b.draft.state.conflict,false);
 // The text is saved for the binding that opened; another conversation's draft is untouched.
 const c=fixture(),one='["origin","owner","agent","one"]',two='["origin","owner","agent","two"]';
 await c.seed(one,'');await c.seed(two,'Other conversation');const otherRaw=c.raw(two);
 c.shell.state.draft='hi';await c.open(one);
 assert.equal(c.row(one).text,'hi');assert.equal(c.row(one).binding,one);assert.equal(c.raw(two),otherRaw);
 assert.ok(c.exchanges.filter(w=>w.binding===two).length===1,'only the seed wrote the other binding');
});

test('a failed write of typed text keeps its notice and explicit retry, and is not repeated',async()=>{
 const f=fixture(),key='["origin","owner","agent","full"]';
 await f.seed(key,'Sent','');const cleared=f.raw(key);
 f.failWrites(true);f.shell.state.draft='hi';await f.open(key);
 assert.equal(f.exchanges.filter(w=>w.failed).length,1,'one write, no retry loop');
 assert.equal(f.draft.state.conflict,true);assert.equal(f.draft.state.message,NOT_SAVED);
 assert.equal(f.shell.state.draft,'hi');assert.equal(f.raw(key),cleared);
 // The explicit retry saves once storage works again.
 f.failWrites(false);f.draft.keepCurrent();await f.flush();
 assert.equal(f.row(key).text,'hi');assert.equal(f.draft.state.conflict,false);
});
