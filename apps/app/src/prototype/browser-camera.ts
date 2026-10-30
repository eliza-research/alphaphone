import {BrowserCameraFocus} from '../browser/camera-focus';
import {browserDevProfile} from '../browser/dev-profile';
import {drawCameraFrame} from '../browser/camera-frame';
import {BrowserVideoCapture} from '../browser/video-capture';
import {browserPhotoLibrary} from '../product/browser-photo-library';
export {browserPhotoLibrary,browserLibrary,importBrowserPhoto,saveBrowserMedia} from '../product/browser-photo-library';
const finder='[aria-label="Viewfinder. Tap to focus, hold to ask Alpha, swipe to change mode"]';
const videoCapture=new BrowserVideoCapture();
let videoSession=0;
let videoSave:Promise<{path:string;duration:number;width:number;height:number;fileSize:number}>|undefined;
let preview:HTMLVideoElement|null=null,stream:MediaStream|null=null,generation=0;
let starting:AbortController|undefined;
let zoom=1,mirror=false;
const cameraFocus=new BrowserCameraFocus();
let screenLight:HTMLDivElement|undefined;
function clearScreenLight(){screenLight?.remove();screenLight=undefined;}
function setScreenLight(enabled:boolean){clearScreenLight();if(!enabled)return;const light=screenLight=document.createElement('div');light.dataset.alphaCameraLight='screen';light.setAttribute('aria-hidden','true');light.style.cssText='position:absolute;inset:0;z-index:2;pointer-events:none;box-shadow:inset 0 0 0 28px white,inset 0 0 70px 40px rgba(255,255,255,.8)';document.querySelector(finder)?.append(light);}
window.addEventListener('pagehide',()=>{clearScreenLight();cameraFocus.clear();});document.addEventListener('visibilitychange',()=>{if(document.hidden){clearScreenLight();cameraFocus.clear();}});

function release(video:HTMLVideoElement|null,media:MediaStream|null){media?.getTracks().forEach(track=>track.stop());if(video){video.pause();video.srcObject=null;video.remove();}}
export function mountBrowserCamera(){const frame=document.querySelector<HTMLElement>(finder);if(preview&&frame&&preview.parentElement!==frame)frame.prepend(preview);}
export const browserCamera={
 async startPreview(options:{direction:'front'|'back';resolution:{width:number;height:number};mirror:boolean}){
  void browserCamera.stopPreview();const token=++generation,controller=new AbortController();starting=controller;
  let ownStream:MediaStream|null=null,ownVideo:HTMLVideoElement|null=null;
  try{
   if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera access is unavailable here.');
   ownStream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:options.direction==='front'?'user':'environment',width:{ideal:options.resolution.width},height:{ideal:options.resolution.height}}});
   controller.signal.throwIfAborted();if(token!==generation)throw Error('Camera cancelled.');
   const frame=document.querySelector<HTMLElement>(finder);if(!frame)throw Error('Camera view is closed.');
   ownVideo=document.createElement('video');ownVideo.srcObject=ownStream;ownVideo.autoplay=true;ownVideo.playsInline=true;ownVideo.muted=true;
   ownVideo.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;z-index:1'+(options.mirror?';transform:scaleX(-1)':'');
   preview=ownVideo;stream=ownStream;zoom=1;mirror=options.mirror;frame.prepend(ownVideo);
   await new Promise<void>((resolve,reject)=>{
    const finish=(error?:unknown)=>{clearTimeout(timeout);controller.signal.removeEventListener('abort',abort);error?reject(error):resolve();};
    const abort=()=>finish(new DOMException('Camera cancelled.','AbortError'));
    const timeout=setTimeout(()=>finish(Error('Camera preview timed out.')),15000);
    controller.signal.addEventListener('abort',abort,{once:true});
    if(controller.signal.aborted){abort();return;}ownVideo!.play().then(()=>finish(),finish);
   });
   controller.signal.throwIfAborted();
   ownStream.getVideoTracks()[0].addEventListener('ended',()=>{if(token===generation){clearScreenLight();cameraFocus.clear();}},{once:true});
   const settings=ownStream.getVideoTracks()[0].getSettings();return {width:ownVideo.videoWidth,height:ownVideo.videoHeight,deviceId:settings.deviceId??''};
  }catch(error){release(ownVideo,ownStream);if(preview===ownVideo){preview=null;stream=null;}throw error;}
  finally{if(starting===controller)starting=undefined;}
 },
 async stopPreview(){cameraFocus.clear();clearScreenLight();++generation;++videoSession;videoCapture.cancel();starting?.abort();starting=undefined;release(preview,stream);preview=null;stream=null;},
 async capturePhoto(options?:{saveToGallery?:boolean}){const token=generation,video=preview;if(!video||!stream||video.readyState<2)throw Error('Camera is not ready.');
  const width=video.videoWidth,height=video.videoHeight;if(width<=0||height<=0||width*height>32_000_000)throw Error('Unsupported photo dimensions.');
  const canvas=drawCameraFrame(video,{zoom,mirror});
  const image=canvas.toDataURL('image/jpeg',0.85);if(!image.startsWith('data:image/jpeg;base64,'))throw Error('Photo encoding failed.');
  const photo={base64:image.slice('data:image/jpeg;base64,'.length),format:'jpeg',width,height};if(token!==generation)throw Error('Camera view changed.');
  if(!photo.base64||photo.base64.length>12_000_000)throw Error('Photo is too large to save in this app.');
  if(options?.saveToGallery===false)return photo;
  const row=await browserPhotoLibrary.importPhoto({image:'data:image/jpeg;base64,'+photo.base64,width:photo.width,height:photo.height},new AbortController().signal,()=>token===generation);
  return {...photo,path:'browser-photo:///'+row.id};
 },
 async switchCamera(options:{direction:'front'|'back'}){return browserCamera.startPreview({...options,resolution:{width:1280,height:720},mirror:options.direction==='front'});},
 async setZoom(input:{zoom:number}){if(!preview)throw Error('Start camera first.');if(!Number.isFinite(input.zoom)||input.zoom<1||input.zoom>8)throw Error('Digital zoom must be between 1× and 8×.');if(videoCapture.state().isRecording)throw Error('Stop recording before changing zoom.');cameraFocus.clear();zoom=input.zoom;preview.style.transform=`scale(${mirror?-zoom:zoom},${zoom})`;},
 flashAvailable(){return browserDevProfile||((stream?.getVideoTracks()[0]?.getCapabilities?.() as (MediaTrackCapabilities&{torch?:boolean})|undefined)?.torch===true);},
 lightingLabel(enabled:boolean){const torch=stream?.getVideoTracks()[0]?.getCapabilities?.() as (MediaTrackCapabilities&{torch?:boolean})|undefined;return `${browserDevProfile&&!torch?.torch?'Screen light':'Flash'} ${enabled?'on':'off'}`;},
 async setSettings(input:{settings:{flash:string}}){
  if(!['on','off'].includes(input.settings.flash))throw Error('Choose flash on or off.');
  const track=stream?.getVideoTracks()[0],token=generation,enabled=input.settings.flash==='on';if(!track)throw Error('Start camera first.');
  if(!(track.getCapabilities() as MediaTrackCapabilities&{torch?:boolean}).torch){if(browserDevProfile){setScreenLight(enabled);return;}if(enabled)throw Error('This camera does not expose a torch.');return;}clearScreenLight();
  await track.applyConstraints({advanced:[{torch:enabled} as MediaTrackConstraintSet&{torch:boolean}]});
  if(token!==generation)throw Error('Camera changed.');
  if((track.getSettings() as MediaTrackSettings&{torch?:boolean}).torch!==enabled){await track.applyConstraints({advanced:[{torch:false} as MediaTrackConstraintSet&{torch:boolean}]});throw Error('The camera could not confirm its torch setting.');}
 },
 async setFocusPoint(input:{x:number;y:number}){const frame=document.querySelector<HTMLElement>(finder),track=stream?.getVideoTracks()[0];if(!frame||!preview||!track)throw Error('Start camera first.');await cameraFocus.select(input,{frame,video:preview,track,zoom,mirror,development:browserDevProfile});},
 async startRecording(input:{audio?:boolean;maxDuration:number;maxFileSize:number}){if(!preview)throw Error('Start camera first.');++videoSession;videoSave=undefined;await videoCapture.start(preview,input,{zoom,mirror});},
 stopRecording(){
  if(videoSave)return videoSave;
  const token=generation,session=videoSession;
  videoSave=(async()=>{
   const clip=await videoCapture.stop();
   const path=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(clip.blob);});
   const row=await browserPhotoLibrary.retainVideo({path,duration:clip.duration,image:clip.image,width:clip.width,height:clip.height},new AbortController().signal,()=>token===generation&&session===videoSession);
   return {path:'browser-video:///'+row.id.slice(2),duration:clip.duration,width:clip.width,height:clip.height,fileSize:clip.blob.size};
  })();return videoSave;
 },
 async getRecordingState(){return videoCapture.state();},
};
