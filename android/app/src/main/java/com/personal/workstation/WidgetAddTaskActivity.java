package com.personal.workstation;

import android.os.Bundle;
import android.text.TextUtils;
import android.util.DisplayMetrics;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.UUID;

/**
 * 小组件「+」弹出的原生添加框：只收标题，默认进「今日」。
 * 写完待同步队列立刻刷新小组件，不打开 App；App 下次启动/回前台时并入 Dexie。
 */
public class WidgetAddTaskActivity extends AppCompatActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setFinishOnTouchOutside(true);
        setContentView(R.layout.widget_add_dialog);

        Window window = getWindow();
        if (window != null) {
            window.setBackgroundDrawableResource(android.R.color.transparent);
            window.setSoftInputMode(
                WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE
                    | WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
            );
            DisplayMetrics dm = getResources().getDisplayMetrics();
            int width = Math.min((int) (dm.widthPixels * 0.9f), (int) (520 * dm.density));
            window.setLayout(width, ViewGroup.LayoutParams.WRAP_CONTENT);
        }

        EditText input = findViewById(R.id.widget_add_input);
        input.requestFocus();
        input.postDelayed(() -> {
            InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (imm != null) imm.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT);
        }, 160);

        findViewById(R.id.widget_add_cancel).setOnClickListener(v -> finish());
        findViewById(R.id.widget_add_save).setOnClickListener(v -> {
            String title = input.getText().toString().trim();
            if (TextUtils.isEmpty(title)) {
                input.setError(getString(R.string.task_widget_add_empty));
                return;
            }
            JSONObject task = new JSONObject();
            try {
                task.put("id", "widget-" + UUID.randomUUID());
                task.put("title", title.length() > 80 ? title.substring(0, 80) : title);
                task.put("tier", "today");
                task.put("createdAt", System.currentTimeMillis());
            } catch (JSONException ignored) {
                return;
            }
            TaskWidgetStore.addPendingAdd(this, task);
            TaskWidgetProvider.refreshAll(this);
            Toast.makeText(this, R.string.task_widget_added, Toast.LENGTH_SHORT).show();
            finish();
        });
    }
}
