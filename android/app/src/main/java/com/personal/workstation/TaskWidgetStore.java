package com.personal.workstation;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * 小组件的本地待同步队列。
 *
 * 小组件不直接碰 IndexedDB：添加/完成先写这里并立刻刷新 RemoteViews，
 * App 启动或回到前台时通过 TaskWidgetPlugin 的 take/ack 把动作并进 Dexie。
 * 这样在桌面点一下就完成，不需要先打开 App；离线也能用。
 */
final class TaskWidgetStore {

    static final String PREFS = "task_widget";
    static final String KEY_PAYLOAD = "payload";
    static final String KEY_PENDING_ADDS = "pending_adds";
    static final String KEY_PENDING_CHECKS = "pending_checks";

    private TaskWidgetStore() {}

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static JSONArray readArray(Context context, String key) {
        String raw = prefs(context).getString(key, "[]");
        try {
            return new JSONArray(raw);
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    private static void writeArray(Context context, String key, JSONArray array) {
        prefs(context).edit().putString(key, array.toString()).apply();
    }

    static synchronized void updateSnapshot(Context context, String payload) {
        prefs(context).edit().putString(KEY_PAYLOAD, payload).apply();
    }

    static synchronized void complete(Context context, String id) {
        if (id == null || id.isEmpty()) return;
        // JS may already have taken the add. Keep a check even when the add can
        // be removed locally so the next batch also completes that captured task.
        removePendingAdd(context, id);
        addPendingCheck(context, id, System.currentTimeMillis());
    }

    static synchronized void addPendingAdd(Context context, JSONObject task) {
        String id = task.optString("id", "");
        if (id.isEmpty()) return;
        JSONArray adds = readArray(context, KEY_PENDING_ADDS);
        for (int i = 0; i < adds.length(); i++) {
            JSONObject existing = adds.optJSONObject(i);
            if (existing != null && id.equals(existing.optString("id"))) return;
        }
        adds.put(task);
        writeArray(context, KEY_PENDING_ADDS, adds);
    }

    static synchronized void removePendingAdd(Context context, String id) {
        if (id == null || id.isEmpty()) return;
        JSONArray adds = readArray(context, KEY_PENDING_ADDS);
        JSONArray next = new JSONArray();
        for (int i = 0; i < adds.length(); i++) {
            JSONObject item = adds.optJSONObject(i);
            if (item != null && !id.equals(item.optString("id"))) next.put(item);
        }
        writeArray(context, KEY_PENDING_ADDS, next);
    }

    static boolean hasPendingAdd(Context context, String id) {
        if (id == null || id.isEmpty()) return false;
        JSONArray adds = readArray(context, KEY_PENDING_ADDS);
        for (int i = 0; i < adds.length(); i++) {
            JSONObject item = adds.optJSONObject(i);
            if (item != null && id.equals(item.optString("id"))) return true;
        }
        return false;
    }

    /**
     * 同一条任务只保留一次待同步勾选：小格子连点两下不应在 App 里完成两次。
     * 打卡任务的一次点击仍由 App 的 checkInTask 决定是 +1 还是归档。
     */
    static synchronized void addPendingCheck(Context context, String id, long at) {
        if (id == null || id.isEmpty()) return;
        JSONArray checks = readArray(context, KEY_PENDING_CHECKS);
        for (int i = 0; i < checks.length(); i++) {
            JSONObject item = checks.optJSONObject(i);
            if (item != null && id.equals(item.optString("id"))) {
                try {
                    if (at > item.optLong("at", 0)) item.put("at", at);
                } catch (JSONException ignored) { /* 保留原时间 */ }
                writeArray(context, KEY_PENDING_CHECKS, checks);
                return;
            }
        }
        JSONObject check = new JSONObject();
        try {
            check.put("id", id);
            check.put("at", at);
        } catch (JSONException ignored) {
            return;
        }
        checks.put(check);
        writeArray(context, KEY_PENDING_CHECKS, checks);
    }

    /** 读取但不清理；App 应用成功后再确认这一批，避免崩溃时丢任务。 */
    static synchronized JSONObject take(Context context) {
        JSONObject out = new JSONObject();
        try {
            out.put("adds", readArray(context, KEY_PENDING_ADDS));
            out.put("checks", readArray(context, KEY_PENDING_CHECKS));
            out.put("payload", prefs(context).getString(KEY_PAYLOAD, ""));
        } catch (JSONException ignored) { /* 两个数组一定放得进去 */ }
        return out;
    }

    static synchronized void ack(Context context, JSONObject processed, String payload) {
        prefs(context).edit()
            .putString(KEY_PAYLOAD, payload)
            .putString(KEY_PENDING_ADDS, remaining(readArray(context, KEY_PENDING_ADDS), processed.optJSONArray("adds")).toString())
            .putString(KEY_PENDING_CHECKS, remaining(readArray(context, KEY_PENDING_CHECKS), processed.optJSONArray("checks")).toString())
            .apply();
    }

    /** Only acknowledge the batch taken by JS; clicks arriving during the drain survive. */
    private static JSONArray remaining(JSONArray queued, JSONArray processed) {
        JSONArray out = new JSONArray();
        for (int i = 0; i < queued.length(); i++) {
            JSONObject item = queued.optJSONObject(i);
            if (item == null) continue;
            boolean matched = false;
            for (int j = 0; processed != null && j < processed.length(); j++) {
                JSONObject done = processed.optJSONObject(j);
                if (done != null && item.optString("id").equals(done.optString("id"))
                    && item.optLong("at", 0) == done.optLong("at", 0)) { matched = true; break; }
            }
            if (!matched) out.put(item);
        }
        return out;
    }
}
