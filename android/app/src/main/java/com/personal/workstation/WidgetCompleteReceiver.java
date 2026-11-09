package com.personal.workstation;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Private PendingIntent target: completion needs no Activity or blocking overlay. */
public class WidgetCompleteReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String id = intent.getStringExtra("task_id");
        if (id == null || id.isEmpty()) return;
        TaskWidgetStore.complete(context, id);
        TaskWidgetProvider.refreshAll(context);
    }
}
