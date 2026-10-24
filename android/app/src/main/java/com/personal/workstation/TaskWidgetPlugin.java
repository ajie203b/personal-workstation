package com.personal.workstation;

import android.content.Context;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

/**
 * 网页侧把今日待办快照写进 SharedPreferences，AppWidget 只读这份快照。
 * 小组件内的添加/完成先写本地待同步队列；网页侧启动或回前台时用 take/ack
 * 把队列并进 IndexedDB，不需要打开主界面。
 */
@CapacitorPlugin(name = "TaskWidget")
public class TaskWidgetPlugin extends Plugin {

    @PluginMethod
    public void update(PluginCall call) {
        String payload = call.getString("payload");
        Context context = getContext();
        TaskWidgetStore.prefs(context)
            .edit()
            .putString(TaskWidgetStore.KEY_PAYLOAD, payload == null ? "{}" : payload)
            .apply();
        TaskWidgetProvider.refreshAll(context);
        call.resolve();
    }

    /** 读取待同步的添加/完成动作（不清理；网页侧处理成功后再 ack） */
    @PluginMethod
    public void take(PluginCall call) {
        JSONObject payload = TaskWidgetStore.take(getContext());
        JSObject out = new JSObject();
        out.put("adds", payload.optJSONArray("adds"));
        out.put("checks", payload.optJSONArray("checks"));
        call.resolve(out);
    }

    /** 网页侧已并入 IndexedDB，清空队列 */
    @PluginMethod
    public void ack(PluginCall call) {
        TaskWidgetStore.ack(getContext());
        call.resolve();
    }
}
