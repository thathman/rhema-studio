package com.openbezal.rhema.camera;

/**
 * Keeps the GPU inside each frame's time on a slower phone. When the encoder's share of a frame
 * (the grade and its copy into the encoder) runs over budget for about a second, the picture gets
 * lighter step by step: first the viewfinder draws at most 15 times a second, then the film grain
 * goes, then the viewfinder draws at most 8 times a second. The encoder is never slowed down on
 * purpose; if it still cannot keep up, Settings says so. After half a minute of calm it steps back
 * one level. Plain Java (no Android), so build.sh can test it.
 */
final class Pace {
    static final int NORMAL = 0;
    static final int VIEW15 = 1;
    static final int NO_GRAIN = 2;
    static final int VIEW8 = 3;

    int level;
    /** The film grain is on in Settings (otherwise the grain step is skipped). */
    boolean grainOn;
    /** The last second was still over budget at the lightest level: the encoder cannot keep up. */
    boolean struggling;
    private long frameNs = 33_333_333L;
    private long windowStart = -1;
    private int windowFrames;
    private int overFrames;
    private long calmSince = -1;

    void reset(int fps) {
        frameNs = 1_000_000_000L / Math.max(1, fps);
        level = NORMAL;
        struggling = false;
        windowStart = -1;
        calmSince = -1;
    }

    /**
     * One camera frame at `now` (ns): how long the encoder's share took, and whether the camera frame
     * before it was skipped (the GPU had no time for it). True when the level changed.
     */
    boolean frame(long now, long passNs, boolean skipped) {
        if (windowStart < 0) windowStart = now;
        windowFrames++;
        boolean over = skipped || passNs > frameNs * 85 / 100;
        if (over) overFrames++;
        if (!over && passNs < frameNs * 6 / 10) {
            if (calmSince < 0) calmSince = now;
        } else {
            calmSince = -1;
        }
        boolean changed = false;
        if (now - windowStart >= 1_000_000_000L) {
            boolean busy = overFrames * 2 > windowFrames;
            struggling = busy && level == VIEW8;
            if (busy && level < VIEW8) {
                level = next(level, +1);
                changed = true;
            }
            windowStart = now;
            windowFrames = 0;
            overFrames = 0;
        }
        if (!changed && level > NORMAL && calmSince >= 0 && now - calmSince >= 30_000_000_000L) {
            level = next(level, -1);
            calmSince = now;
            changed = true;
        }
        return changed;
    }

    private int next(int l, int step) {
        int n = l + step;
        if (n == NO_GRAIN && !grainOn) n += step;
        return Math.max(NORMAL, Math.min(VIEW8, n));
    }

    /** The viewfinder's frame time at this level, from its usual rate. */
    long viewEveryNs(int baseFps) {
        int fps = level >= VIEW8 ? Math.min(baseFps, 8) : level >= VIEW15 ? Math.min(baseFps, 15) : baseFps;
        return 1_000_000_000L / Math.max(1, fps) - 3_000_000L;
    }

    boolean grainAllowed() {
        return level < NO_GRAIN;
    }

    /** What Settings → Picture says, or "" at the normal level. */
    String note(float encoderFps, int targetFps) {
        String s;
        switch (level) {
            case VIEW15: s = "Lighter look on this phone: the viewfinder draws 15 times a second so the picture sent keeps every frame."; break;
            case NO_GRAIN: s = "Lighter look on this phone: the viewfinder draws 15 times a second and the film grain is off."; break;
            case VIEW8: s = "Lighter look on this phone: the viewfinder draws 8 times a second" + (grainOn ? " and the film grain is off." : "."); break;
            default: s = "";
        }
        if (struggling) s += " This phone sends " + Math.round(encoderFps) + " of " + targetFps + " frames a second at this size: choose a smaller size or frame rate.";
        return s;
    }
}
