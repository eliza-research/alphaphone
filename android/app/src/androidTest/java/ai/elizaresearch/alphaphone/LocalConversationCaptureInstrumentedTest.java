package ai.elizaresearch.alphaphone;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
/** Controlled native recording without the conversation UI, activity polling; ASR readback only after capture. */
@RunWith(AndroidJUnit4.class)
public final class LocalConversationCaptureInstrumentedTest {
 @Test public void retainsNativeInputWithoutConversationActivityPolling()throws Exception{
  org.junit.Assume.assumeTrue("Owned coordinated capture required","1".equals(InstrumentationRegistry.getArguments().getString("localConversation")));
  new LocalConversationFixture().run(true,true);
 }
}
