import {encodeMonoPcm16Wav} from '../../../../.eliza/client-features/packages/ui/src/voice/pcm-wave.ts';

/** Decode an owned browser clip to bounded 16 kHz mono samples. */
export async function recordingPcmSamples(blob:Blob,signal:AbortSignal):Promise<Float32Array>{
 signal.throwIfAborted();
 if(!blob.size||blob.size>16_000_000)throw Error('Recording size is invalid.');
 const context=new OfflineAudioContext(1,1,16000);
 const decoded=await context.decodeAudioData(await blob.arrayBuffer());
 signal.throwIfAborted();
 if(!Number.isFinite(decoded.duration)||decoded.duration<=0||decoded.duration>60)throw Error('Keep recordings under 60 seconds.');
 const length=Math.ceil(decoded.duration*16000),renderer=new OfflineAudioContext(1,length,16000);
 const source=renderer.createBufferSource();source.buffer=decoded;source.connect(renderer.destination);source.start();
 const rendered=await renderer.startRendering();signal.throwIfAborted();
 return rendered.getChannelData(0);
}
/** Convert an owned browser clip to bounded mono PCM16 WAV for local-agent ASR. */
export async function recordingPcmWav(blob:Blob,signal:AbortSignal):Promise<Uint8Array>{
 return encodeMonoPcm16Wav(await recordingPcmSamples(blob,signal),16000);
}
