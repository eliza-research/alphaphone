package ai.elizaresearch.alphaphone;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
/** Prepared local speech, foreground Android AudioRecord PCM, no conversation endpoint. */
@RunWith(AndroidJUnit4.class)
public final class LocalConversationPcmCaptureInstrumentedTest {
 @Test public void retainsPcmThroughAndroidAudioRecord()throws Exception{org.junit.Assume.assumeTrue("Owned coordinated capture required","1".equals(androidx.test.platform.app.InstrumentationRegistry.getArguments().getString("localConversation")));
 org.junit.Assume.assumeTrue("Prepared speech control required","1".equals(androidx.test.platform.app.InstrumentationRegistry.getArguments().getString("captureWarmSpeech")));
 org.junit.Assume.assumeTrue("Explicit PCM capture required","1".equals(androidx.test.platform.app.InstrumentationRegistry.getArguments().getString("capturePcm")));
 new LocalConversationFixture().run(true,true);}
}
