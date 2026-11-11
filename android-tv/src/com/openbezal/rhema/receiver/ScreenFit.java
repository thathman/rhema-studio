package com.openbezal.rhema.receiver;

/**
 * How the feed fits this TV (#849 G5, #835 S11): the page's own word on whether its output is off and
 * on the output's overscan, the TV-side edge inset when the output has none, and the display mode
 * with the most fitting frame rate. Plain Java, so build.sh's ScreenFitCheck tests it.
 */
final class ScreenFit {
    /** The most of each edge kept clear (percent), as the host's own overscan setting. */
    static final int MAX_INSET = 10;
    /** The frame rate asked for: the feed page draws at the display's rate, and a TV left at 24 or 30 Hz stutters. */
    static final float WANT_HZ = 60f;
    /**
     * Only a TV slower than this is asked to change (24, 25 or 30 Hz). A 50 Hz TV is left alone: it is
     * smooth, may be the region's setting, and a switch costs an HDMI re-sync of 1 to 3 s at each start.
     */
    static final float RAISE_BELOW_HZ = 48f;

    private ScreenFit() { }

    /**
     * What the Receiver asks the feed page: "off|overscan|stale" (src/feed.ts sets them on the page's
     * root element). An older page says none of them.
     */
    static final String PAGE_QUERY = "(function(d){return (d.off||'')+'|'+(d.overscan||'')+'|'+(d.stale||'')})(document.documentElement.dataset)";

    /** evaluateJavascript's answer (a JSON string, or null/"null") as {off, overscan, stale}; unknown parts are empty. */
    private static String[] parts(String answer) {
        String[] out = {"", "", ""};
        if (answer == null) return out;
        String s = answer.trim();
        if (s.length() >= 2 && s.charAt(0) == '"' && s.charAt(s.length() - 1) == '"') s = s.substring(1, s.length() - 1);
        String[] p = s.split("\\|", -1);
        if (p.length < 2) return out;
        for (int i = 0; i < Math.min(3, p.length); i++) out[i] = p[i];
        return out;
    }

    /**
     * Whether the page says its output is switched off in Rhema Studio: 1 off, 0 on (or it has lost
     * Rhema Studio, which its own cover says: not "off"), -1 it has said nothing yet (an older page,
     * or a page still loading: whatever shows stays).
     */
    static int pageOffState(String answer) {
        String[] p = parts(answer);
        if (p[0].isEmpty()) return -1;
        return "true".equals(p[0]) && !"true".equals(p[2]) ? 1 : 0;
    }

    /** The output's own overscan (percent) as the page says it; 0 when it says none or nothing. */
    static double pageOverscan(String answer) {
        try {
            double v = Double.parseDouble(parts(answer)[1]);
            return Double.isNaN(v) || v < 0 ? 0 : Math.min(MAX_INSET, v);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /** A TV-side inset kept in range. */
    static int tvInset(int pct) {
        return Math.max(0, Math.min(MAX_INSET, pct));
    }

    /**
     * The inset the Receiver applies around the page (percent of each edge): none when the output has
     * its own (the page already keeps it clear, and the two would add up), else the TV's own setting.
     */
    static int applied(double pageOverscan, int tvPct) {
        return pageOverscan > 0 ? 0 : tvInset(tvPct);
    }

    /**
     * The display mode to ask for: the same resolution as now, at the rate nearest WANT_HZ (60 or
     * 59.94), only when the TV runs below RAISE_BELOW_HZ; -1 leaves the TV as it is. Never a
     * different resolution (that would rescale the picture the TV was set up for).
     */
    static int preferredMode(int curW, int curH, float curHz, int[] ids, int[] ws, int[] hs, float[] hzs) {
        if (curHz >= RAISE_BELOW_HZ) return -1;
        int best = -1;
        float bestGap = 0.5f;
        for (int i = 0; i < ids.length; i++) {
            if (ws[i] != curW || hs[i] != curH) continue;
            float gap = Math.abs(hzs[i] - WANT_HZ);
            if (gap < bestGap) {
                best = ids[i];
                bestGap = gap;
            }
        }
        return best;
    }
}
