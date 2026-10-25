import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
// The real controller and compatibility helper run with WebView113's static
// AbortSignal surface. The canonical-client seam only forwards its fetch.
function fixture({wait=false}={}){
 const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const globals={AbortController,AbortSignal:{},DOMException,structuredClone};
 const helper={exports:{}};vm.runInNewContext(compile('apps/app/src/runtime/abort-signal.ts'),{...globals,exports:helper.exports,module:helper});
 const phases=[],snapshots=[],requests=[];let observedSignal;
 const port={sessionId:'s',identity:{ownerId:'o',agentId:'a',sessionId:'s',origin:'native'},current:()=>true,request:async(path,method,body,signal)=>{requests.push({path,method,body});observedSignal=signal;if(wait)return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));return {notes:[],revision:1};}};
 const controllerModule={exports:{}};
 const require=name=>name.includes('abort-signal')?helper.exports:{createNotesClient:api=>({readState:signal=>api.fetch('/api/notes/state',{method:'GET',signal})})};
 vm.runInNewContext(compile('apps/app/src/prototype/canonical-notes-controller.ts'),{...globals,exports:controllerModule.exports,module:controllerModule,require});
 const controller=new controllerModule.exports.CanonicalNotesController(port,{phase:value=>phases.push(value),snapshot:value=>snapshots.push(value)});
 return {controller,phases,snapshots,requests,signal:()=>observedSignal};
}
test('Notes reaches ready and dispatches exactly once without AbortSignal.any',async()=>{const f=fixture();await f.controller.refresh();assert.deepEqual(f.phases,['loading','ready']);assert.equal(f.requests.length,1);assert.equal(f.requests[0].path,'/api/notes/state');assert.equal(f.controller.revision,1);f.controller.retire();});
test('retiring a pending Notes read still cancels the request on old WebView',async()=>{const f=fixture({wait:true});const pending=f.controller.refresh();await Promise.resolve();assert.equal(f.requests.length,1);f.controller.retire();await assert.rejects(pending);assert.equal(f.signal().aborted,true);assert.equal(f.snapshots.length,0);assert.equal(f.controller.current,false);});
test('the affected app-record, automation and reminder paths use the same fallback',()=>{const source=fs.readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8');assert.doesNotMatch(source,/AbortSignal\.any\(/);assert.match(source,/bounded=anyAbortSignal\(\[signal,controller\.signal\]\)/);for(const file of ['agent-calendar-client.ts','owner-reminder-notification-port.ts'])assert.doesNotMatch(fs.readFileSync('apps/app/src/runtime/'+file,'utf8'),/AbortSignal\.any\(/);});
