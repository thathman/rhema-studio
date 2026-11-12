package com.openbezal.rhema.receiver;

/**
 * What Back on the remote does (device test of 1.7): never leave the app, or the congregation sees
 * the TV's home screen mid-service. Home still leaves (Android lets no app block it). Plain Java, so
 * build.sh's ScreenCheck tests it.
 */
final class BackKey {
    /** Take the code screen off and show the feed again (as OK does). */
    static final int HIDE_PANEL = 1;
    /** Stay, with a small line saying how to leave. */
    static final int STAY_HINT = 2;
    /** Stay as it is (the code screen waits for a feed, or says what is wrong). */
    static final int STAY = 3;

    /** How long the "stays on this screen" line shows. */
    static final long HINT_MS = 3_000;

    private BackKey() { }

    /**
     * panelUp: the code screen is shown; feedReady: a feed is shown with nothing wrong (no problem
     * and tries left), so the code screen can give way to it.
     */
    static int decide(boolean panelUp, boolean feedReady) {
        if (panelUp) return feedReady ? HIDE_PANEL : STAY;
        return STAY_HINT;
    }
}
