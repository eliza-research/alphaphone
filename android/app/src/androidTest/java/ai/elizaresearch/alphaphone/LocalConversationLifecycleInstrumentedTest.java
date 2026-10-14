package ai.elizaresearch.alphaphone;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
@RunWith(AndroidJUnit4.class)
public final class LocalConversationLifecycleInstrumentedTest {
 @Test public void startsLocalCaptureAndConfirmsStop()throws Exception {new LocalConversationFixture().run(false);}
}
