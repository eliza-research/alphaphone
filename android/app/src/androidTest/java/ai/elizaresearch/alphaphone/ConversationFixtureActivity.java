package ai.elizaresearch.alphaphone;
import com.getcapacitor.Plugin;
/** Test APK only. Speech plugins and the production renderer are not substituted. */
public final class ConversationFixtureActivity extends MainActivity {
 @Override public void registerPlugin(Class<? extends Plugin> plugin){
  super.registerPlugin(plugin==AlphaConnectionPlugin.class?InboxFixtureConnection.class:plugin==AlphaLocalAgentPlugin.class?ConversationFixtureAgent.class:plugin);
 }
}
