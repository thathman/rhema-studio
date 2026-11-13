package com.airixmedia.rhema.camera;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * After the phone restarts or the app is updated (#836), if Rhema Studio Cam was sending: a
 * notification asks for one tap to send again. Only on Android 8–10, and only when the person has
 * turned Send again by itself after a restart on, does it go live again with no tap (see Lifecycle).
 */
public final class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        boolean boot = Intent.ACTION_BOOT_COMPLETED.equals(action);
        if (!boot && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;
        String when = boot ? CameraService.WHEN_RESTARTED : CameraService.WHEN_UPDATED;
        int how = Lifecycle.resume(Build.VERSION.SDK_INT, Prefs.pairing(c) != null, Prefs.get(c).getBoolean(Prefs.WAS_SENDING, false), Prefs.resumeOn(Prefs.get(c)));
        if (how == Lifecycle.START) {
            try {
                c.startForegroundService(new Intent(c, CameraService.class).setAction(CameraService.ACTION_RESUME).putExtra(CameraService.EXTRA_WHEN, when));
                return;
            } catch (RuntimeException e) {
                Log.w(CameraService.TAG, "could not send again: " + e);
                how = Lifecycle.ASK;
            }
        }
        if (how == Lifecycle.ASK) CameraService.askToResume(c, when);
    }
}
