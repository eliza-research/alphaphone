import {type Page,type TestInfo} from '@playwright/test';
// Failure-only synthetic metadata. Never attach session/request bodies, text, headers, keys or PCM.
export async function observeVoiceFixture(page:Page){
 await page.evaluate(()=>{
  const w=window as any,c=w.Capacitor,prior=c.nativePromise;
  const events:Array<Record<string,unknown>>=[];w.live.failureNativeMetadata=events;
  const token=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_.-]{1,80}$/.test(value)?value:undefined;
  const errorMetadata=(error:any)=>({type:typeof error,name:token(error?.name),code:token(error?.code),causeName:token(error?.cause?.name),causeCode:token(error?.cause?.code)});
  c.nativePromise=async(plugin:string,method:string,input:any)=>{
   const tracked=(plugin==='Agent'&&['request','requestStream','cancelStream'].includes(method))||(plugin==='AlphaVoiceCloud'&&['startLiveCapture','stopLiveCapture','synthesizeLocal','play','stopPlayback','cancel','releaseLocalSpeech','cancelRecording'].includes(method));
   if(!tracked)return prior.call(c,plugin,method,input);
   const path=typeof input?.path==='string'?input.path:'';
   const operation=method==='requestStream'?'conversation-stream':path==='/api/asr/local-inference/live/status'?'live-status':path.startsWith('/api/asr/local-inference/live')?'live-asr':path==='/api/asr/local-inference/end-of-turn'?'end-of-turn':method==='request'?'other-native-request':'capture-or-playback';
   const row:Record<string,unknown>={plugin,method,operation,outcome:'pending'};
   if(events.length<64)events.push(row);
   try{const reply=await prior.call(c,plugin,method,input);row.outcome='resolved';if(typeof reply?.status==='number')row.status=reply.status;return reply;}
   catch(error){row.outcome='rejected';row.error=errorMetadata(error);throw error;}
  };
 });
}
export async function attachVoiceFailureMetadata(page:Page,info:TestInfo){
 let metadata:unknown;
 try{metadata=await page.evaluate(()=>{
  const w=window as any,f=w.live,flag=w.flagOff;
  const token=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_.-]{1,80}$/.test(value)?value:undefined;
  const errorMetadata=(error:any)=>({type:typeof error,name:token(error?.name),code:token(error?.code),causeName:token(error?.cause?.name),causeCode:token(error?.cause?.code)});
  const session=f?.sharedVoiceSession;
  // This is the real shared VoiceAssistantSession public snapshot API, not a renderer callback.
  const snapshot=typeof session?.getSnapshot==='function'?session.getSnapshot():undefined;
  const count=(value:unknown)=>Array.isArray(value)?value.length:0;
  return {version:1,scope:'synthetic-voice-fixture-failure-only',snapshotAvailable:!!snapshot,
   snapshot:snapshot?{phase:token(snapshot.phase),hearing:snapshot.hearing===true,muted:snapshot.muted===true,inputHeld:snapshot.inputHeld===true,hasPendingText:typeof snapshot.pendingText==='string'&&!!snapshot.pendingText,hasTranscript:typeof snapshot.transcript==='string'&&!!snapshot.transcript,error:snapshot.error===undefined?undefined:errorMetadata(snapshot.error)}:undefined,
   counts:{captures:count(f?.captures),stops:count(f?.stops),activeCapturePresent:!!f?.active,asrRoutes:count(f?.routes),closeRoutes:Array.isArray(f?.routes)?f.routes.filter((r:any)=>r.close===true).length:0,routeFrames:Array.isArray(f?.routes)?f.routes.reduce((n:number,r:any)=>n+count(r.frames),0):0,syntheses:count(f?.spoken),plays:count(f?.plays),playbackStops:typeof f?.stopped==='number'?f.stopped:0,posts:count(flag?.posts),unexpectedNativeRequests:count(flag?.unexpected),forbiddenVoiceRequests:count(f?.forbidden)},
   nativeRequests:Array.isArray(f?.failureNativeMetadata)?f.failureNativeMetadata.slice(0,64):[],
   notifications:flag?.notificationListenerMetadata?{added:flag.notificationListenerMetadata.added,removed:flag.notificationListenerMetadata.removed,active:flag.notificationListenerMetadata.active}:undefined};
 });}catch(error){metadata={version:1,diagnosticCaptureFailed:true,errorType:typeof error,errorName:error instanceof Error?error.name:'unknown'};}
 await info.attach('voice-fixture-failure-metadata',{body:Buffer.from(JSON.stringify(metadata,null,2)),contentType:'application/json'});
}
