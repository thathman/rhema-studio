package com.openbezal.rhema.camera;

import android.content.Context;
import android.content.SharedPreferences;

/** The settings this app keeps (on this phone only; the pairing link holds the camera's password). */
final class Prefs {
    private Prefs() { }

    static final String PAIR = "pair_link";
    static final String AUTO_START = "auto_start";
    static final String PRESET = "preset";
    static final String HEIGHT = "height";
    static final String CODEC = "codec";
    static final String BITRATE = "bitrate_mbps";
    static final String CAMERA = "camera_id";
    static final String STAB_VIDEO = "stab_video";
    static final String STAB_OPTICAL = "stab_optical";
    static final String LOOK = "look";
    static final String STRENGTH = "look_strength";
    static final String WARMTH = "look_warmth";
    static final String TINT = "look_tint";
    static final String GRAIN = "look_grain";
    static final String BARS = "look_bars";
    static final String BURN = "look_bars_burn";
    /** A .cube look the person loaded (kept in the app's files as look.cube). */
    static final String CUBE_NAME = "look_cube_name";
    static final String WB = "wb_mode";
    static final String KELVIN = "wb_kelvin";
    static final String WB_LOCK = "wb_lock";
    static final String AE = "ae_mode";
    static final String EV = "ev";
    static final String AE_LOCK = "ae_lock";
    static final String ISO = "iso";
    static final String SHUTTER = "shutter_ns";
    static final String FLICKER = "flicker";
    static final String AF = "af_mode";
    static final String FOCUS = "focus_diopters";
    static final String ZOOM = "zoom";
    static final String GRID_THIRDS = "grid_thirds";
    static final String GRID_CENTRE = "grid_centre";
    static final String GRID_SAFE = "grid_safe";
    static final String LEVEL = "level";
    static final String HISTOGRAM = "histogram";
    static final String AUDIO = "audio";
    /** White-balance measurements per camera (see Kelvin.Anchor). */
    static final String ANCHORS = "wb_anchors_";

    /** Settings that change how the picture is made (the encoder and camera start again). */
    static boolean reshapes(String key) {
        return PRESET.equals(key) || HEIGHT.equals(key) || CODEC.equals(key) || CAMERA.equals(key) || AUDIO.equals(key);
    }

    /** Settings the camera takes while it runs. */
    static boolean controls(String key) {
        return key != null && (key.startsWith("wb_") || key.startsWith("ae_") || key.equals(EV) || key.equals(ISO) || key.equals(SHUTTER) || key.equals(FLICKER)
                || key.equals(AF) || key.equals(FOCUS) || key.equals(ZOOM) || key.equals(STAB_VIDEO) || key.equals(STAB_OPTICAL))
                && !key.startsWith(ANCHORS);
    }

    /** Settings of the look (the GPU's grade; the camera's exposure bias and sharpening follow). */
    static boolean grades(String key) {
        return key != null && key.startsWith("look");
    }

    static SharedPreferences get(Context c) {
        return c.getSharedPreferences("rhema-camera", Context.MODE_PRIVATE);
    }

    /** The pairing, or null when this phone is not paired (or the saved link no longer reads). */
    static Pairing pairing(Context c) {
        String link = get(c).getString(PAIR, null);
        if (link == null) return null;
        try {
            return Pairing.parse(link);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /** Mains frequency for anti-flicker and the flicker-free shutter: 50 or 60, 0 when off or auto. */
    static int mainsHz(SharedPreferences p) {
        String f = p.getString(FLICKER, "auto");
        return "60".equals(f) ? 60 : "50".equals(f) ? 50 : "off".equals(f) ? 0 : 50;
    }
}
