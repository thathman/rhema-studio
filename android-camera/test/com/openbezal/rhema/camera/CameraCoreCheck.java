package com.openbezal.rhema.camera;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * build.sh runs this on the computer (plain Java, no Android) before it makes the app: the pairing
 * link and the certificate pin, RTP packets for H.264, H.265 and AAC, the session description,
 * signing in (RFC 2617's own Digest example), reading the router's replies, the picture plan, and
 * the looks' colour maths (the same as the GPU shader's) and .cube tables.
 */
public final class CameraCoreCheck {
    private static int failed;

    private CameraCoreCheck() { }

    static final String FP = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"; // SHA-256 of "abc"
    static final String TOKEN = "0123456789abcdef0123456789abcdef";
    static final String LINK = "rhema-camera://pair?host=192.168.1.20&port=8322&name=pulpit&user=cam-pulpit&token=" + TOKEN + "&fp=" + FP + "&label=Pulpit%20cam";

    public static void main(String[] args) throws Exception {
        pairing();
        rtp();
        sdp();
        auth();
        reader();
        plan();
        kelvin();
        looks();
        lut();
        exposure();
        if (failed > 0) {
            System.out.println(failed + " camera check(s) failed");
            System.exit(1);
        }
        System.out.println("camera checks passed");
    }

    static void pairing() {
        Pairing p = Pairing.parse(LINK);
        check("pair: host", p.host.equals("192.168.1.20") && p.port == 8322);
        check("pair: camera", p.name.equals("pulpit") && p.user.equals("cam-pulpit") && p.token.equals(TOKEN));
        check("pair: fingerprint", p.fp.equals(FP));
        check("pair: label", p.label.equals("Pulpit cam") && p.title().equals("Pulpit cam"));
        check("pair: rtsps only", p.url().equals("rtsps://192.168.1.20:8322/pulpit"));
        check("pair: link round trip", Pairing.parse(p.link()).link().equals(p.link()));
        check("pair: printing has no password", !p.toString().contains(TOKEN));
        check("pair: upper-case and colon fingerprint", Pairing.parse(LINK.replace(FP, FP.toUpperCase().replaceAll("(..)(?!$)", "$1:"))).fp.equals(FP));
        check("pair: scheme case", Pairing.parse(LINK.replace("rhema-camera://pair", "RHEMA-CAMERA://pair")).name.equals("pulpit"));
        refused("pair: another scheme", LINK.replace("rhema-camera://", "https://"));
        refused("pair: host name", LINK.replace("192.168.1.20", "rhema.example"));
        refused("pair: bad address", LINK.replace("192.168.1.20", "192.168.1.256"));
        refused("pair: no port", LINK.replace("&port=8322", ""));
        refused("pair: port 0", LINK.replace("port=8322", "port=0"));
        refused("pair: port too big", LINK.replace("port=8322", "port=70000"));
        refused("pair: capital name", LINK.replace("name=pulpit", "name=Pulpit"));
        refused("pair: user of another camera", LINK.replace("user=cam-pulpit", "user=cam-choir"));
        refused("pair: the anyone user", LINK.replace("user=cam-pulpit", "user=any"));
        refused("pair: short token", LINK.replace(TOKEN, "short"));
        refused("pair: token with symbols", LINK.replace(TOKEN, "0123456789abcdef%22%0A456789abcdef"));
        refused("pair: short fingerprint", LINK.replace(FP, FP.substring(2)));
        refused("pair: no fingerprint", LINK.replace("&fp=" + FP, ""));
        refused("pair: twice", LINK + "&host=10.0.0.1");
        refused("pair: nothing", "");
        check("pin: the named certificate", Pairing.pinned("abc".getBytes(StandardCharsets.US_ASCII), FP));
        check("pin: another certificate", !Pairing.pinned("abd".getBytes(StandardCharsets.US_ASCII), FP));
        check("pin: no certificate", !Pairing.pinned(null, FP));
        check("pin: a bad fingerprint", !Pairing.pinned("abc".getBytes(StandardCharsets.US_ASCII), FP.toUpperCase()));
    }

    static final class Collect implements Rtp.Sink {
        final List<byte[]> packets = new ArrayList<byte[]>();

        @Override
        public void packet(byte[] buf, int off, int len) {
            check("rtp: room for the interleaved header", off >= 4);
            packets.add(Arrays.copyOfRange(buf, off, off + len));
        }
    }

    static byte[] nal(int len, int b0, int b1) {
        byte[] d = new byte[len];
        for (int i = 0; i < len; i++) d[i] = (byte) (i * 7 + 3);
        d[0] = (byte) b0;
        if (b1 >= 0) d[1] = (byte) b1;
        return d;
    }

    static boolean marker(byte[] p) {
        return (p[1] & 0x80) != 0;
    }

    static int seq(byte[] p) {
        return ((p[2] & 0xff) << 8) | (p[3] & 0xff);
    }

    static void rtp() throws Exception {
        Rtp h264 = new Rtp(Rtp.Kind.H264, 96, 0x11223344, 65534);
        Collect c = new Collect();
        byte[] small = nal(200, 0x67, -1);
        h264.nal(small, 0, small.length, 0x01020304L, false, c);
        byte[] p0 = c.packets.get(0);
        check("h264: one packet for a small unit", c.packets.size() == 1 && p0.length == 12 + 200);
        check("h264: RTP version 2, type 96", (p0[0] & 0xff) == 0x80 && (p0[1] & 0x7f) == 96);
        check("h264: timestamp and ssrc", p0[4] == 1 && p0[5] == 2 && p0[6] == 3 && p0[7] == 4 && (p0[8] & 0xff) == 0x11 && (p0[11] & 0xff) == 0x44);
        check("h264: no marker before the picture's end", !marker(p0));
        check("h264: single unit as is", Arrays.equals(Arrays.copyOfRange(p0, 12, p0.length), small));

        byte[] big = nal(3000, 0x65, -1);
        c.packets.clear();
        h264.nal(big, 0, big.length, 90000, true, c);
        check("h264: FU-A in three", c.packets.size() == 3);
        check("h264: FU indicator keeps NRI, type 28", (c.packets.get(0)[12] & 0xff) == 0x7c && (c.packets.get(2)[12] & 0xff) == 0x7c);
        check("h264: FU headers start, middle, end", (c.packets.get(0)[13] & 0xff) == 0x85 && (c.packets.get(1)[13] & 0xff) == 0x05 && (c.packets.get(2)[13] & 0xff) == 0x45);
        check("h264: marker only on the last", !marker(c.packets.get(0)) && !marker(c.packets.get(1)) && marker(c.packets.get(2)));
        check("h264: sequence numbers wrap", seq(p0) == 65534 && seq(c.packets.get(0)) == 65535 && seq(c.packets.get(1)) == 0 && seq(c.packets.get(2)) == 1);
        ByteArrayOutputStream joined = new ByteArrayOutputStream();
        joined.write(big[0]);
        for (byte[] p : c.packets) {
            check("h264: no packet over the limit", p.length - 12 <= Rtp.MAX_PAYLOAD);
            joined.write(p, 14, p.length - 14);
        }
        check("h264: fragments join back", Arrays.equals(joined.toByteArray(), big));

        Rtp h265 = new Rtp(Rtp.Kind.H265, 96, 7, 0);
        c.packets.clear();
        byte[] idr = nal(3000, 0x26, 0x01); // type 19 (IDR_W_RADL)
        h265.nal(idr, 0, idr.length, 0, true, c);
        check("h265: FU in three", c.packets.size() == 3);
        check("h265: payload header type 49", (c.packets.get(0)[12] & 0xff) == 0x62 && (c.packets.get(0)[13] & 0xff) == 0x01);
        check("h265: FU headers start, middle, end", (c.packets.get(0)[14] & 0xff) == 0x93 && (c.packets.get(1)[14] & 0xff) == 0x13 && (c.packets.get(2)[14] & 0xff) == 0x53);
        check("h265: marker only on the last", !marker(c.packets.get(1)) && marker(c.packets.get(2)));
        joined.reset();
        joined.write(idr, 0, 2);
        for (byte[] p : c.packets) joined.write(p, 15, p.length - 15);
        check("h265: fragments join back", Arrays.equals(joined.toByteArray(), idr));
        check("h265: nal type", Rtp.nalType(Rtp.Kind.H265, (byte) 0x40) == 32 && Rtp.nalType(Rtp.Kind.H264, (byte) 0x67) == 7);

        byte[] annexB = {0, 0, 0, 1, 0x67, 1, 2, 0, 0, 1, 0x68, 3, 0, 0, 0, 1, 0x65, 4, 5, 6, 0};
        int[] units = Rtp.nals(annexB, 0, annexB.length);
        check("annex b: three units", Arrays.equals(units, new int[] {4, 3, 10, 2, 16, 4}));
        check("annex b: no start code is one unit", Arrays.equals(Rtp.nals(new byte[] {0x65, 1, 2}, 0, 3), new int[] {0, 3}));
        c.packets.clear();
        h264.picture(annexB, 0, annexB.length, 3000, c);
        check("picture: one packet each, marker on the last", c.packets.size() == 3 && !marker(c.packets.get(0)) && !marker(c.packets.get(1)) && marker(c.packets.get(2)));

        Rtp aac = new Rtp(Rtp.Kind.AAC, 97, 9, 10);
        c.packets.clear();
        byte[] au = nal(300, 0x21, -1);
        aac.aac(au, 0, au.length, 1024, c);
        byte[] a0 = c.packets.get(0);
        check("aac: AU header length 16 bits", a0[12] == 0 && a0[13] == 16);
        check("aac: AU size 300, index 0", (((a0[14] & 0xff) << 5) | ((a0[15] & 0xff) >> 3)) == 300 && (a0[15] & 7) == 0);
        check("aac: marker, type 97", marker(a0) && (a0[1] & 0x7f) == 97 && a0.length == 12 + 4 + 300);
        check("aac: counted", aac.packets == 1 && aac.octets == 304);

        byte[] sr = new byte[28];
        Rtp.senderReport(sr, 0, 0x01020304, 1000L, 90000, 5, 1000);
        check("rtcp: sender report", (sr[0] & 0xff) == 0x80 && (sr[1] & 0xff) == 200 && sr[3] == 6 && sr[7] == 4);
        check("rtcp: NTP seconds since 1900", ((sr[8] & 0xffL) << 24 | (sr[9] & 0xff) << 16 | (sr[10] & 0xff) << 8 | (sr[11] & 0xff)) == 2208988801L);
    }

    static void sdp() {
        byte[] sps = {0x67, 0x64, 0x00, 0x28, (byte) 0xac};
        byte[] pps = {0x68, (byte) 0xee, 0x3c, (byte) 0x80};
        String s = Sdp.build("192.168.1.20", 42, new Sdp.Video(false, null, sps, pps, 24), null);
        check("sdp: lines end in CRLF", s.endsWith("\r\n") && !s.replace("\r\n", "").contains("\n"));
        check("sdp: H.264 track", s.contains("m=video 0 RTP/AVP 96\r\n") && s.contains("a=rtpmap:96 H264/90000\r\n"));
        check("sdp: profile and parameter sets", s.contains("packetization-mode=1; profile-level-id=640028; sprop-parameter-sets=Z2QAKKw=,aO48gA==\r\n"));
        check("sdp: track control", s.contains("a=control:trackID=0\r\n") && !s.contains("m=audio"));
        check("sdp: frame rate", s.contains("a=framerate:24\r\n"));
        String h = Sdp.build("10.0.0.2", 1, new Sdp.Video(true, new byte[] {0x40, 1}, new byte[] {0x42, 1}, new byte[] {0x44, 1}, 30), new Sdp.Audio(48000, 1));
        check("sdp: H.265 track", h.contains("a=rtpmap:96 H265/90000\r\n") && h.contains("sprop-vps=QAE=; sprop-sps=QgE=; sprop-pps=RAE=\r\n"));
        check("sdp: AAC track", h.contains("m=audio 0 RTP/AVP 97\r\n") && h.contains("a=rtpmap:97 MPEG4-GENERIC/48000/1\r\n") && h.contains("mode=AAC-hbr; sizelength=13; indexlength=3; indexdeltalength=3; config=1188\r\n") && h.contains("a=control:trackID=1\r\n"));
        check("sdp: AAC 44.1 kHz stereo config", Pairing.hex(Sdp.aacConfig(44100, 2)).equals("1210"));
    }

    static void auth() {
        // RFC 2617 section 3.5.
        Auth d = Auth.parse("Digest realm=\"testrealm@host.com\", qop=\"auth,auth-int\", nonce=\"dcd98b7102dd2f0e8b11d0f600bfb0c093\", opaque=\"5ccc069c403ebaf9f0171e9517f40e41\"");
        String h = d.digest("GET", "/dir/index.html", "Mufasa", "Circle Of Life", "00000001", "0a4f113b");
        check("digest: RFC 2617 response", h.contains("response=\"6629fae49393a05397450978507c4ef1\""));
        check("digest: echoes opaque, qop, nc", h.contains("opaque=\"5ccc069c403ebaf9f0171e9517f40e41\"") && h.contains("qop=auth, nc=00000001, cnonce=\"0a4f113b\""));
        Auth plain = Auth.parse("Digest realm=\"mediamtx\", nonce=\"abc\"");
        String expect = Auth.hash("MD5", Auth.hash("MD5", "cam-pulpit:mediamtx:" + TOKEN) + ":abc:" + Auth.hash("MD5", "ANNOUNCE:rtsps://h/pulpit"));
        check("digest: without qop", plain.digest("ANNOUNCE", "rtsps://h/pulpit", "cam-pulpit", TOKEN, "00000001", "x").contains("response=\"" + expect + "\""));
        Auth sha = Auth.parse("Digest realm=\"r\", nonce=\"n\", algorithm=SHA-256");
        check("digest: SHA-256", sha.digest("M", "u", "a", "b", "00000001", "c").contains("response=\"" + Auth.hash("SHA-256", Auth.hash("SHA-256", "a:r:b") + ":n:" + Auth.hash("SHA-256", "M:u")) + "\""));
        check("basic: RFC 7617", Auth.parse("Basic realm=\"x\"").header("GET", "/", "Aladdin", "open sesame").equals("Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ=="));
        check("choose: digest first", Auth.choose(Arrays.asList("Basic realm=\"m\"", "Digest realm=\"m\", nonce=\"1\"")).scheme.equals("digest"));
        check("choose: basic when only basic", Auth.choose(Arrays.asList("Basic realm=\"m\"")).scheme.equals("basic"));
        check("choose: nothing known", Auth.choose(Arrays.asList("Bearer x")) == null);
    }

    static void reader() throws Exception {
        String reply = "RTSP/1.0 401 Unauthorized\r\nCSeq: 2\r\nWWW-Authenticate: Basic realm=\"mediamtx\"\r\nWWW-Authenticate: Digest realm=\"mediamtx\", nonce=\"5d\"\r\nContent-Length: 3\r\n\r\nabc";
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        b.write(new byte[] {'$', 1, 0, 4, 9, 9, 9, 9});
        b.write(reply.getBytes(StandardCharsets.US_ASCII));
        b.write("RTSP/1.0 200 OK\r\nCSeq: 3\r\nSession: 12345678;timeout=60\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
        RtspReader r = new RtspReader(new ByteArrayInputStream(b.toByteArray()));
        RtspReader.Response one = r.next();
        check("reader: skips an interleaved packet", r.packetsSkipped == 1);
        check("reader: status", one.status == 401 && one.reason.equals("Unauthorized") && one.header("cseq").equals("2"));
        check("reader: both challenges", one.all("WWW-Authenticate").size() == 2);
        check("reader: body", new String(one.body, StandardCharsets.US_ASCII).equals("abc"));
        RtspReader.Response two = r.next();
        check("reader: next reply", two.status == 200 && two.header("Session").startsWith("12345678"));
        boolean eof = false;
        try {
            r.next();
        } catch (java.io.EOFException e) {
            eof = true;
        }
        check("reader: end of connection", eof);
        boolean bad = false;
        try {
            new RtspReader(new ByteArrayInputStream("HTTP/1.1 200 OK\r\n\r\n".getBytes(StandardCharsets.US_ASCII))).next();
        } catch (java.io.IOException e) {
            bad = true;
        }
        check("reader: not RTSP", bad);
    }

    static void plan() {
        check("bitrate: 4K24 about 45 Mbit/s", Plan.autoBitrate(3840, 2160, 24, false) == 45000000);
        check("bitrate: 1080p30 about 14 Mbit/s", Plan.autoBitrate(1920, 1080, 30, false) == 14000000);
        check("bitrate: 1080p60 more but not double", Plan.autoBitrate(1920, 1080, 60, false) == 21000000);
        check("bitrate: 4K24 HEVC about 38 Mbit/s", Plan.autoBitrate(3840, 2160, 24, true) == 38000000);
        check("bitrate: encoder's own limit", Plan.capBitrate(45000000, 0, 20000000) == 20000000);
        check("bitrate: Wi-Fi link cap", Plan.capBitrate(45000000, 72, 100000000) == 32400000);
        check("bitrate: never below 1 Mbit/s", Plan.capBitrate(45000000, 1, 0) == 1000000);
        check("shutter: 180 degrees at 24", Plan.shutterLabel(Plan.shutterNs(24, 0)).equals("1/48"));
        check("shutter: 24 under 50 Hz light", Plan.shutterLabel(Plan.shutterNs(24, 50)).equals("1/50"));
        check("shutter: 24 under 60 Hz light", Plan.shutterLabel(Plan.shutterNs(24, 60)).equals("1/60"));
        check("shutter: 30 under 50 Hz light", Plan.shutterLabel(Plan.shutterNs(30, 50)).equals("1/50"));
        check("shutter: 30 under 60 Hz light", Plan.shutterLabel(Plan.shutterNs(30, 60)).equals("1/60"));
        check("shutter: 60 under 50 Hz light", Plan.shutterLabel(Plan.shutterNs(60, 50)).equals("1/100"));
        check("shutter: angle", Plan.angle(Plan.shutterNs(24, 0), 24) == 180 && Plan.angle(Plan.shutterNs(24, 50), 24) == 173);
        check("thermal: steps", Plan.thermalStep(0) == 0 && Plan.thermalStep(1) == 0 && Plan.thermalStep(2) == 1 && Plan.thermalStep(3) == 2 && Plan.thermalStep(5) == 3);
        Plan.Shape s = new Plan.Shape(3840, 2160, 60, false, 50000000);
        Plan.Shape warm = Plan.cool(s, 1);
        check("thermal: warm lowers the bitrate only", warm.width == 3840 && warm.fps == 60 && warm.bitrate == 35000000);
        Plan.Shape hot = Plan.cool(s, 2);
        check("thermal: hot is 1080p30 at most", hot.width == 1920 && hot.height == 1080 && hot.fps == 30 && hot.bitrate <= 14000000 * 0.7 + 1);
        Plan.Shape veryHot = Plan.cool(s, 3);
        check("thermal: very hot is 720p", veryHot.height == 720 && veryHot.fps == 30);
        check("thermal: nothing when cool", Plan.cool(s, 0) == s);
        check("presets: four", Plan.PRESETS.length == 4 && Plan.preset("cine24").fps == 24 && Plan.preset("sports60").fps == 60 && Plan.preset("x") == null);
    }

    static void kelvin() {
        Kelvin.Anchor day = new Kelvin.Anchor(5500, new float[] {2.0f, 1f, 1f, 1.5f}, new float[] {1.6f, -0.4f, -0.2f, -0.2f, 1.5f, -0.3f, 0f, -0.6f, 1.6f});
        Kelvin.Anchor tung = new Kelvin.Anchor(2850, new float[] {1.2f, 1f, 1f, 2.6f}, new float[] {1.4f, -0.3f, -0.1f, -0.3f, 1.6f, -0.3f, 0.1f, -0.9f, 1.8f});
        check("kelvin: daylight is the daylight anchor", near(Kelvin.gains(day, tung, 5500), day.gains));
        check("kelvin: tungsten is the tungsten anchor", near(Kelvin.gains(day, tung, 2850), tung.gains));
        float[] mid = Kelvin.gains(day, tung, (int) Math.round(1e6 / ((1e6 / 5500 + 1e6 / 2850) / 2)));
        check("kelvin: half way in mired is the geometric mean", Math.abs(mid[0] - Math.sqrt(2.0 * 1.2)) < 0.01 && Math.abs(mid[3] - Math.sqrt(1.5 * 2.6)) < 0.01);
        float[] cool = Kelvin.gains(day, tung, 9000);
        check("kelvin: bluer light, less blue gain", cool[3] < day.gains[3] && cool[0] > day.gains[0]);
        check("kelvin: matrix held at the ends", near(Kelvin.matrix(day, tung, 10000), day.matrix) && near(Kelvin.matrix(day, tung, 2500), tung.matrix));
    }

    static float[] graded(Looks.Params p, float r, float g, float b) {
        float[] c = {r, g, b};
        Looks.apply(p, c, 0.5f, 0.5f);
        return c;
    }

    static float hueDiff(float a, float b) {
        float d = Math.abs(a - b) % 360f;
        return d > 180 ? 360 - d : d;
    }

    static void looks() {
        check("looks: six, Studio first", Looks.IDS.length == 6 && Looks.IDS[0].equals("studio") && Looks.NAMES.length == 6 && Looks.ABOUT.length == 6);
        for (String id : Looks.IDS) {
            Looks.Params p = Looks.at(id, 1f, 0f, 0f);
            float last = -1;
            boolean up = true;
            for (int i = 0; i <= 256; i++) {
                float y = Looks.curve(p, i / 256f);
                if (y < last - 1e-6f || y < 0 || y > 1) up = false;
                last = y;
            }
            check("look " + id + ": tone curve always rising, within 0..1", up);
            float[] grey = graded(Looks.at(id, 0f, 0f, 0f), 0.5f, 0.5f, 0.5f);
            check("look " + id + ": at 0 % mid-grey stays mid-grey", Math.abs(grey[0] - 0.5f) < 1e-4 && Math.abs(grey[1] - 0.5f) < 1e-4 && Math.abs(grey[2] - 0.5f) < 1e-4);
            float[] any = graded(Looks.at(id, 0f, 0f, 0f), 0.8f, 0.3f, 0.1f);
            check("look " + id + ": at 0 % nothing changes", Math.abs(any[0] - 0.8f) < 1e-4 && Math.abs(any[1] - 0.3f) < 1e-4 && Math.abs(any[2] - 0.1f) < 1e-4);
            float[] g = graded(Looks.at(id, 1f, 0f, 0f), 0.5f, 0.5f, 0.5f);
            float gl = Looks.LR * g[0] + Looks.LG * g[1] + Looks.LB * g[2];
            check("look " + id + ": mid-grey stays near mid-grey at full strength", Math.abs(gl - 0.5f) < 0.06);
            if (!id.equals("mono")) {
                // Light and medium skin (sRGB) keep their hue within 8 degrees.
                float[][] skins = {{0.87f, 0.67f, 0.55f}, {0.55f, 0.38f, 0.29f}, {0.36f, 0.22f, 0.15f}};
                for (float[] s : skins) {
                    float[] o = graded(Looks.at(id, 1f, 0f, 0f), s[0], s[1], s[2]);
                    check("look " + id + ": skin hue kept (" + s[0] + ")", hueDiff(Looks.hue(o[0], o[1], o[2]), Looks.hue(s[0], s[1], s[2])) < 8f);
                }
            }
        }
        check("look studio: greys stay neutral", Math.abs(graded(Looks.at("studio", 1f, 0f, 0f), 0.3f, 0.3f, 0.3f)[0] - graded(Looks.at("studio", 1f, 0f, 0f), 0.3f, 0.3f, 0.3f)[2]) < 0.01);
        float[] bw = graded(Looks.at("mono", 1f, 0f, 0f), 0.8f, 0.2f, 0.4f);
        check("look mono: black and white", Math.abs(bw[0] - bw[1]) < 1e-4 && Math.abs(bw[1] - bw[2]) < 1e-4);
        float[] cin = graded(Looks.at("cinematic", 1f, 0f, 0f), 0.1f, 0.1f, 0.1f);
        check("look cinematic: teal shadows, lifted blacks", cin[2] > cin[0] && cin[1] > 0.1f);
        float[] cinHi = graded(Looks.at("cinematic", 1f, 0f, 0f), 0.85f, 0.85f, 0.85f);
        check("look cinematic: warm highlights, rolled off", cinHi[0] > cinHi[2] && cinHi[1] < 0.85f);
        check("look cinematic: keeps highlights (exposure bias -0.3 EV)", Math.abs(Looks.look("cinematic").evBias + 0.3f) < 1e-6 && Looks.look("studio").evBias == 0f);
        float[] warmer = graded(Looks.at("off", 0f, 0.5f, 0f), 0.5f, 0.5f, 0.5f);
        check("fine-tune: warmer is redder", warmer[0] > warmer[2]);
        float[] edge = {0.5f, 0.5f, 0.5f};
        Looks.apply(Looks.at("cinematic", 1f, 0f, 0f), edge, 0f, 0f);
        check("vignette: corners darker than the middle", edge[1] < graded(Looks.at("cinematic", 1f, 0f, 0f), 0.5f, 0.5f, 0.5f)[1]);
        Looks.Params half = Looks.at("cinematic", 0.5f, 0f, 0f);
        check("strength: half is half", Math.abs(half.contrast - Looks.look("cinematic").contrast / 2) < 1e-6 && Math.abs(half.saturation - (1 + (0.92f - 1) / 2)) < 1e-6);
        // The GPU looks the colour up in a 33-point table baked from this maths: it must agree.
        java.util.Random rnd = new java.util.Random(7);
        for (String id : Looks.IDS) {
            Looks.Params p = Looks.at(id, 1f, 0.2f, -0.1f);
            Lut table = Looks.bake(p, null, 0f);
            float worst = 0;
            for (int i = 0; i < 3000; i++) {
                float[] c = {rnd.nextFloat(), rnd.nextFloat(), rnd.nextFloat()}, d = c.clone();
                Looks.colour(p, c);
                table.apply(d);
                for (int k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(c[k] - d[k]));
            }
            check("look " + id + ": the baked table matches the maths (worst " + worst + ")", worst < 0.02f);
        }
        check("skin: a skin colour counts, grey and blue do not", Looks.skin(0.87f, 0.67f, 0.55f) > 0.5f && Looks.skin(0.5f, 0.5f, 0.5f) == 0f && Looks.skin(0.2f, 0.3f, 0.8f) == 0f);
    }

    static void lut() {
        StringBuilder cube = new StringBuilder("TITLE \"identity\"\n# a comment\nLUT_3D_SIZE 2\n");
        for (int b = 0; b < 2; b++) for (int g = 0; g < 2; g++) for (int r = 0; r < 2; r++) cube.append(r).append(' ').append(g).append(' ').append(b).append('\n');
        Lut id = Lut.parse(cube.toString());
        float[] c = {0.25f, 0.5f, 0.75f};
        id.apply(c);
        check("lut: identity keeps colours", Math.abs(c[0] - 0.25f) < 1e-5 && Math.abs(c[1] - 0.5f) < 1e-5 && Math.abs(c[2] - 0.75f) < 1e-5);
        byte[] strip = id.strip();
        check("lut: strip is size*size by size", strip.length == 4 * 2 * 2 * 2);
        // Texel (r=1, g=0, b=1) sits at x = 1 + 1*2, y = 0: red full, blue full.
        check("lut: strip layout (blue picks the slice)", (strip[4 * 3] & 0xff) == 255 && (strip[4 * 3 + 1] & 0xff) == 0 && (strip[4 * 3 + 2] & 0xff) == 255);
        StringBuilder inv = new StringBuilder("LUT_3D_SIZE 2\n");
        for (int b = 0; b < 2; b++) for (int g = 0; g < 2; g++) for (int r = 0; r < 2; r++) inv.append(1 - r).append(' ').append(1 - g).append(' ').append(1 - b).append('\n');
        float[] d = {0.2f, 0.2f, 0.2f};
        Lut.parse(inv.toString()).apply(d);
        check("lut: an inverting table inverts", Math.abs(d[0] - 0.8f) < 1e-5);
        for (String bad : new String[] {"", "LUT_1D_SIZE 4\n", "LUT_3D_SIZE 99\n", "LUT_3D_SIZE 2\n0 0 0\n", "0 0 0\nLUT_3D_SIZE 2\n"}) {
            boolean thrown = false;
            try {
                Lut.parse(bad);
            } catch (IllegalArgumentException e) {
                thrown = true;
            }
            check("lut: refused (" + bad.replace("\n", " ").trim() + ")", thrown);
        }
    }

    static int[] flat(int grey, int w, int h) {
        int[] px = new int[w * h];
        java.util.Arrays.fill(px, 0xff000000 | (grey << 16) | (grey << 8) | grey);
        return px;
    }

    static void exposure() {
        // sRGB 118 is about 18 % grey.
        check("meter: mid-grey needs nothing", Math.abs(Exposure.ratio(flat(118, 32, 18), 32, 18, 0f) - 1) < 0.05);
        check("meter: a dark picture asks for more", Exposure.ratio(flat(50, 32, 18), 32, 18, 0f) > 3);
        check("meter: -0.3 EV aims lower", Exposure.ratio(flat(118, 32, 18), 32, 18, -0.3f) < 0.85);
        check("meter: clipped highlights never ask for more", Exposure.ratio(flat(254, 32, 18), 32, 18, 2f) <= 0.92);
        int[] range = {50, 800};
        check("iso: small change, no change", Exposure.nextIso(400, 1.05, range) == 400);
        check("iso: at most a quarter more", Exposure.nextIso(400, 16, range) == 500);
        check("iso: at most a fifth less", Exposure.nextIso(400, 0.01, range) == 320);
        check("iso: within the sensor", Exposure.nextIso(790, 4, range) == 800 && Exposure.nextIso(55, 0.1, range) == 50);
        check("iso: settles (converges on a steady scene)", converges());
    }

    /** A scene whose brightness follows ISO settles within a few seconds of meter steps. */
    static boolean converges() {
        int iso = 100;
        int[] range = {50, 800};
        for (int i = 0; i < 40; i++) {
            int grey = (int) Math.min(255, Math.round(255 * Math.pow(0.18 * iso / 300.0, 1 / 2.2)));
            iso = Exposure.nextIso(iso, Exposure.ratio(flat(grey, 8, 8), 8, 8, 0f), range);
        }
        return iso > 250 && iso < 350;
    }

    static boolean near(float[] a, float[] b) {
        if (a.length != b.length) return false;
        for (int i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-3) return false;
        return true;
    }

    static void refused(String name, String link) {
        boolean thrown = false;
        try {
            Pairing.parse(link);
        } catch (IllegalArgumentException e) {
            thrown = true;
        }
        check(name + " is refused", thrown);
    }

    static void check(String name, boolean ok) {
        if (!ok) {
            failed++;
            System.out.println("FAILED: " + name);
        }
    }
}
