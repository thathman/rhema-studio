package com.openbezal.rhema.camera;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * After the phone restarts (#836): if Rhema Studio Cam was sending and Resume after a restart is on,
 * it sends again by itself up to Android 10; from Android 11, where a camera service started in the
 * background may not use the camera, a notification asks for one tap instead (see Lifecycle).
 */
public final class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;
        int how = Lifecycle.resume(Build.VERSION.SDK_INT, Prefs.pairing(c) != null, Prefs.get(c).getBoolean(Prefs.WAS_SENDING, false), Prefs.get(c).getBoolean(Prefs.RESUME, true));
        if (how == Lifecycle.START) {
            try {
                c.startForegroundService(new Intent(c, CameraService.class).setAction(CameraService.ACTION_RESUME));
                return;
            } catch (RuntimeException e) {
                Log.w(CameraService.TAG, "could not send again after the restart: " + e);
                how = Lifecycle.ASK;
            }
        }
        if (how == Lifecycle.ASK) CameraService.askToResume(c);
    }
}
