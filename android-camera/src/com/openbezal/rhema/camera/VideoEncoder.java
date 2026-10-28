package com.openbezal.rhema.camera;

import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.view.Surface;

import java.io.IOException;
import java.nio.ByteBuffer;

/**
 * The phone's hardware video encoder, fed straight from the camera through its input surface (no
 * copies of pictures in the app). One full picture every second, no B-frames (screens and TVs
 * playing over WebRTC need none), the bitrate changeable while it runs.
 */
final class VideoEncoder {
    interface Sink {
        /** The parameter sets (vps only for H.265), before the first picture. */
        void config(byte[] vps, byte[] sps, byte[] pps);

        /** One encoded picture, Annex B. */
        void frame(byte[] data, int len, long ptsUs, boolean key);

        void error(String message);
    }

    final String name;
    final boolean hevc;
    final Plan.Shape shape;
    private final MediaCodec codec;
    private final Surface surface;
    private final Sink sink;
    private volatile boolean released;
    private byte[] vps, sps, pps;
    private boolean configured;

    VideoEncoder(MediaCodecInfo info, String mime, Plan.Shape shape, Sink sink, Handler handler) throws IOException {
        this.name = info.getName();
        this.hevc = Caps.HEVC.equals(mime);
        this.shape = shape;
        this.sink = sink;
        codec = MediaCodec.createByCodecName(info.getName());
        codec.setCallback(callback, handler);
        MediaCodecInfo.CodecCapabilities caps = info.getCapabilitiesForType(mime);
        try {
            codec.configure(format(mime, caps, true), null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
        } catch (RuntimeException first) {
            // Some encoders refuse a profile or an extra they do not know: the plain settings, then.
            codec.reset();
            codec.setCallback(callback, handler);
            codec.configure(format(mime, caps, false), null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
        }
        surface = codec.createInputSurface();
    }

    private MediaFormat format(String mime, MediaCodecInfo.CodecCapabilities caps, boolean extras) {
        MediaFormat f = MediaFormat.createVideoFormat(mime, shape.width, shape.height);
        f.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
        f.setInteger(MediaFormat.KEY_BIT_RATE, shape.bitrate);
        f.setInteger(MediaFormat.KEY_FRAME_RATE, shape.fps);
        f.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1);
        MediaCodecInfo.EncoderCapabilities enc = caps.getEncoderCapabilities();
        // Constant bitrate keeps the Wi-Fi load steady; else variable.
        if (enc != null && enc.isBitrateModeSupported(MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_CBR)) {
            f.setInteger(MediaFormat.KEY_BITRATE_MODE, MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_CBR);
        } else if (enc != null && enc.isBitrateModeSupported(MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_VBR)) {
            f.setInteger(MediaFormat.KEY_BITRATE_MODE, MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_VBR);
        }
        f.setInteger(MediaFormat.KEY_PRIORITY, 0);
        if (!extras) return f;
        int profile = hevc ? MediaCodecInfo.CodecProfileLevel.HEVCProfileMain : MediaCodecInfo.CodecProfileLevel.AVCProfileHigh;
        int level = 0;
        for (MediaCodecInfo.CodecProfileLevel pl : caps.profileLevels) if (pl.profile == profile) level = Math.max(level, pl.level);
        if (level > 0) {
            f.setInteger(MediaFormat.KEY_PROFILE, profile);
            f.setInteger(MediaFormat.KEY_LEVEL, level);
        }
        f.setInteger("max-bframes", 0);
        if (Build.VERSION.SDK_INT >= 29) f.setInteger(MediaFormat.KEY_PREPEND_HEADER_TO_SYNC_FRAMES, 1);
        if (Build.VERSION.SDK_INT >= 30) f.setInteger(MediaFormat.KEY_LATENCY, 1);
        return f;
    }

    Surface surface() {
        return surface;
    }

    void start() {
        codec.start();
    }

    /** A full picture now (a reader joined, or frames were dropped). */
    void requestKey() {
        if (released) return;
        Bundle b = new Bundle();
        b.putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0);
        try {
            codec.setParameters(b);
        } catch (IllegalStateException ignored) {
            // Stopping.
        }
    }

    void bitrate(int bps) {
        if (released) return;
        Bundle b = new Bundle();
        b.putInt(MediaCodec.PARAMETER_KEY_VIDEO_BITRATE, bps);
        try {
            codec.setParameters(b);
        } catch (IllegalStateException ignored) {
            // Stopping.
        }
    }

    void release() {
        released = true;
        try {
            codec.stop();
        } catch (IllegalStateException ignored) {
            // Not started, or failed.
        }
        codec.release();
        surface.release();
    }

    /** Keeps the parameter sets from a buffer of NAL units (codec config, or the first key frame). */
    private void params(byte[] d, int len) {
        int[] units = Rtp.nals(d, 0, len);
        for (int i = 0; i < units.length; i += 2) {
            byte[] u = new byte[units[i + 1]];
            System.arraycopy(d, units[i], u, 0, u.length);
            int t = Rtp.nalType(hevc ? Rtp.Kind.H265 : Rtp.Kind.H264, u[0]);
            if (hevc && t == 32) vps = u;
            if (hevc ? t == 33 : t == 7) sps = u;
            if (hevc ? t == 34 : t == 8) pps = u;
        }
        if (!configured && sps != null && pps != null && (!hevc || vps != null)) {
            configured = true;
            sink.config(vps, sps, pps);
        }
    }

    /** A key frame without its parameter sets gets them in front, so a reader can start from it. */
    private byte[] withParams(byte[] d, int len, int[] outLen) {
        int[] units = Rtp.nals(d, 0, len);
        for (int i = 0; i < units.length; i += 2) {
            int t = Rtp.nalType(hevc ? Rtp.Kind.H265 : Rtp.Kind.H264, d[units[i]]);
            if (hevc ? t == 33 : t == 7) {
                outLen[0] = len;
                return d;
            }
        }
        byte[][] sets = hevc ? new byte[][] {vps, sps, pps} : new byte[][] {sps, pps};
        int extra = 0;
        for (byte[] s : sets) extra += 4 + s.length;
        byte[] out = new byte[extra + len];
        int o = 0;
        for (byte[] s : sets) {
            out[o + 3] = 1;
            System.arraycopy(s, 0, out, o + 4, s.length);
            o += 4 + s.length;
        }
        System.arraycopy(d, 0, out, o, len);
        outLen[0] = out.length;
        return out;
    }

    private final MediaCodec.Callback callback = new MediaCodec.Callback() {
        @Override
        public void onInputBufferAvailable(MediaCodec mc, int index) {
            // Input comes from the surface.
        }

        @Override
        public void onOutputBufferAvailable(MediaCodec mc, int index, MediaCodec.BufferInfo info) {
            if (released) return;
            try {
                ByteBuffer buf = mc.getOutputBuffer(index);
                if (buf != null && info.size > 0) {
                    byte[] d = new byte[info.size];
                    buf.position(info.offset);
                    buf.get(d, 0, info.size);
                    boolean key = (info.flags & MediaCodec.BUFFER_FLAG_KEY_FRAME) != 0;
                    if ((info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) {
                        params(d, d.length);
                    } else {
                        if (key && !configured) params(d, d.length);
                        if (configured) {
                            int[] n = {d.length};
                            byte[] out = key ? withParams(d, d.length, n) : d;
                            sink.frame(out, n[0], info.presentationTimeUs, key);
                        }
                    }
                }
                mc.releaseOutputBuffer(index, false);
            } catch (IllegalStateException e) {
                // Released while this buffer was on its way.
            }
        }

        @Override
        public void onError(MediaCodec mc, MediaCodec.CodecException e) {
            if (!released) sink.error("The phone's encoder stopped (" + e.getDiagnosticInfo() + ").");
        }

        @Override
        public void onOutputFormatChanged(MediaCodec mc, MediaFormat format) {
            for (String k : new String[] {"csd-0", "csd-1", "csd-2"}) {
                ByteBuffer b = format.getByteBuffer(k);
                if (b == null) continue;
                byte[] d = new byte[b.remaining()];
                b.duplicate().get(d);
                params(d, d.length);
            }
        }
    };
}
