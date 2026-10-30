package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.actionjournal.ActionJournal;
import ai.eliza.plugins.actionjournal.android.ReviewedDeletionPlugin;
import ai.eliza.plugins.actionjournal.deletion.DeferredDeletionCoordinator;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

/** Installed plugin and real Reminder engine/journal ports. Native review is shared upstream. */
@CapacitorPlugin(name="AlphaDeletions")
public final class AlphaDeletionsPlugin extends ReviewedDeletionPlugin {
 @Override protected DeferredDeletionCoordinator coordinator(){return NativeDeletionCoordinator.get(getContext());}
 @Override protected ActionJournal reminderJournal(){return AlphaActionJournal.get(getContext());}
 @Override protected ReminderReview reminderReview(){return new ReminderReview(){
  public JSONObject selected(String id)throws Exception{return AlphaReminders.engine(getContext()).selected(id);}
  public JSONObject read(String id)throws Exception{return AlphaReminders.engine(getContext()).read(id);}
 };}
}
