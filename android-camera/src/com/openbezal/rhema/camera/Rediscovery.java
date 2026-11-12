package com.openbezal.rhema.camera;

/**
 * When the camera looks for Rhema Studio at a new address (1.6, doc 48; the same timing as the
 * Receiver's): after AFTER_MS of failing to reach the camera router at the address it has while it
 * should be sending, it browses the network (_rhema-host._tcp) for BROWSE_MS, then rests for a while
 * that grows to PAUSE_MS's last (never a tight loop), and again, until it sends. After MOVED_MS of
 * looking, the status says Rhema Studio may have moved. Times are elapsedRealtime milliseconds.
 * Plain Java only, so build.sh's KeyPinCheck tests it.
 */
final class Rediscovery {
    /** Said in the status instead of the connection's own words after MOVED_MS of looking (plain, one line). */
    static final String MAY_HAVE_MOVED = "Rhema Studio may have moved; scan the camera link again if this continues";
    static final long AFTER_MS = 10_000;
    static final long BROWSE_MS = 30_000;
    static final long MOVED_MS = 120_000;
    private static final long[] PAUSE_MS = {15_000, 30_000, 60_000, 120_000};

    private long failingSince = -1;
    private long firstBrowse = -1;
    private long nextAt = -1;
    private int rounds;
    private boolean browsing;

    /** The camera router did not answer at the address the camera has (unreachable, or not the paired key). */
    void failed(long now) {
        if (failingSince >= 0) return;
        failingSince = now;
        nextAt = now + AFTER_MS;
    }

    /** It sends again, it was paired anew, or sending stopped: nothing to look for. */
    void reset() {
        failingSince = -1;
        firstBrowse = -1;
        nextAt = -1;
        rounds = 0;
        browsing = false;
    }

    boolean browsing() {
        return browsing;
    }

    /** How long until a browse may start (0: now), or -1 when none is due (not failing, or browsing). */
    long due(long now) {
        if (failingSince < 0 || browsing) return -1;
        return Math.max(0, nextAt - now);
    }

    /** Starts a browse when one is due and the camera can look (a key pin to look for, and it should be sending). */
    boolean start(long now, boolean canLook) {
        if (!canLook || failingSince < 0 || browsing || now < nextAt) return false;
        browsing = true;
        if (firstBrowse < 0) firstBrowse = now;
        return true;
    }

    /** A browse ended without finding it (its time ran out, or sending stopped): rest first. */
    void stop(long now) {
        if (!browsing) return;
        browsing = false;
        nextAt = now + PAUSE_MS[Math.min(rounds, PAUSE_MS.length - 1)];
        rounds++;
    }

    /** Looked for long enough without finding it: the status says Rhema Studio may have moved. */
    boolean mayHaveMoved(long now) {
        return firstBrowse >= 0 && now - firstBrowse >= MOVED_MS;
    }
}
