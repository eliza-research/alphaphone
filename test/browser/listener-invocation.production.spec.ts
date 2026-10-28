import {test,expect,type Page} from '@playwright/test';
import {flagOffAndroid,residentHome,fenceNetwork,button} from './flag-off-android';
// #424 in the flag-off renderer: the image listener's wake phrase opens the assistant surface and
// starts the on-device voice assistant (#423); Settings shows the listener's status with Pause and
// Turn off. Synthetic ports only (owner-bound ElizaSense, the AlphaVoiceCloud live
// capture and the resident agent's live ASR route). Not image, listener, microphone or device evidence.
type Options={assistant?:boolean;invocation?:'listener'|'system'|'assist';locked?:boolean;listener?:Record<string,unknown>|null};
async function setup(page:Page,options:Options={}){
 const foreign=await fenceNetwork(page);await flagOffAndroid(page);
 await page.addInitScript((options:Options)=>{
  const w=window as any,c=w.Capacitor,prior=c.nativePromise;
  const f=w.live={captures:[] as any[],stops:[] as string[],active:null as string|null,routes:[] as any[],invocations:0,binding:null as any,bindings:[] as any[],claims:[] as any[],listenerCalls:[] as string[],listener:options.listener??null,forbidden:[] as string[]};
  const events:Array<{event:string;callback:(value:any)=>void}>=[];
  const header=(name:string)=>c.PluginHeaders.find((p:any)=>p.name===name);
  header('AlphaVoiceCloud').methods=[...['checkPermissions','localSpeechStatus','liveCaptureStatus','startLiveCapture','stopLiveCapture','synthesizeLocal','play','stopPlayback','cancel','releaseLocalSpeech','cancelRecording'].map(name=>({name,rtype:'promise'})),{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'callback'}];
  c.PluginHeaders.push({name:'ElizaSense',methods:['status','pause','turnOff','openSettings','bindInvocationSession','takeInvocation'].map(name=>({name,rtype:'promise'}))});
  const callback=c.nativeCallback;c.nativeCallback=(plugin:string,method:string,input:any,fn:any)=>{if(plugin==='AlphaVoiceCloud'&&method==='addListener'){events.push({event:input.eventName,callback:fn});return String(events.length);}return callback(plugin,method,input,fn);};
  c.nativePromise=async(plugin:string,method:string,input:any)=>{
   if(plugin==='DailyApps'&&method==='surfaceInfo')return {developmentBuild:false,assistant:options.assistant===true};
   if(plugin==='ElizaSense'){
    if(method==='bindInvocationSession'){
     if(!Number.isInteger(input.generation)||input.generation<1||typeof input.bindingId!=='string'||!input.bindingId||input.sessionKey!==null&&!/^[a-f0-9]{64}$/.test(input.sessionKey))throw Error('Invalid invocation binding');
     f.binding=structuredClone(input);f.bindings.push(structuredClone(input));return {};
    }
    if(method==='takeInvocation'){
     if(!f.binding||!f.binding.sessionKey||input.generation!==f.binding.generation||input.bindingId!==f.binding.bindingId||input.sessionKey!==f.binding.sessionKey||Object.keys(input).sort().join(',')!=='bindingId,generation,sessionKey')throw Error('Invocation was not bound to the current owner');
     f.claims.push({request:structuredClone(input),binding:structuredClone(f.binding)});
     // One-shot like AlphaAssistActivity: the listener origin is reported once, then "assist".
     const first=f.invocations++===0;
     return options.assistant?{assistant:true,invocation:first?options.invocation??'assist':'assist',locked:options.locked===true}:{assistant:false,invocation:null,locked:false};
    }
    f.listenerCalls.push(method);
    if(method==='status')return f.listener??{available:false};
    if(method==='pause'){f.listener={...f.listener,state:'PAUSED_USER',label:'Paused',listening:false,microphoneOpen:false};return f.listener;}
    if(method==='turnOff'){f.listener={...f.listener,state:'OFF',label:'Listening off',listening:false,microphoneOpen:false};return f.listener;}
    if(method==='openSettings')return {opened:true};
    throw Error('Unexpected Sense method '+method);
   }
   if(plugin==='Agent'&&method==='request'&&String(input.path).startsWith('/api/asr/local-inference/live')){
    if(input.path==='/api/asr/local-inference/live/status')return {status:200,body:JSON.stringify({ready:true,streaming:true,sessions:0,maxSessions:4})};
    const body=JSON.parse(input.body);f.routes.push(body);return {status:200,body:JSON.stringify({ok:true,sessionId:body.sessionId,mode:'stream',framesReceived:0})};
   }
   if(plugin!=='AlphaVoiceCloud')return prior(plugin,method,input);
   if(method==='checkPermissions')return {microphone:'granted'};
   if(method==='localSpeechStatus')return {ready:true,execution:'device'};
   if(method==='liveCaptureStatus')return {permission:true,available:true};
   if(method==='startLiveCapture'){f.captures.push({echoCancel:input.echoCancel===true});f.active=input.captureId;return {captureId:input.captureId,sampleRate:16000,echoCancelled:input.echoCancel===true};}
   if(method==='stopLiveCapture'){f.stops.push(input.captureId);f.active=null;for(const row of events)if(row.event==='liveCaptureEnded')row.callback({captureId:input.captureId});return {captureId:input.captureId,durationMs:0};}
   if(['cancel','releaseLocalSpeech','removeListener','cancelRecording','stopPlayback'].includes(method))return {};
   f.forbidden.push(method);throw Error('Not part of this path: '+method);
  };
 },options);
 return foreign;
}
const voice=(page:Page)=>page.getByRole('region',{name:'Voice conversation',exact:true});
const live=<T,>(page:Page,read:(f:any)=>T)=>page.evaluate(`(${read.toString()})(window.live)`) as Promise<T>;
async function expectBoundInvocations(page:Page){
 const claims=await live(page,f=>f.claims);
 expect(claims.length).toBeGreaterThan(0);
 for(const claim of claims){
  expect(claim.request).toEqual(claim.binding);
  expect(claim.request.generation).toBeGreaterThan(0);
  expect(claim.request.bindingId).toBeTruthy();
  expect(claim.request.sessionKey).toMatch(/^[a-f0-9]{64}$/);
 }
}
async function openSurface(page:Page){
 await page.goto('/');
 await expect.poll(()=>page.evaluate(()=>(window as any).flagOff.calls.includes('Agent.start')),{timeout:30_000}).toBe(true);
 await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0,{timeout:30_000});
}

test('the listener wake phrase opens the assistant surface and starts the on-device voice assistant once',async({page})=>{
 const foreign=await setup(page,{assistant:true,invocation:'listener'});await openSurface(page);
 await expect(voice(page)).toHaveAttribute('data-voice-state','listening',{timeout:30_000});
 expect(await live(page,f=>f.captures)).toEqual([{echoCancel:true}]);
 await button(page,'Stop voice conversation').click();
 await expect(voice(page)).toHaveCount(0);
 // Returning to the surface reads the one-shot origin again: it is now a plain assist entry.
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await page.waitForTimeout(500);
 await expect(voice(page)).toHaveCount(0);
 expect(await live(page,f=>f.captures.length)).toBe(1);
 // A second wake phrase while the surface is already in front: native fires the invocation event.
 await page.evaluate(()=>{(window as any).live.invocations=0;window.dispatchEvent(new Event('alpha:assist-invocation'));});
 await expect(voice(page)).toHaveAttribute('data-voice-state','listening');
 expect(await live(page,f=>f.captures.length)).toBe(2);
 await button(page,'Stop voice conversation').click();
 await expectBoundInvocations(page);
 expect(await live(page,f=>f.forbidden)).toEqual([]);expect(foreign).toEqual([]);
});

// Press-and-hold power on the image: SystemUI launches the assistant with its identity shared and
// native reports a "system" origin (shared SenseInvocation). It starts voice like a wake phrase.
test('press-and-hold power opens the assistant surface and starts the on-device voice assistant once',async({page})=>{
 const foreign=await setup(page,{assistant:true,invocation:'system'});await openSurface(page);
 await expect(voice(page)).toHaveAttribute('data-voice-state','listening',{timeout:30_000});
 expect(await live(page,f=>f.captures)).toEqual([{echoCancel:true}]);
 await button(page,'Stop voice conversation').click();
 await expect(voice(page)).toHaveCount(0);
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await page.waitForTimeout(500);
 await expect(voice(page)).toHaveCount(0);
 expect(await live(page,f=>f.captures.length)).toBe(1);
 expect(await live(page,f=>f.forbidden)).toEqual([]);expect(foreign).toEqual([]);
});

for(const [name,options] of [['a locked keyguard',{assistant:true,invocation:'listener',locked:true}],['a locked press-and-hold power',{assistant:true,invocation:'system',locked:true}],['a plain assist entry',{assistant:true,invocation:'assist'}]] as const)
 test(`${name} opens the assistant surface without opening the microphone`,async({page})=>{
  const foreign=await setup(page,options);await openSurface(page);
  await expect.poll(()=>live(page,f=>f.invocations),{timeout:15_000}).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  await expect(voice(page)).toHaveCount(0);
  expect(await live(page,f=>f.captures.length)).toBe(0);
  await expectBoundInvocations(page);
  expect(foreign).toEqual([]);
 });

test('Settings shows the listener status and Pause and Turn off reach the listener; nothing turns it on',async({page})=>{
 const foreign=await setup(page,{listener:{available:true,state:'LISTENING',label:'Listening',consented:true,listening:true,microphoneOpen:true}});
 await residentHome(page);
 await button(page,'Settings').click();
 await button(page,'Character').click();
 await expect(page.getByText('Always-on listening')).toBeVisible();
 await expect(page.getByText('On this device',{exact:true})).toBeVisible();
 await button(page,'Pause listening').click();
 await expect.poll(()=>live(page,f=>f.listenerCalls)).toContain('pause');
 await expect(page.getByText('Paused',{exact:true})).toBeVisible();
 await expect(button(page,'Pause listening')).toHaveCount(0);
 await button(page,'Turn off listening').click();
 await expect.poll(()=>live(page,f=>f.listenerCalls)).toContain('turnOff');
 await button(page,'Listening settings').click();
 await expect.poll(()=>live(page,f=>f.listenerCalls)).toContain('openSettings');
 expect(await live(page,f=>f.listenerCalls.filter((m:string)=>!['status','pause','turnOff','openSettings'].includes(m)))).toEqual([]);
 expect(foreign).toEqual([]);
});

test('without the image listener Settings keeps the wake word unavailable',async({page})=>{
 const foreign=await setup(page);await residentHome(page);
 await button(page,'Settings').click();await button(page,'Character').click();
 await expect(page.getByText('Wake word')).toBeVisible();
 await expect(page.getByText('Always-on listening')).toHaveCount(0);
 expect(foreign).toEqual([]);
});
