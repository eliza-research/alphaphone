import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from './fixtures/cloud-voice-view.mjs';

// The actual Maps adapter and shared guidance state machine with a closed voice port: failed
// guidance speech turns guidance off and repaints with no notice; spoken guidance changes nothing.
function maps(createOnDeviceVoice){
 const f={refreshes:0,notices:[]};
 class Screen{constructor(host){f.host=host;}refresh(){f.refreshes++;}notify(text){f.notices.push(text);}surface(){return {};}dispose(){}}
 const box={AbortController,console,createOnDeviceVoice,MapsScreenController:Screen,BackgroundNavigation:class {},NativeMapsLocation:class {},registerPlugin:()=>({}),Capacitor:{isNativePlatform:()=>false},window:{addEventListener(){},removeEventListener(){}},document:{addEventListener(){},removeEventListener(){}},bindAgentNavigation:()=>({dispose(){}}),mapsConnection:()=>({config:{status:'configured'}}),onMapsConnectionChange(){},locationPermissionGranted(){},shareMap(){},publishMapsSelection(){},clearMapsSelection(){},residentMapsNavigationPort(){},isAndroid:false,regionalMapsConfigured:false};
 load('../../../.eliza/client-features/plugins/plugin-maps/src/client/navigation-voice.ts',box,['SharedNavigationVoice'],source=>source.replace('class NavigationVoice','class SharedNavigationVoice'));
 load('maps/navigation-voice.ts',box,['NavigationVoice']);
 load('prototype/maps-adapter.ts',box,['installPrototypeMapsAdapter']);
 box.installPrototypeMapsAdapter(class {},{maps:{render:()=>({})}});
 return Object.assign(f,{tick:async()=>{for(let count=0;count<5;count++)await new Promise(resolve=>setTimeout(resolve,0));}});
}
for(const [name,voice] of [['no voice',()=>null],['playback not ready',()=>({playbackReady:async()=>false})],['speech refused',()=>({playbackReady:async()=>true,speak:async()=>{throw Error('PRIVATE_ENGINE_TEXT');}})]])
test(`guidance with ${name} turns off and repaints with no notice`,async()=>{
 const f=maps(voice);
 f.host.voice.update('step-1','Turn right');await f.tick();
 assert.equal(f.host.voice.enabled,false);assert.equal(f.refreshes,1);assert.deepEqual(f.notices,[]);
});
test('spoken guidance stays on with no repaint and no notice',async()=>{
 const spoken=[],f=maps(()=>({playbackReady:async()=>true,speak:async text=>{spoken.push(text);}}));
 f.host.voice.update('step-1','Turn right');await f.tick();
 assert.deepEqual(spoken,['Turn right']);assert.equal(f.host.voice.enabled,true);assert.equal(f.refreshes,0);assert.deepEqual(f.notices,[]);
});
