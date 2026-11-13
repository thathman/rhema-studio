package com.airixmedia.rhema.receiver;

/** build.sh runs this before it makes the app: Identify TV is never extended, and is rate-limited per computer. */
public final class IdentifyGateCheck {
    private static int failed;

    private IdentifyGateCheck() { }

    public static void main(String[] args) {
        IdentifyGate g = new IdentifyGate();
        String a = "192.168.3.90";
        String b = "192.168.3.56";
        check("the first call flashes", g.allow(a, 0));
        check("another computer cannot extend it while it shows", !g.allow(b, 1_000));
        check("nor during the cooldown after", !g.allow(b, IdentifyGate.SHOW_MS + IdentifyGate.COOLDOWN_MS - 1));
        check("after the cooldown another computer may", g.allow(b, IdentifyGate.SHOW_MS + IdentifyGate.COOLDOWN_MS));

        IdentifyGate h = new IdentifyGate();
        check("first", h.allow(a, 0));
        long free = IdentifyGate.SHOW_MS + IdentifyGate.COOLDOWN_MS;
        check("the same computer waits its own PER_PEER_MS even after the cooldown", free >= IdentifyGate.PER_PEER_MS || !h.allow(a, free));
        check("refused calls do not push the wait out", !h.allow(a, IdentifyGate.PER_PEER_MS - 1) && h.allow(a, Math.max(IdentifyGate.PER_PEER_MS, free)));

        IdentifyGate flood = new IdentifyGate();
        long t = 0;
        int flashes = 0;
        for (int i = 0; i < 1_000; i++) {
            if (flood.allow("10.0.0." + (i % 250), t)) flashes++;
            t += 50;
        }
        // 50 s of calls from 250 computers: at most one flash per SHOW_MS + COOLDOWN_MS.
        check("a flood flashes at most once per window", flashes <= 1 + 50_000 / (IdentifyGate.SHOW_MS + IdentifyGate.COOLDOWN_MS));

        IdentifyGate full = new IdentifyGate();
        long now = 0;
        for (int i = 0; i < IdentifyGate.MAX_PEERS; i++) {
            full.allow("10.1.0." + i, now);
            now += IdentifyGate.SHOW_MS + IdentifyGate.COOLDOWN_MS;
        }
        check("old computers are forgotten so a new one is still served", full.allow("10.2.0.1", now + IdentifyGate.PER_PEER_MS));

        // Over a feed: the sender only; upgraded from 1.6 (no sender kept), the host in the saved link.
        check("the sender may", IdentifyGate.mayAskOverFeed("192.168.3.37", "192.168.3.37", "192.168.3.37"));
        check("another computer may not", !IdentifyGate.mayAskOverFeed("192.168.3.37", "192.168.3.37", "192.168.3.56"));
        check("the sender wins over the link", !IdentifyGate.mayAskOverFeed("192.168.3.40", "192.168.3.37", "192.168.3.37"));
        check("from 1.6: the link's host may", IdentifyGate.mayAskOverFeed(null, "192.168.3.37", "192.168.3.37"));
        check("from 1.6: no one else", !IdentifyGate.mayAskOverFeed(null, "192.168.3.37", "192.168.3.56"));
        check("from 1.6 with no readable link: no one", !IdentifyGate.mayAskOverFeed(null, null, "192.168.3.56"));

        if (failed > 0) {
            System.err.println(failed + " identify check(s) failed");
            System.exit(1);
        }
        System.out.println("IdentifyGateCheck: all passed");
    }

    private static void check(String what, boolean ok) {
        if (!ok) {
            failed++;
            System.err.println("FAIL: " + what);
        }
    }
}
