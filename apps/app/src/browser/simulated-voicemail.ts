import {speakLocalText} from '../local-speech-playback';
import {devSurfacesEnabled} from '../build-flags';
type Bag=Record<string,any>;
/** Local seed messages have transcripts rather than recordings. Read them with the local voice. */
export function installSimulatedVoicemail(phone:Bag){
 if(!devSurfacesEnabled)return ()=>{};
 let generation=0,owner:AbortController|undefined,api:Bag|undefined;
 const stop=(finished=false)=>{
  generation++;owner?.abort();owner=undefined;
  api?.set({playing:null,vpos:finished?1:0});
 };
 const play=async(row:Bag,currentApi:Bag)=>{
  if(currentApi.get('phone').playing===row.id){stop();return;}
  stop();api=currentApi;const epoch=generation;const speech=new AbortController();owner=speech;api.set({playing:row.id,vpos:0});
  try{
   await speakLocalText(row.text,speech.signal);if(epoch===generation)stop(true);
  }catch{if(epoch===generation)stop();}
 };
 const render=phone.render,leave=phone.onLeave,back=phone.back;
 phone.render=(state:Bag,currentApi:Bag)=>{
  const out=render(state,currentApi);
  const wrap=(fn:()=>unknown)=>()=>{stop();return fn();};
  out.vms=out.vms.map((item:Bag,index:number)=>({...item,recordingOnlyCss:'display:none',readingLabel:state.playing===state.vms[index].id?'Reading transcript':'Local transcript',playLabel:state.playing===state.vms[index].id?'Stop reading':'Read voicemail',play:()=>void play(state.vms[index],currentApi),toggle:wrap(item.toggle),del:wrap(item.del),call:wrap(item.call),msg:wrap(item.msg)}));
  out.tabs=out.tabs.map((tab:Bag)=>({...tab,pick:wrap(tab.pick)}));return out;
 };
 phone.onLeave=(currentApi:Bag)=>{stop();return leave?.(currentApi);};
 phone.back=(state:Bag,currentApi:Bag)=>{if(state.vmOpen)stop();return back?.(state,currentApi);};
 const retire=()=>stop(),visibility=()=>{if(document.hidden)stop();};
 window.addEventListener('pagehide',retire);window.addEventListener('alpha:device-state',retire);document.addEventListener('visibilitychange',visibility);window.addEventListener('alpha:dev-incoming-call',retire);
 return ()=>{stop();api=undefined;window.removeEventListener('pagehide',retire);window.removeEventListener('alpha:device-state',retire);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('alpha:dev-incoming-call',retire);};
}
