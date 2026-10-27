package ai.elizaresearch.alphaphone;

import android.content.Context;
import com.getcapacitor.annotation.CapacitorPlugin;
import ai.eliza.plugins.system.SenseListenerClient;

/** Legacy plugin name and package identity; behavior is owned by upstream ElizaSense. */
@CapacitorPlugin(name="AlphaListener")
public final class AlphaListenerPlugin extends ai.eliza.plugins.system.SensePlugin {
 static final String LISTENER_PACKAGE="ai.elizaresearch.alphaphone.sense";
 static boolean available(Context context){return new SenseListenerClient(context).available();}
 static boolean resetForData(Context context){return new SenseListenerClient(context).resetForData();}
}
