package com.openbezal.rhema.camera;

/**
 * When Rhema Studio Cam starts sending again by itself, and when it gives up (#836). Plain Java
 * (no Android), so build.sh can test it.
 *
 * After the phone restarts, the app is updated, or Android ended the app while it was sending:
 * - Android 11 and newer: a background-started camera service may not use the camera (Android 14
 *   forbids it outright after a restart), so a notification asks for one tap. On by default; Send
 *   again after a restart off means no notification.
 * - Android 8–10: the same notification by default. Only when the person has turned Send again
 *   after a restart on does it start sending by itself, with no tap (a camera going live with
 *   nobody touching the phone has to be their choice).
 *
 * It stops, and says why, when Rhema answers three times running that it does not know this camera
 * (removed, or given a new link). As a fallback for when the tally cannot be read, it also stops
 * when the camera router has refused the camera's sign-in (401 only, never 400/404/503) for at
 * least 90 s without one success between, and Rhema has not said in the last minute that it knows
 * the camera. A link without a report port (no tally) never stops on the router alone: an
 * unreachable or restarting router cannot be told from a removed camera there.
 */
final class Lifecycle {
    private Lifecycle() { }

    static final int NONE = 0;
    static final int START = 1;
    static final int ASK = 2;

    /** Android 11 (API 30): a background-started camera service may not use the camera. */
    static final int BACKGROUND_CAMERA_LIMIT_SDK = 30;

    /** Send again after a restart, unless set: on (a notification) from Android 11, off (a notification, not a silent start) before. */
    static boolean resumeDefault(int sdk) {
        return sdk >= BACKGROUND_CAMERA_LIMIT_SDK;
    }

    static int resume(int sdk, boolean paired, boolean wasSending, boolean resumeOn) {
        if (!paired || !wasSending) return NONE;
        if (sdk >= BACKGROUND_CAMERA_LIMIT_SDK) return resumeOn ? ASK : NONE;
        return resumeOn ? START : ASK;
    }

    /**
     * Whether a "Tap to send again" opening of the app may start sending: only with the nonce this
     * app put in its own notification (MainActivity is exported, so another app could send the
     * extra), and only while resuming is still wanted.
     */
    static boolean resumeTap(String given, String kept, int sdk, boolean paired, boolean wasSending, boolean resumeOn) {
        if (given == null || kept == null || kept.length() < 32 || given.length() != kept.length()) return false;
        if (!java.security.MessageDigest.isEqual(given.getBytes(java.nio.charset.StandardCharsets.UTF_8), kept.getBytes(java.nio.charset.StandardCharsets.UTF_8))) return false;
        return resume(sdk, paired, wasSending, resumeOn) != NONE;
    }

    /** A fresh nonce for one resume notification: 32 random hex characters. */
    static String nonce(java.security.SecureRandom random) {
        byte[] b = new byte[16];
        random.nextBytes(b);
        return Pairing.hex(b);
    }

    static final int FORBIDDEN_TIMES = 3;
    static final long SIGN_IN_REFUSED_MS = 90000;

    /**
     * Why it stopped, or null to keep trying. forbiddenInARow: 403 tally answers running;
     * signInRefusedMs: how long the router has refused the sign-in (401) with no success between;
     * hasTally: the link has a report port; rhemaKnowsItLately: a 200 tally within the last minute.
     */
    static String removed(int forbiddenInARow, long signInRefusedMs, boolean hasTally, boolean rhemaKnowsItLately) {
        if (forbiddenInARow >= FORBIDDEN_TIMES) {
            return "Rhema Studio no longer knows this camera: it was removed, or given a new link. Scan its QR code again (Live → Production tools → Cameras on Rhema Studio).";
        }
        if (hasTally && signInRefusedMs >= SIGN_IN_REFUSED_MS && !rhemaKnowsItLately) {
            return "Rhema Studio's camera router has refused this camera's sign-in for over a minute: it was removed, or given a new link. Scan its QR code again (Live → Production tools → Cameras on Rhema Studio).";
        }
        return null;
    }
}
