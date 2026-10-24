package com.openbezal.rhema.camera;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Rect;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CameraMetadata;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.TotalCaptureResult;
import android.hardware.camera2.params.ColorSpaceTransform;
import android.hardware.camera2.params.MeteringRectangle;
import android.hardware.camera2.params.RggbChannelVector;
import android.os.Build;
import android.os.Handler;
import android.util.Range;
import android.util.Rational;
import android.view.Surface;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * The camera itself (Camera2): opens the chosen lens, runs one capture session into the GPU's
 * texture (Gpu grades it and feeds the encoder and viewfinder), and turns the settings into the
 * camera's controls (white balance, exposure, focus, zoom, stabilisation, sharpening and noise
 * reduction). All calls run on the camera thread.
 */
final class Rig {
    interface Listener {
        void onCameraError(String message);

        /** A short note for the person (e.g. while white balance is being measured). */
        void onNote(String note);
    }

    private final CameraManager manager;
    private final Handler handler;
    private final Listener listener;
    private final SharedPreferences prefs;

    String id;
    CameraCharacteristics chars;
    private CameraDevice device;
    private CameraCaptureSession session;
    private Surface target;
    private int fps = 30;
    /** The look's exposure bias (EV), e.g. −0.3 for Cinematic to keep highlights. */
    volatile float evBias;
    /** Whether a look is on (the camera's own sharpening is then turned down). */
    volatile boolean graded = true;
    /** The film shutter's ISO, set by the service's light meter. */
    volatile int filmIso;
    /**
     * The film shutter starts by letting the camera measure the light itself for a moment (auto
     * exposure and white balance), then holds that white balance and works out the ISO for the film
     * shutter: some phones stop their automatic white balance while exposure is manual.
     * 0: not in film mode; 1: measuring; 2: running.
     */
    volatile int filmPhase;
    private int filmFrames;
    private RggbChannelVector filmGains;
    private ColorSpaceTransform filmTransform;
    private String lastAe;
    private int generation;

    /** Where the last tap asked the camera to focus and meter; null when following the scene. */
    private MeteringRectangle[] tapRegion;
    volatile boolean focusHeld;
    private float zoom = 1f;

    /** White balance in kelvin is worked out from two presets the camera measures itself. */
    private int calPhase;
    private int calFrames;
    private Kelvin.Anchor calDay;

    // The camera's own last values (Settings shows them; manual exposure starts from them).
    volatile int lastIso;
    volatile long lastExposureNs;
    volatile float lastFocus;

    Rig(Context ctx, Handler handler, Listener listener) {
        this.manager = (CameraManager) ctx.getSystemService(Context.CAMERA_SERVICE);
        this.handler = handler;
        this.listener = listener;
        this.prefs = Prefs.get(ctx);
    }

    boolean isOpen() {
        return device != null;
    }

    /** Opens the camera (or keeps it if it is this one), then runs `then`. */
    void open(final String cameraId, final Runnable then) {
        if (device != null && cameraId.equals(id)) {
            then.run();
            return;
        }
        close();
        id = cameraId;
        chars = Caps.chars(manager, cameraId);
        zoom = prefs.getFloat(Prefs.ZOOM, 1f);
        final int gen = ++generation;
        try {
            manager.openCamera(cameraId, new CameraDevice.StateCallback() {
                @Override
                public void onOpened(CameraDevice d) {
                    if (gen != generation) {
                        d.close();
                        return;
                    }
                    device = d;
                    then.run();
                }

                @Override
                public void onDisconnected(CameraDevice d) {
                    d.close();
                    if (device == d) {
                        device = null;
                        session = null;
                        listener.onCameraError("Another app took the camera. Close it, then come back to Rhema Camera.");
                    }
                }

                @Override
                public void onError(CameraDevice d, int error) {
                    d.close();
                    if (device == d || device == null) {
                        device = null;
                        session = null;
                        listener.onCameraError(error == ERROR_CAMERA_IN_USE || error == ERROR_MAX_CAMERAS_IN_USE
                                ? "The camera is in use by another app." : error == ERROR_CAMERA_DISABLED ? "This phone's camera is turned off by a policy." : "The camera stopped (error " + error + "). Trying again may help.");
                    }
                }
            }, handler);
        } catch (CameraAccessException | SecurityException | IllegalArgumentException e) {
            listener.onCameraError("The camera could not open: " + e.getMessage());
        }
    }

    void close() {
        generation++;
        if (session != null) {
            try {
                session.close();
            } catch (RuntimeException ignored) {
                // Closed already.
            }
            session = null;
        }
        if (device != null) {
            device.close();
            device = null;
        }
        target = null;
    }

    /** Stops the session (before its encoder surface goes away). */
    void stopSession() {
        if (session != null) {
            try {
                session.stopRepeating();
                session.abortCaptures();
            } catch (CameraAccessException | RuntimeException ignored) {
                // Closing anyway.
            }
            session.close();
            session = null;
        }
    }

    /** A new session into the GPU's texture at this frame rate (null: none); `done` once it runs. */
    void configure(Surface gpuSurface, int frameRate, final Runnable done) {
        stopSession();
        lastAe = null;
        target = gpuSurface;
        fps = frameRate;
        List<Surface> targets = new ArrayList<Surface>();
        if (target != null) targets.add(target);
        if (device == null || targets.isEmpty()) {
            if (done != null) done.run();
            return;
        }
        final CameraDevice d = device;
        try {
            d.createCaptureSession(targets, new CameraCaptureSession.StateCallback() {
                @Override
                public void onConfigured(CameraCaptureSession s) {
                    if (device != d) {
                        s.close();
                        return;
                    }
                    session = s;
                    update();
                    if (done != null) done.run();
                }

                @Override
                public void onConfigureFailed(CameraCaptureSession s) {
                    listener.onCameraError("The camera could not start at this size and frame rate. Choose another in Settings → Picture.");
                    if (done != null) done.run();
                }
            }, handler);
        } catch (CameraAccessException | IllegalArgumentException | IllegalStateException e) {
            listener.onCameraError("The camera could not start: " + e.getMessage());
            if (done != null) done.run();
        }
    }

    private CaptureRequest.Builder builder() throws CameraAccessException {
        CaptureRequest.Builder b = device.createCaptureRequest(CameraDevice.TEMPLATE_RECORD);
        b.addTarget(target);
        apply(b);
        return b;
    }

    /** The settings as they are now, into the running session. */
    void update() {
        if (session == null || device == null) return;
        try {
            session.setRepeatingRequest(builder().build(), results, handler);
        } catch (CameraAccessException | IllegalStateException | IllegalArgumentException e) {
            listener.onCameraError("The camera did not take the setting: " + e.getMessage());
        }
    }

    private void apply(CaptureRequest.Builder b) {
        CameraCharacteristics c = chars;
        b.set(CaptureRequest.CONTROL_MODE, CameraMetadata.CONTROL_MODE_AUTO);
        b.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, new Range<Integer>(fps, fps));

        // Exposure.
        String ae = aeMode();
        if (!ae.equals(lastAe)) {
            lastAe = ae;
            filmPhase = "film".equals(ae) ? 1 : 0;
            filmFrames = 0;
        }
        if ("film".equals(ae) && filmPhase == 1) ae = "auto";
        if (!"auto".equals(ae)) {
            b.set(CaptureRequest.CONTROL_AE_MODE, CameraMetadata.CONTROL_AE_MODE_OFF);
            b.set(CaptureRequest.SENSOR_SENSITIVITY, "film".equals(ae) && filmIso > 0 ? clampIso(filmIso) : iso());
            b.set(CaptureRequest.SENSOR_EXPOSURE_TIME, shutterNs());
            b.set(CaptureRequest.SENSOR_FRAME_DURATION, 1_000_000_000L / fps);
        } else {
            b.set(CaptureRequest.CONTROL_AE_MODE, CameraMetadata.CONTROL_AE_MODE_ON);
            Range<Integer> ev = c.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_RANGE);
            Rational step = c.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_STEP);
            int bias = step == null || step.floatValue() <= 0 ? 0 : Math.round(evBias / step.floatValue());
            int steps = prefs.getInt(Prefs.EV, 0) + bias;
            if (ev != null) b.set(CaptureRequest.CONTROL_AE_EXPOSURE_COMPENSATION, Math.max(ev.getLower(), Math.min(ev.getUpper(), steps)));
            b.set(CaptureRequest.CONTROL_AE_LOCK, prefs.getBoolean(Prefs.AE_LOCK, false));
            b.set(CaptureRequest.CONTROL_AE_ANTIBANDING_MODE, antibanding(c));
            if (tapRegion != null && maxRegions(c, CameraCharacteristics.CONTROL_MAX_REGIONS_AE) > 0) b.set(CaptureRequest.CONTROL_AE_REGIONS, tapRegion);
        }

        whiteBalance(b, c);
        // The film shutter holds the white balance it measured (where the camera lets apps set colour).
        if ("film".equals(aeMode()) && filmPhase == 2 && filmGains != null && "auto".equals(prefs.getString(Prefs.WB, "auto")) && Caps.manualPost(c)) {
            b.set(CaptureRequest.CONTROL_AWB_MODE, CameraMetadata.CONTROL_AWB_MODE_OFF);
            b.set(CaptureRequest.COLOR_CORRECTION_MODE, CameraMetadata.COLOR_CORRECTION_MODE_TRANSFORM_MATRIX);
            b.set(CaptureRequest.COLOR_CORRECTION_GAINS, filmGains);
            b.set(CaptureRequest.COLOR_CORRECTION_TRANSFORM, filmTransform);
        }

        // Focus.
        boolean manualFocus = "manual".equals(prefs.getString(Prefs.AF, "continuous")) && Caps.manualFocus(c);
        int[] afModes = c.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES);
        if (manualFocus) {
            b.set(CaptureRequest.CONTROL_AF_MODE, CameraMetadata.CONTROL_AF_MODE_OFF);
            Float min = c.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE);
            b.set(CaptureRequest.LENS_FOCUS_DISTANCE, Math.max(0f, Math.min(min == null ? 0f : min, prefs.getFloat(Prefs.FOCUS, 0f))));
        } else if (focusHeld && Caps.contains(afModes, CameraMetadata.CONTROL_AF_MODE_AUTO)) {
            b.set(CaptureRequest.CONTROL_AF_MODE, CameraMetadata.CONTROL_AF_MODE_AUTO);
            if (tapRegion != null && maxRegions(c, CameraCharacteristics.CONTROL_MAX_REGIONS_AF) > 0) b.set(CaptureRequest.CONTROL_AF_REGIONS, tapRegion);
        } else if (Caps.contains(afModes, CameraMetadata.CONTROL_AF_MODE_CONTINUOUS_VIDEO)) {
            b.set(CaptureRequest.CONTROL_AF_MODE, CameraMetadata.CONTROL_AF_MODE_CONTINUOUS_VIDEO);
        }

        zoomInto(b, c);

        // Stabilisation: off by default (a tripod needs none, and electronic stabilisation crops).
        if (Caps.videoStabilisation(c)) {
            b.set(CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE, prefs.getBoolean(Prefs.STAB_VIDEO, false)
                    ? CameraMetadata.CONTROL_VIDEO_STABILIZATION_MODE_ON : CameraMetadata.CONTROL_VIDEO_STABILIZATION_MODE_OFF);
        }
        if (Caps.opticalStabilisation(c)) {
            b.set(CaptureRequest.LENS_OPTICAL_STABILIZATION_MODE, prefs.getBoolean(Prefs.STAB_OPTICAL, false)
                    ? CameraMetadata.LENS_OPTICAL_STABILIZATION_MODE_ON : CameraMetadata.LENS_OPTICAL_STABILIZATION_MODE_OFF);
        }

        // Less "phone": the look does the finishing, so the camera's own sharpening is turned down,
        // and noise reduction is the best the camera does at this frame rate.
        int[] edges = c.get(CameraCharacteristics.EDGE_AVAILABLE_EDGE_MODES);
        if (graded && Caps.contains(edges, CameraMetadata.EDGE_MODE_OFF)) b.set(CaptureRequest.EDGE_MODE, CameraMetadata.EDGE_MODE_OFF);
        else if (Caps.contains(edges, CameraMetadata.EDGE_MODE_FAST)) b.set(CaptureRequest.EDGE_MODE, CameraMetadata.EDGE_MODE_FAST);
        int[] nr = c.get(CameraCharacteristics.NOISE_REDUCTION_AVAILABLE_NOISE_REDUCTION_MODES);
        if (fps <= 30 && Caps.contains(nr, CameraMetadata.NOISE_REDUCTION_MODE_HIGH_QUALITY)) b.set(CaptureRequest.NOISE_REDUCTION_MODE, CameraMetadata.NOISE_REDUCTION_MODE_HIGH_QUALITY);
        else if (Caps.contains(nr, CameraMetadata.NOISE_REDUCTION_MODE_FAST)) b.set(CaptureRequest.NOISE_REDUCTION_MODE, CameraMetadata.NOISE_REDUCTION_MODE_FAST);
    }

    private static int maxRegions(CameraCharacteristics c, CameraCharacteristics.Key<Integer> key) {
        Integer n = c.get(key);
        return n == null ? 0 : n;
    }

    private int antibanding(CameraCharacteristics c) {
        int[] modes = c.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_ANTIBANDING_MODES);
        String f = prefs.getString(Prefs.FLICKER, "auto");
        int want = "60".equals(f) ? CameraMetadata.CONTROL_AE_ANTIBANDING_MODE_60HZ : "50".equals(f) ? CameraMetadata.CONTROL_AE_ANTIBANDING_MODE_50HZ
                : "off".equals(f) ? CameraMetadata.CONTROL_AE_ANTIBANDING_MODE_OFF : CameraMetadata.CONTROL_AE_ANTIBANDING_MODE_AUTO;
        if (Caps.contains(modes, want)) return want;
        // No automatic mode: Nigeria's mains is 50 Hz.
        return Caps.contains(modes, CameraMetadata.CONTROL_AE_ANTIBANDING_MODE_50HZ) ? CameraMetadata.CONTROL_AE_ANTIBANDING_MODE_50HZ : CameraMetadata.CONTROL_AE_ANTIBANDING_MODE_OFF;
    }

    /**
     * "auto", "film" (a fixed film shutter, ISO following the light) or "manual"; the film shutter is
     * the default where the camera allows manual exposure.
     */
    String aeMode() {
        if (!Caps.manualSensor(chars)) return "auto";
        return prefs.getString(Prefs.AE, "film");
    }

    /** The manual ISO: the saved one, else what auto exposure used last, within the sensor's range. */
    int iso() {
        int v = prefs.getInt(Prefs.ISO, 0);
        if (v <= 0) v = lastIso > 0 ? lastIso : 100;
        return clampIso(v);
    }

    int clampIso(int v) {
        Range<Integer> r = chars == null ? null : chars.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE);
        return r == null ? v : Math.max(r.getLower(), Math.min(r.getUpper(), v));
    }

    /** Measure the light again (the film shutter's white balance and starting ISO). */
    void remeasure() {
        if (!"film".equals(aeMode())) return;
        filmPhase = 1;
        filmFrames = 0;
        update();
    }

    int[] isoRange() {
        Range<Integer> r = chars == null ? null : chars.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE);
        return r == null ? new int[] {100, 800} : new int[] {r.getLower(), r.getUpper()};
    }

    /** The manual shutter: the saved one, else near 180 degrees without flicker; never longer than a frame. */
    long shutterNs() {
        long v = prefs.getLong(Prefs.SHUTTER, 0);
        if (v <= 0) v = Plan.shutterNs(fps, Prefs.mainsHz(prefs));
        Range<Long> r = chars == null ? null : chars.get(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE);
        if (r != null) v = Math.max(r.getLower(), Math.min(r.getUpper(), v));
        return Math.min(v, 1_000_000_000L / fps);
    }

    int frameRate() {
        return fps;
    }

    private void whiteBalance(CaptureRequest.Builder b, CameraCharacteristics c) {
        String mode = prefs.getString(Prefs.WB, "auto");
        boolean lock = prefs.getBoolean(Prefs.WB_LOCK, false);
        int[] modes = c.get(CameraCharacteristics.CONTROL_AWB_AVAILABLE_MODES);
        if ("kelvin".equals(mode)) {
            int k = prefs.getInt(Prefs.KELVIN, 5600);
            Kelvin.Anchor[] anchors = anchors();
            if (anchors != null && Caps.manualPost(c)) {
                b.set(CaptureRequest.CONTROL_AWB_MODE, CameraMetadata.CONTROL_AWB_MODE_OFF);
                b.set(CaptureRequest.COLOR_CORRECTION_MODE, CameraMetadata.COLOR_CORRECTION_MODE_TRANSFORM_MATRIX);
                float[] g = Kelvin.gains(anchors[0], anchors[1], k);
                b.set(CaptureRequest.COLOR_CORRECTION_GAINS, new RggbChannelVector(g[0], g[1], g[2], g[3]));
                b.set(CaptureRequest.COLOR_CORRECTION_TRANSFORM, transform(Kelvin.matrix(anchors[0], anchors[1], k)));
                return;
            }
            if (Caps.manualPost(c) && Caps.contains(modes, CameraMetadata.CONTROL_AWB_MODE_DAYLIGHT) && Caps.contains(modes, CameraMetadata.CONTROL_AWB_MODE_INCANDESCENT)) {
                if (calPhase == 0) {
                    calPhase = 1;
                    calFrames = 0;
                    listener.onNote("Measuring this camera's colours for kelvin white balance (about a second)…");
                }
                b.set(CaptureRequest.CONTROL_AWB_MODE, calPhase == 1 ? CameraMetadata.CONTROL_AWB_MODE_DAYLIGHT : CameraMetadata.CONTROL_AWB_MODE_INCANDESCENT);
                return;
            }
            // Without manual colour: the nearest preset.
            mode = k <= 3500 ? "tungsten" : k <= 4600 ? "fluorescent" : k <= 6200 ? "daylight" : "cloudy";
        }
        int awb = "daylight".equals(mode) ? CameraMetadata.CONTROL_AWB_MODE_DAYLIGHT : "cloudy".equals(mode) ? CameraMetadata.CONTROL_AWB_MODE_CLOUDY_DAYLIGHT
                : "tungsten".equals(mode) ? CameraMetadata.CONTROL_AWB_MODE_INCANDESCENT : "fluorescent".equals(mode) ? CameraMetadata.CONTROL_AWB_MODE_FLUORESCENT : CameraMetadata.CONTROL_AWB_MODE_AUTO;
        b.set(CaptureRequest.CONTROL_AWB_MODE, Caps.contains(modes, awb) ? awb : CameraMetadata.CONTROL_AWB_MODE_AUTO);
        if (awb == CameraMetadata.CONTROL_AWB_MODE_AUTO) b.set(CaptureRequest.CONTROL_AWB_LOCK, lock);
    }

    private static ColorSpaceTransform transform(float[] m) {
        Rational[] r = new Rational[9];
        for (int i = 0; i < 9; i++) r[i] = new Rational(Math.round(m[i] * 10000), 10000);
        return new ColorSpaceTransform(r);
    }

    private static Kelvin.Anchor anchor(TotalCaptureResult r, int kelvin) {
        RggbChannelVector g = r.get(android.hardware.camera2.CaptureResult.COLOR_CORRECTION_GAINS);
        ColorSpaceTransform t = r.get(android.hardware.camera2.CaptureResult.COLOR_CORRECTION_TRANSFORM);
        if (g == null || t == null) return null;
        float[] m = new float[9];
        for (int row = 0; row < 3; row++) for (int col = 0; col < 3; col++) m[row * 3 + col] = t.getElement(col, row).floatValue();
        return new Kelvin.Anchor(kelvin, new float[] {g.getRed(), g.getGreenEven(), g.getGreenOdd(), g.getBlue()}, m);
    }

    /** The two measured presets for this camera, or null before they are measured. */
    private Kelvin.Anchor[] anchors() {
        String s = prefs.getString(Prefs.ANCHORS + id, null);
        if (s == null) return null;
        try {
            String[] parts = s.split("\\|");
            return new Kelvin.Anchor[] {readAnchor(parts[0]), readAnchor(parts[1])};
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static String writeAnchor(Kelvin.Anchor a) {
        StringBuilder sb = new StringBuilder().append(a.kelvin).append(';');
        for (float g : a.gains) sb.append(g).append(',');
        sb.append(';');
        for (float m : a.matrix) sb.append(m).append(',');
        return sb.toString();
    }

    private static Kelvin.Anchor readAnchor(String s) {
        String[] p = s.split(";");
        String[] g = p[1].split(","), m = p[2].split(",");
        float[] gains = new float[4], matrix = new float[9];
        for (int i = 0; i < 4; i++) gains[i] = Float.parseFloat(g[i]);
        for (int i = 0; i < 9; i++) matrix[i] = Float.parseFloat(m[i]);
        return new Kelvin.Anchor(Integer.parseInt(p[0]), gains, matrix);
    }

    private final CameraCaptureSession.CaptureCallback results = new CameraCaptureSession.CaptureCallback() {
        @Override
        public void onCaptureCompleted(CameraCaptureSession s, CaptureRequest request, TotalCaptureResult r) {
            Integer iso = r.get(android.hardware.camera2.CaptureResult.SENSOR_SENSITIVITY);
            Long exp = r.get(android.hardware.camera2.CaptureResult.SENSOR_EXPOSURE_TIME);
            Float focus = r.get(android.hardware.camera2.CaptureResult.LENS_FOCUS_DISTANCE);
            Integer ae = r.get(android.hardware.camera2.CaptureResult.CONTROL_AE_MODE);
            if (ae != null && ae != CameraMetadata.CONTROL_AE_MODE_OFF) {
                if (iso != null) lastIso = iso;
                if (exp != null) lastExposureNs = exp;
            } else if (lastIso == 0 && iso != null) {
                lastIso = iso;
                if (exp != null) lastExposureNs = exp;
            }
            if (focus != null) lastFocus = focus;
            if (filmPhase == 1 && ae != null && ae != CameraMetadata.CONTROL_AE_MODE_OFF && ++filmFrames >= Math.max(24, fps * 3 / 2)) {
                filmGains = r.get(android.hardware.camera2.CaptureResult.COLOR_CORRECTION_GAINS);
                filmTransform = r.get(android.hardware.camera2.CaptureResult.COLOR_CORRECTION_TRANSFORM);
                if (filmGains == null || filmTransform == null) filmGains = null;
                if (lastIso > 0 && lastExposureNs > 0) filmIso = clampIso((int) Math.round(lastIso * (double) lastExposureNs / shutterNs()));
                filmPhase = 2;
                update();
                return;
            }
            if (calPhase == 0) return;
            Integer awb = r.get(android.hardware.camera2.CaptureResult.CONTROL_AWB_MODE);
            int want = calPhase == 1 ? CameraMetadata.CONTROL_AWB_MODE_DAYLIGHT : CameraMetadata.CONTROL_AWB_MODE_INCANDESCENT;
            if (awb == null || awb != want || ++calFrames < 8) return;
            Kelvin.Anchor a = anchor(r, calPhase == 1 ? Kelvin.DAYLIGHT_K : Kelvin.TUNGSTEN_K);
            if (a == null) {
                calPhase = 0;
                prefs.edit().putString(Prefs.WB, "daylight").apply();
                listener.onNote("This camera does not report its colours, so kelvin white balance is not available; using Daylight.");
                return;
            }
            if (calPhase == 1) {
                calDay = a;
                calPhase = 2;
                calFrames = 0;
            } else {
                prefs.edit().putString(Prefs.ANCHORS + id, writeAnchor(calDay) + "|" + writeAnchor(a)).apply();
                calPhase = 0;
                listener.onNote("");
            }
            update();
        }
    };

    private Rect active() {
        Rect a = chars == null ? null : chars.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE);
        return a == null ? new Rect(0, 0, 1920, 1080) : a;
    }

    /** Below 1 on phones whose main camera also has an ultra-wide lens (Android 11+). */
    float minZoom() {
        if (chars != null && Build.VERSION.SDK_INT >= 30) {
            Range<Float> r = chars.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE);
            if (r != null) return Math.min(1f, r.getLower());
        }
        return 1f;
    }

    float maxZoom() {
        if (chars == null) return 1f;
        if (Build.VERSION.SDK_INT >= 30) {
            Range<Float> r = chars.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE);
            if (r != null) return Math.min(10f, r.getUpper());
        }
        Float max = chars.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM);
        return max == null ? 1f : Math.min(10f, max);
    }

    float zoom() {
        return zoom;
    }

    /** Pinch zoom while it happens (saved when the pinch ends). */
    void zoom(float ratio) {
        zoom = Math.max(minZoom(), Math.min(maxZoom(), ratio));
        update();
    }

    /** What part of the sensor the picture is (zoom crops the middle). */
    private Rect crop() {
        Rect a = active();
        float z = Math.max(1f, zoom);
        int w = Math.round(a.width() / z), h = Math.round(a.height() / z);
        int left = a.left + (a.width() - w) / 2, top = a.top + (a.height() - h) / 2;
        return new Rect(left, top, left + w, top + h);
    }

    private void zoomInto(CaptureRequest.Builder b, CameraCharacteristics c) {
        if (Build.VERSION.SDK_INT >= 30 && c.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE) != null) {
            b.set(CaptureRequest.CONTROL_ZOOM_RATIO, zoom);
        } else if (zoom > 1.001f) {
            b.set(CaptureRequest.SCALER_CROP_REGION, crop());
        }
    }

    /**
     * A tap at (u, v), 0..1 across the picture as shown (the viewfinder shows the picture as sent,
     * never mirrored): focus and exposure follow that spot and the focus then holds there.
     */
    void tap(float u, float v) {
        if (session == null || device == null) return;
        // With a zoom ratio (Android 11+), regions are relative to the zoomed picture; before, to the sensor.
        boolean ratio = Build.VERSION.SDK_INT >= 30 && chars.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE) != null;
        Rect crop = ratio ? active() : crop();
        int size = Math.max(32, crop.width() / 10);
        int x = crop.left + Math.round(u * crop.width()), y = crop.top + Math.round(v * crop.height());
        Rect r = new Rect(Math.max(crop.left, x - size / 2), Math.max(crop.top, y - size / 2), Math.min(crop.right, x + size / 2), Math.min(crop.bottom, y + size / 2));
        tapRegion = new MeteringRectangle[] {new MeteringRectangle(r, MeteringRectangle.METERING_WEIGHT_MAX - 1)};
        boolean canFocus = !"manual".equals(prefs.getString(Prefs.AF, "continuous")) && Caps.contains(chars.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES), CameraMetadata.CONTROL_AF_MODE_AUTO);
        focusHeld = canFocus;
        update();
        if (!canFocus) return;
        try {
            CaptureRequest.Builder b = builder();
            b.set(CaptureRequest.CONTROL_AF_TRIGGER, CameraMetadata.CONTROL_AF_TRIGGER_START);
            session.capture(b.build(), null, handler);
        } catch (CameraAccessException | IllegalStateException e) {
            // The next tap tries again.
        }
    }

    /** Back to following the scene (continuous focus, whole-picture exposure). */
    void release() {
        tapRegion = null;
        boolean was = focusHeld;
        focusHeld = false;
        if (session == null || device == null) return;
        if (was) {
            try {
                CaptureRequest.Builder b = builder();
                b.set(CaptureRequest.CONTROL_AF_TRIGGER, CameraMetadata.CONTROL_AF_TRIGGER_CANCEL);
                session.capture(b.build(), null, handler);
            } catch (CameraAccessException | IllegalStateException e) {
                // update() below still returns to continuous focus.
            }
        }
        update();
    }

    /** One line for Settings: what the camera is doing now. */
    String now() {
        StringBuilder s = new StringBuilder();
        if (lastIso > 0) s.append("ISO ").append(lastIso);
        if (lastExposureNs > 0) s.append(s.length() > 0 ? " · " : "").append(Plan.shutterLabel(lastExposureNs));
        if (lastFocus > 0) s.append(" · focus ").append(String.format(Locale.ROOT, "%.1f m", 1 / lastFocus));
        else if (lastIso > 0) s.append(" · focus far");
        return s.toString();
    }
}
