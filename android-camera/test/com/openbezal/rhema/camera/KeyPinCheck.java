package com.openbezal.rhema.camera;

import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.security.KeyFactory;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.Certificate;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLServerSocket;
import javax.net.ssl.SSLSocket;

/**
 * build.sh runs this before it makes the app (1.6, doc 48): the key pin of a certificate, the link's
 * key=, accepting the old certificate pin once and keeping the key pin (KeyPin, Report.Pin and a real
 * Publisher connection), the network hint (TXT k=), the pairing moved to a new address (only the IP
 * changes), the TLS check at a candidate address (a wrong key is refused, a trickling host is cut off
 * at the whole deadline), when the camera looks, and which addresses get checked (ProbeQueue).
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

    static final String TOKEN = "0123456789abcdef0123456789abcdef";

    private KeyPinCheck() { }

    static String link(String host, int port, String fp, String key) {
        return "rhema-camera://pair?host=" + host + "&port=" + port + "&name=pulpit&user=cam-pulpit&token=" + TOKEN + "&fp=" + fp
                + (key == null ? "" : "&key=" + key) + "&label=Pulpit&api=8081";
    }

    public static void main(String[] args) throws Exception {
        byte[] a1 = Base64.getDecoder().decode(A1);
        byte[] a2 = Base64.getDecoder().decode(A2);
        byte[] b = Base64.getDecoder().decode(B);
        X509Certificate ca1 = KeyPin.parse(a1), ca2 = KeyPin.parse(a2), cb = KeyPin.parse(b);

        // The key pin, as Rhema Studio computes it (sha256 of SubjectPublicKeyInfo), and the old pin.
        check("certificate pin of A1", CERT_A1.equals(KeyPin.leaf(ca1)) && CERT_A1.equals(Pairing.hex(Pairing.sha256(a1))));
        check("key pin of A1", PIN_A.equals(KeyPin.spki(ca1)) && PIN_A.equals(KeyPin.spkiOfDer(a1)));
        check("another address, same key: same key pin", PIN_A.equals(KeyPin.spki(ca2)));
        check("another address: another certificate pin", CERT_A2.equals(KeyPin.leaf(ca2)));
        check("another computer's key pin", PIN_B.equals(KeyPin.spki(cb)) && CERT_B.equals(KeyPin.leaf(cb)));
        check("the key pin is not the certificate pin", !PIN_A.equals(CERT_A1));
        check("not a certificate: no pin", KeyPin.spkiOfDer(new byte[] {1, 2, 3}) == null && KeyPin.spkiOfDer(null) == null);
        check("the old pin check still names A1", Pairing.pinned(a1, CERT_A1) && !Pairing.pinned(a2, CERT_A1));

        // Accept either, upgrade once, never weaker.
        check("key pin: its key at the old address", KeyPin.check(PIN_A, CERT_A1, new X509Certificate[] {ca1}) == KeyPin.ACCEPT);
        check("key pin: its key at a new address", KeyPin.check(PIN_A, CERT_A1, new X509Certificate[] {ca2}) == KeyPin.ACCEPT);
        check("key pin: another computer is refused", KeyPin.check(PIN_A, CERT_A1, new X509Certificate[] {cb}) == KeyPin.REFUSE);
        check("key pin set: the old certificate pin no longer opens another key", KeyPin.check(PIN_A, CERT_B, new X509Certificate[] {cb}) == KeyPin.REFUSE);
        check("old pin: the very certificate upgrades", KeyPin.check(null, CERT_A1, new X509Certificate[] {ca1}) == KeyPin.UPGRADE);
        check("old pin: another certificate over the same key is not enough before the upgrade", KeyPin.check(null, CERT_A1, new X509Certificate[] {ca2}) == KeyPin.REFUSE);
        check("old pin: another computer is refused", KeyPin.check(null, CERT_A1, new X509Certificate[] {cb}) == KeyPin.REFUSE);
        check("old pin matches but no key pin could be read: refused", KeyPin.check(null, CERT_A1, CERT_A1, null) == KeyPin.REFUSE);
        check("an empty key pin is no key pin", KeyPin.check("", CERT_A1, new X509Certificate[] {ca1}) == KeyPin.UPGRADE);
        check("a malformed key pin never falls back to the old pin", KeyPin.check("e8291ddd", CERT_A1, new X509Certificate[] {ca1}) == KeyPin.UPGRADE
                && KeyPin.check("e8291ddd", CERT_A1, new X509Certificate[] {cb}) == KeyPin.REFUSE);
        check("nothing pinned: refused", KeyPin.check(null, null, new X509Certificate[] {ca1}) == KeyPin.REFUSE);
        check("nothing seen: refused", KeyPin.check(PIN_A, CERT_A1, (X509Certificate[]) null) == KeyPin.REFUSE
                && KeyPin.check(PIN_A, CERT_A1, new X509Certificate[0]) == KeyPin.REFUSE);

        // Report.Pin (battery, heat and tally over https): the same rules, the key noted for keeping.
        Report.Pin rp = new Report.Pin(PIN_A, CERT_A1);
        rp.checkServerTrusted(new X509Certificate[] {ca2}, "ECDHE_ECDSA");
        check("report: key pin accepts its key at a new address, nothing to keep", rp.seen == null);
        check("report: key pin refuses another computer", refuses(rp, cb));
        Report.Pin legacy = new Report.Pin(null, CERT_A1);
        legacy.checkServerTrusted(new X509Certificate[] {ca1}, "ECDHE_ECDSA");
        check("report: old pin accepts its certificate and notes its key", PIN_A.equals(legacy.seen));
        check("report: old pin refuses the same key in another certificate", refuses(new Report.Pin(null, CERT_A1), ca2));
        check("report: old pin refuses another computer", refuses(new Report.Pin(null, CERT_A1), cb));
        final AtomicReference<String> kept = new AtomicReference<String>();
        Report.Keeper keeper = new Report.Keeper() {
            @Override
            public void keep(String fp, String keyPin) {
                kept.set(fp + " " + keyPin);
            }
        };
        Pairing old = Pairing.parse(link("192.168.1.20", 8322, CERT_A1, null));
        check("report: an old link's pin check is by certificate", Report.pin(old).seen == null);
        Report.kept(old, legacy, keeper);
        check("report: the keeper gets the key of the link's certificate", (CERT_A1 + " " + PIN_A).equals(kept.get()));
        kept.set(null);
        Report.kept(Pairing.parse(link("192.168.1.20", 8322, CERT_A1, PIN_A)), legacy, keeper);
        check("report: nothing to keep once the link has a key", kept.get() == null);
        Report.kept(old, rp, keeper);
        check("report: nothing to keep when nothing was noted", kept.get() == null);

        // The link's key= (optional; old links keep working).
        Pairing withKey = Pairing.parse(link("192.168.1.20", 8322, CERT_A1, PIN_A));
        check("link: key read", PIN_A.equals(withKey.key) && withKey.keyPinned() && !old.keyPinned() && old.key.isEmpty());
        check("link: key survives the round trip", Pairing.parse(withKey.link()).key.equals(PIN_A) && Pairing.parse(old.link()).key.isEmpty());
        check("link: upper-case and colon key", Pairing.parse(link("192.168.1.20", 8322, CERT_A1, PIN_A.toUpperCase().replaceAll("(..)(?!$)", "$1:"))).key.equals(PIN_A));
        check("link: a malformed key is refused", refusedLink(link("192.168.1.20", 8322, CERT_A1, PIN_A.substring(2))) && refusedLink(link("192.168.1.20", 8322, CERT_A1, "zz" + PIN_A.substring(2))));
        check("link: an empty key is no key", !Pairing.parse(link("192.168.1.20", 8322, CERT_A1, "")).keyPinned());
        check("link: key twice is refused", refusedLink(link("192.168.1.20", 8322, CERT_A1, PIN_A) + "&key=" + PIN_B));

        // Keeping the key of an old link, and moving to a new address: only what should change does.
        Pairing up = old.withKey(PIN_A);
        check("keep: the old link gains key=", up != null && up.keyPinned() && up.fp.equals(CERT_A1) && up.host.equals(old.host) && up.link().contains("&key=" + PIN_A));
        check("keep: never over a kept key, never a bad one", withKey.withKey(PIN_B) == null && old.withKey("abc") == null && old.withKey(null) == null);
        Pairing moved = withKey.movedTo("10.0.0.5");
        check("move: only the address changes", moved != null && moved.host.equals("10.0.0.5") && moved.port == 8322 && moved.api == 8081 && moved.key.equals(PIN_A)
                && moved.fp.equals(CERT_A1) && moved.token.equals(TOKEN) && moved.name.equals("pulpit") && moved.label.equals("Pulpit"));
        check("move: the link at the new address", moved.link().equals(withKey.link().replace("host=192.168.1.20", "host=10.0.0.5")) && moved.url().equals("rtsps://10.0.0.5:8322/pulpit"));
        check("move: never to a name, IPv6, an address with a port or nothing", withKey.movedTo("evil.example") == null && withKey.movedTo("fe80::1") == null
                && withKey.movedTo("10.0.0.5:99") == null && withKey.movedTo("10.0.0.256") == null && withKey.movedTo(null) == null);
        check("move: never without a key pin", old.movedTo("10.0.0.5") == null);
        check("change: the same link", Pairing.change(withKey, Pairing.parse(withKey.link())) == Pairing.SAME);
        check("change: a kept key", Pairing.change(old, up) == Pairing.KEY_KEPT);
        check("change: moved", Pairing.change(withKey, moved) == Pairing.MOVED);
        check("change: moved without a key pin is a new pairing", Pairing.change(old, Pairing.parse(link("10.0.0.5", 8322, CERT_A1, null))) == Pairing.OTHER);
        check("change: another key is a new pairing", Pairing.change(withKey, Pairing.parse(link("192.168.1.20", 8322, CERT_A1, PIN_B))) == Pairing.OTHER);
        check("change: another certificate is a new pairing", Pairing.change(withKey, Pairing.parse(link("192.168.1.20", 8322, CERT_B, PIN_A))) == Pairing.OTHER);
        check("change: another camera is a new pairing", Pairing.change(withKey, Pairing.parse(link("192.168.1.20", 8322, CERT_A1, PIN_A).replace("token=" + TOKEN, "token=" + TOKEN + "x"))) == Pairing.OTHER);
        check("change: nothing before", Pairing.change(null, withKey) == Pairing.OTHER && Pairing.change(withKey, null) == Pairing.OTHER);

        // The network hint (TXT k=): a filter only.
        String hint = PIN_A.substring(0, KeyPin.HINT);
        check("its own hint matches", KeyPin.hintMatches(hint, PIN_A));
        check("upper case is the same hint", KeyPin.hintMatches(hint.toUpperCase(), PIN_A));
        check("another computer's hint does not", !KeyPin.hintMatches(PIN_B.substring(0, KeyPin.HINT), PIN_A));
        check("a short or long hint does not", !KeyPin.hintMatches(hint.substring(0, 8), PIN_A) && !KeyPin.hintMatches(PIN_A.substring(0, 20), PIN_A));
        check("no hint (an older Rhema Studio) does not", !KeyPin.hintMatches(null, PIN_A) && !KeyPin.hintMatches("", PIN_A));
        check("not hex does not", !KeyPin.hintMatches("e8291ddd878ec0eg", PIN_A));
        check("no key pin: nothing matches", !KeyPin.hintMatches(hint, null) && !KeyPin.hintMatches(hint, ""));
        Map<String, byte[]> txt = new HashMap<String, byte[]>();
        txt.put("v", "1".getBytes("US-ASCII"));
        txt.put("tls", "8081".getBytes("US-ASCII"));
        txt.put("k", hint.getBytes("US-ASCII"));
        check("TXT values read", hint.equals(KeyPin.txt(txt, "k")) && "8081".equals(KeyPin.txt(txt, "tls")) && KeyPin.txt(txt, "x") == null && KeyPin.txt(null, "k") == null);

        // The TLS check at a candidate address: only the paired key completes it.
        SSLServerSocket rhema = serve(KEY_A, a2);
        SSLServerSocket other = serve(KEY_B, b);
        check("probe: Rhema Studio at its new address is found", KeyPin.probe("127.0.0.1", rhema.getLocalPort(), PIN_A, 3_000));
        check("probe: another computer's key is refused", !KeyPin.probe("127.0.0.1", other.getLocalPort(), PIN_A, 3_000));
        check("probe: a wrong pin is refused at Rhema Studio too", !KeyPin.probe("127.0.0.1", rhema.getLocalPort(), PIN_B, 3_000));
        check("probe: the old certificate pin is no key pin", !KeyPin.probe("127.0.0.1", rhema.getLocalPort(), CERT_A2, 3_000));
        check("probe: no pin, no check", !KeyPin.probe("127.0.0.1", rhema.getLocalPort(), null, 3_000));
        ServerSocket trickle = trickler();
        long t0 = System.nanoTime();
        boolean trickled = KeyPin.probe("127.0.0.1", trickle.getLocalPort(), PIN_A, 1_500);
        long tookMs = (System.nanoTime() - t0) / 1_000_000L;
        check("probe: a trickling host is not found", !trickled);
        check("probe: and is cut off at the whole deadline (took " + tookMs + " ms)", tookMs < 3_000);
        trickle.close();
        check("probe: no time, no check", !KeyPin.probe("127.0.0.1", rhema.getLocalPort(), PIN_A, 0));

        // A real Publisher: an old link connects over its certificate and keeps its key (zero taps);
        // a link with a key connects to another certificate over that key; another key is refused.
        SSLServerSocket rhemaOld = serve(KEY_A, a1);
        Seen s1 = publish(Pairing.parse(link("127.0.0.1", rhemaOld.getLocalPort(), CERT_A1, null)));
        check("publisher: an old link keeps the key of its certificate after the handshake", PIN_A.equals(s1.key));
        Seen s2 = publish(Pairing.parse(link("127.0.0.1", rhema.getLocalPort(), CERT_A1, PIN_A)));
        check("publisher: a kept key opens the certificate at the new address, nothing more to keep", s2.key == null && !s2.message.contains("not the Rhema"));
        Seen s3 = publish(Pairing.parse(link("127.0.0.1", rhema.getLocalPort(), CERT_A1, null)));
        check("publisher: an old link refuses the same key in another certificate", s3.key == null && s3.message.contains("not the Rhema") && s3.unreachable);
        Seen s4 = publish(Pairing.parse(link("127.0.0.1", other.getLocalPort(), CERT_A1, PIN_A)));
        check("publisher: another computer's key is refused and counts as not answering", s4.key == null && s4.message.contains("its key does not match") && s4.unreachable);
        int closed = rhema.getLocalPort();
        rhema.close();
        other.close();
        rhemaOld.close();
        check("probe: nothing listening, not found", !KeyPin.probe("127.0.0.1", closed, PIN_A, 1_000));

        // When the camera looks: after AFTER_MS of failing, BROWSE_MS at a time, resting longer each round.
        Rediscovery r = new Rediscovery();
        check("look: nothing failing, nothing due", r.due(0) < 0 && !r.start(0, true));
        r.failed(1_000);
        r.failed(5_000);
        check("look: not before ten seconds of failing", r.due(5_000) == Rediscovery.AFTER_MS - 4_000 && !r.start(10_999, true));
        check("look: not without a key pin or while not sending", !r.start(11_000, false));
        check("look: then it looks", r.start(11_000, true) && r.browsing() && r.due(11_000) < 0);
        check("look: one browse at a time", !r.start(11_500, true));
        r.stop(41_000);
        check("look: then rests", !r.browsing() && r.due(41_000) == 15_000 && !r.start(50_000, true));
        check("look: and looks again", r.start(56_000, true));
        r.stop(86_000);
        check("look: resting longer", r.due(86_000) == 30_000);
        check("look: not yet 'may have moved'", !r.mayHaveMoved(11_000 + Rediscovery.MOVED_MS - 1));
        check("look: after two minutes of looking, 'may have moved'", r.mayHaveMoved(11_000 + Rediscovery.MOVED_MS));
        r.start(116_000, true);
        r.stop(146_000);
        r.start(206_000, true);
        r.stop(236_000);
        r.start(356_000, true);
        r.stop(386_000);
        check("look: never resting more than two minutes", r.due(386_000) == 120_000);
        r.reset();
        check("look: sending again or stopped, all over", r.due(400_000) < 0 && !r.mayHaveMoved(400_000) && !r.browsing());
        check("look: the words, plain and on one line", Rediscovery.MAY_HAVE_MOVED.equals("Rhema Studio may have moved; scan the camera link again if this continues"));

        // Which addresses get a TLS check in one browse (ProbeQueue): one announcer cannot starve the real one.
        ProbeQueue q = new ProbeQueue(new java.util.Random(7));
        check("queue: an address waits", q.offer("fake-1", "10.0.0.66", 8322, false));
        check("queue: the same address only once", !q.offer("fake-1", "10.0.0.66", 8322, false) && !q.offer("fake-2", "10.0.0.66", 8322, false));
        check("queue: a second address of the service", q.offer("fake-1", "10.0.0.67", 8322, false));
        check("queue: no third address per service", !q.offer("fake-1", "10.0.0.68", 8322, false));
        check("queue: no address or port, nothing", !q.offer("x", null, 8322, false) && !q.offer("x", "10.0.0.9", 0, false));
        for (int i = 3; q.waiting() < ProbeQueue.MAX_WAITING; i++) q.offer("fake-" + i, "10.0.1." + i, 8322, false);
        check("queue: a full queue turns a newcomer away, unmarked", !q.offer("CAC Ibadan", "10.0.0.5", 8322, false) && q.waiting() == ProbeQueue.MAX_WAITING);
        check("queue: the last-known Rhema Studio makes room", q.offer("CAC Ibadan", "10.0.0.5", 8322, true) && q.waiting() == ProbeQueue.MAX_WAITING);
        ProbeQueue.Candidate first = q.next();
        check("queue: and is checked first", first != null && "10.0.0.5".equals(first.ip) && first.preferred);
        ProbeQueue.Candidate any = q.next();
        check("queue: then the rest", any != null && !any.preferred);
        q.release(any);
        check("queue: a check that could not start is unmarked", q.offer(any.service, any.ip, any.port, false));
        ProbeQueue r2 = new ProbeQueue(new java.util.Random(1));
        r2.offer("s", "10.0.0.1", 8322, false);
        r2.offer("s", "10.0.0.2", 8322, false);
        ProbeQueue.Candidate a = r2.next();
        r2.release(a);
        check("queue: released, its service has room again", r2.offer("s", a.ip, 8322, false) && !r2.offer("s", "10.0.0.3", 8322, false));
        int realFirst = 0;
        java.util.Random rnd = new java.util.Random(42);
        for (int round = 0; round < 200; round++) {
            ProbeQueue fair = new ProbeQueue(rnd);
            for (int i = 0; i < 6; i++) fair.offer("fake-" + i, "10.0.2." + i, 8322, false);
            fair.offer("CAC Ibadan", "10.0.0.5", 8322, false);
            if ("10.0.0.5".equals(fair.next().ip)) realFirst++;
        }
        check("queue: not always last (" + realFirst + "/200 first)", realFirst > 10);
        q.clear();
        check("queue: a new browse starts clean", q.waiting() == 0 && q.next() == null && q.offer("fake-1", "10.0.0.66", 8322, false));

        if (failed > 0) {
            System.out.println(failed + " key pin check(s) failed");
            System.exit(1);
        }
        System.out.println("key pin checks passed");
    }

    /** What a Publisher said and kept in one try. */
    static final class Seen {
        volatile String key;
        volatile String message = "";
        volatile boolean unreachable;
    }

    /** Runs a Publisher against a local server until its first try is over (the server only does TLS). */
    static Seen publish(Pairing p) throws Exception {
        final Seen seen = new Seen();
        final Object done = new Object();
        Publisher pub = new Publisher(p, "v=0\r\n", false, false, 48000, 1_000_000, new Publisher.Listener() {
            @Override
            public void onState(boolean live, String message) {
                if (!live) {
                    seen.message = message;
                    synchronized (done) {
                        done.notifyAll();
                    }
                }
            }

            @Override
            public void onNeedKeyFrame() { }

            @Override
            public void onCongested() { }

            @Override
            public void onKeyPin(String keyPin) {
                seen.key = keyPin;
            }
        }, new Publisher.Clock() {
            @Override
            public long nowUs() {
                return System.nanoTime() / 1000;
            }
        });
        pub.start();
        synchronized (done) {
            done.wait(8_000);
        }
        seen.unreachable = pub.unreachable();
        pub.stop();
        return seen;
    }

    private static boolean refuses(Report.Pin pin, X509Certificate c) {
        try {
            pin.checkServerTrusted(new X509Certificate[] {c}, "ECDHE_ECDSA");
            return false;
        } catch (CertificateException e) {
            return pin.seen == null;
        }
    }

    private static boolean refusedLink(String l) {
        try {
            Pairing.parse(l);
            return false;
        } catch (IllegalArgumentException e) {
            return true;
        }
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

    /** A plain server that answers every connection with one byte every 300 ms, forever. */
    private static ServerSocket trickler() throws Exception {
        final ServerSocket s = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                while (!s.isClosed()) {
                    try (Socket conn = s.accept()) {
                        OutputStream out = conn.getOutputStream();
                        // A TLS record header that never ends: type handshake, version, a long length.
                        byte[] slow = {0x16, 0x03, 0x03, 0x40, 0x00};
                        for (int i = 0; !s.isClosed(); i++) {
                            out.write(slow[Math.min(i, slow.length - 1)]);
                            out.flush();
                            Thread.sleep(300);
                        }
                    } catch (Exception ignored) {
                        // The probe gave up, or the server closed.
                    }
                }
            }
        }, "keypin-check-trickle");
        t.setDaemon(true);
        t.start();
        return s;
    }

    private static void check(String what, boolean ok) {
        if (!ok) {
            failed++;
            System.out.println("FAIL: " + what);
        }
    }
}
