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

/**
 * 今日待办小组件（4x2 标准版 / 2x2 紧凑版）。
 *
 * 小米负一屏（智能助理 → 添加卡片 → 小组件）里通常只能放 2x2 的格子，
 * 所以尺寸不再固定成 250dp 宽：按系统给的 minWidth 自动切布局，
 * 窄格子用 compact 版，桌面上仍是完整的 4 条待办。
 *
 * 数据由 TaskWidgetPlugin 从网页侧同步；点击整张卡回到今日页，
 * 点单条任务则带着 id 深链过去（com.personal.workstation://task?id=…）。
 */
public class TaskWidgetProvider extends AppWidgetProvider {

    static final String PREFS = "task_widget";
    static final String KEY = "payload";

    /** 小于这个宽度就用紧凑布局（2x2 大约 110–180dp） */
    private static final int COMPACT_WIDTH_DP = 220;

    private static final int COLOR_TEXT = Color.parseColor("#201F1D");
    private static final int COLOR_MUTED = Color.parseColor("#8B887F");
    private static final int COLOR_ACCENT = Color.parseColor("#2C55B8");
    private static final int COLOR_DANGER = Color.parseColor("#E5484D");
    private static final int COLOR_WARN = Color.parseColor("#B7791F");

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

    private static RemoteViews build(Context context, int appWidgetId) {
        boolean compact = isCompact(context, appWidgetId);
        RemoteViews views = new RemoteViews(
            context.getPackageName(),
            compact ? R.layout.widget_tasks_compact : R.layout.widget_tasks
        );

        // 整卡：回今日页
        views.setOnClickPendingIntent(
            R.id.widget_root,
            appIntent(context, Uri.parse("com.personal.workstation://today"), 0)
        );

        int[] rowIds = {R.id.widget_task_1, R.id.widget_task_2, R.id.widget_task_3, R.id.widget_task_4};
        int maxRows = compact ? 3 : 4;

        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY, null);

        if (raw == null || raw.isEmpty()) {
            views.setTextViewText(R.id.widget_meta, "打开应用同步");
            views.setTextViewText(R.id.widget_empty, "打开应用后自动同步今日待办");
            views.setTextColor(R.id.widget_empty, COLOR_MUTED);
            views.setViewVisibility(R.id.widget_tasks, View.GONE);
            views.setViewVisibility(R.id.widget_empty, View.VISIBLE);
            return views;
        }

        try {
            JSONObject root = new JSONObject(raw);
            String date = root.optString("date", "");
            int total = root.optInt("total", 0);
            int done = root.optInt("done", 0);
            JSONArray tasks = root.optJSONArray("tasks");
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
                        int priority = task.optInt("priority", 3);
                        int count = task.optInt("count", 0);
                        int countTotal = task.optInt("total", 0);

                        // 打卡任务显示 2/3，普通任务显示时间；两者都有时时间在前
                        String suffix = countTotal > 1 ? count + "/" + countTotal : "";
                        String head = time.isEmpty() ? "" : time + "  ";
                        String line = "•  " + head + title + (suffix.isEmpty() ? "" : "  " + suffix);
                        views.setTextViewText(rowIds[i], line);
                        views.setTextColor(
                            rowIds[i],
                            overdue || priority == 0 ? COLOR_DANGER : priority == 1 ? COLOR_WARN : COLOR_TEXT
                        );

                        // 单条点击 → 定位到这条任务（负一屏里点开就能直接干活）
                        String id = task.optString("id", "");
                        if (!id.isEmpty()) {
                            views.setOnClickPendingIntent(
                                rowIds[i],
                                appIntent(
                                    context,
                                    Uri.parse("com.personal.workstation://task?id=" + Uri.encode(id)),
                                    100 + i
                                )
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
}
