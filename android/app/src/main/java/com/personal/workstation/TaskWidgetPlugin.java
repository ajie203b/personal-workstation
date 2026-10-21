package com.personal.workstation;

import android.content.Context;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 网页侧把今日待办快照写进 SharedPreferences，AppWidget 只读这份快照。
 * 小组件本身不碰 WebView / IndexedDB，点击统一回到「今日」。
 */
@CapacitorPlugin(name = "TaskWidget")
public class TaskWidgetPlugin extends Plugin {

    @PluginMethod
    public void update(PluginCall call) {
        String payload = call.getString("payload");
        Context context = getContext();
        context.getSharedPreferences(TaskWidgetProvider.PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(TaskWidgetProvider.KEY, payload == null ? "{}" : payload)
            .apply();
        TaskWidgetProvider.refreshAll(context);
        call.resolve();
    }
}
