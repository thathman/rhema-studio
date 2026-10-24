package com.openbezal.rhema.receiver;

/**
 * Cheap checks ShowServer makes before it reads a request (#198 hardening). Plain Java only, so
 * build.sh's CodeProofCheck can test them on the computer.
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

    private static boolean digits(String s, int max) {
        if (s.isEmpty() || s.length() > max) return false;
        for (int i = 0; i < s.length(); i++) {
            if (s.charAt(i) < '0' || s.charAt(i) > '9') return false;
        }
        return true;
    }
}
