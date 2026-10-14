import {Capacitor} from '@capacitor/core';
import {registerPlugin} from './platform-plugins';
import {planLocalSpeech} from './runtime/local-speech-text';
/** Preflight the complete native passage, then await every owned chunk. */
export async function speakLocalText(text:string,signal:AbortSignal,onStarted?:()=>void,queue=false,requirements?:{execution?:'device'|'browser';assertCurrent:()=>void}){
 signal.throwIfAborted();const native=Capacitor.isNativePlatform(),chunks=native?planLocalSpeech(text):[text],voice=registerPlugin<any>('AlphaVoiceCloud');
 const controller=new AbortController(),cancel=()=>controller.abort(signal.reason);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
 const timer=setTimeout(()=>controller.abort(Error('Speech did not finish.')),20*60*1000);let started=false;
 try{for(const chunk of chunks){controller.signal.throwIfAborted();await speakChunk(voice,native,chunk,controller.signal,()=>{if(!started){started=true;onStarted?.();}},queue,requirements,undefined,native);}}
 finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);}
}
async function speakChunk(voice:any,native:boolean,text:string,signal:AbortSignal,onStarted:()=>void,queue:boolean,requirements?:{execution?:'device'|'browser';assertCurrent:()=>void},prepare?:(requestId:string)=>Promise<{playbackId:string;execution?:string}>,strictDrain=false){
 const requestId=crypto.randomUUID();let playbackId:string|undefined,active=true,cleanup:Promise<void>|undefined;
 const handles=new Set<{remove:()=>Promise<void>}>();
 const bounded=(run:()=>Promise<unknown>)=>new Promise<void>(resolve=>{const timer=setTimeout(resolve,500);Promise.resolve().then(run).catch(()=>{}).finally(()=>{clearTimeout(timer);resolve();});});
 let interrupt!:(reason:unknown)=>void,ended!:()=>void,failed!:(error:Error)=>void;
 const interrupted=new Promise<never>((_,reject)=>interrupt=reject),finished=new Promise<void>((resolve,reject)=>{ended=resolve;failed=reject;});void interrupted.catch(()=>{});void finished.catch(()=>{});
 const media=(run:()=>Promise<unknown>)=>strictDrain?Promise.resolve().then(run).catch(cause=>{throw Object.assign(Error('Owned speech cleanup could not be confirmed.'),{code:'speech-cleanup-unconfirmed',cause});}):bounded(run);
 const dispose=()=>{if(cleanup)return cleanup;active=false;cleanup=Promise.all([...Array.from(handles,h=>bounded(()=>h.remove())),media(()=>voice.cancel({requestId})),...(playbackId||native||prepare?[media(()=>voice.stopPlayback({playbackId,requestId}))]:[])]).then(()=>{});void cleanup.catch(()=>{});handles.clear();return cleanup;};
 const abort=()=>{interrupt(signal.reason??new DOMException('Speech cancelled','AbortError'));void dispose();};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 const wait=(prepared=false)=>Promise.race([new Promise<void>(resolve=>setTimeout(resolve,100)),interrupted,...(prepared?[finished.then(()=>{throw Error('Speech finished while waiting for playback.');})]:[])]);
 try{
  for(const event of ['playbackEnded','playbackFailed','playbackStopped']){
   const pending=voice.addListener(event,(value:{playbackId:string;message?:string})=>{if(!active||!playbackId||value.playbackId!==playbackId)return;if(event==='playbackEnded')ended();else failed(Error(event==='playbackStopped'?'Speech was stopped before completion.':(!native&&typeof value.message==='string'?value.message:'Speech playback failed.')));}).then((handle:{remove:()=>Promise<void>})=>{if(active)handles.add(handle);else void bounded(()=>handle.remove());});
   await Promise.race([pending,interrupted]);signal.throwIfAborted();
  }
  for(;;){signal.throwIfAborted();requirements?.assertCurrent();try{
   const pending=(prepare?prepare(requestId):voice.synthesizeLocal({text,requestId,...(queue&&native?{replace:false}:{})})).then((result:{playbackId:string;execution?:string})=>{if(!active&&result.playbackId)void bounded(()=>voice.stopPlayback({playbackId:result.playbackId,requestId}));return result;});
   const result=await Promise.race([pending,interrupted]);playbackId=result.playbackId;if(requirements?.execution&&result.execution!==requirements.execution)throw Error('Invalid local speech execution');requirements?.assertCurrent();if(typeof playbackId!=='string'||!playbackId)throw Error('Speech preparation returned no playback identity');break;
  }catch(error){if(!queue||(error as {code?:string}).code!=='playback-busy')throw error;await wait();}}
  // Admission owns its precise refusal; cleanup can emit stopped before play rejects.
  // Terminal events still retire a prepared utterance while it waits for a busy speaker.
  for(;;){signal.throwIfAborted();requirements?.assertCurrent();try{await Promise.race([voice.play({playbackId,...(queue?{replace:false}:{})}),interrupted]);break;}catch(error){if(!queue||(error as {code?:string}).code!=='playback-busy')throw error;await wait(true);}}
  signal.throwIfAborted();requirements?.assertCurrent();onStarted();await Promise.race([finished,interrupted]);signal.throwIfAborted();
 }finally{signal.removeEventListener('abort',abort);await dispose();}
}

/** Shared owned playback for authorized Cloud/paired synthesis; never selects a provider. */
export async function playOwnedSpeech(voice:any,signal:AbortSignal,prepare:(requestId:string)=>Promise<{playbackId:string}>,check:()=>void,onStarted?:()=>void,strictDrain=false,queue=false){
 signal.throwIfAborted();check();const controller=new AbortController(),cancel=()=>controller.abort(signal.reason);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
 const timer=setTimeout(()=>controller.abort(Error('Speech did not finish.')),20*60*1000);
 try{await speakChunk(voice,Capacitor.isNativePlatform(),'',controller.signal,()=>{check();onStarted?.();},queue,{assertCurrent:check},prepare,strictDrain);check();}
 finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);}
}
