package ai.elizaresearch.alphaphone;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
/** Controlled WebRTC audio through real capture/ASR/TTS; synthetic agent reply only. */
@RunWith(AndroidJUnit4.class)
public final class LocalConversationUtteranceInstrumentedTest {
 @Test public void automaticallySendsLocalTranscriptAndPlaysMatchingReply()throws Exception {new LocalConversationFixture().run(true);}
}
