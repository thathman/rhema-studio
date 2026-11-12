package com.openbezal.rhema.receiver;

import java.net.InetAddress;
import java.security.KeyFactory;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLServerSocket;
import javax.net.ssl.SSLSocket;

/**
 * build.sh runs this before it makes the app (1.8, doc 48): the key pin of a certificate, accepting
 * the old certificate pin once and keeping the key pin, the network hint (TXT k=), the moved feed
 * link, the TLS check at a new address (a wrong key is refused), and when the TV looks.
 */
public final class KeyPinCheck {
    private static int failed;

    // Test material only, made for this check with openssl (EC P-256, self-signed): A1 and A2 are two
    // certificates over key A (for 192.168.1.20 and 10.0.0.5, as Rhema Studio makes after a move);
    // B is another computer's, for 192.168.1.20. These keys are used nowhere else.
    private static final String A1 = "MIIBgDCCASWgAwIBAgIUV13Is9Og2ztFjKohCbwJekw+JFcwCgYIKoZIzj0EAwIwHDEaMBgGA1UEAwwRUmhlbWEgU3R1ZGlvIHRlc3QwIBcNMjYxMTEyMjExNDQ3WhgPMjEyNjEwMTkyMTE0NDdaMBwxGjAYBgNVBAMMEVJoZW1hIFN0dWRpbyB0ZXN0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAExfmSTrpVoBMAwh3/dk3N+ROrGPqBxWQTNgw2FgDTJ3s4B3g+JgkZf0HkKD2LwI9X8JjKmnxTNW7YZPlIi6BctKNDMEEwHQYDVR0OBBYEFOs3YGQfX/Eg9tliHgoDKA9KR4toMA8GA1UdEwEB/wQFMAMBAf8wDwYDVR0RBAgwBocEwKgBFDAKBggqhkjOPQQDAgNJADBGAiEAxEubtke45Th5wAkPCaWbEA5RkMZnN+n6SZ3Zn5pgkf8CIQCgdwgRaV09MRtKks5chQisV0uXnGBCptRI4IcSH2yNMA==";
    private static final String A2 = "MIIBgDCCASWgAwIBAgIUPOeya5V0RlDV5YuBUpvMDFgFnzswCgYIKoZIzj0EAwIwHDEaMBgGA1UEAwwRUmhlbWEgU3R1ZGlvIHRlc3QwIBcNMjYxMTEyMjExNDQ3WhgPMjEyNjEwMTkyMTE0NDdaMBwxGjAYBgNVBAMMEVJoZW1hIFN0dWRpbyB0ZXN0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAExfmSTrpVoBMAwh3/dk3N+ROrGPqBxWQTNgw2FgDTJ3s4B3g+JgkZf0HkKD2LwI9X8JjKmnxTNW7YZPlIi6BctKNDMEEwHQYDVR0OBBYEFOs3YGQfX/Eg9tliHgoDKA9KR4toMA8GA1UdEwEB/wQFMAMBAf8wDwYDVR0RBAgwBocECgAABTAKBggqhkjOPQQDAgNJADBGAiEA5enMolhmEpzQeoOl0qor1mCTMBVwhOgaKLG4jdAXwlQCIQC5/SLfasQXPYfGxRq6R0op2u5r71Kp/IKJfD6mdn4fMQ==";
    private static final String B = "MIIBfzCCASWgAwIBAgIUL1gw1D76KRUhysrwYMtNg3XpqKkwCgYIKoZIzj0EAwIwHDEaMBgGA1UEAwwRUmhlbWEgU3R1ZGlvIHRlc3QwIBcNMjYxMTEyMjExNDQ3WhgPMjEyNjEwMTkyMTE0NDdaMBwxGjAYBgNVBAMMEVJoZW1hIFN0dWRpbyB0ZXN0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE19bDHxT6E8pgJWLTI2YwoJGRcWtHaqYcNRMOLxjt7UWhLXyXUs3YJEX/TUmei0T2oYYJCByZEeKh8Z5n5FjwIqNDMEEwHQYDVR0OBBYEFJAF8IEXXBrFu9WB57KfgLGRrmv1MA8GA1UdEwEB/wQFMAMBAf8wDwYDVR0RBAgwBocEwKgBFDAKBggqhkjOPQQDAgNIADBFAiAM1WQInIa5p+x91Uux2/MSE+9wWYuXs+uwY6NWC459/QIhAL+M2b8FfpjyB0zDbZiZg9FlMiI/QcFdwemLYuUGpsWQ";
    private static final String KEY_A = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgzJ2oumiez7qodUitCgyatWUh14rV35mf82LyULf4lXihRANCAATF+ZJOulWgEwDCHf92Tc35E6sY+oHFZBM2DDYWANMnezgHeD4mCRl/QeQoPYvAj1fwmMqafFM1bthk+UiLoFy0";
    private static final String KEY_B = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg3JmcAKUPQdgQkcKtAbGWUzEcRPoY3kdxX2Q19gdVEC2hRANCAATX1sMfFPoTymAlYtMjZjCgkZFxa0dqphw1Ew4vGO3tRaEtfJdSzdgkRf9NSZ6LRPahhgkIHJkR4qHxnmfkWPAi";
    // What openssl says: sha256 of each DER certificate, and of its public key (SubjectPublicKeyInfo DER).
    private static final String CERT_A1 = "7f108a5941038c937c6930c81f3426f5fba6efe67d8070f32a4f8337a800c253";
    private static final String CERT_A2 = "7ac24a866146efdfbfffea767ccc781f50f314a739a2cb709bea1941aa4b3868";
    private static final String CERT_B = "2b13c78c233997f8ddbbc39bd6916e1b0079ffe151f62ca491354148ddc6953f";
    private static final String PIN_A = "e8291ddd878ec0ed99e4d35fbdecb24f7317cb91f4a2ea26173a585f2603fc38";
    private static final String PIN_B = "ad3e701b7956205c2d5e74b40c6037fc1632bc9ee09bb0883c16e3e6768aaaf9";

    private KeyPinCheck() { }

    public static void main(String[] args) throws Exception {
        byte[] a1 = Base64.getDecoder().decode(A1);
        byte[] a2 = Base64.getDecoder().decode(A2);
        byte[] b = Base64.getDecoder().decode(B);

        // The key pin, as Rhema Studio computes it (sha256 of SubjectPublicKeyInfo), and the old pin.
        check("certificate pin of A1", CERT_A1.equals(CodeProof.hex(CodeProof.sha256(a1))));
        check("key pin of A1", PIN_A.equals(KeyPin.spkiOfDer(a1)));
        check("another address, same key: same key pin", PIN_A.equals(KeyPin.spkiOfDer(a2)));
        check("another address: another certificate pin", CERT_A2.equals(CodeProof.hex(CodeProof.sha256(a2))));
        check("another computer's key pin", PIN_B.equals(KeyPin.spkiOfDer(b)) && CERT_B.equals(CodeProof.hex(CodeProof.sha256(b))));
        check("the key pin is not the certificate pin", !PIN_A.equals(CERT_A1));
        check("from a parsed certificate too", PIN_A.equals(KeyPin.spki(KeyPin.parse(a1))));
        check("not a certificate: no pin", KeyPin.spkiOfDer(new byte[] {1, 2, 3}) == null && KeyPin.spkiOfDer(null) == null);

        // What a /show may carry.
        String[] both = KeyPin.fromShow(CERT_A1, PIN_A);
        check("a new Rhema Studio: both pins", both != null && CERT_A1.equals(both[0]) && PIN_A.equals(both[1]));
        String[] old = KeyPin.fromShow(CERT_A1, "");
        check("an older Rhema Studio: the certificate pin only", old != null && old[1] == null);
        check("no key field at all", KeyPin.fromShow(CERT_A1, null) != null);
        check("a malformed key pin is refused", KeyPin.fromShow(CERT_A1, "E8291DDD") == null && KeyPin.fromShow(CERT_A1, PIN_A.toUpperCase()) == null);
        check("no certificate pin is refused", KeyPin.fromShow("", PIN_A) == null && KeyPin.fromShow(null, PIN_A) == null);
        check("paired by either", KeyPin.paired(CERT_A1, null) && KeyPin.paired(null, PIN_A) && !KeyPin.paired(null, null) && !KeyPin.paired("x", "y"));

        // Accept either, upgrade once, never weaker.
        check("key pin: its key at the old address", KeyPin.check(PIN_A, null, CERT_A1, PIN_A) == KeyPin.ACCEPT);
        check("key pin: its key at a new address", KeyPin.check(PIN_A, null, CERT_A2, PIN_A) == KeyPin.ACCEPT);
        check("key pin: another computer is refused", KeyPin.check(PIN_A, null, CERT_B, PIN_B) == KeyPin.REFUSE);
        check("key pin set: the old certificate pin no longer opens another key", KeyPin.check(PIN_A, CERT_B, CERT_B, PIN_B) == KeyPin.REFUSE);
        check("old pin: the very certificate upgrades", KeyPin.check(null, CERT_A1, CERT_A1, PIN_A) == KeyPin.UPGRADE);
        check("old pin: another certificate over the same key is not enough before the upgrade", KeyPin.check(null, CERT_A1, CERT_A2, PIN_A) == KeyPin.REFUSE);
        check("old pin: another computer is refused", KeyPin.check(null, CERT_A1, CERT_B, PIN_B) == KeyPin.REFUSE);
        check("old pin matches but no key pin could be read: refused", KeyPin.check(null, CERT_A1, CERT_A1, null) == KeyPin.REFUSE);
        check("nothing pinned: refused", KeyPin.check(null, null, CERT_A1, PIN_A) == KeyPin.REFUSE);
        check("nothing seen: refused", KeyPin.check(PIN_A, CERT_A1, null, null) == KeyPin.REFUSE);
        // After the upgrade (key pin stored, old one dropped) the next address opens by itself.
        check("after the upgrade the moved certificate opens", KeyPin.check(PIN_A, null, CERT_A2, KeyPin.spkiOfDer(a2)) == KeyPin.ACCEPT);

        // The network hint (TXT k=): a filter only.
        String hint = PIN_A.substring(0, KeyPin.HINT);
        check("its own hint matches", KeyPin.hintMatches(hint, PIN_A));
        check("upper case is the same hint", KeyPin.hintMatches(hint.toUpperCase(), PIN_A));
        check("another computer's hint does not", !KeyPin.hintMatches(PIN_B.substring(0, KeyPin.HINT), PIN_A));
        check("a short or long hint does not", !KeyPin.hintMatches(hint.substring(0, 8), PIN_A) && !KeyPin.hintMatches(PIN_A.substring(0, 20), PIN_A));
        check("no hint (an older Rhema Studio) does not", !KeyPin.hintMatches(null, PIN_A) && !KeyPin.hintMatches("", PIN_A));
        check("not hex does not", !KeyPin.hintMatches("e8291ddd878ec0eg", PIN_A));
        check("no key pin: nothing matches", !KeyPin.hintMatches(hint, null) && !KeyPin.hintMatches(hint, CERT_A1.substring(0, 10)));
        Map<String, byte[]> txt = new HashMap<String, byte[]>();
        txt.put("v", "1".getBytes("US-ASCII"));
        txt.put("tls", "8081".getBytes("US-ASCII"));
        txt.put("k", hint.getBytes("US-ASCII"));
        check("TXT values read", hint.equals(KeyPin.txt(txt, "k")) && KeyPin.port(KeyPin.txt(txt, "tls")) == 8081 && KeyPin.txt(txt, "x") == null && KeyPin.txt(null, "k") == null);
        check("bad ports", KeyPin.port("0") < 0 && KeyPin.port("65536") < 0 && KeyPin.port("80a") < 0 && KeyPin.port("") < 0 && KeyPin.port(null) < 0 && KeyPin.port("123456") < 0);

        // The feed link at the new address keeps its path and key.
        String feed = "https://192.168.1.20:8081/feed/abc%20d?k=x%2By";
        check("moved link", "https://10.0.0.5:8082/feed/abc%20d?k=x%2By".equals(KeyPin.movedTo(feed, "10.0.0.5", 8082)));
        check("not moved to a name or v6", KeyPin.movedTo(feed, "evil.example", 8081) == null && KeyPin.movedTo(feed, "fe80::1", 8081) == null);
        check("not moved to a bad port", KeyPin.movedTo(feed, "10.0.0.5", 0) == null && KeyPin.movedTo(feed, "10.0.0.5", 70000) == null);
        check("not from a link that is not a feed", KeyPin.movedTo("https://192.168.1.20:8081/remote", "10.0.0.5", 8081) == null && KeyPin.movedTo(null, "10.0.0.5", 8081) == null);

        // The TLS check at a candidate address: only the paired key completes it.
        SSLServerSocket rhema = serve(KEY_A, a2);
        SSLServerSocket other = serve(KEY_B, b);
        check("Rhema Studio at its new address is found", KeyPin.probe("127.0.0.1", rhema.getLocalPort(), PIN_A, 3_000));
        check("another computer's key is refused", !KeyPin.probe("127.0.0.1", other.getLocalPort(), PIN_A, 3_000));
        check("a wrong pin is refused at Rhema Studio too", !KeyPin.probe("127.0.0.1", rhema.getLocalPort(), PIN_B, 3_000));
        check("the old certificate pin is no key pin", !KeyPin.probe("127.0.0.1", rhema.getLocalPort(), CERT_A2, 3_000));
        check("no pin: no check", !KeyPin.probe("127.0.0.1", rhema.getLocalPort(), null, 3_000));
        int closed = rhema.getLocalPort();
        rhema.close();
        other.close();
        check("nothing listening: not found", !KeyPin.probe("127.0.0.1", closed, PIN_A, 1_000));

        // When the TV looks: after AFTER_MS of failing, BROWSE_MS at a time, resting longer each round.
        Rediscovery r = new Rediscovery();
        check("nothing failing: nothing due", r.due(0) < 0 && !r.start(0, true));
        r.failed(1_000);
        r.failed(5_000);
        check("not before ten seconds of failing", r.due(5_000) == Rediscovery.AFTER_MS - 4_000 && !r.start(10_999, true));
        check("not without a key pin or with the feed off screen", !r.start(11_000, false));
        check("then it looks", r.start(11_000, true) && r.browsing() && r.due(11_000) < 0);
        check("one browse at a time", !r.start(11_500, true));
        r.stop(41_000);
        check("then rests", !r.browsing() && r.due(41_000) == 15_000 && !r.start(50_000, true));
        check("and looks again", r.start(56_000, true));
        r.stop(86_000);
        check("resting longer", r.due(86_000) == 30_000);
        check("not yet 'may have moved'", !r.mayHaveMoved(11_000 + Rediscovery.MOVED_MS - 1));
        check("after two minutes of looking, 'may have moved'", r.mayHaveMoved(11_000 + Rediscovery.MOVED_MS));
        r.start(116_000, true);
        r.stop(146_000);
        r.start(206_000, true);
        r.stop(236_000);
        r.start(356_000, true);
        r.stop(386_000);
        check("never resting more than two minutes", r.due(386_000) == 120_000);
        r.reset();
        check("found or a new feed: all over", r.due(400_000) < 0 && !r.mayHaveMoved(400_000) && !r.browsing());

        if (failed > 0) {
            System.err.println(failed + " key pin check(s) failed");
            System.exit(1);
        }
        System.out.println("KeyPinCheck: all passed");
    }

    /** A TLS server on this computer with this key and certificate, answering handshakes until closed. */
    private static SSLServerSocket serve(String key, byte[] cert) throws Exception {
        PrivateKey k = KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(key)));
        X509Certificate c = KeyPin.parse(cert);
        KeyStore ks = KeyStore.getInstance("PKCS12");
        ks.load(null, null);
        char[] pw = "test".toCharArray();
        ks.setKeyEntry("rhema", k, pw, new Certificate[] {c});
        KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        kmf.init(ks, pw);
        SSLContext ctx = SSLContext.getInstance("TLS");
        ctx.init(kmf.getKeyManagers(), null, null);
        final SSLServerSocket s = (SSLServerSocket) ctx.getServerSocketFactory().createServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                while (!s.isClosed()) {
                    try (SSLSocket conn = (SSLSocket) s.accept()) {
                        conn.setSoTimeout(3_000);
                        conn.startHandshake();
                    } catch (Exception ignored) {
                        // A refused handshake, or the server closed.
                    }
                }
            }
        }, "keypin-check-server");
        t.setDaemon(true);
        t.start();
        return s;
    }

    private static void check(String what, boolean ok) {
        if (!ok) {
            failed++;
            System.err.println("FAIL: " + what);
        }
    }
}
