package com.openbezal.rhema.camera;

import java.util.Base64;

/**
 * The session description this phone ANNOUNCEs to the camera router: one video track (H.264 or
 * H.265, with its parameter sets so a reader can start at once) and, when the microphone is on,
 * one AAC track. Plain Java (no Android), so build.sh can test it.
 */
final class Sdp {
    private Sdp() { }

    static final int VIDEO_PT = 96;
    static final int AUDIO_PT = 97;

    /** The video track's parameter sets, without start codes (vps only for H.265). */
    static final class Video {
        final boolean hevc;
        final byte[] vps;
        final byte[] sps;
        final byte[] pps;
        final int fps;

        Video(boolean hevc, byte[] vps, byte[] sps, byte[] pps, int fps) {
            this.hevc = hevc;
            this.vps = vps;
            this.sps = sps;
            this.pps = pps;
            this.fps = fps;
        }
    }

    static final class Audio {
        final int sampleRate;
        final int channels;

        Audio(int sampleRate, int channels) {
            this.sampleRate = sampleRate;
            this.channels = channels;
        }
    }

    static String build(String host, long sessionId, Video v, Audio a) {
        StringBuilder s = new StringBuilder();
        line(s, "v=0");
        line(s, "o=- " + sessionId + " 1 IN IP4 " + host);
        line(s, "s=Rhema Camera");
        line(s, "c=IN IP4 " + host);
        line(s, "t=0 0");
        line(s, "m=video 0 RTP/AVP " + VIDEO_PT);
        if (v.hevc) {
            line(s, "a=rtpmap:" + VIDEO_PT + " H265/90000");
            line(s, "a=fmtp:" + VIDEO_PT + " sprop-vps=" + b64(v.vps) + "; sprop-sps=" + b64(v.sps) + "; sprop-pps=" + b64(v.pps));
        } else {
            line(s, "a=rtpmap:" + VIDEO_PT + " H264/90000");
            line(s, "a=fmtp:" + VIDEO_PT + " packetization-mode=1; profile-level-id=" + profileLevelId(v.sps) + "; sprop-parameter-sets=" + b64(v.sps) + "," + b64(v.pps));
        }
        if (v.fps > 0) line(s, "a=framerate:" + v.fps);
        line(s, "a=control:trackID=0");
        if (a != null) {
            line(s, "m=audio 0 RTP/AVP " + AUDIO_PT);
            line(s, "a=rtpmap:" + AUDIO_PT + " MPEG4-GENERIC/" + a.sampleRate + "/" + a.channels);
            line(s, "a=fmtp:" + AUDIO_PT + " profile-level-id=1; mode=AAC-hbr; sizelength=13; indexlength=3; indexdeltalength=3; config="
                    + Pairing.hex(aacConfig(a.sampleRate, a.channels)));
            line(s, "a=control:trackID=1");
        }
        return s.toString();
    }

    /** H.264's profile, constraints and level: the three bytes after the SPS's NAL header. */
    static String profileLevelId(byte[] sps) {
        if (sps == null || sps.length < 4) return "42e01f";
        return Pairing.hex(new byte[] {sps[1], sps[2], sps[3]});
    }

    /** AAC-LC's AudioSpecificConfig (ISO 14496-3): object type 2, the rate's index, channels. */
    static byte[] aacConfig(int sampleRate, int channels) {
        int[] rates = {96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350};
        int index = 4;
        for (int i = 0; i < rates.length; i++) if (rates[i] == sampleRate) index = i;
        int bits = (2 << 11) | (index << 7) | (channels << 3);
        return new byte[] {(byte) (bits >> 8), (byte) bits};
    }

    private static String b64(byte[] b) {
        return Base64.getEncoder().encodeToString(b == null ? new byte[0] : b);
    }

    private static void line(StringBuilder s, String l) {
        s.append(l).append("\r\n");
    }
}
