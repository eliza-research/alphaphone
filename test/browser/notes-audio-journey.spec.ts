import {test,expect} from '@playwright/test';
test('Notes records, reviews, saves, reloads, plays and restores the same retained audio',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 // Firefox defers Web Audio in background tabs even after a synthetic input click.
 await page.bringToFront();
 await page.evaluate(async ()=>{
  const ctx=new AudioContext(),osc=ctx.createOscillator(),gain=ctx.createGain(),sink=ctx.createMediaStreamDestination();gain.gain.value=.1;osc.connect(gain);gain.connect(sink);osc.start();
  // Resume from the real Notes click so Firefox's user-activation policy is exercised.
  // The synthetic signal goes only to the recording stream, never the speakers.
  document.addEventListener('click',()=>{void ctx.resume();},{once:true,capture:true});
  const Original=MediaRecorder;(window as any).recordedBytes=0;
  window.MediaRecorder=class extends Original{constructor(stream:MediaStream,options?:MediaRecorderOptions){super(stream,options);this.addEventListener('dataavailable',event=>{(window as any).recordedBytes+=event.data.size;});}};
  Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>sink.stream},configurable:true});(window as any).fixture={ctx,osc};
 });
 await page.getByRole('button',{name:'Notes',exact:true}).click();
 await expect.poll(()=>page.evaluate(async ()=>(window as any).fixture.ctx.state)).toBe('running');
 await page.getByRole('button',{name:'Record and transcribe',exact:true}).click();
 await page.getByRole('button',{name:'Record without transcription',exact:true}).click();
 await page.getByRole('button',{name:'Start recording',exact:true}).click();
 await expect(page.getByRole('button',{name:'Stop recording',exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(async ()=>(window as any).recordedBytes)).toBeGreaterThan(0);
 await page.getByRole('button',{name:'Stop recording',exact:true}).click();
 await page.getByRole('button',{name:'Review transcript',exact:true}).click();
 await page.getByRole('textbox',{name:'Review transcript',exact:true}).fill('A recorded note saved through the real Notes interface.');
 await page.getByRole('button',{name:'Save note',exact:true}).click();
 await expect(page.getByRole('button',{name:'Play recording',exact:true})).toBeVisible();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Browser audio journey');
 await page.evaluate(async()=>{const {ctx,osc}=(window as any).fixture;osc.stop();await ctx.close();});
 await page.reload();await page.getByRole('button',{name:'Notes',exact:true}).click();await page.getByRole('button',{name:'Open Browser audio journey',exact:true}).click();
 await expect(page.getByText('A recorded note saved through the real Notes interface.',{exact:true}).first()).toBeVisible();
 const note=await page.evaluate(async ()=>JSON.parse(((await (await import('/src/browser/notes-document.ts')).browserNotesDocument.read())?.raw??null)!).records.find((n:any)=>n.title==='Browser audio journey'));
 const replay=await page.evaluate(async(note)=>{
  const {registerPlugin}=await import('/src/platform-plugins.ts');const voice=registerPlugin<any>('AlphaVoiceCloud');
  const result=await voice.saveRecording({recordingId:note.audio.audioId,noteId:note.id,transcript:note.body});
  let wrongOwner=false;try{await voice.saveRecording({recordingId:note.audio.audioId,noteId:'different-note',transcript:note.body});}catch{wrongOwner=true;}
  const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('alpha.browser.audio.v1');r.onsuccess=()=>resolve(r.result);});
  const count=await new Promise<number>(resolve=>{const r=db.transaction('audio').objectStore('audio').count();r.onsuccess=()=>resolve(r.result);});db.close();return {audioId:result.audioId,wrongOwner,count};
 },note);
 expect(replay).toEqual({audioId:note.audio.audioId,wrongOwner:true,count:1});
 await page.getByRole('button',{name:'Play recording',exact:true}).click();
 await expect(page.getByRole('button',{name:'Stop recording playback',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Play recording',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Delete note',exact:true}).click();
 await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeVisible();
 expect(await page.evaluate(async(id)=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return (await registerPlugin<any>('AlphaNoteAudio').describe({audioId:id})).deletedAt;},note.audio.audioId)).toBeGreaterThan(0);
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await expect.poll(()=>page.evaluate(async(id)=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return (await registerPlugin<any>('AlphaNoteAudio').describe({audioId:id})).deletedAt;},note.audio.audioId)).toBeUndefined();
 await page.getByRole('button',{name:'Open Browser audio journey',exact:true}).click();
 await page.getByRole('button',{name:'Play recording',exact:true}).click();await expect(page.getByRole('button',{name:'Stop recording playback',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Stop recording playback',exact:true}).click();
 await expect(page.getByRole('button',{name:'Play recording',exact:true})).toBeVisible();
 await page.screenshot({path:test.info().outputPath('restored-voice-note.png')});
});
