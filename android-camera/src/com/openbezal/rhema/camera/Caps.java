package com.openbezal.rhema.camera;

import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CameraMetadata;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaFormat;
import android.os.Build;
import android.util.Range;
import android.util.Size;
import android.util.SizeF;

import java.util.ArrayList;
import java.util.List;

/** What this phone's cameras and hardware encoders can really do (asked, never assumed). */
final class Caps {
    private Caps() { }

    static final String AVC = MediaFormat.MIMETYPE_VIDEO_AVC;
    static final String HEVC = MediaFormat.MIMETYPE_VIDEO_HEVC;

    static final class Lens {
        final String id;
        final String label;
        final boolean front;

        Lens(String id, String label, boolean front) {
            this.id = id;
            this.label = label;
            this.front = front;
        }
    }

    static List<Lens> lenses(CameraManager m) {
        List<Lens> out = new ArrayList<Lens>();
        try {
            for (String id : m.getCameraIdList()) {
                CameraCharacteristics c = m.getCameraCharacteristics(id);
                Integer facing = c.get(CameraCharacteristics.LENS_FACING);
                int[] caps = c.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES);
                boolean usable = false;
                if (caps != null) for (int x : caps) if (x == CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_BACKWARD_COMPATIBLE) usable = true;
                if (!usable) continue;
                String side = facing == null ? "Camera" : facing == CameraMetadata.LENS_FACING_FRONT ? "Front" : facing == CameraMetadata.LENS_FACING_BACK ? "Back" : "External";
                float[] focal = c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS);
                SizeF sensor = c.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE);
                String detail = "";
                if (focal != null && focal.length > 0 && sensor != null && sensor.getWidth() > 0) {
                    // 35 mm equivalent, from the sensor's diagonal.
                    double diag = Math.hypot(sensor.getWidth(), sensor.getHeight());
                    long eq = Math.round(focal[0] * 43.27 / diag);
                    detail = " (" + (eq < 20 ? "ultra wide, " : eq > 45 ? "tele, " : "") + eq + " mm)";
                }
                if (Build.VERSION.SDK_INT >= 30) {
                    android.util.Range<Float> z = c.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE);
                    if (z != null && z.getLower() < 0.99f) detail += ", all lenses: zoom " + String.format(java.util.Locale.ROOT, "%.1f", z.getLower()) + "× to " + Math.round(z.getUpper()) + "×";
                }
                out.add(new Lens(id, side + detail, facing != null && facing == CameraMetadata.LENS_FACING_FRONT));
            }
        } catch (CameraAccessException | RuntimeException e) {
            // No cameras listed.
        }
        return out;
    }

    static CameraCharacteristics chars(CameraManager m, String id) {
        try {
            return m.getCameraCharacteristics(id);
        } catch (CameraAccessException | RuntimeException e) {
            return null;
        }
    }

    /** The camera to use: the saved one if it is still there, else the first back camera. */
    static String camera(CameraManager m, String saved) {
        List<Lens> all = lenses(m);
        for (Lens l : all) if (l.id.equals(saved)) return l.id;
        for (Lens l : all) if (!l.front) return l.id;
        return all.isEmpty() ? null : all.get(0).id;
    }

    static boolean has(CameraCharacteristics c, int capability) {
        int[] caps = c == null ? null : c.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES);
        if (caps != null) for (int x : caps) if (x == capability) return true;
        return false;
    }

    static boolean manualSensor(CameraCharacteristics c) {
        return has(c, CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR);
    }

    static boolean manualPost(CameraCharacteristics c) {
        return has(c, CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_POST_PROCESSING);
    }

    static boolean contains(int[] list, int v) {
        if (list != null) for (int x : list) if (x == v) return true;
        return false;
    }

    static boolean videoStabilisation(CameraCharacteristics c) {
        return c != null && contains(c.get(CameraCharacteristics.CONTROL_AVAILABLE_VIDEO_STABILIZATION_MODES), CameraMetadata.CONTROL_VIDEO_STABILIZATION_MODE_ON);
    }

    static boolean opticalStabilisation(CameraCharacteristics c) {
        return c != null && contains(c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_OPTICAL_STABILIZATION), CameraMetadata.LENS_OPTICAL_STABILIZATION_MODE_ON);
    }

    static boolean manualFocus(CameraCharacteristics c) {
        Float min = c == null ? null : c.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE);
        return manualSensor(c) && min != null && min > 0;
    }

    /** The camera can hold exactly this frame rate. */
    static boolean fixedFps(CameraCharacteristics c, int fps) {
        Range<Integer>[] ranges = c == null ? null : c.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES);
        if (ranges != null) for (Range<Integer> r : ranges) if (r.getLower() == fps && r.getUpper() == fps) return true;
        return false;
    }

    /** The camera gives this size to an encoder at this frame rate. */
    static boolean cameraSize(CameraCharacteristics c, int w, int h, int fps) {
        StreamConfigurationMap map = c == null ? null : c.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
        if (map == null) return false;
        Size[] sizes = map.getOutputSizes(MediaCodec.class);
        if (sizes == null) return false;
        for (Size s : sizes) {
            if (s.getWidth() == w && s.getHeight() == h) {
                long min = map.getOutputMinFrameDuration(MediaCodec.class, s);
                return min == 0 || min <= 1_000_000_000L / fps + 1000;
            }
        }
        return false;
    }

    /** A hardware encoder for this type (software encoders cost too much battery and heat). */
    static MediaCodecInfo encoder(String mime) {
        for (MediaCodecInfo info : new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos()) {
            if (!info.isEncoder() || !hardware(info)) continue;
            for (String t : info.getSupportedTypes()) if (t.equalsIgnoreCase(mime)) return info;
        }
        return null;
    }

    static boolean hardware(MediaCodecInfo info) {
        if (Build.VERSION.SDK_INT >= 29) return info.isHardwareAccelerated() && !info.isSoftwareOnly();
        String n = info.getName().toLowerCase(java.util.Locale.ROOT);
        return !n.startsWith("omx.google.") && !n.startsWith("c2.android.") && !n.contains(".sw.") && !n.endsWith(".sw");
    }

    static boolean encodes(MediaCodecInfo info, String mime, int w, int h, int fps) {
        if (info == null) return false;
        try {
            MediaCodecInfo.VideoCapabilities v = info.getCapabilitiesForType(mime).getVideoCapabilities();
            return v != null && v.areSizeAndRateSupported(w, h, fps);
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    static int maxBitrate(MediaCodecInfo info, String mime) {
        if (info == null) return 0;
        try {
            return info.getCapabilitiesForType(mime).getVideoCapabilities().getBitrateRange().getUpper();
        } catch (RuntimeException e) {
            return 0;
        }
    }

    /** The presets this camera can hold (exact frame rate). */
    static List<Plan.Preset> presets(CameraCharacteristics c) {
        List<Plan.Preset> out = new ArrayList<Plan.Preset>();
        for (Plan.Preset p : Plan.PRESETS) if (fixedFps(c, p.fps) && !sizes(c, p.fps, "auto").isEmpty()) out.add(p);
        return out;
    }

    /** The codec for a size: "auto" is HEVC where the hardware encodes it, else H.264; "h264" is always H.264. */
    static String codecFor(String choice, int w, int h, int fps) {
        boolean avc = encodes(encoder(AVC), AVC, w, h, fps);
        boolean hevc = encodes(encoder(HEVC), HEVC, w, h, fps);
        if ("h264".equals(choice)) return avc ? AVC : null;
        // Automatic and HEVC: HEVC where the phone's hardware encodes it (the same picture in less bitrate), else H.264.
        return hevc ? HEVC : avc ? AVC : null;
    }

    /** The heights offered at a frame rate: both the camera and a hardware encoder do them. */
    static List<Integer> sizes(CameraCharacteristics c, int fps, String codec) {
        List<Integer> out = new ArrayList<Integer>();
        for (int[] s : Plan.SIZES) if (cameraSize(c, s[0], s[1], fps) && codecFor(codec, s[0], s[1], fps) != null) out.add(s[1]);
        return out;
    }

    static int widthFor(int h) {
        for (int[] s : Plan.SIZES) if (s[1] == h) return s[0];
        return h * 16 / 9;
    }

    /** The sensor timestamps' clock: Android's realtime clock, or the monotonic clock (nanoTime). */
    static boolean realtimeClock(CameraCharacteristics c) {
        Integer src = c == null ? null : c.get(CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE);
        return src != null && src == CameraMetadata.SENSOR_INFO_TIMESTAMP_SOURCE_REALTIME;
    }
}
