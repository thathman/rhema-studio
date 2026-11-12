package com.openbezal.rhema.camera;

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
 * What this camera pins Rhema Studio by (1.6, doc 48): the SHA-256 of the server's public key
 * (SubjectPublicKeyInfo DER, 64 lowercase hex, the link's key=), which stays the same when Rhema
 * Studio's address changes or its certificate is renewed. A link from before (fp= only) pinned the
 * SHA-256 of the whole certificate; the first time that very certificate completes a connection, the
 * camera keeps the key pin of that same, already-checked certificate instead (no one has to touch the
 * phone). The same rules as the Receiver's KeyPin; the two apps share no code, so this is a copy.
 * Plain Java only (javax.net.ssl, no Android), so build.sh's KeyPinCheck tests it.
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
        return Pairing.hex(Pairing.sha256(cert.getPublicKey().getEncoded()));
    }

    /** SHA-256 of the whole certificate (DER), lowercase hex: the pin of a link from before key=. */
    static String leaf(X509Certificate cert) throws CertificateException {
        return Pairing.hex(Pairing.sha256(cert.getEncoded()));
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

    /** A pin as the links write it: 64 lowercase hex. */
    static boolean fingerprint(String s) {
        return s != null && Pairing.hex64(s);
    }

    /**
     * Whether a server's certificate is Rhema Studio's. With a key pin, only that key is accepted (the
     * old certificate pin no longer counts, so it cannot be used to go back). Without one, a
     * certificate whose whole hash is the old pin is accepted and its own key pin is kept (UPGRADE);
     * anything else is refused.
     */
    static int check(String keyPin, String legacyPin, String seenCert, String seenKey) {
        if (fingerprint(keyPin)) return same(keyPin, seenKey) ? ACCEPT : REFUSE;
        if (fingerprint(legacyPin) && same(legacyPin, seenCert) && fingerprint(seenKey)) return UPGRADE;
        return REFUSE;
    }

    /** check() for the chain a TLS server sent (its first certificate is the server's own). */
    static int check(String keyPin, String legacyPin, X509Certificate[] chain) {
        if (chain == null || chain.length == 0 || chain[0] == null) return REFUSE;
        try {
            return check(keyPin, legacyPin, leaf(chain[0]), spki(chain[0]));
        } catch (Exception e) {
            return REFUSE;
        }
    }

    /** Equal pins, compared in constant time. */
    static boolean same(String a, String b) {
        return a != null && b != null && MessageDigest.isEqual(a.getBytes(StandardCharsets.US_ASCII), b.getBytes(StandardCharsets.US_ASCII));
    }

    /**
     * Whether an announced Rhema Studio (TXT k=) may be this camera's: its hint is the first HINT hex
     * digits of the key pin. Only a filter (anyone can announce anything): the address is used only
     * after probe() finds the whole key pin there.
     */
    static boolean hintMatches(String k, String keyPin) {
        if (k == null || !fingerprint(keyPin)) return false;
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
     * private half (TLS signs the handshake with it). Sends nothing else. Blocking; never on the main
     * thread. timeoutMs is the whole check, connect and handshake together: a host that sends a byte
     * now and then (anyone can announce the public k= hint) is cut off when it is over, since a read
     * timeout alone would restart with every byte.
     */
    static boolean probe(String host, int port, String keyPin, int timeoutMs) {
        if (!fingerprint(keyPin) || timeoutMs <= 0) return false;
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
                return inTime(System.nanoTime(), until, raw.isClosed());
            }
        } catch (Exception e) {
            return false;
        } finally {
            if (cut != null) cut.cancel(false);
            try { raw.close(); } catch (Exception ignored) { }
        }
    }

    /** A handshake counts only when done in time: one that finished just as the deadline closed its socket does not. */
    static boolean inTime(long nowNs, long untilNs, boolean closed) {
        return nowNs - untilNs < 0 && !closed;
    }

    /** Trusts exactly one server key (the pin), whatever names or dates its certificate has. */
    static final class Pinned extends X509ExtendedTrustManager {
        private final String pin;

        Pinned(String pin) {
            this.pin = pin;
        }

        private void server(X509Certificate[] chain) throws CertificateException {
            if (chain == null || chain.length == 0 || !same(pin, spki(chain[0]))) {
                throw new CertificateException("not the Rhema Studio this camera is paired with");
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
