package com.openbezal.rhema.camera;

/**
 * The picture's "look": the colour grade the GPU applies to every frame before the encoder (and
 * the same on the viewfinder, so what you see is what is sent). The colour part is baked from this
 * code into a small 3D table that the shader looks up (cheap enough for any phone's GPU at
 * 4K); the vignette, film grain and letterbox depend on where the pixel is, so the shader does
 * those itself (Gpu.java mirrors vignette() below). Plain Java, so build.sh tests it and Settings
 * shows each look as a small preview with the same maths.
 *
 * Order per pixel (sRGB values 0..1): white-balance fine-tune, filmic tone curve (S-curve, soft
 * highlight roll-off, lifted blacks), saturation and skin-safe vibrance, split toning (teal
 * shadows, warm highlights, skin-safe), black-and-white mix; then vignette (and, GPU only, grain).
 */
final class Looks {
    private Looks() { }

    static final class Params {
        /** S-curve strength 0..1. */
        float contrast;
        /** Highlight roll-off 0..1. */
        float shoulder;
        /** Black lift 0..0.1. */
        float lift;
        float saturation = 1f;
        /** Extra saturation for muted colours, 0..1 (skin protected). */
        float vibrance;
        /** Teal in the shadows, 0..1. */
        float shadowTeal;
        /** Warmth in the highlights, 0..1. */
        float highlightWarm;
        /** Darker corners, 0..1. */
        float vignette;
        /** White-balance fine-tune: warmer (+) or cooler (−), −1..1. */
        float warmth;
        /** Magenta (+) or green (−), −1..1. */
        float tint;
        /** 1 = black and white. */
        float mono;
        /** Exposure bias the camera is asked for (EV), e.g. −0.3 to keep highlights. */
        float evBias;

        Params copy() {
            Params p = new Params();
            p.contrast = contrast;
            p.shoulder = shoulder;
            p.lift = lift;
            p.saturation = saturation;
            p.vibrance = vibrance;
            p.shadowTeal = shadowTeal;
            p.highlightWarm = highlightWarm;
            p.vignette = vignette;
            p.warmth = warmth;
            p.tint = tint;
            p.mono = mono;
            p.evBias = evBias;
            return p;
        }
    }

    static final String[] IDS = {"studio", "cinematic", "warm", "natural", "mono", "off"};
    static final String[] NAMES = {"Studio", "Cinematic", "Warm Sanctuary", "Natural", "Black & White", "Off"};
    static final String[] ABOUT = {
        "Clean broadcast picture: neutral colour, gentle contrast, true skin.",
        "Film-like: soft highlights, lifted blacks, teal shadows and warm highlights.",
        "Warm and soft, flattering under church lighting.",
        "A light touch: a little contrast, nothing more.",
        "Filmic black and white.",
        "The camera's own picture, untouched.",
    };

    static String name(String id) {
        for (int i = 0; i < IDS.length; i++) if (IDS[i].equals(id)) return NAMES[i];
        return id.equals("cube") ? "Your .cube look" : id;
    }

    /** A built-in look at full strength. */
    static Params look(String id) {
        Params p = new Params();
        if ("studio".equals(id)) {
            p.contrast = 0.15f;
            p.shoulder = 0.25f;
            p.lift = 0.01f;
            p.vibrance = 0.10f;
        } else if ("cinematic".equals(id)) {
            p.contrast = 0.35f;
            p.shoulder = 0.5f;
            p.lift = 0.035f;
            p.saturation = 0.92f;
            p.vibrance = 0.12f;
            p.shadowTeal = 0.55f;
            p.highlightWarm = 0.45f;
            p.vignette = 0.3f;
            p.evBias = -0.3f;
        } else if ("warm".equals(id)) {
            p.contrast = 0.10f;
            p.shoulder = 0.4f;
            p.lift = 0.03f;
            p.saturation = 0.97f;
            p.vibrance = 0.10f;
            p.highlightWarm = 0.35f;
            p.vignette = 0.15f;
            p.warmth = 0.35f;
            p.evBias = -0.15f;
        } else if ("natural".equals(id)) {
            p.contrast = 0.08f;
            p.shoulder = 0.15f;
            p.vibrance = 0.05f;
        } else if ("mono".equals(id)) {
            p.contrast = 0.3f;
            p.shoulder = 0.35f;
            p.lift = 0.03f;
            p.vignette = 0.2f;
            p.mono = 1f;
            p.evBias = -0.15f;
        }
        return p;
    }

    /** A look at a strength (0..1; 0 is the untouched picture), with the person's own warmth and tint on top. */
    static Params at(String id, float strength, float warmth, float tint) {
        Params full = look(id), p = new Params();
        float s = Math.max(0f, Math.min(1f, strength));
        p.contrast = full.contrast * s;
        p.shoulder = full.shoulder * s;
        p.lift = full.lift * s;
        p.saturation = 1f + (full.saturation - 1f) * s;
        p.vibrance = full.vibrance * s;
        p.shadowTeal = full.shadowTeal * s;
        p.highlightWarm = full.highlightWarm * s;
        p.vignette = full.vignette * s;
        p.warmth = full.warmth * s + warmth;
        p.tint = full.tint * s + tint;
        p.mono = full.mono * s;
        p.evBias = full.evBias * s;
        return p;
    }

    static final float LR = 0.2126f, LG = 0.7152f, LB = 0.0722f;

    /** The tone curve for one channel: S-curve, then highlight roll-off, then black lift. Always rising. */
    static float curve(Params p, float x) {
        x = clamp(x);
        float y = x + p.contrast * (x * x * (3f - 2f * x) - x);
        float t = 0.6f;
        if (y > t) y = t + (y - t) * (1f - p.shoulder * (y - t) / (2f * (1f - t)));
        return p.lift + (1f - p.lift) * y;
    }

    /** How much a colour looks like skin (0..1): red-led, hue about 0–50 degrees, not grey, not black. */
    static float skin(float r, float g, float b) {
        float mx = Math.max(r, Math.max(g, b)), mn = Math.min(r, Math.min(g, b)), ch = mx - mn;
        if (ch < 1e-4f || r < mx - 1e-5f) return 0f;
        float hue = 60f * (g - b) / ch;
        float near = clamp(1f - Math.abs(hue - 25f) / 30f);
        return near * smoothstep(0.06f, 0.2f, ch) * smoothstep(0.12f, 0.35f, mx);
    }

    /** One pixel, in place: rgb at (u, v) across the picture (0..1). */
    static void apply(Params p, float[] c, float u, float v) {
        colour(p, c);
        float vig = vignette(p, u, v);
        c[0] *= vig;
        c[1] *= vig;
        c[2] *= vig;
    }

    /** The vignette's darkening at (u, v): 1 in the middle (the shader has the same formula). */
    static float vignette(Params p, float u, float v) {
        float du = u - 0.5f, dv = v - 0.5f;
        float d = (float) Math.sqrt(du * du + dv * dv) * 1.4142f;
        return 1f - 0.5f * p.vignette * smoothstep(0.35f, 1.0f, d);
    }

    /** The colour part of a look (everything but the vignette), in place: what is baked into the table. */
    static void colour(Params p, float[] c) {
        // White-balance fine-tune.
        float r = c[0] * (1f + 0.12f * p.warmth + 0.03f * p.tint);
        float g = c[1] * (1f - 0.08f * p.tint);
        float b = c[2] * (1f - 0.12f * p.warmth + 0.03f * p.tint);
        // Tone.
        r = curve(p, r);
        g = curve(p, g);
        b = curve(p, b);
        float sk = skin(r, g, b);
        float l = LR * r + LG * g + LB * b;
        // Saturation, and vibrance that leaves skin mostly alone.
        float mx = Math.max(r, Math.max(g, b)), mn = Math.min(r, Math.min(g, b));
        float k = p.saturation * (1f + p.vibrance * (1f - clamp((mx - mn) * 2f)) * (1f - 0.7f * sk));
        r = l + (r - l) * k;
        g = l + (g - l) * k;
        b = l + (b - l) * k;
        // Split toning: zero-brightness colour offsets, kept off skin.
        float ws = (1f - l) * (1f - l), wh = l * l, keep = 0.12f * (1f - 0.75f * sk);
        float tr = -0.6f, tg = 0.15f, tb = 0.45f, tl = LR * tr + LG * tg + LB * tb;
        float hr = 0.6f, hg = 0.15f, hb = -0.75f, hl = LR * hr + LG * hg + LB * hb;
        r += keep * (ws * p.shadowTeal * (tr - tl) + wh * p.highlightWarm * (hr - hl));
        g += keep * (ws * p.shadowTeal * (tg - tl) + wh * p.highlightWarm * (hg - hl));
        b += keep * (ws * p.shadowTeal * (tb - tl) + wh * p.highlightWarm * (hb - hl));
        // Black and white (a film-like red-leaning mix).
        float m = 0.30f * r + 0.59f * g + 0.11f * b;
        r += (m - r) * p.mono;
        g += (m - g) * p.mono;
        b += (m - b) * p.mono;
        c[0] = clamp(r);
        c[1] = clamp(g);
        c[2] = clamp(b);
    }

    /** Points per side of the baked table: 17 (about 20 KB) stays in a small phone GPU's texture cache. */
    static final int SIZE = 17;

    /** The table the GPU uses: this look's colour (after a .cube look mixed in by cubeMix, if any). */
    static Lut bake(final Params p, final Lut cube, final float cubeMix) {
        return Lut.bake(SIZE, new Lut.Colour() {
            @Override
            public void map(float[] c) {
                if (cube != null && cubeMix > 0) {
                    float[] o = c.clone();
                    cube.apply(o);
                    for (int i = 0; i < 3; i++) c[i] += (o[i] - c[i]) * cubeMix;
                }
                colour(p, c);
            }
        });
    }

    static float clamp(float x) {
        return x < 0f ? 0f : x > 1f ? 1f : x;
    }

    static float smoothstep(float e0, float e1, float x) {
        float t = clamp((x - e0) / (e1 - e0));
        return t * t * (3f - 2f * t);
    }

    /** Hue in degrees (0..360) of an sRGB colour, for the tests. */
    static float hue(float r, float g, float b) {
        float mx = Math.max(r, Math.max(g, b)), mn = Math.min(r, Math.min(g, b)), ch = mx - mn;
        if (ch <= 0) return 0;
        float h;
        if (mx == r) h = 60f * (((g - b) / ch) % 6f);
        else if (mx == g) h = 60f * ((b - r) / ch + 2f);
        else h = 60f * ((r - g) / ch + 4f);
        return h < 0 ? h + 360f : h;
    }
}
