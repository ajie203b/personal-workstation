package com.personal.workstation;

import android.os.Bundle;
import android.text.TextUtils;
import android.util.DisplayMetrics;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.UUID;

/**
 * 小组件「+」弹出的原生悬浮快速添加卡片：
 * - 自适应系统浅/深色（Porcelain Frost / Obsidian Sapphire）
 * - 支持一键选择优先级（常规 / 重要 / 紧急）与键盘完成键直接提交
 * - 写入待同步队列后立刻刷新小组件并伴随轻快触感反馈，不打开主 App
 */
public class WidgetAddTaskActivity extends AppCompatActivity {

    private int selectedPriority = 2;

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
            int width = Math.min((int) (dm.widthPixels * 0.9f), (int) (460 * dm.density));
            window.setLayout(width, ViewGroup.LayoutParams.WRAP_CONTENT);
        }

        EditText input = findViewById(R.id.widget_add_input);
        TextView prioNormal = findViewById(R.id.widget_prio_normal);
        TextView prioHigh = findViewById(R.id.widget_prio_high);
        TextView prioUrgent = findViewById(R.id.widget_prio_urgent);

        Runnable syncChips = () -> {
            prioNormal.setSelected(selectedPriority == 2);
            prioHigh.setSelected(selectedPriority == 1);
            prioUrgent.setSelected(selectedPriority == 0);
        };
        syncChips.run();

        prioNormal.setOnClickListener(v -> { selectedPriority = 2; syncChips.run(); });
        prioHigh.setOnClickListener(v -> { selectedPriority = 1; syncChips.run(); });
        prioUrgent.setOnClickListener(v -> { selectedPriority = 0; syncChips.run(); });

        Runnable submit = () -> {
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
                task.put("priority", selectedPriority);
                task.put("createdAt", System.currentTimeMillis());
            } catch (JSONException ignored) {
                return;
            }
            TaskWidgetStore.addPendingAdd(this, task);
            TaskWidgetProvider.refreshAll(this);
            WidgetCompleteActivity.vibrateSuccess(this);
            Toast.makeText(this, R.string.task_widget_added, Toast.LENGTH_SHORT).show();
            finish();
        };

        input.requestFocus();
        input.postDelayed(() -> {
            InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (imm != null) imm.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT);
        }, 160);
        input.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE
                || (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER && event.getAction() == KeyEvent.ACTION_DOWN)) {
                submit.run();
                return true;
            }
            return false;
        });

        findViewById(R.id.widget_add_cancel).setOnClickListener(v -> finish());
        findViewById(R.id.widget_add_save).setOnClickListener(v -> submit.run());
    }
}
