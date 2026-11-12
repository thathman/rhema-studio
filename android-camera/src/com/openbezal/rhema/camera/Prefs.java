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
    /** The viewfinder shows over the lock screen (on unless turned off). */
    static final String OVER_LOCK = "over_lock";
    /** It was sending when the app last ran (cleared by a stop the person made, or by Rhema removing the camera; #836). */
    static final String WAS_SENDING = "was_sending";
    /** Resume sending after the phone restarts or Android ends the app (on unless turned off; #836). */
    static final String RESUME = "resume_after_restart";
    /** The nonce in the current "Tap to send again" notification (#836); only that tap may start sending. */
    static final String RESUME_NONCE = "resume_nonce";
    /** Follow the quality Rhema Studio suggests for this camera (on unless turned off; #838). */
    static final String FOLLOW_HOST = "follow_host_quality";
    /** Rhema Studio's suggestion as it last said it (#838): height and Mbit/s (0: none) and in words. */
    static final String SUGGEST_HEIGHT = "host_suggest_height";
    static final String SUGGEST_MBPS = "host_suggest_mbps";
    static final String SUGGEST_WORDS = "host_suggest_words";
    /** What Rhema Studio calls this camera, as it last said (#850). */
    static final String HOST_NAME = "host_camera_name";
    /** White-balance measurements per camera (see Kelvin.Anchor). */
    static final String ANCHORS = "wb_anchors_";

    /** Settings that change how the picture is made (the encoder and camera start again). */
    static boolean reshapes(String key) {
        return PRESET.equals(key) || HEIGHT.equals(key) || CODEC.equals(key) || CAMERA.equals(key) || AUDIO.equals(key)
                || SUGGEST_HEIGHT.equals(key) || FOLLOW_HOST.equals(key);
    }

    /** Settings that change only the bitrate (the encoder takes it while it runs). */
    static boolean rates(String key) {
        return BITRATE.equals(key) || SUGGEST_MBPS.equals(key);
    }

    /** Send again after a restart (#836): as set, else Lifecycle.resumeDefault for this Android. */
    static boolean resumeOn(SharedPreferences p) {
        return p.getBoolean(RESUME, Lifecycle.resumeDefault(android.os.Build.VERSION.SDK_INT));
    }

    /** Rhema Studio's suggestion (#838) when this phone follows it: {height, Mbit/s}, 0 for none. */
    static int[] suggestion(SharedPreferences p) {
        if (!p.getBoolean(FOLLOW_HOST, true)) return new int[] {0, 0};
        return new int[] {p.getInt(SUGGEST_HEIGHT, 0), p.getInt(SUGGEST_MBPS, 0)};
    }

    /** What to call this camera: Rhema Studio's name for it when it has said one, else the pairing link's. */
    static String cameraTitle(Context c, Pairing p) {
        String host = get(c).getString(HOST_NAME, "");
        return host != null && !host.isEmpty() ? host : p == null ? "Camera" : p.title();
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
