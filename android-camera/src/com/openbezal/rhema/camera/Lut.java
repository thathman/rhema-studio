package com.openbezal.rhema.camera;

import java.util.Locale;

/**
 * A 3D colour lookup table from a .cube file (Adobe/Resolve format), laid out as the 2D strip the
 * shader samples: N slices of N × N side by side (blue chooses the slice, red runs across it,
 * green up it). Plain Java (no Android), so build.sh can test it.
 */
final class Lut {
    final int size;
    /** RGB, red fastest, then green, then blue (as in the file), 0..1. */
    final float[] data;

    private Lut(int size, float[] data) {
        this.size = size;
        this.data = data;
    }

    interface Colour {
        /** One colour (0..1), changed in place. */
        void map(float[] c);
    }

    /** A table of a colour function at size points on each side. */
    static Lut bake(int size, Colour f) {
        float[] data = new float[size * size * size * 3];
        float[] c = new float[3];
        for (int b = 0; b < size; b++) {
            for (int g = 0; g < size; g++) {
                for (int r = 0; r < size; r++) {
                    c[0] = r / (float) (size - 1);
                    c[1] = g / (float) (size - 1);
                    c[2] = b / (float) (size - 1);
                    f.map(c);
                    int i = 3 * (r + g * size + b * size * size);
                    data[i] = c[0];
                    data[i + 1] = c[1];
                    data[i + 2] = c[2];
                }
            }
        }
        return new Lut(size, data);
    }

    /** Largest size the strip may be: 64 × 64 = 4096 texels wide, what every phone GPU takes. */
    static final int MAX = 64;

    static Lut parse(String text) {
        int size = 0;
        float[] min = {0, 0, 0}, max = {1, 1, 1};
        float[] data = null;
        int n = 0;
        for (String raw : text.split("\r?\n")) {
            String line = raw.trim();
            if (line.isEmpty() || line.startsWith("#")) continue;
            String[] f = line.split("\\s+");
            String key = f[0].toUpperCase(Locale.ROOT);
            if (key.equals("LUT_3D_SIZE")) {
                size = Integer.parseInt(f[1]);
                if (size < 2 || size > MAX) throw new IllegalArgumentException("This look's table is " + size + " points; Rhema Camera takes 2 to " + MAX + ".");
                data = new float[size * size * size * 3];
            } else if (key.equals("LUT_1D_SIZE")) {
                throw new IllegalArgumentException("This is a 1D look; Rhema Camera takes 3D .cube looks.");
            } else if (key.equals("DOMAIN_MIN") && f.length >= 4) {
                for (int i = 0; i < 3; i++) min[i] = Float.parseFloat(f[i + 1]);
            } else if (key.equals("DOMAIN_MAX") && f.length >= 4) {
                for (int i = 0; i < 3; i++) max[i] = Float.parseFloat(f[i + 1]);
            } else if (Character.isDigit(key.charAt(0)) || key.charAt(0) == '-' || key.charAt(0) == '.') {
                if (data == null) throw new IllegalArgumentException("The look has numbers before its LUT_3D_SIZE.");
                if (f.length < 3 || n + 3 > data.length) throw new IllegalArgumentException("The look has more rows than its size says.");
                for (int i = 0; i < 3; i++) data[n++] = (Float.parseFloat(f[i]) - min[i]) / (max[i] - min[i]);
            }
        }
        if (data == null || n != data.length) throw new IllegalArgumentException("The look's table is incomplete.");
        return new Lut(size, data);
    }

    /** The strip texture's pixels (RGBA, 8 bits each), (size × size) wide and size high. */
    byte[] strip() {
        int w = size * size;
        byte[] px = new byte[w * size * 4];
        for (int b = 0; b < size; b++) {
            for (int g = 0; g < size; g++) {
                for (int r = 0; r < size; r++) {
                    int src = 3 * (r + g * size + b * size * size);
                    int dst = 4 * ((r + b * size) + g * w);
                    for (int i = 0; i < 3; i++) px[dst + i] = (byte) Math.round(Looks.clamp(data[src + i]) * 255f);
                    px[dst + 3] = (byte) 255;
                }
            }
        }
        return px;
    }

    /** The table's colour for (r, g, b), trilinear, as the shader samples it (for the tests and previews). */
    void apply(float[] c) {
        float fr = Looks.clamp(c[0]) * (size - 1), fg = Looks.clamp(c[1]) * (size - 1), fb = Looks.clamp(c[2]) * (size - 1);
        int r0 = (int) Math.floor(fr), g0 = (int) Math.floor(fg), b0 = (int) Math.floor(fb);
        int r1 = Math.min(r0 + 1, size - 1), g1 = Math.min(g0 + 1, size - 1), b1 = Math.min(b0 + 1, size - 1);
        float dr = fr - r0, dg = fg - g0, db = fb - b0;
        float[] out = new float[3];
        for (int i = 0; i < 3; i++) {
            float c00 = lerp(at(r0, g0, b0, i), at(r1, g0, b0, i), dr), c10 = lerp(at(r0, g1, b0, i), at(r1, g1, b0, i), dr);
            float c01 = lerp(at(r0, g0, b1, i), at(r1, g0, b1, i), dr), c11 = lerp(at(r0, g1, b1, i), at(r1, g1, b1, i), dr);
            out[i] = lerp(lerp(c00, c10, dg), lerp(c01, c11, dg), db);
        }
        System.arraycopy(out, 0, c, 0, 3);
    }

    private float at(int r, int g, int b, int ch) {
        return data[3 * (r + g * size + b * size * size) + ch];
    }

    private static float lerp(float a, float b, float t) {
        return a + (b - a) * t;
    }
}
