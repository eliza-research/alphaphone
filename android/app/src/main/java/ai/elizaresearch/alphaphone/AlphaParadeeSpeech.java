package ai.elizaresearch.alphaphone;

import android.content.Context;
import ai.eliza.voice.InferenceSession;
import ai.eliza.voice.ParadeeVoice;
import ai.eliza.voice.VoiceAssets;
import java.io.IOException;
import java.util.Arrays;
import java.util.concurrent.CancellationException;
import java.util.function.BooleanSupplier;

/** Product lifecycle adapter over the shared on-device ASR and Paradee engine. */
final class AlphaParadeeSpeech implements AlphaLocalSpeechEngine.Backend {
 private final InferenceSession inference;
 AlphaParadeeSpeech(Context context)throws Exception{
  inference=VoiceAssets.install(context).openInference();
 }
 @Override public void prepare()throws IOException{inference.prepareSpeech();}
 public String transcribe(float[] samples)throws IOException{
  if(samples==null||samples.length<1600||samples.length>16000*60)throw new IllegalArgumentException("Expected 0.1 to 60 seconds of audio");
  double energy=0;for(float sample:samples){if(!Float.isFinite(sample)||Math.abs(sample)>1)throw new IllegalArgumentException("Invalid PCM");energy+=(double)sample*sample;}
  if(energy/samples.length<0.000001)return "";
  String text=inference.transcribe(samples);if(text==null||text.length()>16000)throw new IllegalStateException("Invalid transcription");return text.trim();
 }
 public AlphaLocalSpeechEngine.Audio synthesize(String text)throws IOException{return synthesize(text,()->false);}
 public AlphaLocalSpeechEngine.Audio synthesize(String text,BooleanSupplier cancelled)throws IOException{
  if(text==null||text.isBlank()||text.length()>5000||text.indexOf('\0')>=0)throw new IllegalArgumentException("Invalid reviewed speech text");
  if(cancelled.getAsBoolean())throw new CancellationException();
  ParadeeVoice.Audio audio=inference.synthesize(text,1f);boolean accepted=false;
  try{
   if(cancelled.getAsBoolean())throw new CancellationException();
   if(audio.sampleRate!=24000||audio.samples.length<2400||audio.samples.length>(8*1024*1024-44)/2)throw new IllegalStateException("Invalid speech output");
   double energy=0;for(float sample:audio.samples){if(!Float.isFinite(sample))throw new IllegalStateException("Invalid speech output");energy+=(double)sample*sample;}
   if(energy/audio.samples.length<0.000001)throw new IllegalStateException("Speech output is silent");
   accepted=true;return new AlphaLocalSpeechEngine.Audio(audio.samples,audio.sampleRate);
  }finally{if(!accepted)Arrays.fill(audio.samples,0);}
 }
 @Override public boolean supportsStreaming(){try{return inference.supportsStreaming();}catch(LinkageError|RuntimeException unavailable){return false;}}
 @Override public boolean speechLoaded(){return inference.isSpeechLoaded();}
 /**
  * Issue #397: per-chunk validation of the shared Paradee stream. The sink never reenters the voice;
  * its exceptions are held and rethrown after the native call returns, so nothing propagates through
  * JNI. A rejected chunk is zeroed.
  */
 @Override public void synthesizeStream(String text,BooleanSupplier cancelled,AlphaLocalSpeechEngine.ChunkSink sink)throws Exception{
  if(text==null||text.isBlank()||text.length()>5000||text.indexOf('\0')>=0)throw new IllegalArgumentException("Invalid reviewed speech text");
  if(cancelled.getAsBoolean())throw new CancellationException();
  if(inference.speechSampleRate()!=AlphaLocalSpeechEngine.STREAM_RATE)throw new IllegalStateException("Invalid speech output");
  SpeechStreamValidation state=new SpeechStreamValidation();
  inference.synthesizeStream(text,1f,(samples,complete)->{
   try{
    if(cancelled.getAsBoolean()){state.cancelled=true;zero(samples);return false;}
    state.accept(samples,complete);
    if(!sink.accept(samples,complete)){state.cancelled=true;return false;}
    return true;
   }catch(Exception|Error failure){zero(samples);state.failure=failure;return false;}
  });
  if(state.failure instanceof Exception)throw (Exception)state.failure;
  if(state.failure instanceof Error)throw (Error)state.failure;
  if(state.cancelled||cancelled.getAsBoolean())throw new CancellationException();
  if(!state.complete)throw new IllegalStateException("Speech stream ended early");
 }
 private static void zero(float[] samples){if(samples!=null)Arrays.fill(samples,0);}
 public void cancel(){inference.cancel();}
 public void close(){inference.close();}
}
