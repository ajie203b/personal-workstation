package com.personal.workstation;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 兼容旧版或外部私有广播触发完成：同样附带小组件内闪动与成功触感反馈 */
public class WidgetCompleteReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String id = intent.getStringExtra("task_id");
        if (id == null || id.isEmpty()) return;
        TaskWidgetProvider.completeWithFlash(context, id);
        WidgetCompleteActivity.vibrateSuccess(context);
    }
}
