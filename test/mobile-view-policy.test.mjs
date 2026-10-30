import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {mobileViewFeatures} from './helpers/mobile-view-features.mjs';

test('actual registered implementations share the same ordinary availability on standalone and image',async()=>{
 const ordinary=await mobileViewFeatures(false),image=await mobileViewFeatures(true);
 for(const id of ['calendar','camera','files','inbox','notes','maps','photos','workflows','settings']){
  assert.equal(ordinary.isMvpView(id),true,id);assert.equal(image.isMvpView(id),true,id);
 }
 for(const host of [ordinary,image]){host.registerMobileCompatibilityView('new_plugin_view');assert.equal(host.isMvpView('new_plugin_view'),true);host.registerMobileCompatibilityView('not_implemented',false);assert.equal(host.isMvpView('not_implemented'),false);}
 assert.equal(ordinary.isMvpView('phone'),false);assert.equal(image.isMvpView('phone'),true);
 ordinary.admitImageContacts(true);assert.equal(ordinary.isMvpView('contacts'),false,'an ordinary install cannot elevate its native profile');
 image.admitImageContacts(true);assert.equal(image.isMvpView('contacts'),true);
 image.admitImageContacts(false);assert.equal(image.isMvpView('contacts'),false);
});

test('enabled-view enrollment derives from that same implemented set, never the product order',async()=>{
 const host=await mobileViewFeatures(false);
 host.registerMobileCompatibilityView('new_plugin_view');
 const source=stripTypeScriptTypes(readFileSync(new URL('../apps/app/src/runtime/device-view-profile.ts',import.meta.url),'utf8'),{mode:'transform'}).replace(/^import[^\n]*\n/,'').replace('export async function negotiateEnabledViews','async function negotiateEnabledViews');
 const negotiate=new Function('ENABLED_MVP_VIEWS',source+'\nreturn negotiateEnabledViews;')(host.ENABLED_MVP_VIEWS);
 const calls=[];
 await negotiate(1,async(path,body)=>{calls.push({path,body});return body?{version:1,profile:{version:1,revision:'11111111-1111-4111-8111-111111111111',views:body.views}}:{version:1,supportedViews:['calendar','camera','wallet','phone','new_plugin_view'],profile:null};},new AbortController().signal);
 assert.deepEqual(calls[1].body.views,['calendar','camera','new_plugin_view']);
 assert.equal(calls.length,2);
});
