package com.openbezal.rhema.receiver;

import java.math.BigInteger;

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
        check("the shared secret", CodeProof.hex(a.transcript).equals("73911ba62c97ac2abd114fb1c6806385bc0f594cedd20b71866f8b8db833f85d"));
        check("the TV's proof (its own key)", a.proof.equals("a9841532dd2e0c74ca00d4b8e00eba7bd2204068747a4c0d4846eb287a70355b"));
        check("the encryption key", CodeProof.hex(a.enc).equals("a31f06ca466a6687b837d3736be4e2d2a36f2d7f002b0afba0682e992ca20ecf"));
        check("another address gives another key", !CodeProof.hex(CodeProof.answer(xPub.toString(16), code, "192.168.3.99:8095", y).enc).equals(CodeProof.hex(a.enc)));
        byte[] ikm = new byte[22];
        java.util.Arrays.fill(ikm, (byte) 0x0b);
        check("HKDF-SHA256 (RFC 5869 test case 3)", CodeProof.hex(CodeProof.derive(ikm, "")).equals("8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d"));

        // Rhema's /show for that exchange, sealed by Rhema's Rust code with nonce 000102…0b.
        String nonce = "000102030405060708090a0b";
        String data = "3f169144b6eec6a7b137af19a89992e4ff6672cc90a463cd14738dbbd3317d1518e8abdd9a273366b47eb76e302c8783a934a5edce880084a6934cf6ed177f6fd4c85144ee4a625ab8b8b4c784e43e718ee095253f9037ba4845a4753298ac645ed6685367e136f2e939d5b43b416405b0034fb6c8d1503673b09ab04b86d43a284e39e611ef28b533a4d7fc1eee40a1ce6ffaade3";
        String plain = "{\"url\":\"https://192.168.3.10:8081/feed/abc?k=x\",\"certFingerprint\":\"abecce707af4a66a8aa18ce9624ebead97a8f362335dd688e9d5899af9428a19\"}";
        check("Rhema's /show opens", plain.equals(CodeProof.open(a.enc, nonce, data)));
        String flipped = data.substring(0, 10) + (data.charAt(10) == '0' ? '1' : '0') + data.substring(11);
        check("a changed /show is refused", CodeProof.open(a.enc, nonce, flipped) == null);
        check("another nonce is refused", CodeProof.open(a.enc, "000102030405060708090a0c", data) == null);
        check("another exchange's key is refused", CodeProof.open(CodeProof.answer(xPub.toString(16), code, "192.168.3.99:8095", y).enc, nonce, data) == null);
        check("a short nonce is refused", CodeProof.open(a.enc, "0001", data) == null);
        check("nothing sealed is refused", CodeProof.open(a.enc, nonce, "") == null);
        check("odd hex is refused", CodeProof.open(a.enc, nonce, data + "0") == null);

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
        check("a nonce in capitals is refused", CodeProof.open(a.enc, nonce.toUpperCase(), data) == null);

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
        check("feed link", Guard.feedLink("https://192.168.3.10:8081/feed/abc?k=x"));
        check("plain http feed link", !Guard.feedLink("http://192.168.3.10:8080/feed/abc?k=x"));
        check("feed link by name", !Guard.feedLink("https://rhema.example:8081/feed/abc?k=x"));
        check("feed link without port", !Guard.feedLink("https://192.168.3.10/feed/abc?k=x"));
        check("feed link elsewhere", !Guard.feedLink("https://192.168.3.10:8081/remote"));
        check("feed link with a user", !Guard.feedLink("https://me@192.168.3.10:8081/feed/abc"));
        check("not a link", !Guard.feedLink("::"));
        check("fingerprint", Guard.fingerprint("abecce707af4a66a8aa18ce9624ebead97a8f362335dd688e9d5899af9428a19"));
        check("fingerprint in capitals", !Guard.fingerprint("ABECCE707AF4A66A8AA18CE9624EBEAD97A8F362335DD688E9D5899AF9428A19"));
        check("short fingerprint", !Guard.fingerprint("abecce"));

        // The picture kept for a restart (1.5): bounded, the screen's shape, only of the feed shown.
        int[] big = Guard.stillSize(3840, 2160);
        check("a 4K screen is kept at 1080p", big != null && big[0] == 1920 && big[1] == 1080);
        int[] small = Guard.stillSize(1280, 720);
        check("a 720p screen is kept as it is", small != null && small[0] == 1280 && small[1] == 720);
        int[] tall = Guard.stillSize(1080, 1920);
        check("a tall screen keeps its shape", tall != null && tall[1] == 1080 && tall[0] == 608);
        check("a screen with no size has no picture", Guard.stillSize(0, 1080) == null);
        String feed = "https://192.168.3.10:8081/feed/abc?k=x";
        check("the picture of the feed shown", Guard.stillFits(feed, feed, 300_000));
        check("a picture of another feed", !Guard.stillFits("https://192.168.3.10:8081/feed/other?k=y", feed, 300_000));
        check("no picture taken", !Guard.stillFits(null, feed, 300_000));
        check("an empty picture", !Guard.stillFits(feed, feed, 0));
        check("a picture too big", !Guard.stillFits(feed, feed, Guard.STILL_MAX_BYTES + 1));

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
