package com.openbezal.rhema.receiver;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;

/**
 * build.sh runs this on the computer (plain Java, no Android) before it makes the app: it replays
 * the test vector Rhema checks in src-tauri/src/commands/tv_proof.rs, so the two sides cannot drift
 * apart unnoticed, and checks that the values an attacker would send are refused.
 */
public final class CodeProofCheck {
    private static int failed;

    private CodeProofCheck() { }

    public static void main(String[] args) {
        // The shared vector: Rhema's x and the TV's y fixed, code 123456, TV at 192.168.3.37:8095.
        CodeProof.Code code = new CodeProof.Code("123456");
        BigInteger x = new BigInteger("12345678901234567890");
        BigInteger y = new BigInteger("98765432109876543210");
        BigInteger xPub = CodeProof.G.modPow(x, CodeProof.P).multiply(CodeProof.M.modPow(code.w, CodeProof.P)).mod(CodeProof.P);
        check("Rhema's value", xPub.toString(16).startsWith("2393ea81a58767ec5ab69cfe207325733b44f4e4"));
        CodeProof.Answer a = CodeProof.answer(xPub.toString(16), code, "192.168.3.37:8095", y);
        check("the TV's value", a.y.equals("e38b82b80531e4786ca069f21a46e3db64b0fc92d5db31f281e44f3e2b96ad98559261b93f17148e84b1aa8e43441246fcc1ece94c8e516661574a9b16b842bc46ddf45b672c8e3d0a03746d2aff684230d99fccc67a53dc6a4e2922096acaa9400b412cfcfab4bcb3ef5373ac75d68dcd4faa11a29cd1af0b8ce51f32c947e22f7eab7ab267ccc9cc16e7ebc8304da0a160ecddf02f9765f1ea1e5b92fc82facdbc7d03806b170c1662487a46d72b79c21d1323edf3d3f62dfaab655c636869ff1f6b6d011e75049e9630b51d9ca4ef2d3cd150f06b1b8229eeab7baf7fd1b6778a80309a6fbdfe07503707fc4019691ac3094effc376ad9d14ee0ab0ed5922"));
        check("the shared key", CodeProof.hex(a.key).equals("73911ba62c97ac2abd114fb1c6806385bc0f594cedd20b71866f8b8db833f85d"));
        check("the TV's proof", a.proof.equals("593950f805179eff94d85dacba62e16c1e6241de03d834e69a9a6f33acbabe40"));
        check("Rhema's proof", CodeProof.deskProofMatches(a.key, "http://192.168.3.10:8080/feed/abc?t=x", "5eb4439439a464508ddb18b67f22cfeb276a8e0d2fbaca824de5c612a89d7917"));
        check("Rhema's proof for another link", !CodeProof.deskProofMatches(a.key, "http://192.168.3.10:8080/feed/abd?t=x", "5eb4439439a464508ddb18b67f22cfeb276a8e0d2fbaca824de5c612a89d7917"));
        check("another address gives another key", !CodeProof.hex(CodeProof.answer(xPub.toString(16), code, "192.168.3.99:8095", y).key).equals(CodeProof.hex(a.key)));

        // Values that are not a Rhema value: outside the group, its edges, or chosen to make K = 1.
        BigInteger p = CodeProof.P;
        BigInteger[] bad = {BigInteger.ZERO, BigInteger.ONE, p.subtract(BigInteger.ONE), p, p.add(BigInteger.ONE), CodeProof.M.modPow(code.w, p)};
        String[] names = {"0", "1", "p-1", "p", "p+1", "M^w"};
        for (int i = 0; i < bad.length; i++) refused("X = " + names[i], code, bad[i].toString(16), y);
        refused("X with a sign", code, "+" + xPub.toString(16), y);
        refused("X in capitals", code, xPub.toString(16).toUpperCase(), y);
        refused("X too long", code, "0" + p.toString(16) + "00", y);
        refused("X empty", code, "", y);
        refused("X not hex", code, "12_34", y);
        check("a proof in capitals", !CodeProof.deskProofMatches(a.key, "x", CodeProof.hex(CodeProof.hmac(a.key, "deskx".getBytes(StandardCharsets.UTF_8))).toUpperCase()));

        // The server's cheap checks.
        check("flat object", Guard.flatObject("{\"x\":\"2393ea\"}"));
        check("nested object", !Guard.flatObject("{\"x\":{\"y\":1}}"));
        check("list", !Guard.flatObject("{\"x\":[1]}"));
        check("deep list", !Guard.flatObject(new String(new char[8000]).replace('\0', '[')));
        check("not an object", !Guard.flatObject("\"x\""));
        check("host ip", Guard.ipLiteralHost("192.168.3.37:8095"));
        check("host ip without port", Guard.ipLiteralHost("10.0.0.9"));
        check("host ipv6", Guard.ipLiteralHost("[fe80::1]:8095"));
        check("host name", !Guard.ipLiteralHost("evil.example:8095"));
        check("host name with digits", !Guard.ipLiteralHost("1.2.3.4.nip.io"));
        check("host out of range", !Guard.ipLiteralHost("192.168.3.256:8095"));
        check("host bad port", !Guard.ipLiteralHost("192.168.3.37:99999"));
        check("no host", !Guard.ipLiteralHost(null));
        check("empty host", !Guard.ipLiteralHost(""));

        if (failed > 0) {
            System.err.println("CodeProofCheck: " + failed + " check(s) failed");
            System.exit(1);
        }
        System.out.println("CodeProofCheck: all checks passed");
    }

    private static void refused(String what, CodeProof.Code code, String xHex, BigInteger y) {
        boolean refused;
        try {
            CodeProof.answer(xHex, code, "192.168.3.37:8095", y);
            refused = false;
        } catch (IllegalArgumentException e) {
            refused = true;
        }
        check(what + " is refused", refused);
    }

    private static void check(String what, boolean ok) {
        if (!ok) {
            failed++;
            System.err.println("FAILED: " + what);
        }
    }
}
