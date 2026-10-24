package com.openbezal.rhema.camera;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.os.SystemClock;
import android.view.View;

/**
 * What is drawn over the viewfinder, inside the picture as sent: gridlines (thirds, centre cross,
 * title-safe and action-safe), a letterbox guide, the level, a small brightness histogram, the
 * tap-to-focus ring and the zoom while pinching. Each is optional and off unless chosen (Settings → On screen).
 */
final class OverlayView extends View {
    final RectF picture = new RectF();
    boolean thirds;
    boolean centre;
    boolean safe;
    boolean level;
    boolean histogram;
    /** A letterbox framing guide (2.39 or 1.85 to 1), 0 for none. */
    float bars;
    /** The phone's roll from level, degrees; NaN when unknown. */
    float roll = Float.NaN;
    int[] bins;
    private float ringX = -1;
    private float ringY = -1;
    private long ringAt;
    private String zoomText;
    private long zoomAt;
    private final Paint line = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint shade = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint label = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final float d;

    OverlayView(Context c) {
        super(c);
        d = getResources().getDisplayMetrics().density;
        line.setStyle(Paint.Style.STROKE);
        line.setStrokeWidth(Math.max(1f, d));
        shade.setStyle(Paint.Style.FILL);
        label.setColor(0xFFFFFFFF);
        label.setTextSize(15 * d);
        label.setTextAlign(Paint.Align.CENTER);
        label.setShadowLayer(3 * d, 0, 0, 0xFF000000);
    }

    void ring(float x, float y) {
        ringX = x;
        ringY = y;
        ringAt = SystemClock.uptimeMillis();
        invalidate();
    }

    void zoom(float z) {
        zoomText = String.format(java.util.Locale.ROOT, "%.1f×", z);
        zoomAt = SystemClock.uptimeMillis();
        invalidate();
    }

    @Override
    protected void onDraw(Canvas c) {
        RectF p = picture;
        if (p.width() <= 0) return;
        line.setColor(0x80FFFFFF);
        if (thirds) {
            for (int i = 1; i < 3; i++) {
                float x = p.left + p.width() * i / 3f, y = p.top + p.height() * i / 3f;
                c.drawLine(x, p.top, x, p.bottom, line);
                c.drawLine(p.left, y, p.right, y, line);
            }
        }
        if (centre) {
            float s = 14 * d;
            c.drawLine(p.centerX() - s, p.centerY(), p.centerX() + s, p.centerY(), line);
            c.drawLine(p.centerX(), p.centerY() - s, p.centerX(), p.centerY() + s, line);
        }
        if (safe) {
            // Action safe 93 %, title safe 90 % (SMPTE ST 2046-1, 16:9).
            line.setColor(0x60FFFFFF);
            inset(c, p, 0.93f);
            line.setColor(0x90FFD27A);
            inset(c, p, 0.90f);
        }
        if (bars > 0) {
            float band = p.height() * (16f / 9f) / bars, off = (p.height() - band) / 2;
            shade.setColor(0x8C000000);
            c.drawRect(p.left, p.top, p.right, p.top + off, shade);
            c.drawRect(p.left, p.bottom - off, p.right, p.bottom, shade);
            line.setColor(0x80FFFFFF);
            c.drawLine(p.left, p.top + off, p.right, p.top + off, line);
            c.drawLine(p.left, p.bottom - off, p.right, p.bottom - off, line);
        }
        if (level && !Float.isNaN(roll)) {
            boolean flat = Math.abs(roll) < 1f;
            line.setColor(flat ? 0xFF6FD08C : 0xCCFFFFFF);
            line.setStrokeWidth(2 * d);
            float len = p.width() * 0.18f;
            double a = Math.toRadians(-roll);
            float dx = (float) (Math.cos(a) * len), dy = (float) (Math.sin(a) * len);
            c.drawLine(p.centerX() - dx, p.centerY() - dy, p.centerX() + dx, p.centerY() + dy, line);
            line.setColor(0x80FFFFFF);
            c.drawLine(p.centerX() - len * 1.25f, p.centerY(), p.centerX() - len * 1.08f, p.centerY(), line);
            c.drawLine(p.centerX() + len * 1.08f, p.centerY(), p.centerX() + len * 1.25f, p.centerY(), line);
            line.setStrokeWidth(Math.max(1f, d));
        }
        if (histogram && bins != null) drawHistogram(c, p);
        long now = SystemClock.uptimeMillis();
        if (ringX >= 0 && now - ringAt < 1200) {
            line.setColor(0xE6FFD27A);
            line.setStrokeWidth(2 * d);
            float r = 36 * d * (1f - 0.25f * Math.min(1f, (now - ringAt) / 300f));
            c.drawCircle(ringX, ringY, r, line);
            line.setStrokeWidth(Math.max(1f, d));
            postInvalidateDelayed(32);
        }
        if (zoomText != null && now - zoomAt < 1500) {
            c.drawText(zoomText, p.centerX(), p.top + 40 * d, label);
            postInvalidateDelayed(200);
        }
    }

    private void inset(Canvas c, RectF p, float f) {
        float dx = p.width() * (1 - f) / 2, dy = p.height() * (1 - f) / 2;
        c.drawRect(p.left + dx, p.top + dy, p.right - dx, p.bottom - dy, line);
    }

    private void drawHistogram(Canvas c, RectF p) {
        float w = 128 * d, h = 52 * d;
        float left = p.left + 16 * d, bottom = p.bottom - 16 * d;
        shade.setColor(0x66000000);
        c.drawRoundRect(left, bottom - h, left + w, bottom, 6 * d, 6 * d, shade);
        int max = 1;
        for (int b : bins) max = Math.max(max, b);
        shade.setColor(0xCCFFFFFF);
        float bw = w / bins.length;
        for (int i = 0; i < bins.length; i++) {
            float bh = (h - 8 * d) * (float) Math.sqrt(bins[i] / (double) max);
            c.drawRect(left + i * bw, bottom - 4 * d - bh, left + (i + 1) * bw - 0.5f, bottom - 4 * d, shade);
        }
    }
}
