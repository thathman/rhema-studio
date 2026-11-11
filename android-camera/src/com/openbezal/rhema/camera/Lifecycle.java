package com.openbezal.rhema.camera;

/**
 * When Rhema Studio Cam starts sending again by itself, and when it gives up (#836). Plain Java
 * (no Android), so build.sh can test it.
 *
 * After the phone restarts, or Android ended the app while it was sending, it resumes if it was
 * sending and Resume after a restart is on. Before Android 11 it starts again by itself. From
 * Android 11 a camera service started in the background may not use the camera (and Android 14
 * forbids it from a restart outright), so it shows a notification instead: a tap opens the app and
 * it sends again.
 *
 * It stops, and says why, when Rhema answers three times running that it does not know this camera
 * (removed, or given a new link), or when Rhema's camera router has refused its sign-in six times
 * running (about a minute and a half) and Rhema has not said lately that it knows the camera.
 */
final class Lifecycle {
    private Lifecycle() { }

    static final int NONE = 0;
    static final int START = 1;
    static final int ASK = 2;

    /** Android 11 (API 30): a background-started camera service may not use the camera. */
    static final int BACKGROUND_CAMERA_LIMIT_SDK = 30;

    static int resume(int sdk, boolean paired, boolean wasSending, boolean resumeOn) {
        if (!paired || !wasSending || !resumeOn) return NONE;
        return sdk >= BACKGROUND_CAMERA_LIMIT_SDK ? ASK : START;
    }

    static final int FORBIDDEN_TIMES = 3;
    static final int REFUSED_TIMES = 6;

    /** Why it stopped, or null to keep trying. */
    static String removed(int forbiddenInARow, int refusedInARow, boolean rhemaKnowsItLately) {
        if (forbiddenInARow >= FORBIDDEN_TIMES) {
            return "Rhema Studio no longer knows this camera: it was removed, or given a new link. Scan its QR code again (Live → Production tools → Cameras on Rhema Studio).";
        }
        if (refusedInARow >= REFUSED_TIMES && !rhemaKnowsItLately) {
            return "Rhema Studio's camera router keeps refusing this camera: it was removed, or given a new link. Scan its QR code again (Live → Production tools → Cameras on Rhema Studio).";
        }
        return null;
    }
}
