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

    /**
     * Whether a request the feed page makes is its acknowledgement of a drawn frame (#604, Ready):
     * a POST to /api/v1/feed/<id>/ack?k=<key> at the same https address as the link shown, for the
     * same feed and with the same key. Anything else (another feed's page, an old link, another
     * computer) proves nothing about this screen.
     */
    static boolean ackOf(String shown, String method, String request) {
        if (shown == null || request == null || !"POST".equalsIgnoreCase(method)) return false;
        try {
            java.net.URI s = new java.net.URI(shown);
            java.net.URI r = new java.net.URI(request);
            String id = decode(lastSegment(s.getRawPath()));
            String key = query(s.getRawQuery(), "k");
            String path = r.getRawPath();
            String prefix = "/api/v1/feed/";
            String sent = path != null && path.startsWith(prefix) && path.endsWith("/ack") && path.length() > prefix.length() + 4
                    ? path.substring(prefix.length(), path.length() - 4) : null;
            return "https".equals(r.getScheme()) && r.getRawUserInfo() == null && s.getHost() != null
                    && s.getHost().equalsIgnoreCase(r.getHost()) && s.getPort() == r.getPort()
                    && id != null && !id.isEmpty() && key != null && !key.isEmpty()
                    && sent != null && sent.indexOf('/') < 0 && id.equals(decode(sent)) && key.equals(query(r.getRawQuery(), "k"));
        } catch (Exception e) {
            return false;
        }
    }

    /** The page reads its feed id as the last part of its raw path, decoded (feed.ts), so this does too. */
    private static String lastSegment(String path) {
        return path == null ? null : path.substring(path.lastIndexOf('/') + 1);
    }

    /** decodeURIComponent: %XX only ("+" stays "+", as in a path). */
    private static String decode(String s) throws java.io.UnsupportedEncodingException {
        return s == null ? null : java.net.URLDecoder.decode(s.replace("+", "%2B"), "UTF-8");
    }

    /** One query value, decoded as the page's URLSearchParams does; null when absent or repeated. */
    private static String query(String raw, String name) throws java.io.UnsupportedEncodingException {
        if (raw == null) return null;
        String found = null;
        for (String part : raw.split("&")) {
            int eq = part.indexOf('=');
            String k = java.net.URLDecoder.decode(eq < 0 ? part : part.substring(0, eq), "UTF-8");
            if (!k.equals(name)) continue;
            if (found != null) return null;
            found = java.net.URLDecoder.decode(eq < 0 ? "" : part.substring(eq + 1), "UTF-8");
        }
        return found;
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

    /**
     * How old the retained picture is, only when its saved URL still belongs to the shown feed.
     * Wall-clock time is persisted so the age survives process and device restarts. A missing,
     * invalid, future (clock moved backwards), or different-feed timestamp is reported honestly.
     */
    static String stillAgeLabel(String takenOf, String shown, long capturedAtMillis, long nowMillis) {
        if (takenOf == null || shown == null || !takenOf.equals(shown)
                || capturedAtMillis <= 0 || nowMillis <= 0 || capturedAtMillis > nowMillis) {
            return "age unknown";
        }

        long elapsedMillis = nowMillis - capturedAtMillis;
        if (elapsedMillis < 60_000L) return "less than a minute ago";

        long minutes = elapsedMillis / 60_000L;
        if (minutes < 60L) return quantity(minutes, "minute");

        long hours = elapsedMillis / 3_600_000L;
        if (hours < 24L) return quantity(hours, "hour");

        long days = elapsedMillis / 86_400_000L;
        return quantity(days, "day");
    }

    private static String quantity(long value, String unit) {
        return value + " " + unit + (value == 1 ? "" : "s") + " ago";
    }

    private static boolean digits(String s, int max) {
        if (s.isEmpty() || s.length() > max) return false;
        for (int i = 0; i < s.length(); i++) {
            if (s.charAt(i) < '0' || s.charAt(i) > '9') return false;
        }
        return true;
    }
}
