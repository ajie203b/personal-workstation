package com.personal.workstation;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.WindowManager;

/**
 * 小组件勾选后的透明撒花层：不打开 App、不挡触摸，2.6 秒后自动消失。
 * 任务状态先写本地队列并立刻刷新小组件，App 回到前台时再并入 IndexedDB。
 */
public class WidgetCompleteActivity extends Activity {

    private static final long EFFECT_MS = 2_600;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowManager.LayoutParams params = getWindow().getAttributes();
        // 透明全屏但保持可聚焦/可触摸：独立任务栈才会被带到前台，撒花不会藏在桌面后面。
        // 只显示 2.6 秒，短暂占住触摸是可接受的。
        params.flags |= WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS;
        getWindow().setAttributes(params);
        getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));

        String taskId = getIntent().getStringExtra("task_id");
        if (taskId != null && !taskId.isEmpty()) {
            if (TaskWidgetStore.hasPendingAdd(this, taskId)) {
                // 还没同步进 App 的新任务被勾掉：直接从待添加队列移除，不必再让 App 添加
                TaskWidgetStore.removePendingAdd(this, taskId);
            } else {
                TaskWidgetStore.addPendingCheck(this, taskId, System.currentTimeMillis());
            }
            TaskWidgetProvider.refreshAll(this);
        }

        vibrateSuccess();

        ConfettiView confetti = new ConfettiView(this);
        setContentView(confetti);
        confetti.start();

        new Handler(Looper.getMainLooper()).postDelayed(this::finish, EFFECT_MS + 100);
    }

    private void vibrateSuccess() {
        try {
            Vibrator vibrator;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager manager = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                vibrator = manager == null ? null : manager.getDefaultVibrator();
            } else {
                vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            }
            if (vibrator == null || !vibrator.hasVibrator()) return;
            long[] pattern = {0, 10, 36, 14};
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1));
            } else {
                //noinspection deprecation
                vibrator.vibrate(pattern, -1);
            }
        } catch (Exception ignored) {
            /* 没有马达不影响任务完成 */
        }
    }
}
