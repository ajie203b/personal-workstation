package com.personal.workstation;

import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PathMeasure;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.SystemClock;
import android.view.View;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Random;

/**
 * Apple Liquid Glass × Google Material You 小组件完成动效层：
 * 1. 从被点击的勾选圆环坐标原地绽放双层翠绿/天蓝细光环（与 App 内 .done-halo 一脉相承）
 * 2. 原地弹性弹出实心翠绿对勾微印，平滑描边画出白色对勾
 * 3. 四色 xyj + 翠绿宝石微粒（四角星芒、柔光圆珠、圆角微丝带）轻盈散开、1.35s 丝滑消隐
 * 4. 顶部滑出灵动毛玻璃确认胶囊（「已完成 · …」/「打卡 2/3」/「今日待办已清空」），自适应深浅色
 */
public class ConfettiView extends View {

    private static final float PARTICLE_LIFE = 1.32f;
    private static final float HALO_LIFE = 0.48f;
    private static final float STAMP_LIFE = 0.54f;
    private static final float BANNER_LIFE = 1.28f;
    private static final int PARTICLE_COUNT = 42;

    /** Kairos 四色 xyj 基因 + 翠绿完成色 + 极光青 */
    private static final int[][] PALETTE = {
        {Color.parseColor("#10B981"), Color.parseColor("#047857")}, // Emerald
        {Color.parseColor("#2563EB"), Color.parseColor("#1D4ED8")}, // Sapphire
        {Color.parseColor("#38BDF8"), Color.parseColor("#0284C7")}, // Sky
        {Color.parseColor("#F59E0B"), Color.parseColor("#B45309")}, // Amber
        {Color.parseColor("#F43F5E"), Color.parseColor("#BE123C")}, // Rose
        {Color.parseColor("#8B5CF6"), Color.parseColor("#6D28D9")}, // Violet
    };

    private static final class Burst {
        final Rect pendingSourceBounds;
        float originX;
        float originY;
        boolean resolved;
        final long startedAt;
        final List<Particle> particles = new ArrayList<>(PARTICLE_COUNT);

        Burst(Rect sourceBounds, long now) {
            this.pendingSourceBounds = sourceBounds == null ? null : new Rect(sourceBounds);
            this.startedAt = now;
        }
    }

    private static final class Particle {
        float x;
        float y;
        float vx;
        float vy;
        float size;
        float length;
        float rot;
        float vr;
        float phase;
        float life;
        int front;
        int back;
        int shape; // 0 四角星芒 / 1 柔光珠 / 2 圆角微丝带
    }

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint strokePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path checkPath = new Path();
    private final Path drawnPath = new Path();
    private final Path starPath = new Path();
    private final PathMeasure pathMeasure = new PathMeasure();
    private final RectF rectF = new RectF();
    private final int[] viewLoc = new int[2];
    private final Random random = new Random();
    private final List<Burst> bursts = new ArrayList<>();

    private final float density;
    private final boolean darkMode;
    private long lastFrame;

    private String bannerText = "";
    private boolean bannerAllDone = false;
    private long bannerStartedAt = 0L;

    public ConfettiView(Context context) {
        super(context);
        density = getResources().getDisplayMetrics().density;
        int nightMask = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        darkMode = nightMask == Configuration.UI_MODE_NIGHT_YES;
        setBackgroundColor(Color.TRANSPARENT);

        strokePaint.setStyle(Paint.Style.STROKE);
        strokePaint.setStrokeCap(Paint.Cap.ROUND);
        strokePaint.setStrokeJoin(Paint.Join.ROUND);

        textPaint.setTextSize(13.5f * density);
        textPaint.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
    }

    public void triggerBurst(Rect sourceBounds, String text, boolean allDone) {
        long now = SystemClock.elapsedRealtime();
        lastFrame = now;
        bursts.add(new Burst(sourceBounds, now));
        if (text != null && !text.isEmpty()) {
            bannerText = text;
            bannerAllDone = allDone;
            bannerStartedAt = now;
        }
        postInvalidateOnAnimation();
    }

    private void resolveBurst(Burst burst) {
        float w = getWidth();
        float h = getHeight();
        if (w <= 0 || h <= 0) return;

        float ox = w * 0.5f;
        float oy = h * 0.36f;
        if (burst.pendingSourceBounds != null && !burst.pendingSourceBounds.isEmpty()) {
            getLocationOnScreen(viewLoc);
            float sx = burst.pendingSourceBounds.exactCenterX() - viewLoc[0];
            float sy = burst.pendingSourceBounds.exactCenterY() - viewLoc[1];
            float padX = 20f * density;
            float padY = 48f * density;
            if (sx >= 0 && sx <= w && sy >= 0 && sy <= h) {
                ox = Math.max(padX, Math.min(w - padX, sx));
                oy = Math.max(padY, Math.min(h - padY, sy));
            }
        }
        burst.originX = ox;
        burst.originY = oy;
        burst.resolved = true;

        // 16 颗环形近景星芒 + 26 颗向上扬起的流光微粒，兼顾精致感与层次感
        for (int i = 0; i < PARTICLE_COUNT; i++) {
            Particle p = new Particle();
            boolean ringSpark = i < 16;
            double angle;
            float speed;
            if (ringSpark) {
                angle = (Math.PI * 2.0 * i / 16.0) + (random.nextDouble() - 0.5) * 0.28;
                speed = (120f + random.nextFloat() * 145f) * density;
                p.shape = (i % 2 == 0) ? 0 : 1;
                p.life = 0.68f + random.nextFloat() * 0.34f;
            } else {
                angle = Math.toRadians(-90.0 + (random.nextDouble() * 2.0 - 1.0) * 62.0);
                speed = (210f + random.nextFloat() * 290f) * density;
                p.shape = i % 3;
                p.life = 0.92f + random.nextFloat() * 0.4f;
            }
            p.x = ox + (random.nextFloat() - 0.5f) * 6f * density;
            p.y = oy + (random.nextFloat() - 0.5f) * 6f * density;
            p.vx = (float) Math.cos(angle) * speed;
            p.vy = (float) Math.sin(angle) * speed;
            p.size = (p.shape == 0 ? 4.2f + random.nextFloat() * 3.2f
                : p.shape == 1 ? 2.6f + random.nextFloat() * 2.2f
                : 3.1f + random.nextFloat() * 1.4f) * density;
            p.length = (7.2f + random.nextFloat() * 4.5f) * density;
            p.rot = random.nextFloat() * 360f;
            p.vr = (random.nextFloat() * 2f - 1f) * 340f;
            p.phase = random.nextFloat() * (float) Math.PI * 2f;
            int[] pair = PALETTE[i % PALETTE.length];
            p.front = pair[0];
            p.back = pair[1];
            burst.particles.add(p);
        }
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        long now = SystemClock.elapsedRealtime();
        float dt = lastFrame == 0 ? 0.016f : Math.min(0.045f, Math.max(0.001f, (now - lastFrame) / 1000f));
        lastFrame = now;

        boolean keepAnimating = false;

        Iterator<Burst> it = bursts.iterator();
        while (it.hasNext()) {
            Burst b = it.next();
            if (!b.resolved) {
                resolveBurst(b);
                if (!b.resolved) {
                    keepAnimating = true;
                    continue;
                }
            }
            float age = (now - b.startedAt) / 1000f;
            if (age > PARTICLE_LIFE + 0.1f) {
                it.remove();
                continue;
            }
            keepAnimating = true;
            drawHaloRings(canvas, b, age);
            drawCheckStamp(canvas, b, age);
            drawParticles(canvas, b, age, dt);
        }

        if (bannerStartedAt > 0L && !bannerText.isEmpty()) {
            float bannerAge = (now - bannerStartedAt) / 1000f;
            if (bannerAge <= BANNER_LIFE) {
                keepAnimating = true;
                drawBannerPill(canvas, bannerAge);
            }
        }

        if (keepAnimating) {
            postInvalidateOnAnimation();
        }
    }

    private void drawHaloRings(Canvas canvas, Burst b, float age) {
        if (age < HALO_LIFE) {
            float t = age / HALO_LIFE;
            float eased = easeOutCubic(t);
            float radius = (10f + 42f * eased) * density;
            int alpha = Math.round((1f - t) * (1f - t) * 215f);
            strokePaint.setColor(Color.parseColor("#10B981"));
            strokePaint.setAlpha(alpha);
            strokePaint.setStrokeWidth((2.8f - 1.8f * eased) * density);
            canvas.drawCircle(b.originX, b.originY, radius, strokePaint);
        }

        float secondAge = age - 0.055f;
        if (secondAge > 0f && secondAge < HALO_LIFE * 0.9f) {
            float t = secondAge / (HALO_LIFE * 0.9f);
            float eased = easeOutCubic(t);
            float radius = (8f + 30f * eased) * density;
            int alpha = Math.round((1f - t) * (1f - t) * 160f);
            strokePaint.setColor(Color.parseColor("#38BDF8"));
            strokePaint.setAlpha(alpha);
            strokePaint.setStrokeWidth((2.0f - 1.2f * eased) * density);
            canvas.drawCircle(b.originX, b.originY, radius, strokePaint);
        }
    }

    private void drawCheckStamp(Canvas canvas, Burst b, float age) {
        if (age >= STAMP_LIFE) return;
        float t = age / STAMP_LIFE;
        float scale;
        float alpha;
        if (t < 0.28f) {
            float u = t / 0.28f;
            scale = easeOutBack(u);
            alpha = Math.min(1f, u * 1.6f);
        } else if (t < 0.68f) {
            scale = 1f;
            alpha = 1f;
        } else {
            float u = (t - 0.68f) / 0.32f;
            scale = 1f - 0.24f * u;
            alpha = 1f - u;
        }
        float r = 13.5f * density * Math.max(0f, scale);
        if (r <= 0.5f || alpha <= 0f) return;

        // 柔和翡翠光晕底影
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(Color.parseColor("#10B981"));
        paint.setAlpha(Math.round(alpha * 58f));
        canvas.drawCircle(b.originX, b.originY, r * 1.55f, paint);

        // 实心翡翠徽标
        paint.setAlpha(Math.round(alpha * 255f));
        canvas.drawCircle(b.originX, b.originY, r, paint);

        // 白色对勾描边动画
        float drawProgress = Math.min(1f, Math.max(0f, (t - 0.08f) / 0.28f));
        if (drawProgress > 0f) {
            checkPath.reset();
            checkPath.moveTo(b.originX - r * 0.42f, b.originY + r * 0.02f);
            checkPath.lineTo(b.originX - r * 0.10f, b.originY + r * 0.34f);
            checkPath.lineTo(b.originX + r * 0.44f, b.originY - r * 0.28f);
            pathMeasure.setPath(checkPath, false);
            drawnPath.reset();
            pathMeasure.getSegment(0f, pathMeasure.getLength() * easeOutCubic(drawProgress), drawnPath, true);

            strokePaint.setColor(Color.WHITE);
            strokePaint.setAlpha(Math.round(alpha * 255f));
            strokePaint.setStrokeWidth(2.4f * density * Math.max(0.6f, scale));
            canvas.drawPath(drawnPath, strokePaint);
        }
    }

    private void drawParticles(Canvas canvas, Burst b, float age, float dt) {
        paint.setStyle(Paint.Style.FILL);
        for (Particle p : b.particles) {
            if (age > p.life) continue;
            p.vy += 420f * density * dt;
            float drag = Math.max(0f, 1f - 2.35f * dt);
            p.vx *= drag;
            p.vy *= Math.max(0f, 1f - 1.35f * dt);
            p.x += (p.vx + (float) Math.sin(p.phase + age * 7f) * 18f * density) * dt;
            p.y += p.vy * dt;
            p.rot += p.vr * dt;

            float remain = p.life - age;
            float alpha = remain < 0.36f ? Math.max(0f, remain / 0.36f) : 1f;
            alpha *= alpha; // 平滑缓出
            if (alpha <= 0.01f) continue;

            if (p.shape == 0) {
                // 四角星芒（Apple 质感闪烁）
                float twinkle = 0.72f + 0.28f * (float) Math.sin(p.phase + age * 14f);
                float sr = p.size * twinkle;
                paint.setColor(p.front);
                paint.setAlpha(Math.round(alpha * 70f));
                canvas.drawCircle(p.x, p.y, sr * 1.25f, paint);

                paint.setAlpha(Math.round(alpha * 245f));
                canvas.save();
                canvas.translate(p.x, p.y);
                canvas.rotate(p.rot * 0.35f);
                drawFourPointStar(canvas, sr);
                canvas.restore();
            } else if (p.shape == 1) {
                // 柔光圆珠
                paint.setColor(p.front);
                paint.setAlpha(Math.round(alpha * 64f));
                canvas.drawCircle(p.x, p.y, p.size * 1.7f, paint);
                paint.setAlpha(Math.round(alpha * 245f));
                canvas.drawCircle(p.x, p.y, p.size * 0.72f, paint);
            } else {
                // 3D 翻转圆角微丝带
                float flip = (float) Math.cos(p.phase + age * 8.5f);
                float scaleY = Math.abs(flip) < 0.14f ? 0.14f : flip;
                paint.setColor(flip < 0 ? p.back : p.front);
                paint.setAlpha(Math.round(alpha * 235f));
                canvas.save();
                canvas.translate(p.x, p.y);
                canvas.rotate(p.rot);
                canvas.scale(1f, scaleY);
                rectF.set(-p.length * 0.5f, -p.size * 0.5f, p.length * 0.5f, p.size * 0.5f);
                canvas.drawRoundRect(rectF, p.size * 0.5f, p.size * 0.5f, paint);
                canvas.restore();
            }
        }
    }

    private void drawFourPointStar(Canvas canvas, float r) {
        float inner = r * 0.28f;
        starPath.reset();
        starPath.moveTo(0f, -r);
        starPath.quadTo(inner * 0.4f, -inner * 0.4f, r, 0f);
        starPath.quadTo(inner * 0.4f, inner * 0.4f, 0f, r);
        starPath.quadTo(-inner * 0.4f, inner * 0.4f, -r, 0f);
        starPath.quadTo(-inner * 0.4f, -inner * 0.4f, 0f, -r);
        starPath.close();
        canvas.drawPath(starPath, paint);
    }

    private void drawBannerPill(Canvas canvas, float age) {
        float w = getWidth();
        if (w <= 0) return;

        float enter = Math.min(1f, age / 0.22f);
        float exit = age > BANNER_LIFE - 0.26f ? Math.max(0f, (BANNER_LIFE - age) / 0.26f) : 1f;
        float alpha = Math.min(easeOutCubic(enter), easeOutCubic(exit));
        if (alpha <= 0.01f) return;

        float slideY = (1f - easeOutBack(enter)) * (-22f * density) + (1f - exit) * (-14f * density);
        float topSafe = getStatusBarHeight() + 14f * density;

        String label = bannerText;
        float maxTextW = w - 92f * density;
        if (textPaint.measureText(label) > maxTextW) {
            int count = textPaint.breakText(label, true, maxTextW - 14f * density, null);
            label = label.substring(0, Math.max(1, count)) + "…";
        }
        float textW = textPaint.measureText(label);
        float pillH = 38f * density;
        float pillW = Math.min(w - 32f * density, 46f * density + textW + 16f * density);
        float left = (w - pillW) * 0.5f;
        float top = topSafe + slideY;

        // 柔和悬浮投影
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(darkMode ? Color.parseColor("#000000") : Color.parseColor("#0F172A"));
        paint.setAlpha(Math.round(alpha * (darkMode ? 88f : 26f)));
        rectF.set(left - 1f * density, top + 4f * density, left + pillW + 1f * density, top + pillH + 6f * density);
        canvas.drawRoundRect(rectF, pillH * 0.5f, pillH * 0.5f, paint);

        // 毛玻璃瓷白 / 曜石蓝胶囊主体
        paint.setColor(darkMode ? Color.parseColor("#161E31") : Color.parseColor("#FFFFFF"));
        paint.setAlpha(Math.round(alpha * (darkMode ? 242f : 246f)));
        rectF.set(left, top, left + pillW, top + pillH);
        canvas.drawRoundRect(rectF, pillH * 0.5f, pillH * 0.5f, paint);

        // 高光描边
        strokePaint.setColor(bannerAllDone
            ? Color.parseColor(darkMode ? "#34D399" : "#6EE7B7")
            : Color.parseColor(darkMode ? "#33476E" : "#D9E4F4"));
        strokePaint.setAlpha(Math.round(alpha * 220f));
        strokePaint.setStrokeWidth(1.1f * density);
        canvas.drawRoundRect(rectF, pillH * 0.5f, pillH * 0.5f, strokePaint);

        // 左侧翠绿完成徽章
        float badgeCx = left + 20f * density;
        float badgeCy = top + pillH * 0.5f;
        float badgeR = 9.5f * density;
        paint.setColor(Color.parseColor("#10B981"));
        paint.setAlpha(Math.round(alpha * 255f));
        canvas.drawCircle(badgeCx, badgeCy, badgeR, paint);

        checkPath.reset();
        checkPath.moveTo(badgeCx - 3.8f * density, badgeCy + 0.3f * density);
        checkPath.lineTo(badgeCx - 0.9f * density, badgeCy + 3.2f * density);
        checkPath.lineTo(badgeCx + 4.0f * density, badgeCy - 2.6f * density);
        strokePaint.setColor(Color.WHITE);
        strokePaint.setAlpha(Math.round(alpha * 255f));
        strokePaint.setStrokeWidth(1.9f * density);
        canvas.drawPath(checkPath, strokePaint);

        // 胶囊文字
        textPaint.setColor(darkMode ? Color.parseColor("#F1F5F9") : Color.parseColor("#0F172A"));
        textPaint.setAlpha(Math.round(alpha * 255f));
        Paint.FontMetrics fm = textPaint.getFontMetrics();
        float textY = badgeCy - (fm.ascent + fm.descent) * 0.5f;
        canvas.drawText(label, left + 37f * density, textY, textPaint);
    }

    private int getStatusBarHeight() {
        int resId = getResources().getIdentifier("status_bar_height", "dimen", "android");
        return resId > 0 ? getResources().getDimensionPixelSize(resId) : Math.round(28f * density);
    }

    private static float easeOutCubic(float t) {
        float u = 1f - Math.max(0f, Math.min(1f, t));
        return 1f - u * u * u;
    }

    private static float easeOutBack(float t) {
        float c1 = 1.70158f;
        float c3 = c1 + 1f;
        float u = Math.max(0f, Math.min(1f, t)) - 1f;
        return 1f + c3 * u * u * u + c1 * u * u;
    }
}
