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
 * rhema-camera://pair?host=192.168.1.20&port=8322&name=pulpit&user=cam-pulpit&token=…&fp=…&api=8081
 * It says where Rhema's camera router is, which camera this phone is, the camera's own password
 * (its link's secret) and the SHA-256 fingerprint of Rhema's certificate, which is the only
 * certificate this phone will send to; and (from Rhema Studio 1.x with this app 1.2) the port of
 * Rhema's secure listener, where the app reports its battery and heat (same certificate). Plain
 * Java (no Android), so build.sh can test it.
 */
final class Pairing {
    final String host;
    final int port;
    final String name;
    final String user;
    final String token;
    /** Lower-case hex SHA-256 of the router's certificate (DER). */
    final String fp;
    /** What the operator called the camera ("Pulpit"); may be empty. */
    final String label;
    /** Rhema's secure listener (https, the same certificate), for the battery and heat report; 0 when the link has none. */
    final int api;

    private Pairing(String host, int port, String name, String user, String token, String fp, String label, int api) {
        this.host = host;
        this.port = port;
        this.name = name;
        this.user = user;
        this.token = token;
        this.fp = fp;
        this.label = label;
        this.api = api;
    }

    /** Reads a pairing link; the message of the exception says plainly what is wrong with it. */
    static Pairing parse(String link) {
        if (link == null) throw new IllegalArgumentException("No link");
        String s = link.trim();
        String prefix = "rhema-camera://pair?";
        if (!s.regionMatches(true, 0, prefix, 0, prefix.length())) {
            throw new IllegalArgumentException("That is not a Rhema Camera link (it starts with rhema-camera://pair)");
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
        return new Pairing(host, port, name, user, token, fp, label, api);
    }

    /** Where this camera publishes: always RTSP over TLS, never plain RTSP. */
    String url() {
        return "rtsps://" + host + ":" + port + "/" + name;
    }

    /** The link again (what Settings keeps). */
    String link() {
        return "rhema-camera://pair?host=" + host + "&port=" + port + "&name=" + name + "&user=" + user + "&token=" + token + "&fp=" + fp
                + (label.isEmpty() ? "" : "&label=" + encode(label)) + (api == 0 ? "" : "&api=" + api);
    }

    /** Where the battery and heat report goes, or null when the link has no report port. */
    String statusUrl() {
        return api == 0 ? null : "https://" + host + ":" + api + "/api/v1/camera/" + name + "/status";
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

    /** Whether a certificate (its DER bytes) is the one this link names. */
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
