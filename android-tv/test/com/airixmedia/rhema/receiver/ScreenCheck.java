package com.airixmedia.rhema.receiver;

/**
 * build.sh runs this before it makes the app: what the code screen says about tries (CodeTries,
 * #841), Start with the TV after pairing and a refused boot launch (BootStart, #834), and how the
 * feed fits the TV: an output that is off, the edge inset and the frame rate (ScreenFit, #835, #849).
 */
public final class ScreenCheck {
    private static int failed;

    private ScreenCheck() { }

    public static void main(String[] args) {
        // CodeTries: a try is said, the code never.
        CodeTries t = new CodeTries();
        check("nothing tried: nothing said", t.words(0) == null && t.changesAt() == -1);
        t.tried(1_000, 4);
        String checking = t.words(2_000);
        check("just tried: checking, with tries left", checking != null && checking.contains("checking") && checking.contains("4 tries left"));
        check("changes when the wait runs out", t.changesAt() == 1_000 + CodeTries.FOLLOW_MS);
        String wrong = t.words(1_000 + CodeTries.FOLLOW_MS);
        check("no feed followed: did not open a feed", wrong != null && wrong.contains("did not open a feed") && wrong.contains("4 tries left"));
        t.tried(20_000, 1);
        check("one try: singular", t.words(40_000).contains("1 try left"));
        t.tried(30_000, 0);
        check("no tries left: the code line says it", t.words(40_000) == null);
        t.tried(30_000, 3);
        t.clear();
        check("a feed or a new code clears it", t.words(40_000) == null && t.changesAt() == -1);
        check("never a digit of a code", !wrong.matches(".*\\d{2,}.*"));

        // BackKey: Back never leaves the app.
        check("Back on the code screen over a feed: back to the feed", BackKey.decide(true, true) == BackKey.HIDE_PANEL);
        check("Back on the code screen with no feed (or a problem): stays", BackKey.decide(true, false) == BackKey.STAY);
        check("Back over a feed: stays, with the hint", BackKey.decide(false, true) == BackKey.STAY_HINT);
        check("Back with nothing up: stays, with the hint", BackKey.decide(false, false) == BackKey.STAY_HINT);

        // BootStart
        check("an Off chosen in 1.6 (the setting saved, no mark) is a choice", BootStart.chosen(false, true));
        check("never saved, never marked: not chosen", !BootStart.chosen(false, false));
        check("marked in 1.7: chosen", BootStart.chosen(true, false));
        check("so a 1.6 Off is not forced On", !BootStart.turnOnAfterPairing(BootStart.chosen(false, true), false, true));
        check("first pairing turns it on", BootStart.turnOnAfterPairing(false, false, true));
        check("a person's Off stays off", !BootStart.turnOnAfterPairing(true, false, true));
        check("not before pairing", !BootStart.turnOnAfterPairing(false, false, false));
        check("already on: nothing to do", !BootStart.turnOnAfterPairing(false, true, true));
        check("no boot launch: not blocked", !BootStart.launchWasBlocked(-1, 500_000));
        check("opened soon after the boot launch: not blocked", !BootStart.launchWasBlocked(20_000, 25_000));
        check("opened by hand long after: blocked", BootStart.launchWasBlocked(20_000, 20_000 + BootStart.OPEN_WITHIN_MS + 1));
        check("a later boot (clock started again): not known, not blocked", !BootStart.launchWasBlocked(400_000, 30_000));

        // ScreenFit: the page's word
        check("off", ScreenFit.pageOffState("\"true|0|false\"") == 1);
        check("on", ScreenFit.pageOffState("\"false|0|false\"") == 0);
        check("off but the host is lost: not the hold (the page's own cover says it)", ScreenFit.pageOffState("\"true|0|true\"") == 0);
        check("off before the first stale check", ScreenFit.pageOffState("\"true|0|\"") == 1);
        check("an older page says nothing", ScreenFit.pageOffState("\"||false\"") == -1 && ScreenFit.pageOverscan("\"||\"") == 0);
        check("no answer", ScreenFit.pageOffState(null) == -1 && ScreenFit.pageOffState("null") == -1 && ScreenFit.pageOverscan("null") == 0);
        check("overscan read", ScreenFit.pageOverscan("\"false|3.5|false\"") == 3.5);
        check("overscan bounded", ScreenFit.pageOverscan("\"false|90|false\"") == ScreenFit.MAX_INSET && ScreenFit.pageOverscan("\"false|-2|\"") == 0);
        check("not a number", ScreenFit.pageOverscan("\"false|x|\"") == 0);
        check("the output's own overscan wins (no double inset)", ScreenFit.applied(2.5, 5) == 0);
        check("else the TV's own", ScreenFit.applied(0, 4) == 4);
        check("the TV's own bounded", ScreenFit.applied(0, 40) == ScreenFit.MAX_INSET && ScreenFit.applied(0, -1) == 0);

        // ScreenFit: the frame rate
        int[] ids = {1, 2, 3, 4, 5};
        int[] ws = {1920, 1920, 1920, 3840, 1920};
        int[] hs = {1080, 1080, 1080, 2160, 1080};
        float[] hz = {24f, 30f, 59.94f, 60f, 60f};
        check("at 60 already: left alone", ScreenFit.preferredMode(1920, 1080, 60f, ids, ws, hs, hz) == -1);
        check("at 59.94 already: left alone", ScreenFit.preferredMode(1920, 1080, 59.94f, ids, ws, hs, hz) == -1);
        check("at 30: 60 at the same size", ScreenFit.preferredMode(1920, 1080, 30f, ids, ws, hs, hz) == 5);
        check("never another resolution", ScreenFit.preferredMode(3840, 2160, 30f, new int[] {7, 8}, new int[] {3840, 1920}, new int[] {2160, 1080}, new float[] {30f, 60f}) == -1);
        check("a 50 Hz TV is left alone (its region's rate; no re-sync at every start)", ScreenFit.preferredMode(1920, 1080, 50f, new int[] {1, 2}, new int[] {1920, 1920}, new int[] {1080, 1080}, new float[] {50f, 59.94f}) == -1);
        check("nor anything from 48 Hz up", ScreenFit.preferredMode(1920, 1080, 48f, ids, ws, hs, hz) == -1);
        check("at 24: 60 at the same size", ScreenFit.preferredMode(1920, 1080, 24f, ids, ws, hs, hz) == 5);
        check("at 25: 59.94 when that is all there is", ScreenFit.preferredMode(1920, 1080, 25f, new int[] {1, 2}, new int[] {1920, 1920}, new int[] {1080, 1080}, new float[] {25f, 59.94f}) == 2);
        check("slow with no 60 mode: left alone", ScreenFit.preferredMode(1920, 1080, 30f, new int[] {1, 2}, new int[] {1920, 1920}, new int[] {1080, 1080}, new float[] {30f, 50f}) == -1);

        if (failed > 0) {
            System.err.println(failed + " screen check(s) failed");
            System.exit(1);
        }
        System.out.println("ScreenCheck: all passed");
    }

    private static void check(String what, boolean ok) {
        if (!ok) {
            failed++;
            System.err.println("FAIL: " + what);
        }
    }
}
