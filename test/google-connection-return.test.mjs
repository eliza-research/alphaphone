import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {watchGoogleConnectionReturn,sameGoogleConnectionReturnBinding} from '../apps/app/src/runtime/google-connection-return.ts';

const ui=readFileSync(process.env.ALPHA_GOOGLE_RETURN_UI_SOURCE||'apps/app/src/runtime/google-connection-ui.tsx','utf8');
const accountsSource=stripTypeScriptTypes(readFileSync('apps/app/src/runtime/google-accounts.ts','utf8'),{mode:'transform'}).replace(/^import[^;]+;\n/gm,'').replace(/^export /gm,'');
const createGoogleAccounts=vm.runInNewContext(accountsSource+';createGoogleAccounts',{DOMException,Event});
const loadCode=stripTypeScriptTypes(ui.slice(ui.indexOf(' async function load()'),ui.indexOf('\n useEffect(()=>{if(!open)return;void load();')),{mode:'transform'});
const connectCode=stripTypeScriptTypes(ui.slice(ui.indexOf(' async function connect('),ui.indexOf(' async function disconnect(')),{mode:'transform'});
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function fixture({heldStatus=false,heldOpen=false}={}){
 let foreground=true,panelOpen=true,revision=0,nativeListener,removed=0,visibility,focus;
 const registration=deferred(),status=deferred(),opening=deferred(),published=[],notices=[],scopeCalls=[];
 let reads=0,initiations=0,opens=0,statusSignal,loadPromise;
 const client={environment:'production',async gmailAccounts(signal){reads++;statusSignal=signal;return heldStatus?status.promise:[{connected:true,label:'Synthetic account',grantedCapabilities:['google.gmail.triage']}];},async initiateGoogle(signal,calendar,gmail){signal.throwIfAborted();initiations++;scopeCalls.push([calendar,gmail]);return 'https://accounts.google.com/o/oauth2/v2/auth';}};
 const binding={client,environment:'production',userId:'owner',organizationId:'tenant',sessionId:'session',credentialId:'credential'};
 let current={...binding};const active={current:null};
 const liveCloud=()=>current?{client:current.client,sessionId:current.sessionId,credentialId:current.credentialId}:null;
 const globals={AbortController,DOMException,createGoogleAccounts,sameGoogleConnectionReturnBinding,active,binding,cloud:liveCloud(),key:{environment:'production',userId:'owner',organizationId:'tenant'},serviceName:'Cloud',googleConnectionController:{getSnapshot:()=>panelOpen,close:()=>{panelOpen=false;}},connectionController:{getCloudClient:liveCloud,rejectCloudSession(){throw Error('Unexpected sign-in mutation');},openCloudAccount(){throw Error('Unexpected sign-in');}},currentGoogleConnectionReturnBinding:()=>current,
  setAccounts:rows=>published.push(rows),setSources(){},setConfirm(){},setBusy(){},setNotice:text=>notices.push(text),
  GoogleCalendarReader:class{constructor(){throw Error('No provider reads in this fixture');}},
  openConnectionBrowser:async()=>{opens++;return heldOpen?opening.promise:undefined;},returnWatch:{current:null},
 };
 vm.createContext(globals);vm.runInContext(loadCode+'\n'+connectCode+';globalThis.load=load;globalThis.connect=connect;',globals);
 const watcher=watchGoogleConnectionReturn({binding,current:()=>current,foreground:()=>foreground,refresh:()=>{revision++;active.current?.abort();loadPromise=globals.load();},
  onVisibilityChange:listener=>{visibility=listener;return()=>{visibility=undefined;};},onFocus:listener=>{focus=listener;return()=>{focus=undefined;};},
  onNativeResume:listener=>{nativeListener=listener;return registration.promise;},
 });globals.returnWatch.current=watcher;
 return {binding,client,watcher,globals,published,notices,scopeCalls,
  get reads(){return reads;},get initiations(){return initiations;},get opens(){return opens;},get revision(){return revision;},get removed(){return removed;},get signal(){return statusSignal;},get loadPromise(){return loadPromise;},
  registered(){registration.resolve({remove(){removed++;}});return watcher.ready;},
  background(){foreground=false;visibility?.();},foreground(){foreground=true;visibility?.();},nativeResume(){nativeListener?.();},focus(){focus?.();},
  change(patch){current={...current,...patch};},close(){panelOpen=false;watcher.close();active.current?.abort();},
  releaseStatus(){status.resolve([{connected:true,label:'Synthetic account',grantedCapabilities:['google.gmail.triage']}]);},releaseOpen(){opening.resolve();},
 };
}

test('retained native resume after registration and arming cannot consume a return before background or open completion',async()=>{
 const f=fixture({heldOpen:true});await f.registered();const connecting=f.globals.connect();for(let i=0;i<8&&f.opens===0;i++)await Promise.resolve();assert.equal(f.opens,1);
 f.nativeResume();f.focus();assert.equal(f.reads,0);assert.equal(f.revision,0);
 f.background();f.nativeResume();assert.equal(f.reads,0,'still background');f.releaseOpen();await connecting;assert.equal(f.reads,0,'external promise completion is not foreground');
 f.foreground();f.nativeResume();f.focus();await f.loadPromise;assert.equal(f.reads,1);assert.equal(f.revision,1);assert.equal(f.initiations,1);f.close();
});
test('immediate browser-open completion leaves a pending genuine return and duplicate events load once',async()=>{
 const f=fixture();await f.registered();await f.globals.connect();assert.equal(f.opens,1);assert.equal(f.reads,0);f.nativeResume();f.focus();assert.equal(f.reads,0);
 f.background();f.foreground();f.nativeResume();f.focus();await f.loadPromise;assert.equal(f.reads,1);assert.equal(f.published.at(-1)[0].connected,true);assert.equal(f.initiations,1);f.close();
});
test('foreground events without an authorization attempt never load connections',async()=>{
 const f=fixture();await f.registered();f.background();f.foreground();f.nativeResume();f.focus();assert.equal(f.reads,0);f.close();
});
for(const [field,value] of [['environment','staging'],['userId','other-owner'],['organizationId','other-tenant'],['sessionId','other-session'],['credentialId','other-credential'],['client',{}]]){
 test(`${field} change before foreground retires the original pending return`,async()=>{
  const f=fixture();await f.globals.connect();f.background();f.change({[field]:value});f.foreground();f.nativeResume();assert.equal(f.reads,0);assert.equal(f.revision,0);f.close();
 });
 test(`${field} change during canonical status cannot publish a connected account`,async()=>{
  const f=fixture({heldStatus:true});await f.globals.connect();f.background();f.foreground();assert.equal(f.reads,1);f.change({[field]:value});f.releaseStatus();await f.loadPromise;assert.ok(f.published.every(rows=>rows.length===0));f.close();
 });
}
test('panel close aborts canonical read and ignores all late lifecycle/status callbacks',async()=>{
 const f=fixture({heldStatus:true});await f.globals.connect();f.background();f.foreground();assert.equal(f.reads,1);f.close();assert.equal(f.signal.aborted,true);f.releaseStatus();await f.loadPromise;f.nativeResume();f.focus();assert.equal(f.reads,1);assert.ok(f.published.every(rows=>rows.length===0));
});
test('cleanup removes a native listener whose registration resolves after the panel closed',async()=>{
 const f=fixture();f.close();await f.registered();assert.equal(f.removed,1);f.nativeResume();assert.equal(f.reads,0);f.close();assert.equal(f.removed,1);
});
test('ordinary cleanup removes a resolved native listener exactly once',async()=>{
 const f=fixture();await f.registered();f.close();f.close();assert.equal(f.removed,1);
});
test('permission requests are forwarded unchanged and no return starts another OAuth request',async()=>{
 const f=fixture();await f.globals.connect('modify','write');assert.equal(JSON.stringify(f.scopeCalls),JSON.stringify([['write','modify']]));f.background();f.foreground();await f.loadPromise;assert.equal(f.initiations,1);f.close();
});
test('a failed external open cancels only its own pending return',async()=>{
 const f=fixture();f.globals.openConnectionBrowser=async()=>{throw new DOMException('Cancelled','AbortError');};f.globals.connectionController.rejectCloudSession=()=>{};await f.globals.connect();f.background();f.foreground();assert.equal(f.reads,0);f.close();
});
test('the actual panel lifecycle wiring uses the existing native port and removes document/window listeners',()=>{
 assert.match(ui,/DailyApps\.addListener\('appResumed',listener\)/);assert.match(ui,/document\.addEventListener\('visibilitychange',listener\)/);assert.match(ui,/window\.addEventListener\('focus',listener\)/);assert.match(ui,/watcher\.close\(\).*active\.current\?\.abort\(\)/s);
 assert.ok(!ui.includes('appUrlOpen'));assert.ok(!ui.includes('google_connected'));assert.ok(!ui.includes('completeOAuth'));
});

test('a stale panel binding cannot initiate a new Google authorization',async()=>{
 const f=fixture();f.change({organizationId:'new-tenant'});await f.globals.connect();assert.equal(f.initiations,0);assert.equal(f.opens,0);f.close();
});
test('a binding change while an authorization URL is pending cannot arm or open the browser',async()=>{
 const f=fixture(),authorization=deferred();f.client.initiateGoogle=()=>authorization.promise;const connecting=f.globals.connect();await Promise.resolve();f.change({organizationId:'new-tenant'});authorization.resolve('https://accounts.google.com/o/oauth2/v2/auth');await connecting;assert.equal(f.opens,0);f.background();f.foreground();assert.equal(f.reads,0);f.close();
});

test('a still-referenced watcher from the prior panel generation cannot initiate under a freshly rendered binding',async()=>{
 const f=fixture();f.change({organizationId:'new-tenant'});f.globals.binding={...f.binding,organizationId:'new-tenant'};await f.globals.connect();assert.equal(f.initiations,0);assert.equal(f.opens,0);f.close();
});
