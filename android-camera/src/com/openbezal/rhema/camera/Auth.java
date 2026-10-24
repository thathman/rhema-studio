package com.openbezal.rhema.camera;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Signing in to the camera router as this camera: answers its WWW-Authenticate challenge with
 * Basic (safe here: always inside TLS) or Digest (RFC 2617 / 7616, MD5 or SHA-256), whichever it
 * asks for, preferring Digest. Plain Java (no Android), so build.sh can test it.
 */
final class Auth {
    final String scheme;
    final Map<String, String> params;
    private int nc;

    private Auth(String scheme, Map<String, String> params) {
        this.scheme = scheme;
        this.params = params;
    }

    /** The challenge to answer from the router's WWW-Authenticate headers, or null if none fits. */
    static Auth choose(List<String> challenges) {
        Auth basic = null;
        for (String c : challenges) {
            Auth a = parse(c);
            if (a == null) continue;
            if (a.scheme.equals("digest")) return a;
            if (a.scheme.equals("basic")) basic = a;
        }
        return basic;
    }

    static Auth parse(String header) {
        String h = header.trim();
        int sp = h.indexOf(' ');
        String scheme = (sp < 0 ? h : h.substring(0, sp)).toLowerCase(Locale.ROOT);
        if (!scheme.equals("basic") && !scheme.equals("digest")) return null;
        Map<String, String> p = new HashMap<String, String>();
        String rest = sp < 0 ? "" : h.substring(sp + 1);
        int i = 0;
        while (i < rest.length()) {
            while (i < rest.length() && (rest.charAt(i) == ' ' || rest.charAt(i) == ',')) i++;
            int eq = rest.indexOf('=', i);
            if (eq < 0) break;
            String k = rest.substring(i, eq).trim().toLowerCase(Locale.ROOT);
            i = eq + 1;
            String v;
            if (i < rest.length() && rest.charAt(i) == '"') {
                StringBuilder sb = new StringBuilder();
                i++;
                while (i < rest.length() && rest.charAt(i) != '"') {
                    if (rest.charAt(i) == '\\' && i + 1 < rest.length()) i++;
                    sb.append(rest.charAt(i++));
                }
                i++;
                v = sb.toString();
            } else {
                int end = rest.indexOf(',', i);
                if (end < 0) end = rest.length();
                v = rest.substring(i, end).trim();
                i = end;
            }
            p.put(k, v);
        }
        return new Auth(scheme, p);
    }

    /** The Authorization header for one request. */
    String header(String method, String uri, String user, String pass) {
        if (scheme.equals("basic")) {
            return "Basic " + Base64.getEncoder().encodeToString((user + ":" + pass).getBytes(StandardCharsets.UTF_8));
        }
        nc++;
        String cnonce = Pairing.hex(Pairing.sha256((System.nanoTime() + ":" + nc).getBytes(StandardCharsets.UTF_8))).substring(0, 16);
        return digest(method, uri, user, pass, String.format(Locale.ROOT, "%08x", nc), cnonce);
    }

    /** The Digest answer for a given nonce count and client nonce (fixed in the tests). */
    String digest(String method, String uri, String user, String pass, String ncValue, String cnonce) {
        String realm = val("realm");
        String nonce = val("nonce");
        String algorithm = val("algorithm");
        String alg = algorithm.equalsIgnoreCase("SHA-256") ? "SHA-256" : "MD5";
        boolean auth = false;
        for (String q : val("qop").split(",")) if (q.trim().equalsIgnoreCase("auth")) auth = true;
        String ha1 = hash(alg, user + ":" + realm + ":" + pass);
        String ha2 = hash(alg, method + ":" + uri);
        String response = auth ? hash(alg, ha1 + ":" + nonce + ":" + ncValue + ":" + cnonce + ":auth:" + ha2) : hash(alg, ha1 + ":" + nonce + ":" + ha2);
        StringBuilder sb = new StringBuilder("Digest username=\"").append(user).append("\", realm=\"").append(realm)
                .append("\", nonce=\"").append(nonce).append("\", uri=\"").append(uri).append("\", response=\"").append(response).append('"');
        if (!algorithm.isEmpty()) sb.append(", algorithm=").append(algorithm);
        if (auth) sb.append(", qop=auth, nc=").append(ncValue).append(", cnonce=\"").append(cnonce).append('"');
        if (params.containsKey("opaque")) sb.append(", opaque=\"").append(val("opaque")).append('"');
        return sb.toString();
    }

    private String val(String k) {
        String v = params.get(k);
        return v == null ? "" : v;
    }

    static String hash(String alg, String s) {
        try {
            return Pairing.hex(MessageDigest.getInstance(alg).digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
