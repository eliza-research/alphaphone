package ai.elizaresearch.alphaphone;

import android.content.Context;
import android.media.*;
import android.os.SystemClock;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.nio.*;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.UUID;
import org.json.*;
import static org.junit.Assert.*;

/** Test-only Android AudioRecord control, retaining PCM without an AAC encoder. */
final class ConversationPcmEvidence {
 static void capture(Context context)throws Exception {
  assertEquals("1",InstrumentationRegistry.getArguments().getString("capturePcm"));
  String run=InboxFixtureScope.runId;assertNotNull(run);assertTrue(run.matches("[a-f0-9-]{36}"));
  int rate=16000,min=AudioRecord.getMinBufferSize(rate,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);assertTrue(min>0);
  AudioRecord recorder=new AudioRecord.Builder().setAudioSource(MediaRecorder.AudioSource.MIC)
   .setAudioFormat(new AudioFormat.Builder().setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_IN_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
   .setBufferSizeInBytes(Math.max(min,16000)).build();
  ByteArrayOutputStream pcm=new ByteArrayOutputStream();long started=0,elapsed=0;int actualBufferFrames=recorder.getBufferSizeInFrames();
  try{
   assertEquals(AudioRecord.STATE_INITIALIZED,recorder.getState());recorder.startRecording();
   assertEquals(AudioRecord.RECORDSTATE_RECORDING,recorder.getRecordingState());started=SystemClock.elapsedRealtime();
   android.util.Log.i("AlphaVoiceFixture","CAPTURE_READY "+run);
   byte[] chunk=new byte[4096];
   while(SystemClock.elapsedRealtime()-started<8500){
    int count=recorder.read(chunk,0,chunk.length,AudioRecord.READ_NON_BLOCKING);
    assertTrue("AudioRecord read must not fail: "+count,count>=0);
    if(count>0){assertTrue("Bounded synthetic PCM",pcm.size()+count<=rate*2*12);pcm.write(chunk,0,count);}else SystemClock.sleep(2);
   }
   elapsed=SystemClock.elapsedRealtime()-started;
  }finally{try{if(recorder.getRecordingState()==AudioRecord.RECORDSTATE_RECORDING)recorder.stop();}finally{recorder.release();}}
  byte[] data=pcm.toByteArray();assertTrue("PCM16 must have whole samples",data.length>0&&data.length%2==0);
  ByteBuffer wav=ByteBuffer.allocate(44+data.length).order(ByteOrder.LITTLE_ENDIAN);
  wav.put("RIFF".getBytes(java.nio.charset.StandardCharsets.US_ASCII)).putInt(36+data.length).put("WAVEfmt ".getBytes(java.nio.charset.StandardCharsets.US_ASCII)).putInt(16).putShort((short)1).putShort((short)1).putInt(rate).putInt(rate*2).putShort((short)2).putShort((short)16).put("data".getBytes(java.nio.charset.StandardCharsets.US_ASCII)).putInt(data.length).put(data);
  String relative="conversation-audio-evidence/"+run+"/"+UUID.randomUUID()+".wav";File file=new File(context.getFilesDir(),relative);
  assertTrue(file.getParentFile().mkdirs()||file.getParentFile().isDirectory());Files.write(file.toPath(),wav.array());
  StringBuilder hash=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(wav.array()))hash.append(String.format("%02x",b&255));
  android.os.Bundle result=new android.os.Bundle();result.putString("conversationAudioFixture",new JSONArray().put(new JSONObject().put("path","files/"+relative).put("bytes",wav.capacity()).put("sha256",hash.toString())).toString());
  result.putString("pcmCapture",new JSONObject().put("sampleRate",rate).put("frames",data.length/2).put("elapsedMs",elapsed).put("requestedBufferBytes",Math.max(min,16000)).put("actualBufferFrames",actualBufferFrames).toString());
  InstrumentationRegistry.getInstrumentation().addResults(result);
 }
}
