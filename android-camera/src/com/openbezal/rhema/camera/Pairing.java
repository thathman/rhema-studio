package com.openbezal.rhema.camera;

import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashMap;
import java.util.Map;

/**
 * A camera's pairing link from Rhema's Cameras card:
 * rhema-camera://pair?host=192.168.1.20&port=8322&name=pulpit&user=cam-pulpit&token=…&fp=…&key=…&api=8081
 * It says where Rhema's camera router is, which camera this phone is, the camera's own password
 * (its link's secret) and the SHA-256 fingerprint of Rhema's certificate; (from this app 1.2) the
 * port of Rhema's secure listener, where the app reports its battery and heat (same certificate);
 * and (from this app 1.6, doc 48) key=, the SHA-256 of Rhema's server key (SubjectPublicKeyInfo),
 * which stays the same when Rhema's address changes. With key= only that key is trusted; a link
 * without it trusts that one certificate until it first connects, then keeps its key (KeyPin).
 * Plain Java (no Android), so build.sh can test it.
 */
final class Pairing {
    final String host;
    final int port;
    final String name;
    final String user;
    final String token;
    /** Lower-case hex SHA-256 of the router's certificate (DER): trusted only until key is known. */
    final String fp;
    /** Lower-case hex SHA-256 of Rhema's server key (SubjectPublicKeyInfo DER); empty when not known yet. */
    final String key;
    /** What the operator called the camera ("Pulpit"); may be empty. */
    final String label;
    /** Rhema's secure listener (https, the same certificate), for the battery and heat report; 0 when the link has none. */
    final int api;

    private Pairing(String host, int port, String name, String user, String token, String fp, String key, String label, int api) {
        this.host = host;
        this.port = port;
        this.name = name;
        this.user = user;
        this.token = token;
        this.fp = fp;
        this.key = key;
        this.label = label;
        this.api = api;
    }

    /** Reads a pairing link; the message of the exception says plainly what is wrong with it. */
    static Pairing parse(String link) {
        if (link == null) throw new IllegalArgumentException("No link");
        String s = link.trim();
        String prefix = "rhema-camera://pair?";
        if (!s.regionMatches(true, 0, prefix, 0, prefix.length())) {
            throw new IllegalArgumentException("That is not a Rhema Studio Cam link (it starts with rhema-camera://pair)");
        }
        Map<String, String> q = new HashMap<String, String>();
        for (String part : s.substring(prefix.length()).split("&")) {
            if (part.isEmpty()) continue;
            int eq = part.indexOf('=');
            String k = eq < 0 ? part : part.substring(0, eq);
            String v = eq < 0 ? "" : decode(part.substring(eq + 1));
            if (q.put(k, v) != null) throw new IllegalArgumentException("The link has \"" + k + "\" twice");
        }
        String host = need(q, "host");
        if (!ipv4(host)) throw new IllegalArgumentException("The link's computer address is not an IPv4 address");
        int port;
        try {
            port = Integer.parseInt(need(q, "port"));
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("The link's port is not a number");
        }
        if (port < 1 || port > 65535) throw new IllegalArgumentException("The link's port is out of range");
        String name = need(q, "name");
        if (!cameraName(name)) throw new IllegalArgumentException("The link's camera name is not one Rhema makes");
        String user = need(q, "user");
        if (!user.equals("cam-" + name)) throw new IllegalArgumentException("The link's user does not belong to this camera");
        String token = need(q, "token");
        if (!secret(token)) throw new IllegalArgumentException("The link's password is not one Rhema makes");
        String fp = need(q, "fp").replace(":", "").toLowerCase(java.util.Locale.ROOT);
        if (!hex64(fp)) throw new IllegalArgumentException("The link's certificate fingerprint is not a SHA-256 fingerprint");
        // Optional (doc 48): a link from an older Rhema has none. When it is there it must be right.
        String key = q.containsKey("key") ? q.get("key").replace(":", "").toLowerCase(java.util.Locale.ROOT) : "";
        if (!key.isEmpty() && !hex64(key)) throw new IllegalArgumentException("The link's key fingerprint is not a SHA-256 fingerprint");
        String label = q.containsKey("label") ? q.get("label") : "";
        if (label.length() > 40) label = label.substring(0, 40);
        int api = 0;
        if (q.containsKey("api")) {
            try {
                api = Integer.parseInt(q.get("api"));
            } catch (NumberFormatException e) {
                throw new IllegalArgumentException("The link's report port is not a number");
            }
            if (api < 1 || api > 65535) throw new IllegalArgumentException("The link's report port is out of range");
        }
        return new Pairing(host, port, name, user, token, fp, key, label, api);
    }

    /** Whether this camera trusts Rhema by its server key (else, until the first connection, by its certificate). */
    boolean keyPinned() {
        return hex64(key);
    }

    /**
     * The same pairing, trusting from now on the server key of the certificate the link's fp named,
     * once that certificate completed a connection (KeyPin.UPGRADE). Null when there is nothing to do
     * (a key is already kept, or that is no key pin).
     */
    Pairing withKey(String spki) {
        if (keyPinned() || spki == null || !hex64(spki)) return null;
        return new Pairing(host, port, name, user, token, fp, spki, label, api);
    }

    /**
     * The same pairing at Rhema's new address (found on the network and proved by its key, doc 48):
     * only the IPv4 address changes; ports, camera, password and pins stay. Null when the address is
     * not an IPv4 address, or this pairing has no key pin to have proved it by.
     */
    Pairing movedTo(String ipv4) {
        if (!keyPinned() || ipv4 == null || !ipv4(ipv4)) return null;
        return new Pairing(ipv4, port, name, user, token, fp, key, label, api);
    }

    /** change(): another camera, another Rhema, or nothing before: start again and forget what Rhema said. */
    static final int OTHER = 0;
    /** change(): the very same link. */
    static final int SAME = 1;
    /** change(): only the server key was added (KeyPin.UPGRADE): nothing has to start again. */
    static final int KEY_KEPT = 2;
    /** change(): only Rhema's address changed (rediscovery): connect there, the same camera. */
    static final int MOVED = 3;

    /** What changed between the kept pairing and a new one. */
    static int change(Pairing before, Pairing after) {
        if (before == null || after == null) return OTHER;
        boolean camera = before.port == after.port && before.name.equals(after.name) && before.user.equals(after.user) && before.token.equals(after.token)
                && before.fp.equals(after.fp) && before.label.equals(after.label) && before.api == after.api;
        if (!camera) return OTHER;
        boolean sameHost = before.host.equals(after.host);
        if (sameHost && before.key.equals(after.key)) return SAME;
        if (sameHost && before.key.isEmpty() && after.keyPinned()) return KEY_KEPT;
        if (!sameHost && before.keyPinned() && before.key.equals(after.key)) return MOVED;
        return OTHER;
    }

    /** Where this camera publishes: always RTSP over TLS, never plain RTSP. */
    String url() {
        return "rtsps://" + host + ":" + port + "/" + name;
    }

    /** The link again (what Settings keeps). */
    String link() {
        return "rhema-camera://pair?host=" + host + "&port=" + port + "&name=" + name + "&user=" + user + "&token=" + token + "&fp=" + fp + (key.isEmpty() ? "" : "&key=" + key)
                + (label.isEmpty() ? "" : "&label=" + encode(label)) + (api == 0 ? "" : "&api=" + api);
    }

    /** Where the battery and heat report goes, or null when the link has no report port. */
    String statusUrl() {
        return api == 0 ? null : "https://" + host + ":" + api + "/api/v1/camera/" + name + "/status";
    }

    /** Where its tally is read (#209); null for a link without a report port (an older Rhema). */
    String tallyUrl() {
        return api == 0 ? null : "https://" + host + ":" + api + "/api/v1/camera/" + name + "/tally";
    }

    /**
     * What the Pair dialog says: where this phone will send and as what, what it replaces when
     * another pairing is kept (currentTitle is what that one is called on screen), and what is trusted.
     */
    static String askWords(Pairing current, String currentTitle, Pairing next) {
        StringBuilder b = new StringBuilder("This phone will send its camera to Rhema at ").append(next.host).append(" as \"").append(next.title()).append("\".");
        if (current != null && change(current, next) != SAME) {
            b.append("\n\nIt replaces \"").append(currentTitle == null || currentTitle.isEmpty() ? current.title() : currentTitle).append("\" at ").append(current.host).append('.');
        }
        b.append("\n\nOnly that computer's ").append(next.keyPinned() ? "key" : "certificate").append(" is accepted, and the picture is encrypted on the way.");
        return b.toString();
    }

    /** What to call this camera on screen. */
    String title() {
        return label.isEmpty() ? name : label;
    }

    /** Safe to print: no password. */
    @Override
    public String toString() {
        return "Pairing(" + host + ":" + port + "/" + name + ")";
    }

    /** Whether a certificate (its DER bytes) is the one this link's fp names (the pin of links from before key=). */
    static boolean pinned(byte[] der, String fp) {
        if (der == null || fp == null || !hex64(fp)) return false;
        byte[] want = unhex(fp);
        return MessageDigest.isEqual(sha256(der), want);
    }

    static byte[] sha256(byte[] data) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(data);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(Character.forDigit((x >> 4) & 15, 16)).append(Character.forDigit(x & 15, 16));
        return sb.toString();
    }

    static byte[] unhex(String s) {
        byte[] out = new byte[s.length() / 2];
        for (int i = 0; i < out.length; i++) out[i] = (byte) Integer.parseInt(s.substring(2 * i, 2 * i + 2), 16);
        return out;
    }

    /** As Rhema's camera names: lower-case letters, digits, - and _, not starting with - or _. */
    static boolean cameraName(String n) {
        if (n.isEmpty() || n.length() > 40 || n.charAt(0) == '-' || n.charAt(0) == '_') return false;
        for (int i = 0; i < n.length(); i++) {
            char c = n.charAt(i);
            if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_')) return false;
        }
        return true;
    }

    /** As Rhema's secrets: 16 to 128 letters and digits. */
    static boolean secret(String t) {
        if (t.length() < 16 || t.length() > 128) return false;
        for (int i = 0; i < t.length(); i++) {
            char c = t.charAt(i);
            if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'))) return false;
        }
        return true;
    }

    static boolean hex64(String s) {
        if (s.length() != 64) return false;
        for (int i = 0; i < 64; i++) {
            char c = s.charAt(i);
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
        }
        return true;
    }

    static boolean ipv4(String h) {
        String[] parts = h.split("\\.", -1);
        if (parts.length != 4) return false;
        for (String p : parts) {
            if (p.isEmpty() || p.length() > 3) return false;
            for (int i = 0; i < p.length(); i++) if (p.charAt(i) < '0' || p.charAt(i) > '9') return false;
            if (Integer.parseInt(p) > 255) return false;
        }
        return true;
    }

    private static String need(Map<String, String> q, String k) {
        String v = q.get(k);
        if (v == null || v.isEmpty()) throw new IllegalArgumentException("The link has no " + k);
        return v;
    }

    private static String decode(String v) {
        try {
            return URLDecoder.decode(v, "UTF-8");
        } catch (UnsupportedEncodingException | IllegalArgumentException e) {
            throw new IllegalArgumentException("The link is not written correctly");
        }
    }

    private static String encode(String v) {
        try {
            return URLEncoder.encode(v, "UTF-8").replace("+", "%20");
        } catch (UnsupportedEncodingException e) {
            throw new IllegalStateException(e);
        }
    }
}
