package com.openbezal.rhema.receiver;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Rhema and this TV prove to each other that they know the code on the TV's screen before Rhema sends
 * a feed's secret link (#198), so a device on the network that only pretends to be a Rhema Receiver
 * never gets the link. The code never crosses the network.
 *
 * Why not simply answer with a hash of the code: six digits are a million guesses, which a computer
 * tries in under a second, so whoever asked (or whoever Rhema asked) would know the code. This is SPAKE2,
 * a password-authenticated key exchange, in the 2048-bit group of RFC 3526: whoever does not know the
 * code can test only one guess per exchange, by taking part in it, so the receiver counts every exchange
 * as a try. The address Rhema reached the TV at is part of the proof, so a device that passes Rhema's
 * messages on to the real TV cannot use the TV's answer. Rhema's side is src-tauri/src/commands/tv_proof.rs.
 *
 * Two keys come from the exchange (1.3): one for the TV's proof, one that encrypts what Rhema sends
 * in /show (AES-256-GCM): the feed's https link and the fingerprint of Rhema's certificate, so
 * someone watching the network learns neither, and the TV opens only that exact Rhema's page.
 *
 * Plain Java only (no Android classes): build.sh runs CodeProofCheck against it on the computer.
 */
final class CodeProof {
    static final BigInteger P = new BigInteger(
            "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD"
            + "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED"
            + "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F"
            + "83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B"
            + "E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA0510"
            + "15728E5A8AACAA68FFFFFFFFFFFFFFFF", 16);
    static final BigInteger Q = P.shiftRight(1);
    static final BigInteger G = BigInteger.valueOf(2);
    static final BigInteger M = element("rhema-tv M");
    static final BigInteger N = element("rhema-tv N");
    private static final int LEN = 256;

    /** What /show is encrypted with, so the TV can tell what Rhema sent from anything else. */
    static final byte[] SHOW_AAD = ascii("rhema-tv show");

    /** The TV's reply: its public value and its proof; and the key that opens Rhema's /show. */
    static final class Answer {
        final String y;
        final String proof;
        /** The exchange's shared secret (for the test vector only). */
        final byte[] transcript;
        final byte[] enc;

        Answer(String y, String proof, byte[] transcript, byte[] enc) {
            this.y = y;
            this.proof = proof;
            this.transcript = transcript;
            this.enc = enc;
        }
    }

    /**
     * A code and its two fixed values, worked out once when the code is made, so the code's own
     * number is not part of the maths each request times (and each request does two fewer powers).
     */
    static final class Code {
        final String digits;
        final BigInteger w;
        /** N^w, added to the TV's value. */
        final BigInteger nW;
        /** 1 / M^w, which takes the code back out of Rhema's value. */
        final BigInteger mWInverse;

        Code(String digits) {
            this.digits = digits;
            this.w = w(digits);
            this.nW = N.modPow(w, P);
            this.mWInverse = M.modPow(w, P).modInverse(P);
        }
    }

    private CodeProof() { }

    static BigInteger randomExponent(SecureRandom random) {
        return new BigInteger(320, random).add(BigInteger.ONE);
    }

    /** Answers Rhema's value X (hex) for this code, reached at this address ("ip:port"). */
    static Answer answer(String xHex, Code code, String address, BigInteger y) {
        BigInteger x = value(xHex);
        if (x == null || !inGroup(x)) throw new IllegalArgumentException("not a Rhema value");
        BigInteger yPub = G.modPow(y, P).multiply(code.nW).mod(P);
        BigInteger k = x.multiply(code.mWInverse).mod(P).modPow(y, P);
        if (k.equals(BigInteger.ONE)) throw new IllegalArgumentException("not a Rhema value");
        byte[] key = sha256(ascii("rhema-tv-1"), fixed(x), fixed(yPub), fixed(k), fixed(code.w), ascii(address));
        return new Answer(yPub.toString(16), hex(hmac(derive(key, "rhema-tv confirm"), ascii("tv"))), key, derive(key, "rhema-tv enc"));
    }

    /** HKDF-SHA256 (RFC 5869) with no salt, one 32-byte block: a separate key for each use. */
    static byte[] derive(byte[] secret, String info) {
        byte[] prk = hmac(new byte[32], secret);
        byte[] label = ascii(info);
        byte[] in = new byte[label.length + 1];
        System.arraycopy(label, 0, in, 0, label.length);
        in[label.length] = 1;
        return hmac(prk, in);
    }

    /**
     * Rhema's /show, decrypted with the exchange's key: the text, or null when it was not sealed
     * with this exchange's key (a wrong code, another exchange, or changed on the way).
     */
    static String open(byte[] enc, String nonceHex, String dataHex) {
        byte[] nonce = unhex(nonceHex, 12);
        byte[] data = dataHex == null || dataHex.length() < 34 || dataHex.length() > 8192 ? null : unhex(dataHex, dataHex.length() / 2);
        if (nonce == null || data == null) return null;
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(enc, "AES"), new GCMParameterSpec(128, nonce));
            c.updateAAD(SHOW_AAD);
            return new String(c.doFinal(data), StandardCharsets.UTF_8);
        } catch (Exception wrong) {
            return null;
        }
    }

    static BigInteger w(String code) {
        return new BigInteger(1, sha256(("rhema-tv code:" + code).getBytes(StandardCharsets.UTF_8))).mod(Q);
    }

    /** A group value as Rhema writes it: lowercase hex, at most 512 digits; anything else is null. */
    static BigInteger value(String hex) {
        if (hex == null || hex.isEmpty() || hex.length() > 2 * LEN) return null;
        for (int i = 0; i < hex.length(); i++) {
            char c = hex.charAt(i);
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return null;
        }
        return new BigInteger(hex, 16);
    }

    private static boolean inGroup(BigInteger v) {
        return v.compareTo(BigInteger.ONE) > 0 && v.compareTo(P.subtract(BigInteger.ONE)) < 0 && v.modPow(Q, P).equals(BigInteger.ONE);
    }

    /** A fixed group element nobody knows the logarithm of: a long hash of the label, squared. */
    private static BigInteger element(String label) {
        byte[] all = new byte[9 * 32];
        for (int i = 0; i < 9; i++) {
            System.arraycopy(sha256(label.getBytes(StandardCharsets.UTF_8), new byte[] {(byte) i}), 0, all, i * 32, 32);
        }
        return new BigInteger(1, all).mod(P).modPow(BigInteger.valueOf(2), P);
    }

    private static byte[] fixed(BigInteger v) {
        byte[] b = v.toByteArray();
        byte[] out = new byte[LEN];
        int n = Math.min(b.length, LEN);
        System.arraycopy(b, b.length - n, out, LEN - n, n);
        return out;
    }

    private static byte[] ascii(String s) {
        return s.getBytes(StandardCharsets.US_ASCII);
    }

    static byte[] sha256(byte[]... parts) {
        try {
            MessageDigest d = MessageDigest.getInstance("SHA-256");
            for (byte[] p : parts) d.update(p);
            return d.digest();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static byte[] hmac(byte[] key, byte[] message) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(message);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static String hex(byte[] b) {
        StringBuilder s = new StringBuilder(b.length * 2);
        for (byte x : b) s.append(String.format("%02x", x & 0xff));
        return s.toString();
    }

    /** Exactly this many bytes as lowercase hex, else null. */
    static byte[] unhex(String s, int bytes) {
        if (s == null || s.length() != 2 * bytes) return null;
        byte[] out = new byte[bytes];
        for (int i = 0; i < bytes; i++) {
            int hi = nibble(s.charAt(2 * i));
            int lo = nibble(s.charAt(2 * i + 1));
            if (hi < 0 || lo < 0) return null;
            out[i] = (byte) ((hi << 4) | lo);
        }
        return out;
    }

    private static int nibble(char c) {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        return -1;
    }
}
