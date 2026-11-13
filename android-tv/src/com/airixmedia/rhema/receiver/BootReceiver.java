package com.airixmedia.rhema.receiver;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;

/**
 * Start with the TV (1.5; on by itself after the first pairing since 1.7, #834): when the TV has
 * started, open Rhema Studio Receiver, which shows its last feed again (and its last picture until
 * Rhema Studio answers). The receiver is enabled only while the setting is on (MainActivity), and the
 * setting is checked again here.
 *
 * Android 10 and later refuse an activity started from the background unless the app may "Display
 * over other apps" (SYSTEM_ALERT_WINDOW). Some TVs go further (seen on the Onn, Android 14, 13 Nov:
 * "Background activity launch blocked … callingUidHasAnyVisibleWindow: false" with the permission
 * allowed): only an app that has a window showing may open. So, when the permission is allowed, a
 * one-pixel see-through overlay window is put up first, the app is opened, and the window is taken
 * down a few seconds later. The refusal is otherwise silent, so the time of the attempt is kept: when
 * the app is next opened by hand long after it, the code screen says the TV blocked it and how to
 * allow it (BootStart.launchWasBlocked).
 */
public final class BootReceiver extends BroadcastReceiver {
    /** Some TVs send their own "started" broadcast for a fast boot instead of (or as well as) BOOT_COMPLETED. */
    static final String QUICKBOOT = "android.intent.action.QUICKBOOT_POWERON";
    /** How long the one-pixel window stays up: well past the launch, well inside a receiver's 10 s. */
    private static final long WINDOW_MS = 3_000;
    /** The window is drawn before the launch is asked for. */
    private static final long LAUNCH_AFTER_MS = 300;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !QUICKBOOT.equals(action)) return;
        android.content.SharedPreferences prefs = context.getSharedPreferences("receiver", Context.MODE_PRIVATE);
        if (!prefs.getBoolean("boot", false)) return;
        prefs.edit().putLong("bootTriedAt", SystemClock.elapsedRealtime()).commit();
        final Context app = context.getApplicationContext();
        final View window = Build.VERSION.SDK_INT >= 23 && Settings.canDrawOverlays(app) ? showPixel(app) : null;
        if (window == null) {
            open(app);
            return;
        }
        final PendingResult pending = goAsync();
        final Handler ui = new Handler(Looper.getMainLooper());
        ui.postDelayed(new Runnable() {
            @Override
            public void run() {
                open(app);
            }
        }, LAUNCH_AFTER_MS);
        ui.postDelayed(new Runnable() {
            @Override
            public void run() {
                try {
                    ((WindowManager) app.getSystemService(Context.WINDOW_SERVICE)).removeView(window);
                } catch (RuntimeException gone) {
                    // Already gone with the process or the TV: nothing to take down.
                }
                pending.finish();
            }
        }, WINDOW_MS);
    }

    private static void open(Context context) {
        Intent open = new Intent(context, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(open);
        } catch (RuntimeException refused) {
            // The TV does not allow it: the app opens from the home screen as usual, and then says so.
        }
    }

    /** A one-pixel see-through window that takes no touches or keys; null when the TV refuses it. */
    private static View showPixel(Context context) {
        try {
            WindowManager wm = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
            int type = Build.VERSION.SDK_INT >= 26
                    ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                    : WindowManager.LayoutParams.TYPE_PHONE;
            WindowManager.LayoutParams lp = new WindowManager.LayoutParams(1, 1, type,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                            | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                    PixelFormat.TRANSLUCENT);
            lp.gravity = Gravity.TOP | Gravity.START;
            View v = new View(context);
            wm.addView(v, lp);
            return v;
        } catch (RuntimeException refused) {
            return null;
        }
    }
}
