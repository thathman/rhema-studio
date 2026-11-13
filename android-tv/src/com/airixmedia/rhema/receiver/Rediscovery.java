package com.airixmedia.rhema.receiver;

/**
 * When the TV looks for Rhema Studio at a new address (1.8, doc 48): after AFTER_MS of failing to
 * open the feed at the address it has, it browses the network (_rhema-host._tcp) for BROWSE_MS,
 * then rests for a while that grows to PAUSE_MS's last (never a tight loop), and again, until the
 * feed opens; a browse with checks still waiting goes on to BROWSE_MAX_MS. After MOVED_MS of looking,
 * the screen says Rhema Studio may have moved. Times are
 * elapsedRealtime milliseconds. Plain Java only, so build.sh's KeyPinCheck tests it.
 */
final class Rediscovery {
    static final long AFTER_MS = 10_000;
    static final long BROWSE_MS = 30_000;
    /** A browse with checks still to run goes on past BROWSE_MS, but never past this. */
    static final long BROWSE_MAX_MS = 60_000;
    static final long MOVED_MS = 120_000;
    private static final long[] PAUSE_MS = {15_000, 30_000, 60_000, 120_000};

    private long failingSince = -1;
    private long firstBrowse = -1;
    private long nextAt = -1;
    private long browseStarted = -1;
    private int rounds;
    private boolean browsing;

    /** The feed did not open at the address the TV has (unreachable, or not the paired key). */
    void failed(long now) {
        if (failingSince >= 0) return;
        failingSince = now;
        nextAt = now + AFTER_MS;
    }

    /** The feed opened, a new one was sent, or it was withdrawn: nothing to look for. */
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

    /** Starts a browse when one is due and the TV can look (a key pin to look for, the feed on screen). */
    boolean start(long now, boolean canLook) {
        if (!canLook || failingSince < 0 || browsing || now < nextAt) return false;
        browsing = true;
        browseStarted = now;
        if (firstBrowse < 0) firstBrowse = now;
        return true;
    }

    /**
     * Whether the running browse is over: after BROWSE_MS, unless addresses still wait for their
     * TLS check (pending), then at the latest after BROWSE_MAX_MS.
     */
    boolean over(long now, boolean pending) {
        if (!browsing) return false;
        long ran = now - browseStarted;
        return ran >= BROWSE_MAX_MS || (ran >= BROWSE_MS && !pending);
    }

    /** A browse ended without finding it (its time ran out, or the screen left the feed): rest first. */
    void stop(long now) {
        if (!browsing) return;
        browsing = false;
        nextAt = now + PAUSE_MS[Math.min(rounds, PAUSE_MS.length - 1)];
        rounds++;
    }

    /** Looked for long enough without finding it: the screen says Rhema Studio may have moved. */
    boolean mayHaveMoved(long now) {
        return firstBrowse >= 0 && now - firstBrowse >= MOVED_MS;
    }
}
