package com.openbezal.rhema.camera;

import java.io.IOException;

/**
 * Turns the encoder's pictures and sound into RTP packets for one track: H.264 (RFC 6184, single
 * NAL units and FU-A fragments), H.265 (RFC 7798, single NAL units and FU fragments) or AAC
 * (RFC 3640, AAC-hbr, one access unit per packet). Each packet is handed to a Sink with four free
 * bytes before it, where the sender writes RTSP's interleaved header ($, channel, length).
 * Plain Java (no Android), so build.sh can test it.
 */
final class Rtp {
    interface Sink {
        /** One RTP packet at buf[off..off+len); buf[off-4..off) is free for the sender. */
        void packet(byte[] buf, int off, int len) throws IOException;
    }

    /** Payload bytes per packet: small enough for any reader that sends it on over UDP. */
    static final int MAX_PAYLOAD = 1400;
    static final int HEADER = 12;

    enum Kind { H264, H265, AAC }

    final Kind kind;
    final int payloadType;
    final int ssrc;
    private int seq;
    private final byte[] buf = new byte[4 + HEADER + MAX_PAYLOAD + 4];
    /** Counted for RTCP sender reports. */
    long packets;
    long octets;
    long lastTimestamp;

    Rtp(Kind kind, int payloadType, int ssrc, int firstSeq) {
        this.kind = kind;
        this.payloadType = payloadType;
        this.ssrc = ssrc;
        this.seq = firstSeq & 0xffff;
    }

    int nextSeq() {
        return seq;
    }

    private int header(long timestamp, boolean marker) {
        int o = 4;
        buf[o] = (byte) 0x80;
        buf[o + 1] = (byte) ((marker ? 0x80 : 0) | (payloadType & 0x7f));
        buf[o + 2] = (byte) (seq >> 8);
        buf[o + 3] = (byte) seq;
        buf[o + 4] = (byte) (timestamp >> 24);
        buf[o + 5] = (byte) (timestamp >> 16);
        buf[o + 6] = (byte) (timestamp >> 8);
        buf[o + 7] = (byte) timestamp;
        buf[o + 8] = (byte) (ssrc >> 24);
        buf[o + 9] = (byte) (ssrc >> 16);
        buf[o + 10] = (byte) (ssrc >> 8);
        buf[o + 11] = (byte) ssrc;
        seq = (seq + 1) & 0xffff;
        lastTimestamp = timestamp & 0xffffffffL;
        return o + HEADER;
    }

    private void send(Sink sink, int end) throws IOException {
        int len = end - 4;
        packets++;
        octets += len - HEADER;
        sink.packet(buf, 4, len);
    }

    /**
     * One NAL unit (without its start code). `last` marks the last NAL unit of a picture, which
     * gets the RTP marker bit on its last packet.
     */
    void nal(byte[] d, int off, int len, long timestamp, boolean last, Sink sink) throws IOException {
        int hdr = kind == Kind.H265 ? 2 : 1;
        if (len <= hdr) return;
        if (len <= MAX_PAYLOAD) {
            int o = header(timestamp, last);
            System.arraycopy(d, off, buf, o, len);
            send(sink, o + len);
            return;
        }
        int type;
        int pos = off + hdr;
        int left = len - hdr;
        boolean first = true;
        while (left > 0) {
            int fuHdr = kind == Kind.H265 ? 3 : 2;
            int chunk = Math.min(left, MAX_PAYLOAD - fuHdr);
            boolean end = chunk == left;
            int o = header(timestamp, last && end);
            if (kind == Kind.H265) {
                type = (d[off] >> 1) & 0x3f;
                // PayloadHdr: the NAL header with type 49 (FU); then the FU header.
                buf[o] = (byte) ((d[off] & 0x81) | (49 << 1));
                buf[o + 1] = d[off + 1];
                buf[o + 2] = (byte) ((first ? 0x80 : 0) | (end ? 0x40 : 0) | type);
            } else {
                type = d[off] & 0x1f;
                // FU indicator: F and NRI of the NAL unit, type 28 (FU-A); then the FU header.
                buf[o] = (byte) ((d[off] & 0xe0) | 28);
                buf[o + 1] = (byte) ((first ? 0x80 : 0) | (end ? 0x40 : 0) | type);
            }
            System.arraycopy(d, pos, buf, o + fuHdr, chunk);
            send(sink, o + fuHdr + chunk);
            pos += chunk;
            left -= chunk;
            first = false;
        }
    }

    /** A whole picture as the encoder gives it (Annex B: NAL units after 00 00 01 start codes). */
    void picture(byte[] d, int off, int len, long timestamp, Sink sink) throws IOException {
        int[] units = nals(d, off, len);
        for (int i = 0; i < units.length; i += 2) nal(d, units[i], units[i + 1], timestamp, i + 2 >= units.length, sink);
    }

    /** One AAC access unit (no ADTS header), with its AU header (13-bit size, 3-bit index 0). */
    void aac(byte[] d, int off, int len, long timestamp, Sink sink) throws IOException {
        if (len <= 0 || len > MAX_PAYLOAD - 4) return;
        int o = header(timestamp, true);
        buf[o] = 0;
        buf[o + 1] = 16;
        buf[o + 2] = (byte) (len >> 5);
        buf[o + 3] = (byte) ((len & 0x1f) << 3);
        System.arraycopy(d, off, buf, o + 4, len);
        send(sink, o + 4 + len);
    }

    /**
     * The NAL units in an Annex B buffer, as (start, length) pairs; start codes and the zero bytes
     * before the next start code are left out.
     */
    static int[] nals(byte[] d, int off, int len) {
        int end = off + len;
        int[] out = new int[16];
        int n = 0;
        int start = -1;
        int i = off;
        while (i + 2 < end) {
            if (d[i] == 0 && d[i + 1] == 0 && d[i + 2] == 1) {
                if (start >= 0) n = add(out = grow(out, n), n, d, start, i);
                i += 3;
                start = i;
            } else {
                i++;
            }
        }
        if (start < 0 && len > 0) start = off; // no start code at all: one NAL unit
        if (start >= 0 && start < end) n = add(out = grow(out, n), n, d, start, end);
        int[] r = new int[n];
        System.arraycopy(out, 0, r, 0, n);
        return r;
    }

    private static int[] grow(int[] a, int n) {
        if (n + 2 <= a.length) return a;
        int[] b = new int[a.length * 2];
        System.arraycopy(a, 0, b, 0, n);
        return b;
    }

    private static int add(int[] out, int n, byte[] d, int start, int stop) {
        while (stop > start && d[stop - 1] == 0) stop--;
        if (stop <= start) return n;
        out[n] = start;
        out[n + 1] = stop - start;
        return n + 2;
    }

    /** The NAL unit type (H.264: 5 bits; H.265: 6 bits). */
    static int nalType(Kind kind, byte first) {
        return kind == Kind.H265 ? (first >> 1) & 0x3f : first & 0x1f;
    }

    /**
     * An RTCP sender report (RFC 3550) into out[off..off+28): this track's clock against wall
     * time, so a reader can line sound up with the picture.
     */
    static int senderReport(byte[] out, int off, int ssrc, long wallMillis, long rtpTimestamp, long packets, long octets) {
        long ntpSec = wallMillis / 1000 + 2208988800L;
        long ntpFrac = ((wallMillis % 1000) << 32) / 1000;
        out[off] = (byte) 0x80;
        out[off + 1] = (byte) 200;
        out[off + 2] = 0;
        out[off + 3] = 6;
        put32(out, off + 4, ssrc);
        put32(out, off + 8, (int) ntpSec);
        put32(out, off + 12, (int) ntpFrac);
        put32(out, off + 16, (int) rtpTimestamp);
        put32(out, off + 20, (int) packets);
        put32(out, off + 24, (int) octets);
        return 28;
    }

    static void put32(byte[] b, int o, int v) {
        b[o] = (byte) (v >> 24);
        b[o + 1] = (byte) (v >> 16);
        b[o + 2] = (byte) (v >> 8);
        b[o + 3] = (byte) v;
    }
}
