// Real Alpha entry adapter over the shared application. Browser cases cover
// native-component launch, responsive layout and retained editor interaction.
import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {tsImport} from 'tsx/esm/api';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<div id="root"></div>',{url:'https://example.test'});
for(const key of ['window','document','localStorage','HTMLElement','Node','MouseEvent'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {AlphaMobileApplication,registerCompatibilityViews}=await tsImport('../apps/app/src/product/AlphaMobileApplication.tsx',import.meta.url);
const {navigateMobileShell}=await tsImport('../.eliza/client-features/packages/ui/src/mobile-shell/navigation.ts',import.meta.url);
const {alphaViewKey}=await tsImport('../apps/app/src/product/alpha-product.ts',import.meta.url);
const views=Object.fromEntries(['inbox','calendar','browser','camera','photos','maps','notes','files','workflows','settings'].map(key=>[key,{label:key==='inbox'?'Inbox':key[0].toUpperCase()+key.slice(1),badge:()=>key==='inbox'}]));
registerCompatibilityViews(views);
let root;
afterEach(async()=>{if(root)await act(async()=>root.unmount());root=undefined;localStorage.clear();});
function mount(bridge){
 let refresh;const opened=[];
 const model={props:{theme:'light'},state:{view:null,stack:[],drawer:false,drawerQuery:'',assistant:'input'},S(){return this.state;},shellNav(){return this.state;},shellNavigate(action){return navigateMobileShell(this.state,action);},setState(patch){this.state={...this.state,...patch};refresh();},openView(key){opened.push(key);this.setState(this.shellNavigate({type:'open',view:key}));},goHome(){this.setState(this.shellNavigate({type:'home'}));},back(){this.setState(this.shellNavigate({type:'back'}));},vget(){return {};}};
 function Host(){const[,force]=React.useReducer(n=>n+1,0);refresh=force;return React.createElement(AlphaMobileApplication,{model,views,bridge,installedIcons:false,followInstalledApps:false,vals:{isOn:true,canonicalNotesWorkspace:React.createElement('textarea',{'aria-label':'Retained draft',defaultValue:'saved'})},parts:{hostProps:{},screenProps:{},header:null,cards:null,view:React.createElement('h1',null,model.state.view),assistant:React.createElement('input',{'aria-label':'Composer',defaultValue:'unsent'}),overlays:null}});}
 root=createRoot(document.getElementById('root'));return {model,opened,render:()=>act(async()=>root.render(React.createElement(Host)))};
}
const button=name=>[...document.querySelectorAll('button')].find(node=>node.getAttribute('aria-label')===name);
test('the production entry owns Home and All apps, preserving exact native launches and the current navigation owner',async()=>{
 const launched=[],apps=[{packageName:'com.android.settings',label:'Settings'}];let reads=0;
 const host=mount({list:async()=>{reads++;return {apps};},launch:async value=>{launched.push(value);}});await host.render();
 assert.equal(document.querySelectorAll('[data-mobile-application]').length,1);
 assert.equal(document.querySelectorAll('[data-mobile-shell-home]').length,1);
 assert.ok(button('Inbox'));assert.equal(reads,0,'fresh Home does not scan installed apps');
 const input=document.querySelector('input[aria-label="Composer"]');const retained=document.querySelector('textarea');retained.value='edited';
 await act(async()=>button('All apps').click());assert.equal(reads,1);assert.ok(document.querySelector('[role="dialog"]'));
 await act(async()=>button('Open Settings (com.android.settings)').click());assert.deepEqual(launched,[{packageName:'com.android.settings'}]);
 await act(async()=>button('Open Settings (Alpha Phone)').click());assert.deepEqual(host.opened,['settings']);assert.equal(host.model.state.view,'settings');
 await act(async()=>host.model.goHome());assert.equal(document.querySelector('input[aria-label="Composer"]'),input);assert.equal(document.querySelector('textarea').value,'edited');
 await act(async()=>button('All apps').click());await act(async()=>host.model.back());assert.equal(document.querySelector('[role="dialog"]'),null);
});
test('the actual root migrates installed legacy view favorites before its first read',async()=>{
 localStorage.setItem('alpha.launcher.favorites.v1',JSON.stringify({version:2,keys:['alpha:notes','alpha:workflows'],defaultPolicy:'alpha-apps'}));
 const host=mount({list:async()=>({apps:[]}),launch:async()=>{throw Error('must remain in app')}});await host.render();
 assert.deepEqual(JSON.parse(localStorage.getItem('alpha.launcher.favorites.v1')).keys,['alpha:notes','alpha:automations']);
 await act(async()=>button('Workflows').click());assert.equal(host.opened[0],alphaViewKey('automations'));assert.equal(host.model.state.view,'workflows');
});
