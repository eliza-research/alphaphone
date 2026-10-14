package ai.elizaresearch.alphaphone;
import com.getcapacitor.Plugin;
/** Test APK only. Native Notes, credential storage and audio plugins remain real. */
public final class NoteAudioFixtureActivity extends MainActivity {
 @Override public void registerPlugin(Class<? extends Plugin> plugin){
  super.registerPlugin(plugin==AlphaConnectionPlugin.class?InboxFixtureConnection.class:plugin==AlphaLocalAgentPlugin.class?ConversationFixtureAgent.class:plugin);
 }
}
