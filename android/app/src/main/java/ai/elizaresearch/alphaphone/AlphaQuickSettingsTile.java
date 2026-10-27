package ai.elizaresearch.alphaphone;

import android.app.PendingIntent;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/** An explicit assistant entry, not a connection indicator or a microphone toggle. */
public final class AlphaQuickSettingsTile extends TileService {
    @Override public void onStartListening() {
        super.onStartListening();
        Tile tile = getQsTile();
        if (tile == null) return;
        tile.setIcon(Icon.createWithResource(this, R.drawable.notification_icon));
        tile.setLabel(getString(R.string.alpha_quick_settings_label));
        tile.setSubtitle(getString(isLocked()
                ? R.string.alpha_quick_settings_locked
                : R.string.alpha_quick_settings_open));
        tile.setContentDescription(getString(R.string.alpha_quick_settings_description));
        // An action tile is not an on/off state. Never imply that inference or capture is active.
        tile.setState(Tile.STATE_INACTIVE);
        tile.updateTile();
    }

    @Override public void onClick() {
        super.onClick();
        if (isLocked()) {
            unlockAndRun(this::openAssistant);
            return;
        }
        openAssistant();
    }

    private void openAssistant() {
        // The existing assist entry sanitizes all incoming context and retains account and
        // microphone admission. Opening it does not grant permissions or start voice capture.
        Intent intent = new Intent(this, AlphaAssistActivity.class)
                .setAction(Intent.ACTION_ASSIST)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            PendingIntent pending = PendingIntent.getActivity(this, 41, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            startActivityAndCollapse(pending);
        } else {
            startActivityAndCollapse(intent);
        }
    }
}
