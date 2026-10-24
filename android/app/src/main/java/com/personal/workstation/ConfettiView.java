package com.personal.workstation;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.os.SystemClock;
import android.view.View;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/**
 * 小组件完成任务的透明撒花层：与 App 内同一套五色纸片，
 * 从屏幕中上方扇形喷出、重力回落、翻面变暗，约 2.5 秒落尽。
 * 只负责画，不接触摸；Activity 用 FLAG_NOT_TOUCHABLE 让它透传给桌面。
 */
public class ConfettiView extends View {

    private static final int COUNT = 100;
    private static final float LIFE_SECONDS = 2.5f;
    private static final float FADE_TAIL = 0.6f;

    private static final int[][] COLORS = {
        {Color.parseColor("#3B82F6"), Color.parseColor("#1E4FA8")},
        {Color.parseColor("#22A06B"), Color.parseColor("#146B47")},
        {Color.parseColor("#F0B451"), Color.parseColor("#A97718")},
        {Color.parseColor("#E5484D"), Color.parseColor("#98242A")},
        {Color.parseColor("#8B5CF6"), Color.parseColor("#5B32B8")},
    };

    private static final class Piece {
        float x;
        float y;
        float vx;
        float vy;
        float w;
        float h;
        float rot;
        float vr;
        float phase;
        int front;
        int back;
        int shape; // 0 长条 / 1 圆点 / 2 方块
    }

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Random random = new Random();
    private final List<Piece> pieces = new ArrayList<>();

    private float density = 1f;
    private long startedAt;
    private long lastFrame;
    private boolean initialized;

    public ConfettiView(Context context) {
        super(context);
        density = getResources().getDisplayMetrics().density;
        setBackgroundColor(Color.TRANSPARENT);
    }

    public void start() {
        startedAt = SystemClock.elapsedRealtime();
        lastFrame = startedAt;
        initialized = false;
        invalidate();
    }

    private void initPieces() {
        float width = getWidth();
        float height = getHeight();
        if (width <= 0 || height <= 0) return;
        initialized = true;
        float originX = width / 2f;
        float originY = height * 0.44f;

        for (int i = 0; i < COUNT; i++) {
            Piece p = new Piece();
            double angle = Math.toRadians(-90 + (random.nextDouble() * 2 - 1) * 35);
            float speed = (320f + random.nextFloat() * 420f) * density;
            p.x = originX + (random.nextFloat() - 0.5f) * 10f * density;
            p.y = originY + (random.nextFloat() - 0.5f) * 6f * density;
            p.vx = (float) Math.cos(angle) * speed;
            p.vy = (float) Math.sin(angle) * speed;
            p.shape = i % 3;
            p.w = (p.shape == 0 ? 9f + random.nextFloat() * 5f
                : p.shape == 1 ? 3f + random.nextFloat() * 2f
                : 4f + random.nextFloat() * 2.5f) * density;
            p.h = p.shape == 0 ? (3f + random.nextFloat() * 1.8f) * density : p.w;
            p.rot = random.nextFloat() * 360f;
            p.vr = (random.nextFloat() * 2 - 1) * 320f;
            p.phase = random.nextFloat() * (float) Math.PI * 2;
            int[] pair = COLORS[i % COLORS.length];
            p.front = pair[0];
            p.back = pair[1];
            pieces.add(p);
        }
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        if (startedAt == 0) return;
        if (!initialized) {
            initPieces();
            if (!initialized) {
                postInvalidateOnAnimation();
                return;
            }
        }
        if (pieces.isEmpty()) return;

        long now = SystemClock.elapsedRealtime();
        float dt = Math.min(0.05f, Math.max(0.001f, (now - lastFrame) / 1000f));
        lastFrame = now;
        float age = (now - startedAt) / 1000f;
        if (age > LIFE_SECONDS + 0.2f) return;

        for (Piece p : pieces) {
            p.vy += 520f * density * dt;
            p.vx *= Math.max(0f, 1f - 1.4f * dt);
            p.vy *= Math.max(0f, 1f - 0.9f * dt);
            p.x += (p.vx + (float) Math.sin(p.phase + age * 6f) * 26f * density) * dt;
            p.y += p.vy * dt;
            p.rot += p.vr * dt;

            float tail = LIFE_SECONDS - age;
            float alpha = tail < FADE_TAIL ? Math.max(0f, tail / FADE_TAIL) : 1f;
            if (alpha <= 0f) continue;

            float flip = (float) Math.cos(p.phase + age * 6f);
            float scaleY = Math.abs(flip) < 0.08f ? 0.08f : flip;

            paint.setColor(flip < 0 ? p.back : p.front);
            paint.setAlpha(Math.round(alpha * 255));
            canvas.save();
            canvas.translate(p.x, p.y);
            canvas.rotate(p.rot);
            canvas.scale(1f, scaleY);
            if (p.shape == 1) {
                canvas.drawCircle(0f, 0f, p.w / 2f, paint);
            } else {
                canvas.drawRect(-p.w / 2f, -p.h / 2f, p.w / 2f, p.h / 2f, paint);
            }
            canvas.restore();
        }

        if (age < LIFE_SECONDS) {
            postInvalidateOnAnimation();
        }
    }
}
