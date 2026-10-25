package com.openbezal.rhema.camera;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.media.MediaCodecInfo;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;
import android.view.Surface;

import java.io.IOException;
import java.util.List;

/**
 * Owns the camera, the GPU colour pipeline, the encoder and the connection to Rhema, so sending
 * carries on with the screen off: while sending it is a foreground service (a notification says
 * so) holding a partial wake lock and a Wi-Fi lock. The camera draws into the GPU's texture; the
 * GPU grades each frame into the encoder and, while the screen is on, the viewfinder. The
 * screen-off view and a locked phone detach the viewfinder: then only the encoder is drawn.
 */
public final class CameraService extends Service {
    static final String TAG = "RhemaCamera";
    static final String ACTION_SEND = "com.openbezal.rhema.camera.SEND";
    static final String ACTION_STOP = "com.openbezal.rhema.camera.STOP";
    private static final String CHANNEL = "sending";
    private static final int NOTE_ID = 1;

    /** The running service (this app has one process); null when none runs. */
    static volatile CameraService current;

    final class Local extends android.os.Binder {
        CameraService service() {
            return CameraService.this;
        }
    }

    private final IBinder binder = new Local();
    private HandlerThread camThread;
    private HandlerThread encThread;
    /** Where the battery and heat report is sent from (network, off the camera's threads). */
    private HandlerThread reportThread;
    private Handler cam;
    private Handler enc;
    private Handler reporter;
    private Handler main;
    private SharedPreferences prefs;
    private Rig rig;
    private Gpu gpu;
    /** What the camera runs at now (size and frame rate), and which camera; null when closed. */
    private Plan.Shape camShape;
    private String camId;
    private VideoEncoder video;
    private AudioEncoder audio;
    private volatile Publisher pub;
    private Surface preview;
    private Publisher.Clock clock;
    private PowerManager.WakeLock wake;
    private WifiManager.WifiLock wifiLock;
    private WifiManager.WifiLock wifiLowLatency;
    private Object thermalListener;

    // What Settings and the viewfinder show.
    volatile boolean sending;
    volatile String status = "Not sending";
    volatile String cameraError;
    volatile String note = "";
    volatile Plan.Shape shape;
    volatile String encoderName = "";
    volatile double mbps;
    volatile double fpsSent;
    volatile int thermalStep;
    volatile int thermalStatus;
    /** The network's share of the planned bitrate (1 = all; lower after frames had to be dropped). */
    volatile float netFactor = 1f;
    private long congestedAt;
    private long meterAt;
    private long lastBytes;
    private long lastFrames;
    private long lastTick;

    @Override
    public void onCreate() {
        super.onCreate();
        current = this;
        prefs = Prefs.get(this);
        main = new Handler(Looper.getMainLooper());
        camThread = new HandlerThread("rhema-camera");
        camThread.start();
        cam = new Handler(camThread.getLooper());
        encThread = new HandlerThread("rhema-encoder");
        encThread.start();
        enc = new Handler(encThread.getLooper());
        reportThread = new HandlerThread("rhema-report");
        reportThread.start();
        reporter = new Handler(reportThread.getLooper());
        gpu = new Gpu();
        rig = new Rig(this, cam, new Rig.Listener() {
            @Override
            public void onCameraError(String message) {
                cameraError = message;
                Log.w(TAG, "camera: " + message);
            }

            @Override
            public void onNote(String n) {
                note = n;
            }
        });
        prefs.registerOnSharedPreferenceChangeListener(prefsChanged);
        watchHeat();
        main.postDelayed(tick, 1000);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopSending();
        } else if (ACTION_SEND.equals(action)) {
            foreground();
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        prefs.unregisterOnSharedPreferenceChangeListener(prefsChanged);
        main.removeCallbacks(tick);
        unwatchHeat();
        if (sending) stopSending();
        cam.post(new Runnable() {
            @Override
            public void run() {
                teardown();
                rig.close();
                camShape = null;
                gpu.release();
            }
        });
        camThread.quitSafely();
        encThread.quitSafely();
        reportThread.quitSafely();
        current = null;
        super.onDestroy();
    }

    // ---- The viewfinder ----

    /** The viewfinder's surface, or null to detach it (screen-off view, phone locked); `done` once the GPU has let go. */
    void setPreview(final Surface surface, final Runnable done) {
        cam.post(new Runnable() {
            @Override
            public void run() {
                preview = surface;
                gpu.viewfinder(surface);
                if (surface == null && !sending) {
                    rig.close();
                    camShape = null;
                } else if (surface != null) {
                    cameraError = null;
                    camera(sending && shape != null ? shape : choose(), null);
                }
                if (done != null) main.post(done);
            }
        });
    }

    /** The camera running into the GPU at this size and frame rate (opened or set up again only if needed). */
    private void camera(final Plan.Shape s, final Runnable then) {
        final String id = Caps.camera((CameraManager) getSystemService(CAMERA_SERVICE), prefs.getString(Prefs.CAMERA, null));
        if (id == null) {
            cameraError = "This phone has no camera Rhema Camera can use.";
            if (then != null) then.run();
            return;
        }
        rig.open(id, new Runnable() {
            @Override
            public void run() {
                if (camShape != null && id.equals(camId) && camShape.width == s.width && camShape.height == s.height && camShape.fps == s.fps) {
                    if (then != null) then.run();
                    return;
                }
                camShape = s;
                camId = id;
                grade();
                rig.configure(gpu.input(s.width, s.height), s.fps, then);
            }
        });
    }

    void tap(final float u, final float v) {
        cam.post(new Runnable() {
            @Override
            public void run() {
                rig.tap(u, v);
            }
        });
    }

    void releaseFocus() {
        cam.post(new Runnable() {
            @Override
            public void run() {
                rig.release();
            }
        });
    }

    void zoom(final float ratio) {
        cam.post(new Runnable() {
            @Override
            public void run() {
                rig.zoom(ratio);
            }
        });
    }

    void remeasure() {
        cam.post(new Runnable() {
            @Override
            public void run() {
                rig.remeasure();
            }
        });
    }

    /** The camera takes the settings again (e.g. after its colour measurements were cleared). */
    void controlsChanged() {
        cam.post(new Runnable() {
            @Override
            public void run() {
                rig.update();
            }
        });
    }

    float zoomNow() {
        return rig.zoom();
    }

    float maxZoom() {
        return rig.maxZoom();
    }

    float minZoom() {
        return rig.minZoom();
    }

    boolean focusHeld() {
        return rig.focusHeld;
    }

    Rig rig() {
        return rig;
    }

    CameraCharacteristics chars() {
        return rig.chars;
    }

    // ---- Sending ----

    /** Start sending to the paired Rhema (from the viewfinder or Settings). */
    String startSending() {
        if (Prefs.pairing(this) == null) return "Pair this phone with Rhema first: Settings → Connection.";
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) return "Rhema Camera needs the camera permission.";
        if (sending) return null;
        sending = true;
        status = "Starting…";
        Intent i = new Intent(this, CameraService.class).setAction(ACTION_SEND);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(i);
        else startService(i);
        locks(true);
        cam.post(new Runnable() {
            @Override
            public void run() {
                build();
            }
        });
        return null;
    }

    void stopSending() {
        if (!sending) return;
        sending = false;
        status = "Not sending";
        cam.post(new Runnable() {
            @Override
            public void run() {
                teardown();
                if (preview == null) {
                    rig.close();
                    camShape = null;
                }
            }
        });
        locks(false);
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        stopSelf();
    }

    private void foreground() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Sending to Rhema", NotificationManager.IMPORTANCE_LOW));
        Notification n = notification();
        if (Build.VERSION.SDK_INT >= 30) {
            int type = ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA;
            if (audio != null || (prefs.getBoolean(Prefs.AUDIO, false) && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)) {
                type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
            }
            startForeground(NOTE_ID, n, type);
        } else {
            startForeground(NOTE_ID, n);
        }
    }

    private Notification notification() {
        Pairing p = Prefs.pairing(this);
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, CameraService.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle("Rhema Camera is sending")
                .setContentText((p == null ? "Camera" : p.title()) + " to Rhema at " + (p == null ? "" : p.host))
                .setOngoing(true)
                .setContentIntent(open)
                .addAction(new Notification.Action.Builder(null, "Stop sending", stop).build())
                .build();
    }

    private void locks(boolean on) {
        if (on) {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (wake == null) {
                wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "rhema-camera:sending");
                wake.setReferenceCounted(false);
            }
            wake.acquire();
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                if (wifiLock == null) {
                    wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "rhema-camera:sending");
                    wifiLock.setReferenceCounted(false);
                }
                wifiLock.acquire();
                if (Build.VERSION.SDK_INT >= 29) {
                    if (wifiLowLatency == null) {
                        wifiLowLatency = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_LOW_LATENCY, "rhema-camera:low-latency");
                        wifiLowLatency.setReferenceCounted(false);
                    }
                    wifiLowLatency.acquire();
                }
            }
        } else {
            if (wake != null && wake.isHeld()) wake.release();
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
            if (wifiLowLatency != null && wifiLowLatency.isHeld()) wifiLowLatency.release();
        }
    }

    /** The shape the settings ask for on this phone (before any step down for heat). */
    private Plan.Shape choose() {
        CameraManager cm = (CameraManager) getSystemService(CAMERA_SERVICE);
        String id = Caps.camera(cm, prefs.getString(Prefs.CAMERA, null));
        CameraCharacteristics c = id == null ? null : Caps.chars(cm, id);
        List<Plan.Preset> presets = Caps.presets(c);
        Plan.Preset preset = Plan.preset(prefs.getString(Prefs.PRESET, "cine24"));
        if (preset == null || !presets.contains(preset)) preset = presets.isEmpty() ? Plan.preset("smooth30") : presetOr(presets, "cine24");
        String codecChoice = prefs.getString(Prefs.CODEC, "auto");
        List<Integer> heights = Caps.sizes(c, preset.fps, codecChoice);
        int h = prefs.getInt(Prefs.HEIGHT, 0);
        if (!heights.contains(h)) h = heights.isEmpty() ? 720 : heights.get(0);
        int w = Caps.widthFor(h);
        String mime = Caps.codecFor(codecChoice, w, h, preset.fps);
        boolean hevc = Caps.HEVC.equals(mime);
        return new Plan.Shape(w, h, preset.fps, hevc, bitrateFor(w, h, preset.fps, hevc, mime));
    }

    private static Plan.Preset presetOr(List<Plan.Preset> list, String id) {
        for (Plan.Preset p : list) if (p.id.equals(id)) return p;
        return list.get(list.size() - 1);
    }

    private int bitrateFor(int w, int h, int fps, boolean hevc, String mime) {
        int manual = prefs.getInt(Prefs.BITRATE, 0);
        int want = manual > 0 ? manual * 1_000_000 : Plan.autoBitrate(w, h, fps, hevc);
        return Plan.capBitrate(want, wifiUplinkMbps(), Caps.maxBitrate(Caps.encoder(mime == null ? Caps.AVC : mime), mime == null ? Caps.AVC : mime));
    }

    /** The Wi-Fi link's speed (Mbit/s) from this phone, 0 when not on Wi-Fi. */
    int wifiUplinkMbps() {
        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wm == null || !wm.isWifiEnabled()) return 0;
        WifiInfo info = wm.getConnectionInfo();
        if (info == null || info.getNetworkId() == -1) return 0;
        int speed = Build.VERSION.SDK_INT >= 29 ? info.getTxLinkSpeedMbps() : info.getLinkSpeed();
        return Math.max(0, speed);
    }

    /** Encoder, camera session and (once the encoder has its parameter sets) the connection. */
    private void build() {
        if (!sending) return;
        cameraError = null;
        CameraManager cm = (CameraManager) getSystemService(CAMERA_SERVICE);
        final String id = Caps.camera(cm, prefs.getString(Prefs.CAMERA, null));
        if (id == null) {
            cameraError = "This phone has no camera Rhema Camera can use.";
            return;
        }
        Plan.Shape s = Plan.cool(choose(), thermalStep);
        if (Prefs.pairing(this) == null) return;
        String mime = s.hevc ? Caps.HEVC : Caps.AVC;
        MediaCodecInfo info = Caps.encoder(mime);
        if (info == null) {
            status = "This phone has no hardware encoder for " + (s.hevc ? "HEVC" : "H.264") + ".";
            return;
        }
        final boolean realtime = Caps.realtimeClock(Caps.chars(cm, id));
        clock = new Publisher.Clock() {
            @Override
            public long nowUs() {
                return realtime ? SystemClock.elapsedRealtimeNanos() / 1000 : System.nanoTime() / 1000;
            }
        };
        try {
            video = new VideoEncoder(info, mime, s, encoderSink, enc);
        } catch (IOException | RuntimeException e) {
            status = "The encoder could not start at " + s + ": " + e.getMessage();
            return;
        }
        shape = s;
        encoderName = info.getName();
        Log.i(TAG, "sending " + s + " with " + encoderName);
        if (prefs.getBoolean(Prefs.AUDIO, false) && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            try {
                audio = new AudioEncoder(new AudioEncoder.Sink() {
                    @Override
                    public void audio(byte[] data, int len, long ptsUs) {
                        Publisher p = pub;
                        if (p != null) p.audio(data, len, ptsUs);
                    }
                }, clock);
            } catch (IOException | RuntimeException e) {
                note = "The microphone did not start, so no sound is sent: " + e.getMessage();
                audio = null;
            }
        }
        netFactor = 1f;
        video.start();
        gpu.encoder(video.surface(), s.width, s.height);
        gpu.pace(s.fps, 15);
        camera(s, null);
        if (audio != null) audio.start();
        status = "Starting the encoder…";
    }

    private final VideoEncoder.Sink encoderSink = new VideoEncoder.Sink() {
        @Override
        public void config(final byte[] vps, final byte[] sps, final byte[] pps) {
            cam.post(new Runnable() {
                @Override
                public void run() {
                    connect(vps, sps, pps);
                }
            });
        }

        @Override
        public void frame(byte[] data, int len, long ptsUs, boolean key) {
            Publisher p = pub;
            if (p != null) p.video(data, len, ptsUs, key);
        }

        @Override
        public void error(final String message) {
            cam.post(new Runnable() {
                @Override
                public void run() {
                    status = message + " Starting again…";
                    rebuild();
                }
            });
        }
    };

    private void connect(byte[] vps, byte[] sps, byte[] pps) {
        Pairing p = Prefs.pairing(this);
        if (p == null || !sending || video == null || pub != null) return;
        Plan.Shape s = shape;
        String sdp = Sdp.build(p.host, System.currentTimeMillis(), new Sdp.Video(s.hevc, vps, sps, pps, s.fps), audio == null ? null : new Sdp.Audio(AudioEncoder.RATE, 1));
        Publisher np = new Publisher(p, sdp, s.hevc, audio != null, AudioEncoder.RATE, s.bitrate, new Publisher.Listener() {
            @Override
            public void onState(boolean live, String message) {
                status = message;
            }

            @Override
            public void onNeedKeyFrame() {
                VideoEncoder v = video;
                if (v != null) v.requestKey();
            }

            @Override
            public void onCongested() {
                cam.post(new Runnable() {
                    @Override
                    public void run() {
                        congested();
                    }
                });
            }
        }, clock);
        pub = np;
        lastBytes = 0;
        lastFrames = 0;
        np.start();
    }

    private void teardown() {
        Publisher p = pub;
        pub = null;
        if (p != null) p.stop();
        // The GPU lets go of the encoder's surface before the encoder goes; the camera keeps running into the GPU.
        gpu.encoder(null, 0, 0);
        gpu.pace(30, 30);
        if (audio != null) {
            audio.stop();
            audio = null;
        }
        if (video != null) {
            video.release();
            video = null;
        }
        shape = null;
        mbps = 0;
        fpsSent = 0;
    }

    /** Settings changed how the picture is made: start encoder, camera and connection again. */
    private void rebuild() {
        teardown();
        if (sending) build();
        else if (preview != null) camera(choose(), null);
    }

    /** The look from Settings, to the GPU (and its exposure bias and sharpening to the camera). */
    private void grade() {
        String id = prefs.getString(Prefs.LOOK, "studio");
        float strength = prefs.getInt(Prefs.STRENGTH, 100) / 100f;
        float warmth = prefs.getInt(Prefs.WARMTH, 0) / 100f, tint = prefs.getInt(Prefs.TINT, 0) / 100f;
        String bars = prefs.getString(Prefs.BARS, "none");
        float aspect = !prefs.getBoolean(Prefs.BURN, false) ? 0f : "239".equals(bars) ? 2.39f : "185".equals(bars) ? 1.85f : 0f;
        float grain = prefs.getBoolean(Prefs.GRAIN, false) ? 0.5f + 0.5f * strength : 0f;
        Looks.Params p = Looks.at("cube".equals(id) ? "off" : id, strength, warmth, tint);
        Lut cube = "cube".equals(id) ? cube() : null;
        boolean off = "off".equals(id) && warmth == 0 && tint == 0 && grain == 0 && aspect == 0;
        // The colour baked into a table here (a few milliseconds), so the GPU only looks it up.
        gpu.grade(new Gpu.Grade(off, off ? null : Looks.bake(p, cube, strength), p.vignette, grain, aspect));
        rig.evBias = p.evBias;
        rig.graded = !off;
        rig.update();
    }

    private Lut cube() {
        java.io.File f = new java.io.File(getFilesDir(), "look.cube");
        if (!f.isFile()) return null;
        try {
            return Lut.parse(new String(java.nio.file.Files.readAllBytes(f.toPath()), java.nio.charset.StandardCharsets.UTF_8));
        } catch (IOException | RuntimeException e) {
            note = "Your .cube look could not be read: " + e.getMessage();
            return null;
        }
    }

    /** The network dropped frames: send a quarter less, down to a third of the plan; it comes back by itself. */
    private void congested() {
        congestedAt = SystemClock.elapsedRealtime();
        netFactor = Math.max(0.35f, netFactor * 0.75f);
        VideoEncoder v = video;
        if (v != null && shape != null) v.bitrate((int) (shape.bitrate * netFactor));
        Log.i(TAG, "network busy: bitrate to " + Math.round(netFactor * 100) + " %");
    }

    private void recover() {
        if (netFactor >= 1f || SystemClock.elapsedRealtime() - congestedAt < 15000) return;
        congestedAt = SystemClock.elapsedRealtime();
        netFactor = Math.min(1f, netFactor + 0.1f);
        VideoEncoder v = video;
        if (v != null && shape != null) v.bitrate((int) (shape.bitrate * netFactor));
    }

    /**
     * The film shutter's light meter: twice a second a tiny copy of the camera's picture says how
     * bright it is, and the ISO follows slowly (the shutter stays at its film angle).
     */
    private void meter() {
        if (camShape == null || !"film".equals(rig.aeMode()) || rig.filmPhase != 2) return;
        long now = SystemClock.elapsedRealtime();
        if (now - meterAt < 500) return;
        meterAt = now;
        gpu.snapshot(32, 18, new Gpu.Pixels() {
            @Override
            public void got(int[] px, int w, int h) {
                final double ratio = Exposure.ratio(px, w, h, rig.evBias + prefs.getInt(Prefs.EV, 0) * evStep());
                cam.post(new Runnable() {
                    @Override
                    public void run() {
                        int iso = rig.filmIso > 0 ? rig.filmIso : rig.iso();
                        int next = Exposure.nextIso(iso, ratio, rig.isoRange());
                        if (next != iso) {
                            rig.filmIso = next;
                            rig.update();
                        }
                    }
                });
            }
        });
    }

    private float evStep() {
        CameraCharacteristics c = rig.chars;
        android.util.Rational r = c == null ? null : c.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_STEP);
        return r == null ? 0f : r.floatValue();
    }

    /** The viewfinder's surface is going away: the GPU lets go of it now (waits for the GPU thread). */
    void dropViewfinderNow() {
        gpu.viewfinder(null);
    }

    /** The viewfinder's histogram while it is shown (null: none, and the GPU reads nothing for it). */
    void histogram(Gpu.Histogram h) {
        gpu.histogram(h);
    }

    /** What Settings → Picture says when the look had to be made lighter on this phone ("" when not). */
    String lighterNote() {
        Plan.Shape s = shape;
        return gpu.pacer.note(gpu.encoderFps, s == null ? 30 : s.fps);
    }

    /** A small copy of the camera's picture (before the look), for the look previews in Settings. */
    void sample(Gpu.Pixels out) {
        gpu.snapshot(96, 54, out);
    }

    private final SharedPreferences.OnSharedPreferenceChangeListener prefsChanged = new SharedPreferences.OnSharedPreferenceChangeListener() {
        @Override
        public void onSharedPreferenceChanged(SharedPreferences sp, final String key) {
            cam.post(new Runnable() {
                @Override
                public void run() {
                    if (Prefs.CAMERA.equals(key)) {
                        rig.close();
                        camShape = null;
                        rig.filmIso = 0;
                        rebuild();
                    } else if (Prefs.grades(key)) {
                        grade();
                    } else if (Prefs.reshapes(key) || Prefs.PAIR.equals(key)) {
                        rebuild();
                    } else if (Prefs.BITRATE.equals(key) && video != null && shape != null) {
                        Plan.Shape s = shape;
                        int b = (int) (bitrateFor(s.width, s.height, s.fps, s.hevc, s.hevc ? Caps.HEVC : Caps.AVC) * (thermalStep > 0 ? 0.7 : 1));
                        shape = new Plan.Shape(s.width, s.height, s.fps, s.hevc, b);
                        video.bitrate((int) (b * netFactor));
                    } else if (Prefs.controls(key)) {
                        rig.update();
                    }
                }
            });
        }
    };

    // ---- Heat and battery ----

    private void watchHeat() {
        if (Build.VERSION.SDK_INT < 29) return;
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        PowerManager.OnThermalStatusChangedListener l = new PowerManager.OnThermalStatusChangedListener() {
            @Override
            public void onThermalStatusChanged(int s) {
                heat(s);
            }
        };
        thermalListener = l;
        pm.addThermalStatusListener(l);
        heat(pm.getCurrentThermalStatus());
    }

    private void unwatchHeat() {
        if (Build.VERSION.SDK_INT < 29 || thermalListener == null) return;
        ((PowerManager) getSystemService(POWER_SERVICE)).removeThermalStatusListener((PowerManager.OnThermalStatusChangedListener) thermalListener);
    }

    private void heat(final int s) {
        thermalStatus = s;
        final int step = Plan.thermalStep(s);
        if (step == thermalStep) return;
        thermalStep = step;
        Log.i(TAG, "thermal status " + s + ", step " + step);
        cam.post(new Runnable() {
            @Override
            public void run() {
                if (!sending || video == null || shape == null) return;
                Plan.Shape wanted = Plan.cool(choose(), step);
                Plan.Shape now = shape;
                if (wanted.width == now.width && wanted.height == now.height && wanted.fps == now.fps) {
                    shape = wanted;
                    video.bitrate((int) (wanted.bitrate * netFactor));
                } else {
                    rebuild();
                }
            }
        });
    }

    /** Battery level (percent), its temperature (°C) and whether it charges, from Android's last broadcast. */
    float[] battery() {
        Intent b = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (b == null) return new float[] {-1, -1, 0};
        int level = b.getIntExtra(BatteryManager.EXTRA_LEVEL, -1), scale = b.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
        return new float[] {level < 0 ? -1 : level * 100f / scale, b.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, -10) / 10f, b.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0 ? 1 : 0};
    }

    /** The battery's current now, mA, as the phone reports it (makers differ on its sign); 0 when it does not say. */
    int batteryMilliamps() {
        BatteryManager bm = (BatteryManager) getSystemService(BATTERY_SERVICE);
        if (bm == null) return 0;
        int ua = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW);
        if (ua == Integer.MIN_VALUE) return 0;
        // Some phones report mA, most µA.
        return Math.abs(ua) > 20000 ? ua / 1000 : ua;
    }

    private long batteryLogAt;
    private long reportAt;
    private volatile boolean reportFailing;

    /** Tell Rhema the battery and heat (#213), from the report thread; a failure is logged once until it works again. */
    private void report() {
        final Pairing p = Prefs.pairing(this);
        if (p == null || p.statusUrl() == null) return;
        float[] b = battery();
        final String body = Report.body(b[0], b[2] > 0, b[1], Build.VERSION.SDK_INT >= 29 ? thermalStatus : -1, thermalStep > 0);
        reporter.post(new Runnable() {
            @Override
            public void run() {
                try {
                    int code = Report.send(p, body);
                    if (!Report.ok(code) && !reportFailing) Log.w(TAG, "battery report: Rhema answered " + code);
                    reportFailing = !Report.ok(code);
                } catch (IOException e) {
                    if (!reportFailing) Log.w(TAG, "battery report: " + e.getMessage());
                    reportFailing = true;
                }
            }
        });
    }

    Publisher publisher() {
        return pub;
    }

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            Publisher p = pub;
            long now = SystemClock.elapsedRealtime();
            if (p != null) {
                p.checkStall();
                double dt = lastTick == 0 ? 0.5 : (now - lastTick) / 1000.0;
                long bytes = p.bytesSent, frames = p.framesSent;
                mbps = (bytes - lastBytes) * 8 / 1e6 / dt;
                fpsSent = (frames - lastFrames) / dt;
                lastBytes = bytes;
                lastFrames = frames;
            }
            lastTick = now;
            if (sending && now - reportAt >= Report.EVERY_MS) {
                reportAt = now;
                report();
            }
            if (!sending) reportAt = 0;
            if (sending && now - batteryLogAt >= 60000) {
                batteryLogAt = now;
                float[] b = battery();
                BatteryManager bm = (BatteryManager) getSystemService(BATTERY_SERVICE);
                Log.i(TAG, "battery: " + Math.round(b[0]) + " %, " + b[1] + " C, " + batteryMilliamps() + " mA, counter " + (bm == null ? -1 : bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER)) + " uAh, sending " + sending + ", thermal " + thermalStatus);
            }
            cam.post(new Runnable() {
                @Override
                public void run() {
                    meter();
                    recover();
                }
            });
            main.postDelayed(this, 500);
        }
    };
}
