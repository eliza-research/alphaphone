package ai.elizaresearch.alphaphone;
import org.junit.Test;
import ai.eliza.plugins.reminders.ReminderDeletionJournalFixture;
/** Product runner entry for the package-private shared-store fixture. */
public final class ReminderDeletionJournalInstrumentedTest {
 @Test public void persistedSuspensionBlocksDueDeliveryAndUndoKeepsOriginalOccurrence()throws Exception{new ReminderDeletionJournalFixture().persistedSuspensionBlocksDueDeliveryAndUndoKeepsOriginalOccurrence();}
 @Test public void expiryIsSingleWinnerAndChangedBootRequiresReview()throws Exception{new ReminderDeletionJournalFixture().expiryIsSingleWinnerAndChangedBootRequiresReview();}
}
