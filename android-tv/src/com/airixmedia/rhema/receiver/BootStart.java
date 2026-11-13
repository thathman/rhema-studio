package com.airixmedia.rhema.receiver;

/**
 * Start with the TV (#834 S10): a TV that loses power during the week should be showing its feed again
 * when it comes back, without anyone pressing a button. Plain Java, so build.sh's BootStartCheck tests it.
 */
final class BootStart {
    /** A launch from the boot receiver that has not opened the app in this long was blocked by the TV. */
    static final long OPEN_WITHIN_MS = 90_000;

    private BootStart() { }

    /**
     * Whether pairing (a feed shown) turns Start with the TV on by itself: only while nobody has
     * chosen on the code screen; a person who turned it off keeps it off.
     */
    static boolean turnOnAfterPairing(boolean chosen, boolean on, boolean paired) {
        return paired && !chosen && !on;
    }

    /**
     * Whether a person has chosen: marked since 1.7, and before it the "boot" setting existed only
     * once someone had toggled it on the code screen, so its presence alone is a choice to keep.
     */
    static boolean chosen(boolean marked, boolean bootSettingSaved) {
        return marked || bootSettingSaved;
    }

    /**
     * At the app's start: whether the last boot's launch was refused by the TV (Android 10 and later
     * do not let an app open by itself unless it may draw over other apps). triedAt is when the boot
     * receiver asked (elapsedRealtime, -1 when it did not), now is this start's elapsedRealtime: in
     * the same boot (now >= triedAt) and much later than the launch would have taken.
     */
    static boolean launchWasBlocked(long triedAt, long now) {
        return triedAt >= 0 && now >= triedAt && now - triedAt > OPEN_WITHIN_MS;
    }
}
