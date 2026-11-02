import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {cloudVoiceViewFixture} from './fixtures/cloud-voice-view.mjs';

// The actual production template and DCLogic renderer, closed presentation ports only.
test('actual voice view shows activity while healthy and a failure ends quietly, also when its stop is refused',async()=>{
 const template=fs.readFileSync('apps/app/src/prototype/template.html','utf8');
 const start=template.indexOf('<sc-if value="{{legacyChatRecorder}}">');
 const end=template.indexOf('<sc-if value="{{panelComposer}}">',start);
 assert.ok(start>=0&&end>start);
 const fragment='<div class="os"><div data-screen="1">'+template.slice(start,end)+'</div></div>';
 const bundle=await build({stdin:{contents:`import React from 'react';import{renderToStaticMarkup}from'react-dom/server';import{DCLogic}from'./apps/app/src/prototype/dc-lite.js';import{VoiceActivity}from'./apps/app/src/prototype/voice-activity.tsx';export const createActivity=props=>React.createElement(VoiceActivity,props);class Fixture extends DCLogic{renderVals(){return this.props.values;}}export const render=values=>renderToStaticMarkup(React.createElement(Fixture,{phoneSurface:true,values}));`,resolveDir:process.cwd(),loader:'js'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'actual-voice-template',setup(b){b.onResolve({filter:/template\.html\?raw$/},()=>({path:'voice',namespace:'actual-template'}));b.onLoad({filter:/.*/,namespace:'actual-template'},()=>({contents:'export default '+JSON.stringify(fragment),loader:'js'}));}}]});
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'voice-copy-markup-')),file=path.join(temporary,'renderer.cjs'),before=globalThis.document;
 const env=new JSDOM('<!doctype html>'),beforeMedia=globalThis.matchMedia;
 let f;
 globalThis.matchMedia=()=>({matches:true});
 try{
  globalThis.document=env.window.document;fs.writeFileSync(file,bundle.outputFiles[0].text);
  const {render,createActivity}=createRequire(import.meta.url)(file);
  f=cloudVoiceViewFixture({cloudProfile:true});
  f.box.React={createElement:(_component,props)=>createActivity(props)};f.box.VoiceActivity=()=>null;
  f.box.BatchVoiceConversation=class {
    constructor(options){f.batchOptions=options;}
    async start(){f.initialView=f.renderChat();f.batchOptions.onState({phase:'listening'});}
    async stop(){await f.stopGate;if(f.cleanupError)throw f.cleanupError;}
    recheck(){}
  };
  await f.shell.startVoice();
  for(const state of ['starting','listening']){
   const model=state==='starting'?f.initialView:f.renderChat();
   assert.equal(model.state,state);assert.notEqual(model.activity,null);
   const doc=new JSDOM(render({inlineChatRecorder:true,chatRecorder:model})).window.document;
   // Speech routing is disclosed in Settings > Voice; the live composer has no details panel.
   assert.equal(doc.querySelector('details'),null);assert.equal(doc.querySelector('[role="alert"]'),null);
   assert.ok(doc.querySelector('[aria-label="Stop voice conversation"]'));
   assert.equal(doc.querySelectorAll('[data-alpha-voice-animation]').length,1);
   assert.equal(doc.querySelectorAll('[aria-label="Voice activity"]').length,1);
  }
  // A refused sign-in is terminal and ends voice quietly. While its stop is pending the panel says
  // only that, and a refused stop ends the same way: never a claim of mic-off, never an error frame.
  let settleStop;f.stopGate=new Promise(resolve=>settleStop=resolve);f.cleanupError=Error('Cleanup could not be confirmed');
  f.batchOptions.onState({phase:'error',error:Object.assign(new Error('PRIVATE_PROVIDER_BODY'),{code:'voice-http-401'})});
  for(let count=0;count<10;count++)await f.tick();
  const held=f.renderChat();assert.equal(held.state,'stopping');assert.equal(held.problem,false);
  assert.equal(held.muted,'mixed');assert.equal(held.muteLabel,'Microphone status unconfirmed');
  const heldDoc=new JSDOM(render({inlineChatRecorder:true,chatRecorder:held})).window.document;
  assert.equal(heldDoc.querySelector('[role="alert"]'),null);assert.doesNotMatch(heldDoc.body.textContent,/Could not confirm|Close the app|PRIVATE/);
  assert.ok(heldDoc.querySelector('[aria-label="Stop voice conversation"]'));
  settleStop();for(let count=0;count<10;count++)await f.tick();
  assert.equal(f.renderChat(),null,'the refused stop ends voice quietly');assert.deepEqual(f.shell.messages,[]);
  assert.equal(f.starts,0);assert.equal(f.uploads,0);
  // Legacy dictation has named failure states, not just 'error'. Its failure flag must drive
  // the same quiet presentation without renaming the state or bypassing any action guard.
  const adapter=fs.readFileSync('apps/app/src/prototype/voice-adapter.ts','utf8');
  assert.match(adapter,/state: failure \|\| stage,\s+failed: Boolean\(error \|\| failure\)/);
  assert.match(adapter,/recorder\.problem=recorder\.failed===true/);
  for(const state of ['denied','no-speech','local-agent','recognition','permission-denied']){
   const model={...held,state,failed:true,statusLines:[],lines:[{t:'INTERNAL_FAILURE_DETAIL'}]};
   const legacy=new JSDOM(render({legacyChatRecorder:true,chatRecorder:model})).window.document;
   assert.equal(legacy.querySelector('[role="alert"]'),null);
   assert.doesNotMatch(legacy.body.textContent,/INTERNAL_FAILURE_DETAIL/);
   assert.equal(model.state,state,'failure identity is unchanged');
  }
 }finally{f?.close();globalThis.matchMedia=beforeMedia;globalThis.document=before;env.window.close();fs.rmSync(temporary,{recursive:true,force:true});}
});
