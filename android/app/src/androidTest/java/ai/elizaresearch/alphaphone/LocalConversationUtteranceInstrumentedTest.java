package ai.elizaresearch.alphaphone;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.runner.RunWith;
/** Controlled WebRTC audio through real capture/ASR/TTS; synthetic agent reply only. */
@RunWith(AndroidJUnit4.class)
public final class LocalConversationUtteranceInstrumentedTest {
 @Test public void automaticallySendsLocalTranscriptAndPlaysMatchingReply()throws Exception {org.junit.Assume.assumeTrue("Explicit owned conversation test required","1".equals(InstrumentationRegistry.getArguments().getString("localConversation")));new LocalConversationFixture().run(true);}
}
