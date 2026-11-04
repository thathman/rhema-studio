package com.openbezal.rhema.receiver;

/**
 * Whether the feed page has put a picture on this screen (#604). A finished page load is not proof:
 * its HTML can arrive while its script does not (seen over a USB relay), leaving a black screen
 * with no load error. The proof is the page's own acknowledgement of a frame it drew, which it
 * sends to Rhema Studio with this screen's key after drawing (Guard.ackOf). An Off or cleared frame
 * is acknowledged like any other, so a black screen Rhema asked for counts as shown.
 *
 * Until then the kept picture stays up, labelled as not live; a page that draws nothing in
 * FIRST_FRAME_MS is loaded again after a wait that doubles up to MAX_WAIT_MS, and never faster.
 * Plain Java, so build.sh's ReadyCheck tests it on the computer. Used on the UI thread only.
 */
final class Ready {
    /** How long a loaded page has to draw its first frame (the host sends it on connect). */
    static final long FIRST_FRAME_MS = 15_000;
    static final long FIRST_WAIT_MS = 5_000;
    static final long MAX_WAIT_MS = 60_000;

    private boolean drawn;
    /** Loads in a row that drew nothing. */
    private int blank;
    /** noFrame queued a reload that has not started yet. */
    private boolean reloadQueued;

    /** A page load started (ours, or the page reloading itself): nothing is proven for it yet. */
    long started() {
        drawn = false;
        reloadQueued = false;
        return FIRST_FRAME_MS;
    }

    /** The page acknowledged a frame: true the first time for this load (the kept picture goes then). */
    boolean drew() {
        if (drawn) return false;
        drawn = true;
        blank = 0;
        // A page that drew after a renderer death ends the run: the next death waits a second again.
        gone = 0;
        return true;
    }

    /** FIRST_FRAME_MS passed: -1 when a frame was drawn, else how long to wait before loading again. */
    long noFrame() {
        if (drawn) return -1;
        blank++;
        reloadQueued = true;
        return Math.min(MAX_WAIT_MS, FIRST_WAIT_MS << Math.min(blank - 1, 4));
    }

    /**
     * After drew(): whether a reload noFrame queued is still waiting and must be cancelled (the
     * acknowledgement came late, after FIRST_FRAME_MS but before the reload: the page is healthy).
     */
    boolean cancelQueuedReload() {
        boolean queued = drawn && reloadQueued;
        if (queued) reloadQueued = false;
        return queued;
    }

    /** Renderer deaths closer than this to the last one count as a run (a page that keeps crashing it). */
    static final long GONE_RUN_MS = 10 * 60_000;
    private int gone;
    private long goneAt;

    /**
     * The page's renderer died at now (elapsedRealtime): how long to wait before loading it again.
     * One second, doubling for each death in a run, up to MAX_WAIT_MS, so a page that keeps running
     * the TV out of memory is not reloaded in a tight loop. Not reset by forget(): it is the TV's.
     */
    long rendererGone(long now) {
        gone = gone > 0 && now - goneAt < GONE_RUN_MS ? gone + 1 : 1;
        goneAt = now;
        return Math.min(MAX_WAIT_MS, 1_000L << Math.min(gone - 1, 6));
    }

    /** A revoked or replaced link: nothing carries over to the next one. */
    void forget() {
        drawn = false;
        blank = 0;
        reloadQueued = false;
    }

    boolean drawn() {
        return drawn;
    }
}
