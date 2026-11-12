package com.openbezal.rhema.receiver;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;

/**
 * Start with the TV (1.5; on by itself after the first pairing since 1.7, #834): when the TV has
 * started, open Rhema Studio Receiver, which shows its last feed again (and its last picture until
 * Rhema Studio answers). The receiver is enabled only while the setting is on (MainActivity), and the
 * setting is checked again here.
 *
 * Android 10 and later refuse an activity started from the background unless the app may "Display
 * over other apps" (SYSTEM_ALERT_WINDOW); the refusal is silent. So the time of the attempt is kept:
 * when the app is next opened by hand long after it, the code screen says the TV blocked it and how
 * to allow it (BootStart.launchWasBlocked).
 */
public final class BootReceiver extends BroadcastReceiver {
    /** Some TVs send their own "started" broadcast for a fast boot instead of (or as well as) BOOT_COMPLETED. */
    static final String QUICKBOOT = "android.intent.action.QUICKBOOT_POWERON";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !QUICKBOOT.equals(action)) return;
        android.content.SharedPreferences prefs = context.getSharedPreferences("receiver", Context.MODE_PRIVATE);
        if (!prefs.getBoolean("boot", false)) return;
        prefs.edit().putLong("bootTriedAt", SystemClock.elapsedRealtime()).commit();
        Intent open = new Intent(context, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(open);
        } catch (RuntimeException refused) {
            // The TV does not allow it: the app opens from the home screen as usual, and then says so.
        }
    }
}
