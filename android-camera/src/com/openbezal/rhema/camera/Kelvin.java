package com.openbezal.rhema.camera;

/**
 * White balance in kelvin, worked out from two colours the camera measured itself (its daylight
 * and tungsten presets). Plain Java (no Android), so build.sh can test it.
 */
final class Kelvin {
    private Kelvin() { }

    /** What the camera used for one of its own white-balance presets. */
    static final class Anchor {
        final int kelvin;
        /** Colour gains R, G even, G odd, B. */
        final float[] gains;
        /** The 3 × 3 colour matrix, row by row. */
        final float[] matrix;

        Anchor(int kelvin, float[] gains, float[] matrix) {
            this.kelvin = kelvin;
            this.gains = gains;
            this.matrix = matrix;
        }
    }

    /** Daylight and tungsten presets, as cameras commonly mean them. */
    static final int DAYLIGHT_K = 5500;
    static final int TUNGSTEN_K = 2850;

    static double mired(int kelvin) {
        return 1e6 / kelvin;
    }

    /**
     * Where a colour temperature lies between the two anchors, in mired (0 at a, 1 at b), which
     * is how far apart colours of light look; outside 0..1 is extrapolated a little, never far.
     */
    static double position(Anchor a, Anchor b, int kelvin) {
        double t = (mired(kelvin) - mired(a.kelvin)) / (mired(b.kelvin) - mired(a.kelvin));
        return Math.max(-1.5, Math.min(2.5, t));
    }

    /** The gains for a temperature: in between the anchors on a log scale. */
    static float[] gains(Anchor a, Anchor b, int kelvin) {
        double t = position(a, b, kelvin);
        float[] g = new float[4];
        for (int i = 0; i < 4; i++) {
            double la = Math.log(Math.max(1e-3, a.gains[i])), lb = Math.log(Math.max(1e-3, b.gains[i]));
            g[i] = (float) Math.exp(la + (lb - la) * t);
        }
        return g;
    }

    /** The colour matrix for a temperature: in between the anchors' matrices (held at the ends). */
    static float[] matrix(Anchor a, Anchor b, int kelvin) {
        double t = Math.max(0, Math.min(1, position(a, b, kelvin)));
        float[] m = new float[9];
        for (int i = 0; i < 9; i++) m[i] = (float) (a.matrix[i] + (b.matrix[i] - a.matrix[i]) * t);
        return m;
    }
}
