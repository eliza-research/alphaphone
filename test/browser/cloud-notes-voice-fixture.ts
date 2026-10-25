import {expect,type Page} from '@playwright/test';
// Closed media/Cloud ports. No microphone, speech model, audio playback or provider HTTP.
export async function cloudNotesVoiceFixture(page:Page,signed=true,development=false){
 const foreign:string[]=[];
 await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,async route=>{foreign.push(route.request().url());await route.abort();});
 await page.addInitScript(()=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  const f=(window as any).cloudNotesVoice={owner:'a',mic:0,plays:0,starts:0,stops:0,uploads:0,local:0,paired:0,syntheses:0,cancels:0,active:null,clip:null,hold:false,billing:false,failureCode:null,denied:false,empty:false,transcript:'Closed Cloud transcript',requests:[]};
  Object.defineProperty(window,'AudioContext',{configurable:true,value:class{state='suspended';resume=async()=>{};close=async()=>{};}});
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{f.mic++;throw Error('Physical media forbidden');}}});
  HTMLMediaElement.prototype.play=async()=>{f.plays++;throw Error('Physical playback forbidden');};if(window.speechSynthesis)window.speechSynthesis.speak=()=>{f.plays++;throw Error('Local speech forbidden');};
 });
 await page.goto(development?'/?mode=dev':'/');
 await page.evaluate(async signed=>{
  const {BrowserVoice}=await import('/src/browser/voice.ts'),{connectionController:c}=await import('/src/runtime/connection-ui.tsx');const f=(window as any).cloudNotesVoice;
  c.getCloudEnvironment=()=>signed?'production':null;c.getCloudClient=()=>signed?{sessionId:'fixture-account-'+f.owner,credentialId:'fixture-credential-'+f.owner,client:{}} as any:null;
  BrowserVoice.prototype.localSpeechStatus=async()=>{f.local++;throw Error('Local preparation forbidden');};
  BrowserVoice.prototype.synthesizeLocal=async()=>{f.local++;throw Error('Local synthesis forbidden');};
  BrowserVoice.prototype.startRecording=async function(){f.starts++;if(f.denied)throw new DOMException('Denied','NotAllowedError');const recordingId=crypto.randomUUID();f.clip=recordingId;f.active=recordingId;(this as any).capture.clips.set(recordingId,{blob:new Blob(['closed-fixture'],{type:'audio/webm'}),durationMs:1000});return {recordingId,maxDurationMs:59000};};
  BrowserVoice.prototype.stopRecording=async()=>{f.stops++;f.active=null;return {recordingId:f.clip,durationMs:1000};};
  BrowserVoice.prototype.cancelRecording=async()=>{f.active=null;f.cancels++;};
  BrowserVoice.prototype.transcribeRecording=async(input:any)=>{f.uploads++;f.requests.push(input);if(f.hold)await new Promise<void>(resolve=>{f.release=resolve;});if(f.billing)throw Object.assign(Error('Synthetic billing refusal'),{code:'voice-http-402'});if(f.failureCode)throw Object.assign(Error('PRIVATE_TRANSCRIPTION_SENTINEL'),{code:f.failureCode});return {text:f.empty?'':f.transcript,local:false};};
  BrowserVoice.prototype.transcribePairedRecording=async()=>{f.paired++;throw Error('Paired transcription forbidden');};
  BrowserVoice.prototype.synthesize=async()=>{f.syntheses++;return {playbackId:crypto.randomUUID()};};
  BrowserVoice.prototype.play=async function(input:any){queueMicrotask(()=>void (this as any).notifyListeners('playbackEnded',{playbackId:input.playbackId}));};
  BrowserVoice.prototype.stopPlayback=async()=>{};BrowserVoice.prototype.cancel=async()=>{f.cancels++;};
 },signed);
 await agentNotesMock(page);
 return {foreign};
}
/** Synthetic agent notes store behind the real stock notes client and Alpha transport. Empty by default. */
export async function agentNotesMock(page:Page,notes:Array<{id:string;title:string;body:string}>=[]){
 await page.evaluate(async notes=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  const stamp={color:'yellow',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z'};
  const split=(content:string)=>{const cut=content.indexOf('\n');return cut<0?{title:content,body:''}:{title:content.slice(0,cut),body:content.slice(cut)};};
  const a=(window as any).agentNotes={notes:notes.map(note=>({...stamp,...note})),revision:1,calls:[] as any[],next:[] as Array<(body:any)=>unknown>,
   add(content:string){a.notes.unshift({...stamp,id:'agent-'+a.revision,...split(content)});a.revision++;}};
  const state=()=>({notes:structuredClone(a.notes),revision:a.revision}),ok=()=>({requestId:crypto.randomUUID(),success:true,result:{success:true,text:'Done.',state:state()}});
  c.getNotesClient=()=>({sessionId:'fixture-agent-notes',request:async(path:string,method:string,body:any)=>{
   a.calls.push({path,method,body});const next=a.next.shift();if(next)return next(body);
   if(path==='/api/notes/state'&&method==='GET')return {success:true,data:state()};
   const {capability,params}=body;
   if(capability==='create-note'){a.add(params.content);return ok();}
   if(capability==='update-note'){if(params.expectedRevision!==a.revision)return {requestId:crypto.randomUUID(),success:false,result:{success:false,text:'The notes changed since this edit was prepared.',error:{code:'NOTES_EDIT_CONFLICT',message:'The notes changed since this edit was prepared.'}}};Object.assign(a.notes.find((note:any)=>note.id===params.id),split(params.content));a.revision++;return ok();}
   if(capability==='delete-note'){a.notes=a.notes.filter((note:any)=>note.id!==params.id);a.revision++;return ok();}
   throw Object.assign(Error('Unsupported synthetic notes request'),{status:400});
  }});
 },notes);
}
export const agentNotesInteractions=(page:Page)=>page.evaluate(()=>(window as any).agentNotes.calls.filter((call:any)=>call.method==='POST').map((call:any)=>call.body));
export const notesRecorder=(page:Page)=>page.locator('[data-alpha-subview="notes-recording"]');
export async function openNotesRecorder(page:Page){await page.getByRole('button',{name:'Notes',exact:true}).click();await page.getByRole('button',{name:'Record and transcribe',exact:true}).click();}
export async function recordClosedClip(page:Page){const panel=notesRecorder(page);await panel.getByRole('button',{name:'Start recording',exact:true}).click();await expect(panel.getByRole('button',{name:'Stop recording',exact:true})).toBeVisible();await panel.getByRole('button',{name:'Stop recording',exact:true}).click();await expect(panel.getByRole('button',{name:'Transcribe with Eliza Cloud',exact:true})).toBeVisible();}
export async function noPhysicalOrLocalVoice(page:Page){expect(await page.evaluate(()=>{const f=(window as any).cloudNotesVoice;return {mic:f.mic,plays:f.plays,local:f.local,paired:f.paired};})).toEqual({mic:0,plays:0,local:0,paired:0});}
