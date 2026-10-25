package com.openbezal.rhema.receiver;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Start with the TV (1.5, opt-in): when the TV has started, open Rhema Studio Receiver, which
 * shows its last feed again (and its last picture until Rhema Studio answers). Off by default:
 * this receiver is disabled in the manifest and turned on only from the receiver's code screen
 * (← or → on the remote), and the setting is checked again here. Some TVs do not let an app open
 * by itself after a restart (Android 10 and later restrict it); then the TV's home screen shows
 * and the app opens as usual from it.
 */
public final class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        if (!context.getSharedPreferences("receiver", Context.MODE_PRIVATE).getBoolean("boot", false)) return;
        Intent open = new Intent(context, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(open);
        } catch (RuntimeException refused) {
            // The TV does not allow it: the app opens from the home screen as usual.
        }
    }
}
