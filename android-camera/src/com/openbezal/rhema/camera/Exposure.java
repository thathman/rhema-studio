package com.openbezal.rhema.camera;

/**
 * The film shutter's light meter: the shutter stays at its film angle (about 180 degrees) and the
 * ISO follows the light, slowly, from a tiny copy of the picture. Centre-weighted, aiming for an
 * average of mid-grey (18 %) moved by the look's bias, and holding back when highlights clip.
 * Plain Java (no Android), so build.sh can test it.
 */
final class Exposure {
    private Exposure() { }

    static double linear(double srgb) {
        return srgb <= 0.04045 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
    }

    /** How much brighter the picture should be (2 = one stop more), from ARGB pixels. */
    static double ratio(int[] px, int w, int h, float ev) {
        double sum = 0, weights = 0;
        int clipped = 0;
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int c = px[x + y * w];
                double l = (0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)) / 255.0;
                if (l > 0.97) clipped++;
                double dx = (x + 0.5) / w - 0.5, dy = (y + 0.5) / h - 0.5;
                double weight = 1.0 + 2.0 * Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 2.5);
                sum += linear(l) * weight;
                weights += weight;
            }
        }
        double mean = Math.max(1e-4, sum / Math.max(1, weights));
        double r = 0.18 * Math.pow(2, ev) / mean;
        if (clipped > 0.03 * w * h) r = Math.min(r, 0.92);
        return r;
    }

    /** The next ISO: a third of the way there each time, at most a quarter more or less, nothing for small changes. */
    static int nextIso(int iso, double ratio, int[] range) {
        if (Math.abs(Math.log(ratio)) < Math.log(1.08)) return iso;
        double step = Math.max(0.8, Math.min(1.25, Math.pow(ratio, 0.35)));
        long next = Math.round(iso * step);
        next = Math.max(range[0], Math.min(range[1], next));
        if (next == iso && ratio > 1 && iso < range[1]) next = iso + 1;
        if (next == iso && ratio < 1 && iso > range[0]) next = iso - 1;
        return (int) next;
    }
}
