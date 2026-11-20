package com.personal.workstation;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 今日待办小组件：标题栏快速添加，按可用高度展示任务和打卡进度。
 *
 * 小米负一屏主池只收录 MIUI 适配过的卡片；未收录的第三方卡片会显示「努力适配中」。
 * 本组件不再声明 miuiWidget，统一走系统「安卓小组件」入口，避免那个占位提示。
 *
 * 数据由 TaskWidgetPlugin 从网页侧同步；本地待同步队列（TaskWidgetStore）叠加在快照上：
 * - 右上「+」：原生添加框，直接写入队列并刷新
 * - 勾选圈：私有广播立即完成并写队列，不启动 Activity
 * App 启动/回前台时通过 TaskWidgetPlugin 的 take/ack 把队列并进 IndexedDB。
 */
public class TaskWidgetProvider extends AppWidgetProvider {


    /** 小米 Widget 展现刷新（曝光触发，见小米小部件技术规范 2） */
    private static final String MIUI_APPWIDGET_UPDATE = "miui.appwidget.action.APPWIDGET_UPDATE";

    private static final int COLOR_TEXT = Color.parseColor("#201F1D");
    private static final int MAX_ROWS = 4;
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
        refresh(context, appWidgetIds);
    }

    /** 用户在桌面/负一屏拉伸格子后立刻重排，不用等下一次任务变动 */
    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager appWidgetManager, int appWidgetId, Bundle newOptions) {
        refresh(context, new int[] {appWidgetId});
    }

    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName name = new ComponentName(context, TaskWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(name);
        refresh(context, ids);
    }

    private static synchronized void refresh(Context context, int[] ids) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        for (int id : ids) manager.updateAppWidget(id, build(context, id));
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

    private static PendingIntent completeIntent(Context context, String taskId) {
        Intent intent = new Intent(context, WidgetCompleteReceiver.class);
        // Stable task identity instead of row identity: a stale launcher row must
        // never complete the next task that happens to occupy the same row.
        intent.setData(Uri.parse("kairos-widget://complete/" + Uri.encode(taskId)));
        intent.putExtra("task_id", taskId);
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static RemoteViews build(Context context, int appWidgetId) {
        JSONObject snapshot = TaskWidgetStore.take(context);
        JSONArray tasks = new JSONArray();
        String hint = "暂无待办";
        String raw = snapshot.optString("payload", "");
        JSONArray saved = null;
        try {
            if (!raw.isEmpty()) saved = new JSONObject(raw).optJSONArray("tasks");
        } catch (JSONException ignored) { /* 仍然显示本地待同步任务 */ }
        if (saved == null) hint = raw.isEmpty() ? "打开应用后同步待办" : "打开应用以重新同步";
        try {
            tasks = mergePending(snapshot, saved == null ? new JSONArray() : saved);
        } catch (JSONException e) {
            hint = "打开应用以重新同步";
        }

        int rows = Math.min(MAX_ROWS, tasks.length());
        if (rows <= 1) return layout(context, appWidgetId, tasks, rows, hint);

        float density = context.getResources().getDisplayMetrics().density;
        float header = (2 * context.getResources().getDimension(R.dimen.widget_padding)
            + context.getResources().getDimension(R.dimen.widget_header_height)) / density;
        float rowHeight = context.getResources().getDimension(R.dimen.widget_row_height) / density;
        Bundle options = AppWidgetManager.getInstance(context).getAppWidgetOptions(appWidgetId);
        List<SizeF> hostSizes = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            ? options.getParcelableArrayList(AppWidgetManager.OPTION_APPWIDGET_SIZES) : null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && hostSizes != null && !hostSizes.isEmpty()) {
            // 由启动器按实际分配的高度选择整行布局，横竖屏和拉伸都生效。
            Map<SizeF, RemoteViews> sizes = new LinkedHashMap<>();
            for (int count = 1; count <= rows; count++) {
                sizes.put(new SizeF(1, Math.round(header + count * rowHeight)),
                    layout(context, appWidgetId, tasks, count, hint));
            }
            return new RemoteViews(sizes);
        }

        int landscape = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110);
        int portrait = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, landscape);
        int landscapeRows = Math.max(1, Math.min(rows, (int) ((landscape - header) / rowHeight)));
        int portraitRows = Math.max(1, Math.min(rows, (int) ((portrait - header) / rowHeight)));
        RemoteViews normal = layout(context, appWidgetId, tasks, portraitRows, hint);
        return landscapeRows == portraitRows ? normal : new RemoteViews(
            layout(context, appWidgetId, tasks, landscapeRows, hint), normal);
    }

    private static RemoteViews layout(Context context, int appWidgetId, JSONArray tasks, int rows, String hint) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_tasks);
        int base = appWidgetId * 100;
        PendingIntent today = appIntent(context, Uri.parse("com.personal.workstation://today"), base);
        views.setOnClickPendingIntent(R.id.widget_root, today);
        views.setOnClickPendingIntent(R.id.widget_add,
            widgetActivityIntent(context, WidgetAddTaskActivity.class, null, base + 1));
        views.removeAllViews(R.id.widget_tasks);
        views.setViewVisibility(R.id.widget_empty, rows == 0 ? View.VISIBLE : View.GONE);
        views.setTextViewText(R.id.widget_empty, hint);

        for (int i = 0; i < rows; i++) {
            JSONObject task = tasks.optJSONObject(i);
            String id = task.optString("id");
            String title = task.optString("title");
            int priority = task.optInt("priority", 3);
            int total = task.optInt("total");
            RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_task_row);
            row.setTextViewText(R.id.widget_task, title);
            row.setTextColor(R.id.widget_task, task.optBoolean("overdue") || priority == 0
                ? COLOR_DANGER : priority == 1 ? COLOR_WARN : COLOR_TEXT);
            PendingIntent open = task.optBoolean("pending") ? today : appIntent(context,
                Uri.parse("com.personal.workstation://task?id=" + Uri.encode(id)), base + 30 + i);
            row.setOnClickPendingIntent(R.id.widget_task, open);
            row.setContentDescription(R.id.widget_check, (total > 1 ? "打卡：" : "完成：") + title);
            row.setOnClickPendingIntent(R.id.widget_check, completeIntent(context, id));
            if (total > 1) {
                row.setViewVisibility(R.id.widget_progress, View.VISIBLE);
                row.setTextViewText(R.id.widget_progress, task.optInt("count") + "/" + total);
                row.setOnClickPendingIntent(R.id.widget_progress, open);
            }
            views.addView(R.id.widget_tasks, row);
        }
        return views;
    }

    /**
     * 把本地待同步动作叠加到 App 快照上：
     * - 待添加任务排在最前，标题/计数立刻可见
     * - 待勾选任务：普通任务直接消失；打卡任务先 +1，打满才消失
     * 这里只改 RemoteViews 的显示，不写 IndexedDB；等 App 启动后由 take/ack 并入。
     */
    private static JSONArray mergePending(JSONObject snapshot, JSONArray payloadTasks) throws JSONException {
        JSONArray pendingAdds = snapshot.optJSONArray("adds");
        JSONArray pendingChecks = snapshot.optJSONArray("checks");

        List<JSONObject> merged = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < pendingAdds.length(); i++) {
            JSONObject add = pendingAdds.optJSONObject(i);
            if (add == null) continue;
            String id = add.optString("id", "");
            if (id.isEmpty() || !seen.add(id)) continue;
            JSONObject task = new JSONObject();
            task.put("id", id);
            task.put("title", add.optString("title", ""));
            task.put("priority", 2);
            task.put("overdue", false);
            task.put("count", 0);
            task.put("total", 0);
            task.put("pending", true);
            merged.add(task);
        }
        for (int i = 0; i < payloadTasks.length(); i++) {
            JSONObject task = payloadTasks.optJSONObject(i);
            if (task == null) continue;
            String id = task.optString("id", "");
            if (id.isEmpty() || !seen.add(id)) continue;
            merged.add(new JSONObject(task.toString()));
        }

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
            }
        }

        JSONArray tasks = new JSONArray();
        for (JSONObject task : merged) tasks.put(task);
        return tasks;
    }
}
