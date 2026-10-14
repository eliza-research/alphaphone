import {markTtsPlaybackStarted,markTtsPlaybackEnded} from '../../../../.eliza/client-features/packages/ui/src/voice/tts-playback-activity.ts';
import {Capacitor} from '@capacitor/core';
import {speakLocalText} from '../local-speech-playback';
import {createOnDeviceVoice} from './local-voice';
import {connectionController} from './connection-ui';

// Maps, workflows and reviewed agent speech share a retirement barrier. A new
// request cannot overtake unconfirmed native cleanup, even after cancellation.
let appSpeechRetirement:Promise<void>=Promise.resolve();
export async function speakDeviceText(text:string,signal:AbortSignal,onStarted?:()=>void,queue=false,assertCurrent?:()=>void){
  const binding=()=>JSON.stringify([connectionController.getSnapshot().session?.sessionId,connectionController.getCloudEnvironment(),connectionController.getCloudClient()?.sessionId,connectionController.getCloudClient()?.credentialId,document.documentElement.dataset.connectionMode]);
  const selected=binding(),owned=new AbortController();
  const cancel=()=>owned.abort(signal.reason),retire=()=>owned.abort(new DOMException('Voice review changed','AbortError'));
  if(signal.aborted)cancel();
  const current=()=>{
    owned.signal.throwIfAborted();assertCurrent?.();
    if(selected!==binding()||document.hidden||document.documentElement.dataset.devBackground==='true'||connectionController.getSnapshot().open||Array.from(document.querySelectorAll('[aria-label="Unlock with fingerprint"], [aria-label="Wake"]')).some(element=>element.getClientRects().length))throw new DOMException('Voice review changed','AbortError');
  };
  current();
  const voice=createOnDeviceVoice();
  if(!voice)throw Error('On-device speech is unavailable. The text is still available.');
  const previous=appSpeechRetirement;
  let admitted=false;
  const interrupted=new Promise<never>((_,reject)=>{owned.signal.addEventListener('abort',()=>{if(!admitted)reject(owned.signal.reason);},{once:true});});void interrupted.catch(()=>{});
  const changed=()=>{try{current();}catch(error){owned.abort(error);}},unsubscribe=connectionController.subscribe(changed);
  document.addEventListener('visibilitychange',changed);signal.addEventListener('abort',cancel,{once:true});window.addEventListener('alpha:device-state',retire);window.addEventListener('pagehide',retire);if(signal.aborted)cancel();changed();
  const pending=(async()=>{
    await previous;current();admitted=true;let marked=false;
    try{
      if(!await voice.ready(owned.signal))throw Error('On-device speech models are unavailable. The text is still available.');
      current();
      await speakLocalText(text,owned.signal,()=>{current();marked=true;markTtsPlaybackStarted();onStarted?.();},queue,{execution:Capacitor.isNativePlatform()?'device':'browser',assertCurrent:current});
      current();
    }finally{if(marked)markTtsPlaybackEnded();}
  })();
  appSpeechRetirement=pending.catch(error=>{if(error?.code==='speech-cleanup-unconfirmed')throw error;});void appSpeechRetirement.catch(()=>{});
  try{await Promise.race([pending,interrupted]);}
  finally{unsubscribe();document.removeEventListener('visibilitychange',changed);signal.removeEventListener('abort',cancel);window.removeEventListener('alpha:device-state',retire);window.removeEventListener('pagehide',retire);}
}
