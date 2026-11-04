package com.openbezal.rhema.receiver;

/**
 * build.sh runs this on the computer before it makes the app (#604): when the Receiver counts the
 * feed page as shown (the page's own acknowledgement of a drawn frame), and how it waits and loads
 * again when the page loaded but drew nothing.
 */
public final class ReadyCheck {
    private static int failed;
    private static final String LINK = "https://192.168.3.10:8081/feed/l3?k=s3cr%2Bt";
    private static final String ACK = "https://192.168.3.10:8081/api/v1/feed/l3/ack?k=s3cr%2Bt";

    private ReadyCheck() { }

    public static void main(String[] args) {
        // The page's HTML arrived but its script did not: no acknowledgement ever comes.
        Ready r = new Ready();
        check("a load gives the page FIRST_FRAME_MS to draw", r.started() == Ready.FIRST_FRAME_MS);
        check("a finished load alone is not shown", !r.drawn());
        long[] waits = new long[7];
        for (int i = 0; i < waits.length; i++) {
            waits[i] = r.noFrame();
            r.started();
        }
        check("loaded but black: load again after 5, 10, 20, 40 s, then every minute",
                java.util.Arrays.equals(waits, new long[] {5_000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000}));
        check("never shown while nothing was drawn", !r.drawn());

        // The first rendered frame (a picture, or an Off/Clear frame Rhema sent: acknowledged alike).
        check("the first acknowledgement shows the page", r.drew());
        check("later ones change nothing", !r.drew());
        check("a page that drew is not loaded again", r.noFrame() == -1);

        // Lost and found again (a dropped network, Rhema Studio restarted): the reload must draw again,
        // and a page that then draws nothing starts again from the shortest wait.
        r.started();
        check("a reload must draw again", !r.drawn());
        check("after a page that drew, the first wait is the shortest", r.noFrame() == 5_000);
        r.started();
        check("drawing again shows it", r.drew());

        // A late acknowledgement: after FIRST_FRAME_MS (a reload is queued) but before that reload.
        Ready late = new Ready();
        late.started();
        check("the wait runs out and queues a reload", late.noFrame() == 5_000);
        check("then the page draws", late.drew());
        check("the queued reload is cancelled", late.cancelQueuedReload());
        check("only once", !late.cancelQueuedReload());
        check("the healthy page is not loaded again", late.noFrame() == -1);
        late.started();
        late.drew();
        check("an acknowledgement in time cancels nothing", !late.cancelQueuedReload());
        late.started();
        late.noFrame();
        late.started();
        late.drew();
        check("a reload that already started is not cancelled again", !late.cancelQueuedReload());
        late.noFrame();
        late.forget();
        check("forgotten: no reload to cancel", !late.cancelQueuedReload());

        // Revoked, or a new feed: nothing carries over.
        r.noFrame();
        r.forget();
        check("forgotten: not shown", !r.drawn());
        r.started();
        check("forgotten: waits start again", r.noFrame() == 5_000);

        // Another feed assigned while this one is on screen: the old page's acknowledgements, even
        // ones already on their way, never take the cover off; only the new feed's own does.
        String next = "https://192.168.3.10:8081/feed/l9?k=n3w";
        Ready a = new Ready();
        a.started();
        a.drew();
        a.forget();
        check("reassigned: not shown", !a.drawn());
        check("reassigned: the old feed's acknowledgement is not the new one's", !Guard.ackOf(next, "POST", ACK));
        check("reassigned: nor the old feed's under the new key", !Guard.ackOf(next, "POST", ACK.replace("s3cr%2Bt", "n3w")));
        check("reassigned: nor the new id under the old key", !Guard.ackOf(next, "POST", ACK.replace("/l3/", "/l9/")));
        a.started();
        check("reassigned: the new feed's acknowledgement shows it",
                Guard.ackOf(next, "POST", "https://192.168.3.10:8081/api/v1/feed/l9/ack?k=n3w") && a.drew());

        // The page's renderer died (#198): loaded again soon, but never in a tight loop.
        Ready g = new Ready();
        long t = 1_000_000;
        long[] gone = new long[8];
        for (int i = 0; i < gone.length; i++) gone[i] = g.rendererGone(t += 30_000);
        check("renderer deaths in a run: 1, 2, 4 ... s, at most a minute",
                java.util.Arrays.equals(gone, new long[] {1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000}));
        check("a death long after the last starts again from a second", g.rendererGone(t + Ready.GONE_RUN_MS) == 1_000);
        g.forget();
        check("a new link does not reset the run (it is the TV running short)", g.rendererGone(t + Ready.GONE_RUN_MS + 1) == 2_000);
        check("the first death at boot (elapsedRealtime 0) waits a second", new Ready().rendererGone(0) == 1_000);
        g.started();
        check("a page that drew after a death ends the run", g.drew() && g.rendererGone(t + Ready.GONE_RUN_MS + 2) == 1_000);

        // What counts as this screen's acknowledgement.
        check("the page's acknowledgement", Guard.ackOf(LINK, "POST", ACK));
        check("an encoded feed id, as the page encodes it", Guard.ackOf("https://192.168.3.10:8081/feed/a%20b?k=x", "POST", "https://192.168.3.10:8081/api/v1/feed/a%20b/ack?k=x"));
        check("a GET is not one", !Guard.ackOf(LINK, "GET", ACK));
        check("another feed's", !Guard.ackOf(LINK, "POST", ACK.replace("/l3/", "/l4/")));
        check("an old key's (a new link, or this TV revoked)", !Guard.ackOf(LINK, "POST", ACK.replace("s3cr%2Bt", "old")));
        check("no key", !Guard.ackOf(LINK, "POST", "https://192.168.3.10:8081/api/v1/feed/l3/ack"));
        check("the key twice", !Guard.ackOf(LINK, "POST", ACK + "&k=s3cr%2Bt"));
        check("another computer", !Guard.ackOf(LINK, "POST", ACK.replace("192.168.3.10", "192.168.3.11")));
        check("another port", !Guard.ackOf(LINK, "POST", ACK.replace(":8081", ":8082")));
        check("plain http", !Guard.ackOf(LINK, "POST", ACK.replace("https:", "http:")));
        check("another path", !Guard.ackOf(LINK, "POST", ACK.replace("/ack", "/ack2")));
        check("a nested path", !Guard.ackOf(LINK, "POST", "https://192.168.3.10:8081/api/v1/feed/x/l3/ack?k=s3cr%2Bt"));
        check("a prefixed path", !Guard.ackOf(LINK, "POST", "https://192.168.3.10:8081/evil/api/v1/feed/l3/ack?k=s3cr%2Bt"));
        check("user info", !Guard.ackOf(LINK, "POST", ACK.replace("https://", "https://a@")));
        check("nothing shown", !Guard.ackOf(null, "POST", ACK));
        check("not a link", !Guard.ackOf(LINK, "POST", "::"));

        if (failed > 0) {
            System.err.println("ReadyCheck: " + failed + " check(s) failed");
            System.exit(1);
        }
        System.out.println("ReadyCheck: all checks passed");
    }

    private static void check(String what, boolean ok) {
        if (!ok) {
            failed++;
            System.err.println("FAILED: " + what);
        }
    }
}
