package com.personal.workstation;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.Window;
import android.view.WindowManager;

/**
 * 小组件勾选后的透明流光庆祝层：
 * - 不打开主 App、无窗口进出闪烁、约 1.38 秒自动消失
 * - 从被点击勾选圈的精确坐标绽放翡翠光环 + 对勾微印 + 四色流光星芒 + 顶部灵动确认胶囊
 * - 140ms 后立即释放触摸穿透（FLAG_NOT_TOUCHABLE），不挡用户继续划桌面或连点任务
 */
public class WidgetCompleteActivity extends Activity {

    private static final long EFFECT_MS = 1_380;
    private static final long RELEASE_TOUCH_MS = 140;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable finishTask = this::finishQuietly;
    private final Runnable releaseTouchTask = () -> {
        Window window = getWindow();
        if (window != null) {
            window.addFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE);
        }
    };

    private ConfettiView confettiView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        suppressTransition();

        Window window = getWindow();
        if (window != null) {
            WindowManager.LayoutParams params = window.getAttributes();
            params.flags |= WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                params.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            }
            window.setAttributes(params);
            window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        }

        confettiView = new ConfettiView(this);
        setContentView(confettiView);

        handleCompletionIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleCompletionIntent(intent);
    }

    private void handleCompletionIntent(Intent intent) {
        if (intent == null) {
            finishQuietly();
            return;
        }
        String taskId = intent.getStringExtra("task_id");
        String title = intent.getStringExtra("task_title");
        int nextCount = intent.getIntExtra("habit_next_count", 0);
        int total = intent.getIntExtra("habit_total", 0);

        int remainingAfter = -1;
        if (taskId != null && !taskId.isEmpty()) {
            remainingAfter = TaskWidgetProvider.completeWithFlash(this, taskId);
        }

        vibrateSuccess();

        String cleanTitle = title == null ? "" : title.trim();
        String banner;
        boolean allDone = false;
        if (total > 1 && nextCount > 0 && nextCount < total) {
            banner = cleanTitle.isEmpty()
                ? "打卡 " + nextCount + "/" + total
                : "打卡 " + nextCount + "/" + total + " · " + cleanTitle;
        } else if (remainingAfter == 0) {
            banner = getString(R.string.task_widget_all_done);
            allDone = true;
        } else {
            banner = cleanTitle.isEmpty() ? "已完成任务" : "已完成 · " + cleanTitle;
        }

        confettiView.triggerBurst(intent.getSourceBounds(), banner, allDone);

        handler.removeCallbacks(releaseTouchTask);
        handler.postDelayed(releaseTouchTask, RELEASE_TOUCH_MS);

        handler.removeCallbacks(finishTask);
        handler.postDelayed(finishTask, EFFECT_MS);
    }

    private void finishQuietly() {
        finish();
        suppressTransition();
    }

    private void suppressTransition() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            overrideActivityTransition(OVERRIDE_TRANSITION_OPEN, 0, 0);
            overrideActivityTransition(OVERRIDE_TRANSITION_CLOSE, 0, 0);
        } else {
            //noinspection deprecation
            overridePendingTransition(0, 0);
        }
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(releaseTouchTask);
        handler.removeCallbacks(finishTask);
        super.onDestroy();
    }

    static void vibrateSuccess(Context context) {
        try {
            Vibrator vibrator;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager manager = (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                vibrator = manager == null ? null : manager.getDefaultVibrator();
            } else {
                //noinspection deprecation
                vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            }
            if (vibrator == null || !vibrator.hasVibrator()) return;
            long[] pattern = {0, 10, 42, 16};
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                int[] amplitudes = {0, 150, 0, 230};
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, amplitudes, -1));
            } else {
                //noinspection deprecation
                vibrator.vibrate(pattern, -1);
            }
        } catch (Exception ignored) {
            /* 没有马达不影响任务完成 */
        }
    }

    private void vibrateSuccess() {
        vibrateSuccess(this);
    }
}
