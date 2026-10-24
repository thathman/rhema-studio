package com.openbezal.rhema.camera;

import android.content.Context;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Rhema's colours and a few view helpers (no layout files: the views are built in code). */
final class Ui {
    private Ui() { }

    // Rhema's dark palette (#215): ink and slate, deep teal for actions, red only for LIVE.
    static final int BG = 0xFF121C22;
    static final int CARD = 0xFF1A262E;
    static final int FG = 0xFFE6ECEE;
    static final int MUTED = 0xFF98A6AD;
    static final int BORDER = 0xFF2C3A42;
    static final int TEAL = 0xFF2B7A74;
    static final int TEAL_TEXT = 0xFF5FB3A8;
    static final int LIVE = 0xFFD64541;
    static final int AMBER = 0xFFD9A441;
    static final int IDLE = 0xFF7D8A90;

    static int dp(Context c, float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, c.getResources().getDisplayMetrics()));
    }

    static TextView text(Context c, String s, float sp, int color, boolean bold) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        return t;
    }

    static GradientDrawable round(int color, float radiusPx) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(radiusPx);
        return d;
    }

    static GradientDrawable dot(int color) {
        GradientDrawable d = new GradientDrawable();
        d.setShape(GradientDrawable.OVAL);
        d.setColor(color);
        return d;
    }

    static LinearLayout column(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.VERTICAL);
        return l;
    }

    static LinearLayout row(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.HORIZONTAL);
        l.setGravity(Gravity.CENTER_VERTICAL);
        return l;
    }

    static LinearLayout.LayoutParams wide() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    static LinearLayout.LayoutParams fill() {
        return new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    }

    static void pad(View v, Context c, int h, int vert) {
        v.setPadding(dp(c, h), dp(c, vert), dp(c, h), dp(c, vert));
    }
}
