package com.openbezal.rhema.camera;

/**
 * The plain choices behind the picture: the presets, the sizes offered, the bitrate worked out
 * from size and frame rate, a flicker-free shutter near 180 degrees, and how far to step down
 * when the phone gets hot. Plain Java (no Android), so build.sh can test it.
 */
final class Plan {
    private Plan() { }

    static final class Preset {
        final String id;
        final String label;
        final int fps;
        final String about;

        Preset(String id, String label, int fps, String about) {
            this.id = id;
            this.label = label;
            this.fps = fps;
            this.about = about;
        }
    }

    static final Preset[] PRESETS = {
        new Preset("cine24", "Cinematic 24", 24, "24 frames a second with a film-like shutter; the look of a cinema camera"),
        new Preset("film25", "Film 25", 25, "25 frames a second, a film look that matches 50 Hz lighting and PAL TV"),
        new Preset("smooth30", "Smooth 30", 30, "30 frames a second: smooth movement for preaching and choir"),
        new Preset("sports60", "Sports 60", 60, "60 frames a second for fast movement (dance, sport); uses more battery"),
    };

    static Preset preset(String id) {
        for (Preset p : PRESETS) if (p.id.equals(id)) return p;
        return null;
    }

    /** The picture sizes offered, largest first (16:9). */
    static final int[][] SIZES = {{3840, 2160}, {2560, 1440}, {1920, 1080}, {1280, 720}};

    static String sizeLabel(int h) {
        switch (h) {
            case 2160: return "4K (3840 × 2160)";
            case 1440: return "1440p (2560 × 1440)";
            case 1080: return "1080p (1920 × 1080)";
            case 720: return "720p (1280 × 720)";
            default: return h + "p";
        }
    }

    /** What the encoder and camera are set to. */
    static final class Shape {
        final int width;
        final int height;
        final int fps;
        final boolean hevc;
        final int bitrate;

        Shape(int width, int height, int fps, boolean hevc, int bitrate) {
            this.width = width;
            this.height = height;
            this.fps = fps;
            this.hevc = hevc;
            this.bitrate = bitrate;
        }

        @Override
        public String toString() {
            return width + "x" + height + "@" + fps + (hevc ? " HEVC " : " H.264 ") + (bitrate / 100000) / 10.0 + " Mbit/s";
        }
    }

    /**
     * The bitrate for a clean picture: about 0.225 bits per pixel for H.264 at up to 30 frames a
     * second (4K24 ≈ 45 Mbit/s, 1080p30 ≈ 14), frames above 30 counting half, H.265 about 85 % of
     * that (a 4K24 HEVC picture ≈ 38 Mbit/s: a phone's HEVC needs more than the textbook half). Rounded to half a megabit.
     */
    static int autoBitrate(int w, int h, int fps, boolean hevc) {
        double effFps = fps <= 30 ? fps : 30 + (fps - 30) * 0.5;
        double bps = w * (double) h * effFps * 0.225 * (hevc ? 0.85 : 1.0);
        long half = Math.round(bps / 500000.0);
        return (int) Math.max(1500000, half * 500000);
    }

    /**
     * The bitrate actually used: never above what the encoder takes, and on Wi-Fi never above
     * about 45 % of the link speed the phone reports (the rest is for other phones and TVs).
     * linkMbps 0 means not known (not on Wi-Fi).
     */
    static int capBitrate(int want, int linkMbps, int encoderMax) {
        long b = want;
        if (linkMbps > 0) b = Math.min(b, (long) (linkMbps * 1000000L * 0.45));
        if (encoderMax > 0) b = Math.min(b, encoderMax);
        return (int) Math.max(1000000, b);
    }

    /**
     * A shutter near 180 degrees (half the frame time) that does not flicker under mains lights:
     * a whole number of the light's flicker periods (100 or 120 a second), never longer than a
     * frame. hz 0: no mains light to match (exactly 180 degrees). In nanoseconds.
     */
    static long shutterNs(int fps, int hz) {
        double ideal = 1.0 / (2.0 * fps);
        if (hz <= 0) return Math.round(ideal * 1e9);
        double period = 1.0 / (2.0 * hz);
        // A tie goes to the shorter time (crisper; 1/60 for 24 under 60 Hz light).
        long n = Math.max(1, (long) Math.ceil(ideal / period - 0.5 - 1e-9));
        while (n > 1 && n * period > 1.0 / fps) n--;
        return Math.round(n * period * 1e9);
    }

    /** A shutter time as people say it (1/50). */
    static String shutterLabel(long ns) {
        if (ns <= 0) return "Auto";
        double s = ns / 1e9;
        if (s >= 0.5) return String.format(java.util.Locale.ROOT, "%.1f s", s);
        return "1/" + Math.round(1.0 / s);
    }

    /** The shutter angle a time gives at a frame rate (degrees). */
    static int angle(long ns, int fps) {
        return (int) Math.round(ns / 1e9 * fps * 360.0);
    }

    /**
     * Android's thermal status (PowerManager: 0 none … 2 moderate, 3 severe, 4+ critical) as a
     * step: 0 as chosen, 1 bitrate down 30 %, 2 also at most 30 frames and 1080p, 3 also 720p.
     */
    static int thermalStep(int status) {
        if (status >= 4) return 3;
        if (status == 3) return 2;
        if (status == 2) return 1;
        return 0;
    }

    /** A shape stepped down for heat. */
    static Shape cool(Shape s, int step) {
        if (step <= 0) return s;
        int w = s.width, h = s.height, fps = s.fps;
        int bitrate = (int) (s.bitrate * 0.7);
        if (step >= 2) {
            if (fps > 30) fps = 30;
            if (h > 1080) {
                w = 1920;
                h = 1080;
            }
            bitrate = Math.min(bitrate, (int) (autoBitrate(w, h, fps, s.hevc) * 0.7));
        }
        if (step >= 3 && h > 720) {
            w = 1280;
            h = 720;
            bitrate = Math.min(bitrate, (int) (autoBitrate(w, h, fps, s.hevc) * 0.7));
        }
        return new Shape(w, h, fps, s.hevc, bitrate);
    }

    /** What the step means, for Settings. */
    static String thermalNote(int step) {
        switch (step) {
            case 1: return "The phone is warm: the bitrate is 30 % lower to cool it.";
            case 2: return "The phone is hot: sending at most 1080p, 30 frames a second, with a lower bitrate.";
            case 3: return "The phone is very hot: sending 720p until it cools. Move it out of the sun or off its charger cover.";
            default: return "";
        }
    }
}
