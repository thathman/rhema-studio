package com.openbezal.rhema.camera;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.RectF;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CameraMetadata;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.view.GestureDetector;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * The viewfinder: the camera's picture, full screen, with a small LIVE/CONNECTING/NOT SENDING
 * status and an idle CONNECT/SEND action. The Settings gear and screen-off button hide by
 * themselves. Tap to focus and expose there, double-tap to follow the scene again, pinch to zoom.
 * Opens pairing links (rhema-camera://pair?…) from the phone's QR scanner too.
 */
public final class MainActivity extends Activity {
    private CameraService service;
    /** The viewfinder: a SurfaceView, which the display hardware shows without costing the GPU anything. */
    private SurfaceView view;
    private OverlayView overlay;
    private TextView pill;
    private TextView sendAction;
    private TextView detail;
    private TextView hint;
    private ImageButton gear;
    private ImageButton dark;
    private View black;
    private TextView blackHint;
    private Surface surface;
    private boolean started;
    private boolean screenOff;
    private boolean autoStartDone;
    private long touchedAt;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private SensorManager sensors;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs = Prefs.get(this);
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // Like the phone's own camera: the viewfinder shows over the lock screen (unless turned off in
        // Settings → On screen), so a camera on its stand stays usable if the phone locks itself.
        // Settings (with the pairing) still needs the PIN.
        setShowWhenLocked(prefs.getBoolean(Prefs.OVER_LOCK, true));
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(lp);
        }
        sensors = (SensorManager) getSystemService(SENSOR_SERVICE);
        build();
        handlePairing(getIntent());
    }

    private void build() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        view = new SurfaceView(this);
        view.getHolder().addCallback(holderCallback);
        root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        overlay = new OverlayView(this);
        root.addView(overlay, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        int m = Ui.dp(this, 16);

        LinearLayout status = Ui.column(this);
        pill = Ui.text(this, "NOT SENDING", 12, Color.WHITE, true);
        pill.setLetterSpacing(0.08f);
        pill.setCompoundDrawablePadding(Ui.dp(this, 7));
        pill.setBackground(Ui.round(0x99000000, Ui.dp(this, 14)));
        Ui.pad(pill, this, 11, 6);
        pill.setGravity(Gravity.CENTER_VERTICAL);
        pill.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                touched();
                if (service != null && service.sending) toast("Hold to stop sending");
                else startSending();
            }
        });
        pill.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View v) {
                if (service != null && service.sending) {
                    service.stopSending();
                    toast("Stopped sending");
                }
                return true;
            }
        });
        status.addView(pill, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        sendAction = Ui.text(this, "CONNECT", 13, Color.WHITE, true);
        sendAction.setGravity(Gravity.CENTER);
        sendAction.setBackground(Ui.round(Ui.TEAL, Ui.dp(this, 16)));
        sendAction.setPadding(Ui.dp(this, 16), Ui.dp(this, 9), Ui.dp(this, 16), Ui.dp(this, 9));
        sendAction.setMinHeight(Ui.dp(this, 48));
        sendAction.setVisibility(View.GONE);
        sendAction.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                touched();
                startSending();
            }
        });
        LinearLayout.LayoutParams actionParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        actionParams.topMargin = Ui.dp(this, 8);
        status.addView(sendAction, actionParams);

        detail = Ui.text(this, "", 12, 0xFFE6ECEE, false);
        detail.setShadowLayer(4, 0, 0, Color.BLACK);
        detail.setMaxWidth(Ui.dp(this, 360));
        detail.setPadding(Ui.dp(this, 4), Ui.dp(this, 6), 0, 0);
        status.addView(detail, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        FrameLayout.LayoutParams sp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.START);
        sp.setMargins(m, m, m, m);
        root.addView(status, sp);

        gear = button(R.drawable.ic_gear, "Settings");
        gear.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openSettings();
            }
        });
        FrameLayout.LayoutParams gp = new FrameLayout.LayoutParams(Ui.dp(this, 44), Ui.dp(this, 44), Gravity.TOP | Gravity.END);
        gp.setMargins(m, m, m, m);
        root.addView(gear, gp);

        dark = button(R.drawable.ic_screen_off, "Screen off (keeps sending)");
        dark.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                screenOff(true);
            }
        });
        FrameLayout.LayoutParams dp = new FrameLayout.LayoutParams(Ui.dp(this, 44), Ui.dp(this, 44), Gravity.BOTTOM | Gravity.END);
        dp.setMargins(m, m, m, m);
        root.addView(dark, dp);

        hint = Ui.text(this, "", 12, 0xFFE6ECEE, false);
        hint.setBackground(Ui.round(0x99000000, Ui.dp(this, 12)));
        Ui.pad(hint, this, 10, 5);
        hint.setVisibility(View.GONE);
        FrameLayout.LayoutParams hp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        hp.setMargins(m, m, m, m + Ui.dp(this, 4));
        root.addView(hint, hp);

        black = new View(this);
        black.setBackgroundColor(Color.BLACK);
        black.setVisibility(View.GONE);
        black.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                screenOff(false);
            }
        });
        root.addView(black, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        blackHint = Ui.text(this, "Still sending · touch the screen to wake it", 13, 0xFF56616A, false);
        blackHint.setVisibility(View.GONE);
        root.addView(blackHint, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));

        final GestureDetector taps = new GestureDetector(this, new GestureDetector.SimpleOnGestureListener() {
            @Override
            public boolean onSingleTapConfirmed(MotionEvent e) {
                touched();
                RectF p = overlay.picture;
                if (service == null || !p.contains(e.getX(), e.getY())) return true;
                overlay.ring(e.getX(), e.getY());
                service.tap((e.getX() - p.left) / p.width(), (e.getY() - p.top) / p.height());
                return true;
            }

            @Override
            public boolean onDoubleTap(MotionEvent e) {
                touched();
                if (service != null) {
                    service.releaseFocus();
                    toast("Following the scene again");
                }
                return true;
            }
        });
        final ScaleGestureDetector pinch = new ScaleGestureDetector(this, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
            private float zoom = 1f;

            @Override
            public boolean onScaleBegin(ScaleGestureDetector d) {
                zoom = service == null ? 1f : service.zoomNow();
                return service != null;
            }

            @Override
            public boolean onScale(ScaleGestureDetector d) {
                zoom = Math.max(service.minZoom(), Math.min(service.maxZoom(), zoom * d.getScaleFactor()));
                service.zoom(zoom);
                overlay.zoom(zoom);
                touched();
                return true;
            }

            @Override
            public void onScaleEnd(ScaleGestureDetector d) {
                prefs.edit().putFloat(Prefs.ZOOM, zoom).apply();
            }
        });
        overlay.setOnTouchListener(new View.OnTouchListener() {
            @Override
            public boolean onTouch(View v, MotionEvent e) {
                pinch.onTouchEvent(e);
                if (!pinch.isInProgress()) taps.onTouchEvent(e);
                return true;
            }
        });
        // The controls stay clear of where the system bars appear (a touch there only shows the bar).
        final View statusBox = status;
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets in) {
                int base = Ui.dp(MainActivity.this, 16);
                int l = base + in.getStableInsetLeft(), t = base + in.getStableInsetTop(), r = base + in.getStableInsetRight(), b = base + in.getStableInsetBottom();
                for (View c : new View[] {statusBox, gear, dark, hint}) {
                    FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) c.getLayoutParams();
                    lp.setMargins(l, c == hint ? base : t, r, b);
                    c.setLayoutParams(lp);
                }
                return in;
            }
        });
        root.addOnLayoutChangeListener(new View.OnLayoutChangeListener() {
            @Override
            public void onLayoutChange(View v, int l, int t, int r, int b, int ol, int ot, int or, int ob) {
                transform();
            }
        });
        setContentView(root);
    }

    /** Settings, after the PIN if the phone is locked. */
    private void openSettings() {
        android.app.KeyguardManager km = (android.app.KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        if (km != null && km.isKeyguardLocked()) {
            km.requestDismissKeyguard(this, new android.app.KeyguardManager.KeyguardDismissCallback() {
                @Override
                public void onDismissSucceeded() {
                    startActivity(new Intent(MainActivity.this, SettingsActivity.class));
                }
            });
            return;
        }
        startActivity(new Intent(this, SettingsActivity.class));
    }

    private ImageButton button(int icon, String what) {
        ImageButton b = new ImageButton(this);
        b.setImageResource(icon);
        b.setContentDescription(what);
        b.setBackground(Ui.dot(0x99000000));
        b.setScaleType(android.widget.ImageView.ScaleType.CENTER);
        return b;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handlePairing(intent);
    }

    /** A pairing link opened from the phone's QR scanner or a message: ask, then keep it. */
    private void handlePairing(Intent intent) {
        // A look or exposure mode chosen by name, for checking from a computer (am start … --es look cinematic --es ae auto --es preset smooth30).
        String look = intent == null ? null : intent.getStringExtra("look");
        if (look != null && java.util.Arrays.asList(Looks.IDS).contains(look)) prefs.edit().putString(Prefs.LOOK, look).apply();
        String preset = intent == null ? null : intent.getStringExtra("preset");
        if (preset != null && Plan.preset(preset) != null) prefs.edit().putString(Prefs.PRESET, preset).apply();
        String ae = intent == null ? null : intent.getStringExtra("ae");
        if ("auto".equals(ae) || "film".equals(ae) || "manual".equals(ae)) prefs.edit().putString(Prefs.AE, ae).apply();
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() == null) return;
        Uri data = intent.getData();
        intent.setData(null);
        ask(this, data.toString(), new Runnable() {
            @Override
            public void run() {
                // Scanned on the stand: live at once, unless the person chose otherwise.
                if (prefs.getBoolean(Prefs.AUTO_START, true) && service != null && !service.sending) startSending();
            }
        });
    }

    /** Shared with Settings: checks a link, asks to pair, keeps it. */
    static void ask(final Activity a, final String link, final Runnable paired) {
        final Pairing p;
        try {
            p = Pairing.parse(link);
        } catch (IllegalArgumentException e) {
            new AlertDialog.Builder(a).setTitle("Not a Rhema Camera link").setMessage(e.getMessage()).setPositiveButton("OK", null).show();
            return;
        }
        new AlertDialog.Builder(a)
                .setTitle("Pair with Rhema?")
                .setMessage("This phone will send its camera to Rhema at " + p.host + " as \"" + p.title() + "\".\n\nOnly that computer's certificate is accepted, and the picture is encrypted on the way.")
                .setPositiveButton("Pair", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int which) {
                        Prefs.get(a).edit().putString(Prefs.PAIR, p.link()).apply();
                        Toast.makeText(a, "Paired as \"" + p.title() + "\"", Toast.LENGTH_SHORT).show();
                        if (paired != null) paired.run();
                    }
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    @Override
    protected void onStart() {
        super.onStart();
        started = true;
        immersive();
        bindService(new Intent(this, CameraService.class), connection, Context.BIND_AUTO_CREATE);
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] {Manifest.permission.CAMERA}, 1);
        }
        applyOverlayPrefs();
        ui.post(poll);
        touched();
    }

    @Override
    protected void onResume() {
        super.onResume();
        setShowWhenLocked(prefs.getBoolean(Prefs.OVER_LOCK, true));
        applyOverlayPrefs();
        immersive();
    }

    @Override
    protected void onStop() {
        started = false;
        ui.removeCallbacks(poll);
        sensors.unregisterListener(levelListener);
        // The camera must stop drawing into a viewfinder nobody sees, or it would stall the encoder.
        if (service != null) {
            service.setPreview(null, null);
            service.histogram(null);
        }
        histogramOn = false;
        if (screenOff) screenOff(false);
        if (service != null) {
            unbindService(connection);
            service = null;
        }
        super.onStop();
    }

    @Override
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus) immersive();
    }

    private void immersive() {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code == 1 && results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            attach();
            autoStart();
        } else if (code == 1) {
            detail.setText("Rhema Camera needs the camera permission to show and send the picture.");
        } else if (code == 2) {
            sendNow();
        }
    }

    private final ServiceConnection connection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder b) {
            service = ((CameraService.Local) b).service();
            orientation();
            attach();
            autoStart();
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            service = null;
        }
    };

    /** The picture's upright way round: landscape, or the other landscape if this lens is mounted the other way. */
    private void orientation() {
        CameraManager cm = (CameraManager) getSystemService(CAMERA_SERVICE);
        String id = Caps.camera(cm, prefs.getString(Prefs.CAMERA, null));
        CameraCharacteristics c = id == null ? null : Caps.chars(cm, id);
        if (c == null) return;
        Integer sensor = c.get(CameraCharacteristics.SENSOR_ORIENTATION);
        Integer facing = c.get(CameraCharacteristics.LENS_FACING);
        int s = sensor == null ? 90 : sensor;
        boolean front = facing != null && facing == CameraMetadata.LENS_FACING_FRONT;
        int turn = front ? (s + 90) % 360 : (s - 90 + 360) % 360;
        setRequestedOrientation(turn == 180 ? ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
        transform();
    }

    private void attach() {
        if (service == null || surface == null || screenOff || !started) return;
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) return;
        service.setPreview(surface, null);
    }

    private void autoStart() {
        if (autoStartDone || service == null || service.sending) return;
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) return;
        autoStartDone = true;
        if (prefs.getBoolean(Prefs.AUTO_START, true) && Prefs.pairing(this) != null) startSending();
    }

    private void startSending() {
        if (service == null) return;
        if (Prefs.pairing(this) == null) {
            new AlertDialog.Builder(this).setTitle("Not paired yet")
                    .setMessage("In Rhema, open Production → Cameras, add a camera and use \"Rhema Camera app\": scan its QR code with this phone, or copy its link into Settings → Connection here.")
                    .setPositiveButton("Open Settings", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface d, int which) {
                            openSettings();
                        }
                    }).setNegativeButton("Later", null).show();
            return;
        }
        // The notification that says it is sending (Android 13+ asks first), and the microphone if sound is on.
        java.util.List<String> ask = new java.util.ArrayList<String>();
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) ask.add(Manifest.permission.POST_NOTIFICATIONS);
        if (prefs.getBoolean(Prefs.AUDIO, false) && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) ask.add(Manifest.permission.RECORD_AUDIO);
        if (!ask.isEmpty()) {
            requestPermissions(ask.toArray(new String[0]), 2);
            return;
        }
        sendNow();
    }

    private void sendNow() {
        if (service == null) return;
        String why = service.startSending();
        if (why != null) toast(why);
    }

    private void screenOff(boolean on) {
        screenOff = on;
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        lp.screenBrightness = on ? WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_OFF : WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
        getWindow().setAttributes(lp);
        black.setVisibility(on ? View.VISIBLE : View.GONE);
        if (on) {
            blackHint.setVisibility(View.VISIBLE);
            ui.postDelayed(new Runnable() {
                @Override
                public void run() {
                    blackHint.setVisibility(View.GONE);
                }
            }, 4000);
            sensors.unregisterListener(levelListener);
            if (service != null) service.setPreview(null, null);
            histogram();
        } else {
            blackHint.setVisibility(View.GONE);
            attach();
            applyOverlayPrefs();
            touched();
        }
    }

    private void touched() {
        touchedAt = android.os.SystemClock.uptimeMillis();
        controls(true);
    }

    private Boolean controlsShown;

    /** Shows or hides the controls; does nothing while they already are (no animation restarted). */
    private void controls(boolean show) {
        if (controlsShown != null && controlsShown == show) return;
        controlsShown = show;
        float a = show ? 1f : 0f;
        for (View v : new View[] {gear, dark, detail}) {
            v.animate().alpha(a).setDuration(250).start();
            v.setEnabled(show);
        }
    }

    private void toast(String s) {
        Toast.makeText(this, s, Toast.LENGTH_SHORT).show();
    }

    private void applyOverlayPrefs() {
        overlay.thirds = prefs.getBoolean(Prefs.GRID_THIRDS, false);
        overlay.centre = prefs.getBoolean(Prefs.GRID_CENTRE, false);
        overlay.safe = prefs.getBoolean(Prefs.GRID_SAFE, false);
        overlay.level = prefs.getBoolean(Prefs.LEVEL, false);
        overlay.histogram = prefs.getBoolean(Prefs.HISTOGRAM, false);
        String bars = prefs.getString(Prefs.BARS, "none");
        // Burnt in, the GPU draws the bars; otherwise they are a framing guide only.
        overlay.bars = prefs.getBoolean(Prefs.BURN, false) ? 0f : "239".equals(bars) ? 2.39f : "185".equals(bars) ? 1.85f : 0f;
        overlay.invalidate();
        sensors.unregisterListener(levelListener);
        if (overlay.level && started && !screenOff) {
            Sensor g = sensors.getDefaultSensor(Sensor.TYPE_GRAVITY);
            if (g == null) g = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
            if (g != null) sensors.registerListener(levelListener, g, SensorManager.SENSOR_DELAY_UI);
        }
    }

    private final SensorEventListener levelListener = new SensorEventListener() {
        @Override
        public void onSensorChanged(SensorEvent e) {
            int rot = getWindowManager().getDefaultDisplay().getRotation();
            float gx = e.values[0], gy = e.values[1];
            // The screen's up and right in the phone's axes, for each landscape way round.
            float up = rot == Surface.ROTATION_270 ? -gx : gx, right = rot == Surface.ROTATION_270 ? gy : -gy;
            float roll = (float) Math.toDegrees(Math.atan2(right, up));
            float before = overlay.roll;
            overlay.roll = Float.isNaN(before) ? roll : before * 0.8f + roll * 0.2f;
            // Redraw only for a visible change, at most about 15 times a second.
            long now = android.os.SystemClock.uptimeMillis();
            if ((Float.isNaN(before) || Math.abs(overlay.roll - before) > 0.15f) && now - levelDrawnAt > 66) {
                levelDrawnAt = now;
                overlay.invalidate();
            }
        }

        @Override
        public void onAccuracyChanged(Sensor s, int a) { }
    };

    /** Where the GPU draws the 16:9 picture in the screen (fitted, centred), for the overlay. */
    private void transform() {
        int vw = view.getWidth(), vh = view.getHeight();
        if (vw == 0 || vh == 0) return;
        float pw = vw, ph = vw * 9f / 16f;
        if (ph > vh) {
            ph = vh;
            pw = vh * 16f / 9f;
        }
        overlay.picture.set((vw - pw) / 2, (vh - ph) / 2, (vw + pw) / 2, (vh + ph) / 2);
        overlay.invalidate();
    }

    private final SurfaceHolder.Callback holderCallback = new SurfaceHolder.Callback() {
        @Override
        public void surfaceCreated(SurfaceHolder h) {
            surface = h.getSurface();
            transform();
            attach();
        }

        @Override
        public void surfaceChanged(SurfaceHolder h, int format, int w, int hgt) {
            // The GPU reads the surface's size each frame; only the overlay needs telling.
            transform();
        }

        @Override
        public void surfaceDestroyed(SurfaceHolder h) {
            surface = null;
            // The GPU must let go of the surface before this returns.
            if (service != null) {
                service.dropViewfinderNow();
                service.setPreview(null, null);
            }
        }
    };

    private boolean histogramOn;
    private long levelDrawnAt;
    private String shownLabel;
    private String shownAction;
    private int shownColour;

    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            if (!started) return;
            update();
            ui.postDelayed(this, 400);
        }
    };

    private void update() {
        CameraService s = service;
        Pairing p = Prefs.pairing(this);
        boolean live = s != null && s.sending && s.publisher() != null && s.publisher().live();
        CamAction.State state = CamAction.resolve(p != null, s != null && s.sending, live);
        int color = "LIVE".equals(state.status) ? Ui.LIVE
                : "CONNECTING".equals(state.status) ? Ui.AMBER : Ui.IDLE;
        String label = state.status;
        // Views change only when what they show changes (no layout work twice a second for nothing).
        if (color != shownColour || !label.equals(shownLabel)) {
            shownColour = color;
            shownLabel = label;
            android.graphics.drawable.GradientDrawable d = Ui.dot(color);
            int size = Ui.dp(this, 9);
            d.setSize(size, size);
            d.setBounds(0, 0, size, size);
            pill.setCompoundDrawables(d, null, null, null);
            pill.setText(label);
        }
        if (!state.action.equals(shownAction)) {
            shownAction = state.action;
            if (shownAction.isEmpty()) {
                sendAction.setVisibility(View.GONE);
            } else {
                sendAction.setText(shownAction);
                sendAction.setContentDescription("CONNECT".equals(shownAction)
                        ? "Connect this phone to Rhema" : "Send camera to Rhema");
                sendAction.setVisibility(View.VISIBLE);
            }
        }
        String text = "";
        if (s != null) {
            if (s.cameraError != null) text = s.cameraError;
            else if (s.sending && !live) text = s.status;
            else if (!s.sending) text = p == null ? "Tap to pair with Rhema" : "Tap to send to Rhema as \"" + p.title() + "\"";
            else if (s.shape != null) text = s.shape.height + "p" + s.shape.fps + " · " + String.format(java.util.Locale.ROOT, "%.1f Mbit/s", s.mbps);
        }
        if (!text.contentEquals(detail.getText())) detail.setText(text);
        String h = s == null ? "" : !s.note.isEmpty() ? s.note : s.focusHeld() ? "Focus held here · double-tap to follow the scene" : "";
        if (!h.contentEquals(hint.getText())) hint.setText(h);
        int hv = h.isEmpty() || screenOff ? View.GONE : View.VISIBLE;
        if (hint.getVisibility() != hv) hint.setVisibility(hv);
        boolean problem = s != null && (s.cameraError != null || (s.sending && !live));
        if (!problem && android.os.SystemClock.uptimeMillis() - touchedAt > 4000) controls(false);
        else if (problem) controls(true);
        histogram();
    }

    /** The histogram comes from the GPU (a 64 × 36 copy of the graded picture, twice a second), only while shown. */
    private void histogram() {
        CameraService s = service;
        if (s == null) return;
        boolean want = overlay.histogram && started && !screenOff;
        if (want == histogramOn) return;
        histogramOn = want;
        s.histogram(want ? new Gpu.Histogram() {
            @Override
            public void bins(final int[] counts) {
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        overlay.bins = counts;
                        overlay.invalidate();
                    }
                });
            }
        } : null);
    }
}
