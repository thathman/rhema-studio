package com.openbezal.rhema.receiver;

/**
 * Cheap checks ShowServer makes before it reads a request (#198 hardening), and the limits of the
 * picture kept for a restart (1.5). Plain Java only, so build.sh's CodeProofCheck can test them on
 * the computer.
 */
final class Guard {
    private Guard() { }

    /**
     * What Rhema sends is one flat JSON object of short strings. A body with nested objects or any
     * list is refused before parsing: Android's JSON parser recurses without a limit, so a few
     * kilobytes of "[" could overflow the thread's stack and close the app.
     */
    static boolean flatObject(String body) {
        String b = body.trim();
        if (!b.startsWith("{") || !b.endsWith("}")) return false;
        int open = 0;
        for (int i = 0; i < b.length(); i++) {
            char c = b.charAt(i);
            if (c == '[' || c == ']') return false;
            if (c == '{' && ++open > 1) return false;
        }
        return true;
    }

    /**
     * Whether a Host header names this TV by an address (192.168.1.40:8095, [fe80::1]:8095), not by
     * a name. Rhema always uses the address; a web page that renamed itself to this TV's address
     * (DNS rebinding) would send its own name and is refused.
     */
    static boolean ipLiteralHost(String host) {
        if (host == null) return false;
        String h = host.trim();
        String port = null;
        if (h.startsWith("[")) {
            int end = h.indexOf(']');
            if (end < 0) return false;
            String rest = h.substring(end + 1);
            if (!rest.isEmpty()) {
                if (!rest.startsWith(":")) return false;
                port = rest.substring(1);
            }
            String ip = h.substring(1, end);
            if (ip.isEmpty() || ip.indexOf(':') < 0) return false;
            for (int i = 0; i < ip.length(); i++) {
                char c = ip.charAt(i);
                boolean hex = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
                if (!hex && c != ':' && c != '.') return false;
            }
        } else {
            int colon = h.lastIndexOf(':');
            if (colon >= 0) {
                port = h.substring(colon + 1);
                h = h.substring(0, colon);
            }
            String[] parts = h.split("\\.", -1);
            if (parts.length != 4) return false;
            for (String p : parts) {
                if (!digits(p, 3) || Integer.parseInt(p) > 255) return false;
            }
        }
        return port == null || (digits(port, 5) && Integer.parseInt(port) <= 65535);
    }

    /**
     * A feed link Rhema 1.3 sends: https, to a computer named by its address (that is what Rhema's
     * certificate is made for), on a port, at /feed/<id>.
     */
    static boolean feedLink(String url) {
        try {
            java.net.URI u = new java.net.URI(url);
            String host = u.getHost();
            return "https".equals(u.getScheme()) && u.getRawUserInfo() == null && host != null && u.getPort() > 0
                    && ipLiteralHost(host + ":" + u.getPort()) && u.getRawPath() != null && u.getRawPath().startsWith("/feed/") && u.getRawPath().length() > 6;
        } catch (Exception e) {
            return false;
        }
    }

    /** A certificate fingerprint as Rhema writes it: SHA-256, 64 lowercase hex digits. */
    static boolean fingerprint(String hex) {
        if (hex == null || hex.length() != 64) return false;
        for (int i = 0; i < 64; i++) {
            char c = hex.charAt(i);
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
        }
        return true;
    }

    /** The biggest picture of the screen kept for a restart (1.5): 1920×1080 at most. */
    static final int STILL_MAX_W = 1920;
    static final int STILL_MAX_H = 1080;
    /** A kept picture bigger than this is not kept (a JPEG of a 1080p screen is far smaller). */
    static final long STILL_MAX_BYTES = 4L * 1024 * 1024;

    /**
     * The size of the picture kept of a screen w×h: the same shape, no bigger than
     * STILL_MAX_W×STILL_MAX_H, at least 1×1; null for a screen with no size yet.
     */
    static int[] stillSize(int w, int h) {
        if (w <= 0 || h <= 0) return null;
        double scale = Math.min(1.0, Math.min((double) STILL_MAX_W / w, (double) STILL_MAX_H / h));
        return new int[] {Math.max(1, (int) Math.round(w * scale)), Math.max(1, (int) Math.round(h * scale))};
    }

    /**
     * Whether the picture kept is the one to show at start: it was taken of the feed shown now (a
     * picture of another feed, or of a link withdrawn since, is never shown) and is not too big.
     */
    static boolean stillFits(String takenOf, String shown, long bytes) {
        return takenOf != null && takenOf.equals(shown) && bytes > 0 && bytes <= STILL_MAX_BYTES;
    }

    private static boolean digits(String s, int max) {
        if (s.isEmpty() || s.length() > max) return false;
        for (int i = 0; i < s.length(); i++) {
            if (s.charAt(i) < '0' || s.charAt(i) > '9') return false;
        }
        return true;
    }
}
