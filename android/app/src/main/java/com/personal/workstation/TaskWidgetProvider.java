package com.personal.workstation;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 今日待办小组件（4x2 标准版 / 2x2 紧凑版）。
 *
 * 小米负一屏主池只收录 MIUI 适配过的卡片；未收录的第三方卡片会显示「努力适配中」。
 * 本组件不再声明 miuiWidget，统一走系统「安卓小组件」入口，避免那个占位提示。
 *
 * 数据由 TaskWidgetPlugin 从网页侧同步；本地待同步队列（TaskWidgetStore）叠加在快照上：
 * - 右上「+」：原生添加框，直接写入队列并刷新
 * - 勾选圈：原生透明撒花 Activity，立即完成并写队列
 * App 启动/回前台时通过 TaskWidgetPlugin 的 take/ack 把队列并进 IndexedDB。
 */
public class TaskWidgetProvider extends AppWidgetProvider {

    /** 小米 Widget 展现刷新（曝光触发，见小米小部件技术规范 2） */
    private static final String MIUI_APPWIDGET_UPDATE = "miui.appwidget.action.APPWIDGET_UPDATE";

    /** 小于这个宽度就用紧凑布局（2x2 大约 110–180dp） */
    private static final int COMPACT_WIDTH_DP = 220;

    private static final int COLOR_TEXT = Color.parseColor("#201F1D");
    private static final int COLOR_MUTED = Color.parseColor("#8B887F");
    private static final int COLOR_ACCENT = Color.parseColor("#2C55B8");
    private static final int COLOR_DANGER = Color.parseColor("#E5484D");
    private static final int COLOR_WARN = Color.parseColor("#B7791F");

    @Override
    public void onReceive(Context context, Intent intent) {
        // 小米负一屏曝光刷新与系统 APPWIDGET_UPDATE 走同一条重建逻辑
        if (MIUI_APPWIDGET_UPDATE.equals(intent.getAction())) {
            refreshAll(context);
            return;
        }
        super.onReceive(context, intent);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            appWidgetManager.updateAppWidget(id, build(context, id));
        }
    }

    /** 用户在桌面/负一屏拉伸格子后立刻重排，不用等下一次任务变动 */
    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager appWidgetManager, int appWidgetId, Bundle newOptions) {
        appWidgetManager.updateAppWidget(appWidgetId, build(context, appWidgetId));
    }

    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName name = new ComponentName(context, TaskWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(name);
        for (int id : ids) manager.updateAppWidget(id, build(context, id));
    }

    private static boolean isCompact(Context context, int appWidgetId) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        Bundle options = manager.getAppWidgetOptions(appWidgetId);
        if (options == null) return false;
        int minWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH);
        return minWidth > 0 && minWidth < COMPACT_WIDTH_DP;
    }

    private static PendingIntent appIntent(Context context, Uri uri, int requestCode) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(Intent.ACTION_VIEW);
        intent.setData(uri);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static PendingIntent widgetActivityIntent(Context context, Class<?> activity, String taskId, int requestCode) {
        Intent intent = new Intent(context, activity);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (taskId != null) intent.putExtra("task_id", taskId);
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static RemoteViews build(Context context, int appWidgetId) {
        boolean compact = isCompact(context, appWidgetId);
        RemoteViews views = new RemoteViews(
            context.getPackageName(),
            compact ? R.layout.widget_tasks_compact : R.layout.widget_tasks
        );

        int base = appWidgetId * 100;
        // 整卡：回今日页
        views.setOnClickPendingIntent(
            R.id.widget_root,
            appIntent(context, Uri.parse("com.personal.workstation://today"), base)
        );
        // 右上「+」：原生添加框，不打开 App
        views.setOnClickPendingIntent(
            R.id.widget_add,
            widgetActivityIntent(context, WidgetAddTaskActivity.class, null, base + 1)
        );

        int[] rowIds = {R.id.widget_row_1, R.id.widget_row_2, R.id.widget_row_3, R.id.widget_row_4};
        int[] textIds = {R.id.widget_task_1, R.id.widget_task_2, R.id.widget_task_3, R.id.widget_task_4};
        int[] checkIds = {R.id.widget_check_1, R.id.widget_check_2, R.id.widget_check_3, R.id.widget_check_4};
        int maxRows = compact ? 3 : 4;

        SharedPreferences prefs = TaskWidgetStore.prefs(context);
        String raw = prefs.getString(TaskWidgetStore.KEY_PAYLOAD, null);
        boolean hasPendingAdds = TaskWidgetStore.readArray(context, TaskWidgetStore.KEY_PENDING_ADDS).length() > 0;

        if ((raw == null || raw.isEmpty()) && !hasPendingAdds) {
            views.setTextViewText(R.id.widget_meta, "打开应用同步");
            views.setTextViewText(R.id.widget_empty, "打开应用后自动同步今日待办");
            views.setTextColor(R.id.widget_empty, COLOR_MUTED);
            views.setViewVisibility(R.id.widget_tasks, View.GONE);
            views.setViewVisibility(R.id.widget_empty, View.VISIBLE);
            return views;
        }

        JSONObject root = null;
        if (raw != null && !raw.isEmpty()) {
            try {
                root = new JSONObject(raw);
            } catch (JSONException ignored) {
                root = null;
            }
        }
        if (root == null) {
            if (!hasPendingAdds) {
                views.setTextViewText(R.id.widget_meta, "打开应用同步");
                views.setTextViewText(R.id.widget_empty, "待办数据格式异常，打开应用后会重新同步");
                views.setTextColor(R.id.widget_empty, COLOR_MUTED);
                views.setViewVisibility(R.id.widget_tasks, View.GONE);
                views.setViewVisibility(R.id.widget_empty, View.VISIBLE);
                return views;
            }
            root = new JSONObject();
            try {
                root.put("total", 0);
                root.put("done", 0);
                root.put("date", "");
                root.put("tasks", new JSONArray());
            } catch (JSONException ignored) { /* 固定字段不会失败 */ }
        }

        try {
            JSONObject display = mergePending(context, root);
            String date = display.optString("date", "");
            int total = display.optInt("total", 0);
            int done = display.optInt("done", 0);
            JSONArray tasks = display.optJSONArray("tasks");
            int taskCount = tasks == null ? 0 : tasks.length();

            views.setTextViewText(R.id.widget_date, date);
            String meta = total + " 件待办";
            if (done > 0) meta += " · 已完成 " + done;
            views.setTextViewText(R.id.widget_meta, meta);
            views.setTextColor(R.id.widget_meta, COLOR_ACCENT);

            int visible = 0;
            for (int i = 0; i < rowIds.length; i++) {
                if (i < taskCount && i < maxRows) {
                    JSONObject task = tasks.optJSONObject(i);
                    if (task != null) {
                        String title = task.optString("title", "");
                        String time = task.optString("time", "");
                        boolean overdue = task.optBoolean("overdue", false);
                        boolean pending = task.optBoolean("pending", false);
                        int priority = task.optInt("priority", 3);
                        int count = task.optInt("count", 0);
                        int countTotal = task.optInt("total", 0);

                        // 打卡任务显示 2/3，普通任务显示时间；两者都有时时间在前
                        String suffix = countTotal > 1 ? count + "/" + countTotal : "";
                        String head = time.isEmpty() ? "" : time + "  ";
                        String line = head + title + (suffix.isEmpty() ? "" : "  " + suffix);
                        views.setTextViewText(textIds[i], line);
                        views.setTextColor(
                            textIds[i],
                            overdue || priority == 0 ? COLOR_DANGER : priority == 1 ? COLOR_WARN : COLOR_TEXT
                        );

                        String id = task.optString("id", "");
                        if (!id.isEmpty()) {
                            // 待同步的新任务还没有真实的 DB id，标题点击先回今日页
                            views.setOnClickPendingIntent(
                                textIds[i],
                                pending
                                    ? appIntent(context, Uri.parse("com.personal.workstation://today"), base + 30 + i)
                                    : appIntent(
                                        context,
                                        Uri.parse("com.personal.workstation://task?id=" + Uri.encode(id)),
                                        base + 30 + i
                                    )
                            );
                            // 勾选圈：透明 Activity 立刻完成 + 撒花，不打开 App
                            views.setOnClickPendingIntent(
                                checkIds[i],
                                widgetActivityIntent(context, WidgetCompleteActivity.class, id, base + 10 + i)
                            );
                        }
                        views.setViewVisibility(rowIds[i], View.VISIBLE);
                        visible++;
                    }
                } else {
                    views.setViewVisibility(rowIds[i], View.GONE);
                }
            }

            boolean empty = visible == 0;
            views.setViewVisibility(R.id.widget_tasks, empty ? View.GONE : View.VISIBLE);
            views.setViewVisibility(R.id.widget_empty, empty ? View.VISIBLE : View.GONE);
            if (empty) {
                views.setTextViewText(R.id.widget_empty, "今天没有待办，享受此刻。");
                views.setTextColor(R.id.widget_empty, COLOR_MUTED);
            }
        } catch (JSONException e) {
            views.setTextViewText(R.id.widget_meta, "打开应用同步");
            views.setTextViewText(R.id.widget_empty, "待办数据格式异常，打开应用后会重新同步");
            views.setTextColor(R.id.widget_empty, COLOR_MUTED);
            views.setViewVisibility(R.id.widget_tasks, View.GONE);
            views.setViewVisibility(R.id.widget_empty, View.VISIBLE);
        }
        return views;
    }

    /**
     * 把本地待同步动作叠加到 App 快照上：
     * - 待添加任务排在最前，标题/计数立刻可见
     * - 待勾选任务：普通任务直接消失；打卡任务先 +1，打满才消失
     * 这里只改 RemoteViews 的显示，不写 IndexedDB；等 App 启动后由 take/ack 并入。
     */
    private static JSONObject mergePending(Context context, JSONObject root) throws JSONException {
        JSONArray payloadTasks = root.optJSONArray("tasks");
        JSONArray pendingAdds = TaskWidgetStore.readArray(context, TaskWidgetStore.KEY_PENDING_ADDS);
        JSONArray pendingChecks = TaskWidgetStore.readArray(context, TaskWidgetStore.KEY_PENDING_CHECKS);

        Set<String> payloadIds = new HashSet<>();
        if (payloadTasks != null) {
            for (int i = 0; i < payloadTasks.length(); i++) {
                JSONObject task = payloadTasks.optJSONObject(i);
                if (task != null) payloadIds.add(task.optString("id", ""));
            }
        }

        List<JSONObject> merged = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        int addedCount = 0;
        for (int i = 0; i < pendingAdds.length(); i++) {
            JSONObject add = pendingAdds.optJSONObject(i);
            if (add == null) continue;
            String id = add.optString("id", "");
            if (id.isEmpty() || !seen.add(id)) continue;
            JSONObject task = new JSONObject();
            task.put("id", id);
            task.put("title", add.optString("title", ""));
            task.put("time", "");
            task.put("priority", 2);
            task.put("overdue", false);
            task.put("count", 0);
            task.put("total", 0);
            task.put("pending", true);
            merged.add(task);
            if (!payloadIds.contains(id)) addedCount++;
        }
        if (payloadTasks != null) {
            for (int i = 0; i < payloadTasks.length(); i++) {
                JSONObject task = payloadTasks.optJSONObject(i);
                if (task == null) continue;
                String id = task.optString("id", "");
                if (id.isEmpty() || !seen.add(id)) continue;
                merged.add(new JSONObject(task.toString()));
            }
        }

        int done = root.optInt("done", 0);
        int completed = 0;
        for (int i = 0; i < pendingChecks.length(); i++) {
            JSONObject check = pendingChecks.optJSONObject(i);
            if (check == null) continue;
            String id = check.optString("id", "");
            int index = -1;
            for (int j = 0; j < merged.size(); j++) {
                if (id.equals(merged.get(j).optString("id", ""))) {
                    index = j;
                    break;
                }
            }
            if (index < 0) continue;
            JSONObject task = merged.get(index);
            int total = task.optInt("total", 0);
            int count = task.optInt("count", 0);
            if (total > 1 && count + 1 < total) {
                task.put("count", count + 1);
            } else {
                merged.remove(index);
                done++;
                completed++;
            }
        }

        JSONArray tasks = new JSONArray();
        for (JSONObject task : merged) tasks.put(task);

        JSONObject out = new JSONObject();
        String date = root.optString("date", "");
        if (date.isEmpty()) {
            date = new SimpleDateFormat("M月d日 E", Locale.CHINA).format(new Date());
        }
        out.put("date", date);
        out.put("total", Math.max(0, root.optInt("total", 0) + addedCount - completed));
        out.put("done", done);
        out.put("tasks", tasks);
        return out;
    }
}
