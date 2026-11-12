package com.openbezal.rhema.receiver;

import java.io.ByteArrayInputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLEngine;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509ExtendedTrustManager;

/**
 * What this TV pins Rhema Studio by (1.8, doc 48): the SHA-256 of the server's public key
 * (SubjectPublicKeyInfo DER, 64 lowercase hex), which stays the same when Rhema Studio's address
 * changes or its certificate is renewed. A feed paired before 1.8 (or sent by an older Rhema Studio)
 * pinned the SHA-256 of the whole certificate; the first time that certificate opens, the TV keeps
 * the key pin of that same, already-checked certificate instead (no one has to touch the TV).
 * Plain Java only (javax.net.ssl, no Android), so build.sh's KeyPinCheck tests it on the computer.
 */
final class KeyPin {
    private KeyPin() { }

    /** How many hex digits of the key pin Rhema Studio's network announcement carries (TXT k=). */
    static final int HINT = 16;

    /** check(): the certificate is not Rhema Studio's. */
    static final int REFUSE = 0;
    /** check(): it is (by the key pin). */
    static final int ACCEPT = 1;
    /** check(): it is (by the old whole-certificate pin): keep its key pin from now on. */
    static final int UPGRADE = 2;

    /** SHA-256 of a certificate's public key (SubjectPublicKeyInfo DER), lowercase hex. */
    static String spki(X509Certificate cert) {
        return CodeProof.hex(CodeProof.sha256(cert.getPublicKey().getEncoded()));
    }

    /** A certificate from its DER bytes. */
    static X509Certificate parse(byte[] der) throws CertificateException {
        return (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(new ByteArrayInputStream(der));
    }

    /** The key pin of a certificate given as DER, or null when it is not one. */
    static String spkiOfDer(byte[] der) {
        if (der == null) return null;
        try {
            return spki(parse(der));
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * The pins a /show carries: {certFingerprint, keyFingerprint or null}. Every Rhema Studio sends
     * the certificate pin; one with doc 48 also sends the key pin, which must then be well formed.
     * Null when what was sent is not a pair of pins.
     */
    static String[] fromShow(String cert, String key) {
        if (!Guard.fingerprint(cert)) return null;
        if (key == null || key.isEmpty()) return new String[] {cert, null};
        return Guard.fingerprint(key) ? new String[] {cert, key} : null;
    }

    /** Whether a feed is pinned at all (by its key, or by its certificate from before 1.8). */
    static boolean paired(String legacy, String key) {
        return Guard.fingerprint(key) || Guard.fingerprint(legacy);
    }

    /**
     * Whether a page's certificate is Rhema Studio's. With a key pin, only that key is accepted (the
     * old certificate pin no longer counts, so it cannot be used to go back). Without one, a
     * certificate whose whole hash is the old pin is accepted and its own key pin is kept (UPGRADE);
     * anything else is refused.
     */
    static int check(String keyPin, String legacyPin, String seenCert, String seenKey) {
        if (Guard.fingerprint(keyPin)) return same(keyPin, seenKey) ? ACCEPT : REFUSE;
        if (Guard.fingerprint(legacyPin) && same(legacyPin, seenCert) && Guard.fingerprint(seenKey)) return UPGRADE;
        return REFUSE;
    }

    /** Equal pins, compared in constant time. */
    static boolean same(String a, String b) {
        return a != null && b != null && MessageDigest.isEqual(a.getBytes(StandardCharsets.US_ASCII), b.getBytes(StandardCharsets.US_ASCII));
    }

    /**
     * Whether an announced Rhema Studio (TXT k=) may be this TV's: its hint is the first HINT hex
     * digits of the key pin. Only a filter (anyone can announce anything): the address is used only
     * after probe() finds the whole key pin there.
     */
    static boolean hintMatches(String k, String keyPin) {
        if (k == null || !Guard.fingerprint(keyPin)) return false;
        String h = k.trim().toLowerCase(Locale.ROOT);
        if (h.length() != HINT) return false;
        for (int i = 0; i < HINT; i++) {
            char c = h.charAt(i);
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
        }
        return keyPin.startsWith(h);
    }

    /** One TXT value as text (NsdServiceInfo.getAttributes()), or null. */
    static String txt(Map<String, byte[]> attributes, String name) {
        if (attributes == null) return null;
        byte[] v = attributes.get(name);
        return v == null ? null : new String(v, StandardCharsets.US_ASCII);
    }

    /** An announced port (TXT tls=): 1 to 65535, else -1. */
    static int port(String s) {
        if (s == null) return -1;
        String p = s.trim();
        if (p.isEmpty() || p.length() > 5) return -1;
        for (int i = 0; i < p.length(); i++) {
            if (p.charAt(i) < '0' || p.charAt(i) > '9') return -1;
        }
        int n = Integer.parseInt(p);
        return n >= 1 && n <= 65535 ? n : -1;
    }

    /**
     * The feed link at Rhema Studio's new address: the same path and key (Rhema Studio checks the
     * feed by its path and key, and accepts any of its addresses), at ipv4:port. Null when that is
     * not a feed link this TV opens.
     */
    static String movedTo(String url, String ipv4, int port) {
        try {
            if (ipv4 == null || ipv4.indexOf(':') >= 0 || port < 1 || port > 65535 || !Guard.feedLink(url)) return null;
            java.net.URI u = new java.net.URI(url);
            String moved = "https://" + ipv4 + ":" + port + u.getRawPath()
                    + (u.getRawQuery() == null ? "" : "?" + u.getRawQuery())
                    + (u.getRawFragment() == null ? "" : "#" + u.getRawFragment());
            return Guard.feedLink(moved) ? moved : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** Closes probe sockets whose whole time is over (one daemon thread for all probes). */
    private static final ScheduledExecutorService DEADLINES = Executors.newSingleThreadScheduledExecutor(new ThreadFactory() {
        @Override
        public Thread newThread(Runnable r) {
            Thread t = new Thread(r, "rhema-probe-deadline");
            t.setDaemon(true);
            return t;
        }
    });

    /**
     * Whether Rhema Studio with this key pin answers TLS at host:port: the handshake completes only
     * when the server's certificate carries the pinned key and the server proves it holds that key's
     * private half (TLS signs the handshake with it). Sends nothing else. Blocking; never on the
     * screen's thread. timeoutMs is the whole check, connect and handshake together: a host that
     * sends a byte now and then (anyone can announce the public k= hint) is cut off when it is over,
     * since a read timeout alone would restart with every byte.
     */
    static boolean probe(String host, int port, String keyPin, int timeoutMs) {
        if (!Guard.fingerprint(keyPin) || timeoutMs <= 0) return false;
        final long until = System.nanoTime() + timeoutMs * 1_000_000L;
        final Socket raw = new Socket();
        ScheduledFuture<?> cut = null;
        try {
            cut = DEADLINES.schedule(new Runnable() {
                @Override
                public void run() {
                    try { raw.close(); } catch (Exception ignored) { }
                }
            }, timeoutMs, TimeUnit.MILLISECONDS);
            SSLContext ctx = SSLContext.getInstance("TLS");
            ctx.init(null, new TrustManager[] {new Pinned(keyPin)}, null);
            raw.connect(new InetSocketAddress(host, port), timeoutMs);
            raw.setSoTimeout(timeoutMs);
            try (SSLSocket s = (SSLSocket) ctx.getSocketFactory().createSocket(raw, host, port, false)) {
                s.startHandshake();
                // Done in time (a handshake finished just as the deadline closed it does not count).
                return System.nanoTime() < until && !raw.isClosed();
            }
        } catch (Exception e) {
            return false;
        } finally {
            if (cut != null) cut.cancel(false);
            try { raw.close(); } catch (Exception ignored) { }
        }
    }

    /** Trusts exactly one server key (the pin), whatever names or dates its certificate has. */
    static final class Pinned extends X509ExtendedTrustManager {
        private final String pin;

        Pinned(String pin) {
            this.pin = pin;
        }

        private void server(X509Certificate[] chain) throws CertificateException {
            if (chain == null || chain.length == 0 || !same(pin, spki(chain[0]))) {
                throw new CertificateException("not the Rhema Studio this TV is paired with");
            }
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            server(chain);
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType, Socket socket) throws CertificateException {
            server(chain);
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType, SSLEngine engine) throws CertificateException {
            server(chain);
        }

        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            throw new CertificateException("a client is never trusted");
        }

        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType, Socket socket) throws CertificateException {
            throw new CertificateException("a client is never trusted");
        }

        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType, SSLEngine engine) throws CertificateException {
            throw new CertificateException("a client is never trusted");
        }

        @Override
        public X509Certificate[] getAcceptedIssuers() {
            return new X509Certificate[0];
        }
    }
}
