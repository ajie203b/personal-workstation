package com.personal.workstation;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Paint;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;

import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 极简今日待办桌面小组件：
 * - 自适应系统浅/深色纯色留白容器，无渐变与多层嵌套卡片
 * - 单行顶栏：标题 + 轻量计数 + 极简圆形「+」
 * - 扁平任务行：细空心勾选圆 + 单行标题 + 右侧轻量纯文本进度/时间
 * - 保留 340ms 完成微反馈与 WidgetCompleteActivity 原位动效
 */
public class TaskWidgetProvider extends AppWidgetProvider {

    /** 小米 Widget 展现刷新（曝光触发，见小米小部件技术规范 2） */
    private static final String MIUI_APPWIDGET_UPDATE = "miui.appwidget.action.APPWIDGET_UPDATE";

    private static final int MAX_ROWS = 4;
    private static final long COMPLETE_FLASH_MS = 340L;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final Set<String> COMPLETING_IDS = new HashSet<>();

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (MIUI_APPWIDGET_UPDATE.equals(action)
            || Intent.ACTION_DATE_CHANGED.equals(action)
            || Intent.ACTION_TIME_CHANGED.equals(action)
            || Intent.ACTION_TIMEZONE_CHANGED.equals(action)
            || Intent.ACTION_BOOT_COMPLETED.equals(action)) {
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

    /**
     * 立即落库待同步完成动作，并先在小组件内展示 340ms 翠绿对勾 + 删除线闪动反馈，
     * 随后自动清掉已完成行。返回完成后的剩余待办数（用于判断是否触发「全部清空」胶囊）。
     */
    static int completeWithFlash(Context context, String taskId) {
        Context appContext = context.getApplicationContext();
        TaskWidgetStore.complete(appContext, taskId);
        synchronized (COMPLETING_IDS) {
            COMPLETING_IDS.add(taskId);
        }
        refreshAll(appContext);

        int remainingAfter = computeRemainingCount(appContext);
        MAIN.postDelayed(() -> {
            synchronized (COMPLETING_IDS) {
                COMPLETING_IDS.remove(taskId);
            }
            refreshAll(appContext);
        }, COMPLETE_FLASH_MS);
        return remainingAfter;
    }

    private static int computeRemainingCount(Context context) {
        try {
            JSONObject snapshot = TaskWidgetStore.take(context);
            String raw = snapshot.optString("payload", "");
            JSONArray saved = raw.isEmpty() ? new JSONArray() : new JSONObject(raw).optJSONArray("tasks");
            JSONArray after = mergePending(snapshot, saved == null ? new JSONArray() : saved, null, null);
            return after.length();
        } catch (JSONException ignored) {
            return -1;
        }
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

    private static PendingIntent completeIntent(Context context, String taskId, String title, int nextCount, int total) {
        Intent intent = new Intent(context, WidgetCompleteActivity.class);
        // 保持稳定 taskId 身份：过期的桌面行绝不会误勾下一条顶上来的任务
        intent.setData(Uri.parse("kairos-widget://complete/" + Uri.encode(taskId)));
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS);
        intent.putExtra("task_id", taskId);
        intent.putExtra("task_title", title);
        intent.putExtra("habit_next_count", nextCount);
        intent.putExtra("habit_total", total);
        return PendingIntent.getActivity(
            context,
            taskId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static RemoteViews build(Context context, int appWidgetId) {
        JSONObject snapshot = TaskWidgetStore.take(context);
        JSONArray tasks = new JSONArray();
        String hint = context.getString(R.string.task_widget_all_done);
        String dateLabel = "";
        String savedDay = "";
        int doneCount = 0;
        String raw = snapshot.optString("payload", "");
        JSONArray saved = null;
        try {
            if (!raw.isEmpty()) {
                JSONObject obj = new JSONObject(raw);
                saved = obj.optJSONArray("tasks");
                dateLabel = obj.optString("date", "");
                savedDay = obj.optString("day", "");
                doneCount = obj.optInt("done", 0);
            }
        } catch (JSONException ignored) { /* 仍然显示本地待同步任务 */ }
        String todayDay = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        boolean staleDay = !savedDay.isEmpty() && !savedDay.equals(todayDay);
        if (saved == null) {
            hint = raw.isEmpty() ? "打开应用后同步待办" : "打开应用以重新同步";
        } else if (staleDay) {
            // 跨日后不再沿用昨天的「今日已完成」计数，避免误显示「今日待办已清空」
            doneCount = 0;
            hint = context.getString(R.string.task_widget_stale_day);
        }

        Set<String> completingSnapshot;
        synchronized (COMPLETING_IDS) {
            completingSnapshot = COMPLETING_IDS.isEmpty() ? null : new HashSet<>(COMPLETING_IDS);
        }

        try {
            int[] completedDelta = new int[] {0};
            tasks = mergePending(snapshot, saved == null ? new JSONArray() : saved, completingSnapshot, completedDelta);
            doneCount += completedDelta[0];
        } catch (JSONException e) {
            hint = "打开应用以重新同步";
        }

        int activeCount = 0;
        for (int i = 0; i < tasks.length(); i++) {
            JSONObject item = tasks.optJSONObject(i);
            if (item != null && !item.optBoolean("completing")) activeCount++;
        }

        int rows = Math.min(MAX_ROWS, tasks.length());
        if (rows <= 1) return layout(context, appWidgetId, tasks, rows, activeCount, doneCount, dateLabel, hint);

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
                    layout(context, appWidgetId, tasks, count, activeCount, doneCount, dateLabel, hint));
            }
            return new RemoteViews(sizes);
        }

        int landscape = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110);
        int portrait = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, landscape);
        int landscapeRows = Math.max(1, Math.min(rows, (int) ((landscape - header) / rowHeight)));
        int portraitRows = Math.max(1, Math.min(rows, (int) ((portrait - header) / rowHeight)));
        RemoteViews normal = layout(context, appWidgetId, tasks, portraitRows, activeCount, doneCount, dateLabel, hint);
        return landscapeRows == portraitRows ? normal : new RemoteViews(
            layout(context, appWidgetId, tasks, landscapeRows, activeCount, doneCount, dateLabel, hint), normal);
    }

    private static RemoteViews layout(
        Context context,
        int appWidgetId,
        JSONArray tasks,
        int rows,
        int activeCount,
        int doneCount,
        String dateLabel,
        String hint
    ) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_tasks);
        int base = appWidgetId * 100;
        PendingIntent today = appIntent(context, Uri.parse("com.personal.workstation://today"), base);
        views.setOnClickPendingIntent(R.id.widget_root, today);
        views.setOnClickPendingIntent(R.id.widget_add,
            widgetActivityIntent(context, WidgetAddTaskActivity.class, null, base + 1));

        // 极简顶栏轻量计数（颜色走 XML @color/widget_text_secondary，随系统深浅色即时切换）
        if (activeCount > 0) {
            views.setViewVisibility(R.id.widget_count, View.VISIBLE);
            views.setTextViewText(R.id.widget_count, String.valueOf(activeCount));
        } else {
            views.setViewVisibility(R.id.widget_count, View.INVISIBLE);
            views.setTextViewText(R.id.widget_count, "");
        }

        views.removeAllViews(R.id.widget_tasks);
        if (rows == 0) {
            views.setViewVisibility(R.id.widget_empty_wrap, View.VISIBLE);
            views.setTextViewText(R.id.widget_empty, doneCount > 0 ? context.getString(R.string.task_widget_all_done) : hint);
            return views;
        }
        views.setViewVisibility(R.id.widget_empty_wrap, View.GONE);

        for (int i = 0; i < rows; i++) {
            JSONObject task = tasks.optJSONObject(i);
            if (task == null) continue;
            String id = task.optString("id");
            String title = task.optString("title");
            String time = task.optString("time", "");
            int priority = task.optInt("priority", 2);
            boolean overdue = task.optBoolean("overdue");
            boolean completing = task.optBoolean("completing");
            boolean checkedFlash = task.optBoolean("checkedFlash");
            int count = task.optInt("count");
            int total = task.optInt("total");

            RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_task_row);
            row.setTextViewText(R.id.widget_task, title);

            if (completing) {
                row.setInt(R.id.widget_row_card, "setBackgroundResource", R.drawable.widget_row_done_bg);
                row.setImageViewResource(R.id.widget_check, R.drawable.widget_check_done);
                setDynamicTextColor(context, row, R.id.widget_task, R.color.widget_text_done);
                row.setInt(R.id.widget_task, "setPaintFlags", Paint.ANTI_ALIAS_FLAG | Paint.STRIKE_THRU_TEXT_FLAG);
            } else if (checkedFlash) {
                row.setInt(R.id.widget_row_card, "setBackgroundResource", R.drawable.widget_row_done_bg);
                row.setImageViewResource(R.id.widget_check, R.drawable.widget_check_done);
                // 默认文字色已在 widget_task_row.xml 绑定 @color/widget_text_primary，不写静态 ARGB
                row.setInt(R.id.widget_task, "setPaintFlags", Paint.ANTI_ALIAS_FLAG);
            } else {
                row.setInt(R.id.widget_row_card, "setBackgroundResource", R.drawable.widget_row_bg);
                int checkRes = (overdue || priority == 0) ? R.drawable.widget_check_p0
                    : priority == 1 ? R.drawable.widget_check_p1 : R.drawable.widget_check;
                row.setImageViewResource(R.id.widget_check, checkRes);
                row.setInt(R.id.widget_task, "setPaintFlags", Paint.ANTI_ALIAS_FLAG);
            }

            PendingIntent open = task.optBoolean("pending") ? today : appIntent(context,
                Uri.parse("com.personal.workstation://task?id=" + Uri.encode(id)), base + 30 + i);
            row.setOnClickPendingIntent(R.id.widget_task, open);
            row.setContentDescription(R.id.widget_check, (total > 1 ? "打卡：" : "完成：") + title);
            if (!completing) {
                row.setOnClickPendingIntent(R.id.widget_check, completeIntent(context, id, title, count + 1, total));
            }

            // 右侧轻量纯文本：打卡进度 / 逾期 / 截止时间（默认走 XML @color/widget_chip_text，仅逾期动态切 danger 资源）
            if (total > 1) {
                row.setViewVisibility(R.id.widget_progress, View.VISIBLE);
                row.setTextViewText(R.id.widget_progress, count + "/" + total);
                row.setOnClickPendingIntent(R.id.widget_progress, open);
            } else if (overdue && !completing) {
                row.setViewVisibility(R.id.widget_progress, View.VISIBLE);
                row.setTextViewText(R.id.widget_progress, "逾期");
                setDynamicTextColor(context, row, R.id.widget_progress, R.color.widget_danger);
                row.setOnClickPendingIntent(R.id.widget_progress, open);
            } else if (!time.isEmpty()) {
                row.setViewVisibility(R.id.widget_progress, View.VISIBLE);
                row.setTextViewText(R.id.widget_progress, time);
                row.setOnClickPendingIntent(R.id.widget_progress, open);
            } else {
                row.setViewVisibility(R.id.widget_progress, View.GONE);
            }

            views.addView(R.id.widget_tasks, row);
        }
        return views;
    }

    /**
     * 动态绑定颜色资源而非硬编码 ARGB 整数：
     * Android 12+（API 31+）直接传 @ColorRes 给 RemoteViews.setColor，系统切换深浅主题时
     * 桌面启动器会立刻按 values / values-night 重解析，无需等待或手动点击刷新。
     */
    private static void setDynamicTextColor(Context context, RemoteViews views, int viewId, int colorRes) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            views.setColor(viewId, "setTextColor", colorRes);
        } else {
            views.setTextColor(viewId, ContextCompat.getColor(context, colorRes));
        }
    }

    /**
     * 把本地待同步动作叠加到 App 快照上：
     * - 待添加任务排在最前，标题/优先级立刻可见
     * - 待勾选任务：刚勾选 340ms 内保留为 completing 态展示翠绿对勾 + 删除线，之后再移除；
     *   打卡任务先 +1，打满才移除。
     */
    private static JSONArray mergePending(
        JSONObject snapshot,
        JSONArray payloadTasks,
        Set<String> completingIds,
        int[] completedDelta
    ) throws JSONException {
        JSONArray pendingAdds = snapshot.optJSONArray("adds");
        JSONArray pendingChecks = snapshot.optJSONArray("checks");

        List<JSONObject> merged = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        if (pendingAdds != null) {
            for (int i = 0; i < pendingAdds.length(); i++) {
                JSONObject add = pendingAdds.optJSONObject(i);
                if (add == null) continue;
                String id = add.optString("id", "");
                if (id.isEmpty() || !seen.add(id)) continue;
                JSONObject task = new JSONObject();
                task.put("id", id);
                task.put("title", add.optString("title", ""));
                task.put("time", "");
                task.put("priority", add.optInt("priority", 2));
                task.put("overdue", false);
                task.put("count", 0);
                task.put("total", 0);
                task.put("pending", true);
                merged.add(task);
            }
        }
        for (int i = 0; i < payloadTasks.length(); i++) {
            JSONObject task = payloadTasks.optJSONObject(i);
            if (task == null) continue;
            String id = task.optString("id", "");
            if (id.isEmpty() || !seen.add(id)) continue;
            merged.add(new JSONObject(task.toString()));
        }

        if (pendingChecks != null) {
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
                boolean flashing = completingIds != null && completingIds.contains(id);
                if (total > 1 && count + 1 < total) {
                    task.put("count", count + 1);
                    if (flashing) task.put("checkedFlash", true);
                } else if (flashing) {
                    task.put("completing", true);
                    if (completedDelta != null) completedDelta[0]++;
                } else {
                    merged.remove(index);
                    if (completedDelta != null) completedDelta[0]++;
                }
            }
        }

        JSONArray tasks = new JSONArray();
        for (JSONObject task : merged) tasks.put(task);
        return tasks;
    }
}
