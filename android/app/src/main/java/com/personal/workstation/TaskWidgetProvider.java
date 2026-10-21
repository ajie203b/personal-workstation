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
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * 今日待办小组件（4x2，桌面/小米负一屏都能放）。
 * 数据由 TaskWidgetPlugin 从网页侧同步；点击整张卡回到今日页。
 */
public class TaskWidgetProvider extends AppWidgetProvider {

    static final String PREFS = "task_widget";
    static final String KEY = "payload";

    private static final int COLOR_TEXT = Color.parseColor("#201F1D");
    private static final int COLOR_MUTED = Color.parseColor("#8B887F");
    private static final int COLOR_ACCENT = Color.parseColor("#2C55B8");
    private static final int COLOR_DANGER = Color.parseColor("#E5484D");
    private static final int COLOR_WARN = Color.parseColor("#B7791F");

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            appWidgetManager.updateAppWidget(id, build(context));
        }
    }

    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName name = new ComponentName(context, TaskWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(name);
        for (int id : ids) manager.updateAppWidget(id, build(context));
    }

    private static RemoteViews build(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_tasks);

        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(Intent.ACTION_VIEW);
        intent.setData(Uri.parse("com.personal.workstation://today"));
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_root, pending);

        int[] rowIds = {R.id.widget_task_1, R.id.widget_task_2, R.id.widget_task_3, R.id.widget_task_4};
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
                if (i < taskCount) {
                    JSONObject task = tasks.optJSONObject(i);
                    if (task != null) {
                        String title = task.optString("title", "");
                        String time = task.optString("time", "");
                        boolean overdue = task.optBoolean("overdue", false);
                        int priority = task.optInt("priority", 3);
                        String line = (time.isEmpty() ? "•  " : time + "  ") + title;
                        views.setTextViewText(rowIds[i], line);
                        views.setTextColor(
                            rowIds[i],
                            overdue || priority == 0 ? COLOR_DANGER : priority == 1 ? COLOR_WARN : COLOR_TEXT
                        );
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
