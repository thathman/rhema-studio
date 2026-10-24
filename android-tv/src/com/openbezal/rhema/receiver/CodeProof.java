package com.openbezal.rhema.receiver;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;

import javax.crypto.Mac;
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
 * messages on to the real TV cannot use the TV's answer. Rhema's side is src-tauri/src/commands/join.rs.
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

    /** The TV's reply: its public value, its proof, and the shared key for checking Rhema's proof. */
    static final class Answer {
        final String y;
        final String proof;
        final byte[] key;

        Answer(String y, String proof, byte[] key) {
            this.y = y;
            this.proof = proof;
            this.key = key;
        }
    }

    private CodeProof() { }

    static BigInteger randomExponent(SecureRandom random) {
        return new BigInteger(320, random).add(BigInteger.ONE);
    }

    /** Answers Rhema's value X (hex) for this code, reached at this address ("ip:port"). */
    static Answer answer(String xHex, String code, String address, BigInteger y) {
        BigInteger x = new BigInteger(xHex, 16);
        if (!inGroup(x)) throw new IllegalArgumentException("not a Rhema value");
        BigInteger w = w(code);
        BigInteger yPub = G.modPow(y, P).multiply(N.modPow(w, P)).mod(P);
        BigInteger k = x.multiply(M.modPow(w, P).modInverse(P)).mod(P).modPow(y, P);
        if (k.equals(BigInteger.ONE)) throw new IllegalArgumentException("not a Rhema value");
        byte[] key = sha256(ascii("rhema-tv-1"), fixed(x), fixed(yPub), fixed(k), fixed(w), ascii(address));
        return new Answer(yPub.toString(16), hex(hmac(key, ascii("tv"))), key);
    }

    /** Rhema's proof that it took part in this exchange with the same code, for this link. */
    static boolean deskProofMatches(byte[] key, String url, String proofHex) {
        byte[] sent = unhex(proofHex);
        return sent != null && MessageDigest.isEqual(hmac(key, ("desk" + url).getBytes(StandardCharsets.UTF_8)), sent);
    }

    static BigInteger w(String code) {
        return new BigInteger(1, sha256(("rhema-tv code:" + code).getBytes(StandardCharsets.UTF_8))).mod(Q);
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

    private static byte[] unhex(String s) {
        if (s == null || s.length() != 64) return null;
        byte[] out = new byte[32];
        for (int i = 0; i < 32; i++) {
            int hi = Character.digit(s.charAt(2 * i), 16);
            int lo = Character.digit(s.charAt(2 * i + 1), 16);
            if (hi < 0 || lo < 0) return null;
            out[i] = (byte) ((hi << 4) | lo);
        }
        return out;
    }
}
