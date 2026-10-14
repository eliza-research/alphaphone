package ai.elizaresearch.alphaphone;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
/** Fixed native recording with metrics polling; no conversation renderer updates. */
@RunWith(AndroidJUnit4.class)
public final class LocalConversationCapturePollingInstrumentedTest {
 @Test public void retainsNativeInputWithMetricsButWithoutConversationUi()throws Exception{
  org.junit.Assume.assumeTrue("Owned coordinated capture required","1".equals(InstrumentationRegistry.getArguments().getString("localConversation")));
  org.junit.Assume.assumeTrue("Explicit polling control required","1".equals(InstrumentationRegistry.getArguments().getString("capturePolling")));
  new LocalConversationFixture().run(true,true);
 }
}
