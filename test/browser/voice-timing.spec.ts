import {test,expect,type Page} from '@playwright/test';

// Voice latency records from the rendered Cloud voice conversation (voice-timing.ts).
// Closed fixtures only: the recorder, Cloud transcription, the agent reply and playback are
// synthetic, and no microphone, provider or speaker is used. The reply streams into the
// conversation the way sendVoiceTurn does, so first-token is observed from rendered state.
// Evidence boundary: source/browser (test-mocks build). No device latency sample is produced.
const voice=(page:Page)=>page.getByRole('region',{name:'Voice conversation',exact:true});
async function setup(page:Page,options:{playback:'starts'|'fails';policy?:'auto-send'|'review'}){
 await page.route('https://**/*',route=>route.abort());
 await page.addInitScript(()=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  const f=(window as any).timingFixture={starts:0,uploads:0,sends:0,media:0,peak:0,holdTranscript:false,playback:'starts',plays:0,active:null};
  if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{f.media++;throw Error('This test forbids microphone access');};
 });
 await page.goto('/');
 await expect(page.locator('textarea[data-alpha-composer]')).toBeEnabled();
 await page.evaluate(async({playback,policy})=>{
  const {BrowserVoice}=await import('/src/browser/voice.ts'),{connectionController:c}=await import('/src/runtime/connection-ui.tsx'),{Component}=await import('/src/prototype/model.js');
  const timing=await import('/src/runtime/voice-timing.ts');timing.clearVoiceTiming();
  if(policy)(await import('/src/runtime/voice-selection.ts')).setVoiceSendPolicyForTests(policy);
  const f=(window as any).timingFixture;f.playback=playback;
  const snapshot={...c.getSnapshot(),open:false,busy:false,session:{origin:'https://owned.invalid',ownerId:'owner',agentId:'agent',sessionId:'synthetic-agent'}};c.getSnapshot=()=>snapshot as any;
  c.getCloudEnvironment=()=>'production';c.getCloudClient=()=>({sessionId:'synthetic-cloud',credentialId:'synthetic-credential',client:{}} as any);
  BrowserVoice.prototype.startRecording=async()=>{f.active='synthetic-clip-'+(++f.starts);return {recordingId:f.active,maxDurationMs:59000};};
  BrowserVoice.prototype.getRecordingMetrics=async(input:any)=>({recordingId:input.recordingId,peak:f.peak});
  BrowserVoice.prototype.stopRecording=async()=>{f.active=null;return {recordingId:'synthetic-clip-'+f.starts,durationMs:1000};};
  BrowserVoice.prototype.cancelRecording=async()=>{f.active=null;};
  BrowserVoice.prototype.transcribeRecording=async()=>{f.uploads++;if(f.holdTranscript)await new Promise<void>(resolve=>f.releaseTranscript=resolve);return {text:'Synthetic Cloud transcript',local:false};};
  BrowserVoice.prototype.localSpeechStatus=async()=>{throw Error('This test forbids local speech preparation');};
  BrowserVoice.prototype.synthesize=async(input:any)=>{if(f.playback==='fails')throw Error('Synthetic synthesis failure');return {playbackId:'synthetic-'+input.requestId};};
  BrowserVoice.prototype.play=async function(input:any){f.plays++;f.finishPlayback=()=>{void (this as any).notifyListeners('playbackEnded',input);};};
  BrowserVoice.prototype.cancel=async()=>{};BrowserVoice.prototype.stopPlayback=async()=>{};
  Component.prototype.prepareVoiceConversation=async function(signal:any){signal.throwIfAborted();return {binding:{conversationId:'synthetic-room',session:{sessionId:'synthetic-agent'},connectionEpoch:1},context:{view:this.S().view||'home',revision:1,sensitive:false}};};
  Component.prototype.voiceConversationCurrent=()=>true;
  Component.prototype.voiceConversationContext=function(){return {view:this.S().view||'home',revision:1,sensitive:false};};
  // The user turn, then a streaming partial, then the final reply, as the conversation renders them.
  const later=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
  Component.prototype.sendVoiceTurn=async function(input:any){
   input.signal.throwIfAborted();input.assertCurrent();const n=++f.sends;f.sent=input.text;
   const put=(next:(msgs:any[])=>any[])=>new Promise<void>(resolve=>this.setState((previous:any)=>({msgs:next(previous.msgs||[])}),resolve));
   await put(msgs=>[...msgs,{id:'user-'+n,from:'user',text:input.text}]);await later(40);
   await put(msgs=>[...msgs,{id:'stream-'+n,from:'agent',text:'Synthetic',streaming:true}]);await later(40);
   await put(msgs=>[...msgs.filter(m=>m.id!=='stream-'+n),{id:'assistant-'+n,from:'agent',text:'Synthetic matching reply.',streaming:false}]);
   return {requestId:input.turnId,conversationId:'synthetic-room',userMessageId:'user-'+n,assistantMessageId:'assistant-'+n,text:'Synthetic matching reply.',complete:true};
  };
  c.close();const render=Component.prototype.renderVals;Component.prototype.renderVals=function(){f.shell=this;return render.call(this);};
 },options);
 await expect.poll(()=>page.evaluate(()=>!!(window as any).timingFixture.shell)).toBe(true);
}
async function utterance(page:Page){await page.evaluate(()=>(window as any).timingFixture.peak=.25);await page.waitForTimeout(950);await page.evaluate(()=>(window as any).timingFixture.peak=0);}
const records=(page:Page)=>page.evaluate(async()=>JSON.parse((await import('/src/runtime/voice-timing.ts')).exportVoiceTiming()).records);
async function talk(page:Page){await page.getByRole('button',{name:'Talk',exact:true}).click();await expect(voice(page)).toHaveAttribute('data-voice-state','listening');}

test('a Cloud conversation turn records one entry-sourced record from recording end to final reply, without first audio when playback never started',async({page})=>{
 await setup(page,{playback:'fails'});await talk(page);await utterance(page);
 await expect(voice(page)).toHaveCount(0);
 const rows=await records(page);expect(rows).toHaveLength(1);
 const [row]=rows;expect(row).toMatchObject({version:1,route:'eliza-cloud',cold:true,entry:'conversation',policy:'auto-send'});expect(row.outcome).toBeUndefined();
 expect(Object.keys(row.marks)).toEqual(['recording-end','transcript-ready','send','first-token','final-reply']);
 const m=row.marks;expect(m['recording-end']).toBe(0);expect(m['transcript-ready']).toBeGreaterThanOrEqual(0);expect(m.send).toBeGreaterThanOrEqual(m['transcript-ready']);
 // The streamed partial is observed before the final reply is applied.
 expect(m['first-token']).toBeGreaterThan(m.send);expect(m['final-reply']).toBeGreaterThan(m['first-token']);
 expect(await page.evaluate(()=>{const f=(window as any).timingFixture;return {sends:f.sends,plays:f.plays,media:f.media};})).toEqual({sends:1,plays:0,media:0});
 expect(JSON.stringify(rows)).not.toMatch(/Synthetic|synthetic-cloud|synthetic-agent|credential/);
});

test('playback that starts adds first audio after the final reply, and the next turn on the route is warm',async({page})=>{
 await setup(page,{playback:'starts'});await talk(page);await utterance(page);
 await expect(voice(page)).toHaveAttribute('data-voice-state','speaking');
 let [row]=await records(page);expect(Object.keys(row.marks)).toEqual(['recording-end','transcript-ready','send','first-token','final-reply','first-audio']);expect(row.marks['first-audio']).toBeGreaterThanOrEqual(row.marks['final-reply']);
 await page.evaluate(()=>(window as any).timingFixture.finishPlayback());await expect(voice(page)).toHaveAttribute('data-voice-state','listening');
 await utterance(page);await expect(voice(page)).toHaveAttribute('data-voice-state','speaking');
 const rows=await records(page);expect(rows).toHaveLength(2);expect(rows.map((item:any)=>item.cold)).toEqual([true,false]);expect(rows.every((item:any)=>!item.outcome)).toBe(true);
 await voice(page).getByRole('button',{name:'Stop voice conversation',exact:true}).click();await expect(voice(page)).toHaveCount(0);
 row=(await records(page))[1];expect(row.outcome).toBeUndefined();expect(row.marks['first-audio']).toBeDefined();
});

test('closing voice while the transcript is pending records the turn as abandoned and sends nothing',async({page})=>{
 await setup(page,{playback:'starts'});await page.evaluate(()=>(window as any).timingFixture.holdTranscript=true);await talk(page);await utterance(page);
 await expect(voice(page)).toHaveAttribute('data-voice-state','transcribing');
 await voice(page).getByRole('button',{name:'Stop voice conversation',exact:true}).click();await expect(voice(page)).toHaveCount(0);
 await page.evaluate(()=>(window as any).timingFixture.releaseTranscript());
 const rows=await records(page);expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({entry:'conversation',outcome:'abandoned',marks:{'recording-end':0}});expect(Object.keys(rows[0].marks)).toEqual(['recording-end']);
 expect(await page.evaluate(()=>(window as any).timingFixture.sends)).toBe(0);
});

test('under the review policy a discarded transcript is abandoned after transcript-ready, with no send mark',async({page})=>{
 await setup(page,{playback:'starts',policy:'review'});await talk(page);await utterance(page);
 await expect(voice(page)).toHaveAttribute('data-voice-state','review');
 await voice(page).getByRole('button',{name:'Discard voice message',exact:true}).click();await expect(voice(page)).toHaveCount(0);
 const rows=await records(page);expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({entry:'conversation',policy:'review',outcome:'abandoned'});
 expect(Object.keys(rows[0].marks)).toEqual(['recording-end','transcript-ready']);expect(await page.evaluate(()=>(window as any).timingFixture.sends)).toBe(0);
});
