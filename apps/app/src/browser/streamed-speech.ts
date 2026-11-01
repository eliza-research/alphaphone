/** Cloud read-aloud arrives as audio/mpeg chunks from the paired agent (local-agent-dev-bridge.ts). */
const SPEECH_TYPE='audio/mpeg';

/** True when this browser can play audio/mpeg through MediaSource. Otherwise the clip is buffered
 * whole into a Blob and played after its last byte, as before streaming. */
export function streamedSpeechSupported():boolean {
 try{return typeof MediaSource!=='undefined'&&MediaSource.isTypeSupported(SPEECH_TYPE);}catch{return false;}
}

/** A prepared clip that is still downloading. The body is read from preparation on, so the download
 * continues while playback is admitted. Every chunk is kept so playback appends the clip from its
 * start. cancel() stops the download. */
export class StreamedSpeech {
 private chunks:Uint8Array<ArrayBuffer>[]=[];
 private outcome?:{error?:unknown};
 private waiters=new Set<()=>void>();
 private reader:ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>;
 constructor(body:ReadableStream<Uint8Array<ArrayBuffer>>){this.reader=body.getReader();void this.pump();}
 private async pump(){
  try{for(;;){const part=await this.reader.read();if(part.done)break;this.chunks.push(part.value);this.wake();}this.settle({});}
  catch(error){this.settle({error});}
 }
 private settle(outcome:{error?:unknown}){this.outcome??=outcome;this.wake();}
 private wake(){const waiters=[...this.waiters];this.waiters.clear();for(const resume of waiters)resume();}
 cancel(reason:unknown=new DOMException('Speech cancelled','AbortError')){this.settle({error:reason});void this.reader.cancel(reason).catch(()=>{});}
 /** Every chunk received so far, then each later one. Throws when the download fails or `signal` aborts. */
 async *read(signal:AbortSignal):AsyncGenerator<Uint8Array<ArrayBuffer>> {
  for(let index=0;;){
   signal.throwIfAborted();
   if(index<this.chunks.length){yield this.chunks[index++];continue;}
   if(this.outcome){if('error' in this.outcome)throw this.outcome.error;return;}
   await new Promise<void>(resolve=>{const resume=()=>{signal.removeEventListener('abort',resume);this.waiters.delete(resume);resolve();};this.waiters.add(resume);signal.addEventListener('abort',resume,{once:true});});
  }
 }
}

/** Plays `speech` through a MediaSource while it downloads: the element can start on the first
 * frames. The playback owns the download from here: aborting `signal` stops both. `fed` resolves
 * once the whole clip is appended and rejects when the download fails or the media is detached. */
export function streamedSpeechSource(speech:StreamedSpeech,signal:AbortSignal):{url:string;fed:Promise<void>} {
 const media=new MediaSource(),url=URL.createObjectURL(media);
 signal.addEventListener('abort',()=>speech.cancel(signal.reason),{once:true});
 const fed=(async()=>{
  if(media.readyState!=='open')await mediaEvent(media,'sourceopen',signal);
  const buffer=media.addSourceBuffer(SPEECH_TYPE);
  for await(const chunk of speech.read(signal)){buffer.appendBuffer(chunk);await mediaEvent(buffer,'updateend',signal);}
  if(media.readyState==='open')media.endOfStream();
 })();
 void fed.catch(()=>{});
 return {url,fed};
}
function mediaEvent(target:MediaSource|SourceBuffer,type:'sourceopen'|'updateend',signal:AbortSignal):Promise<void> {
 return new Promise((resolve,reject)=>{
  const failures=['error','sourceclose'];
  const finish=(error?:unknown)=>{target.removeEventListener(type,done);for(const name of failures)target.removeEventListener(name,failed);signal.removeEventListener('abort',aborted);if(error)reject(error);else resolve();};
  const done=()=>finish(),failed=()=>finish(Error('Speech audio could not be played.')),aborted=()=>finish(signal.reason??new DOMException('Playback cancelled','AbortError'));
  target.addEventListener(type,done);for(const name of failures)target.addEventListener(name,failed);signal.addEventListener('abort',aborted);
  if(signal.aborted)aborted();
 });
}
