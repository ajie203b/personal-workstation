package com.personal.workstation;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

import androidx.annotation.RequiresApi;

/**
 * Android 下拉快捷设置磁贴（Quick Settings Tile · Phase 3）：
 * 在任意界面下拉通知栏点「速记待办」，直接弹出透明悬浮速记框，无需切回主 App。
 */
@RequiresApi(api = Build.VERSION_CODES.N)
public class QuickAddTileService extends TileService {

    @Override
    public void onStartListening() {
        super.onStartListening();
        Tile tile = getQsTile();
        if (tile != null) {
            tile.setState(Tile.STATE_INACTIVE);
            tile.setLabel(getString(R.string.quick_add_tile_label));
            tile.updateTile();
        }
    }

    @Override
    public void onClick() {
        super.onClick();
        Intent intent = new Intent(this, WidgetAddTaskActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            PendingIntent pending = PendingIntent.getActivity(
                this,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            startActivityAndCollapse(pending);
        } else {
            launchLegacy(intent);
        }
    }

    @SuppressWarnings("deprecation")
    private void launchLegacy(Intent intent) {
        startActivityAndCollapse(intent);
    }
}
