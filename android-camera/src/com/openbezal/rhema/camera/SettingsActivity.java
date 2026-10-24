package com.openbezal.rhema.camera;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.InputType;
import android.util.Range;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Everything that is not the picture: the connection to Rhema and pairing, the picture, white
 * balance, exposure, focus, what is drawn on screen, sound, battery and heat, and what this phone
 * can do. Plain words first; the technical parts fold away under Advanced.
 */
public final class SettingsActivity extends Activity {
    private SharedPreferences prefs;
    private CameraService service;
    private ScrollView scroll;
    private LinearLayout body;
    private final Set<String> open = new HashSet<String>();
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final List<Runnable> live = new ArrayList<Runnable>();
    private CameraCharacteristics chars;
    private boolean visible;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        setTitle("Rhema Camera settings");
        prefs = Prefs.get(this);
        scroll = new ScrollView(this);
        scroll.setBackgroundColor(Ui.BG);
        body = Ui.column(this);
        Ui.pad(body, this, 16, 12);
        scroll.addView(body, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(scroll);
    }

    @Override
    protected void onStart() {
        super.onStart();
        visible = true;
        bindService(new Intent(this, CameraService.class), connection, Context.BIND_AUTO_CREATE);
        render();
        ui.post(refresh);
    }

    @Override
    protected void onStop() {
        visible = false;
        ui.removeCallbacks(refresh);
        if (service != null) {
            unbindService(connection);
            service = null;
        }
        super.onStop();
    }

    private final ServiceConnection connection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName n, IBinder b) {
            service = ((CameraService.Local) b).service();
            render();
        }

        @Override
        public void onServiceDisconnected(ComponentName n) {
            service = null;
        }
    };

    private final Runnable refresh = new Runnable() {
        @Override
        public void run() {
            if (!visible) return;
            for (Runnable r : live) r.run();
            ui.postDelayed(this, 1000);
        }
    };

    // ---- Building the page ----

    private void render() {
        final int y = scroll.getScrollY();
        body.removeAllViews();
        live.clear();
        CameraManager cm = (CameraManager) getSystemService(CAMERA_SERVICE);
        String id = Caps.camera(cm, prefs.getString(Prefs.CAMERA, null));
        chars = id == null ? null : Caps.chars(cm, id);
        connection();
        look();
        picture(cm, id);
        whiteBalance();
        exposure();
        focus();
        onScreen();
        sound();
        battery();
        about();
        for (Runnable r : live) r.run();
        scroll.post(new Runnable() {
            @Override
            public void run() {
                scroll.scrollTo(0, y);
            }
        });
    }

    private LinearLayout card(String title) {
        TextView h = Ui.text(this, title.toUpperCase(Locale.ROOT), 12, Ui.TEAL_TEXT, true);
        h.setLetterSpacing(0.1f);
        h.setPadding(Ui.dp(this, 4), Ui.dp(this, 18), 0, Ui.dp(this, 8));
        body.addView(h);
        LinearLayout c = Ui.column(this);
        c.setBackground(Ui.round(Ui.CARD, Ui.dp(this, 12)));
        Ui.pad(c, this, 16, 10);
        body.addView(c, Ui.wide());
        return c;
    }

    private TextView note(LinearLayout parent, String s) {
        TextView t = Ui.text(this, s, 13, Ui.MUTED, false);
        t.setPadding(0, Ui.dp(this, 4), 0, Ui.dp(this, 8));
        parent.addView(t);
        return t;
    }

    /** A label and its value on one line; returns the value's view. */
    private TextView info(LinearLayout parent, String label, String value) {
        LinearLayout r = Ui.row(this);
        r.setPadding(0, Ui.dp(this, 6), 0, Ui.dp(this, 6));
        r.addView(Ui.text(this, label, 15, Ui.FG, false), Ui.fill());
        TextView v = Ui.text(this, value, 15, Ui.MUTED, false);
        v.setGravity(Gravity.END);
        r.addView(v);
        parent.addView(r, Ui.wide());
        return v;
    }

    interface Pick {
        void picked(int which);
    }

    /** A setting with a few choices: shows the current one, opens a list. */
    private void choice(LinearLayout parent, final String label, final String[] names, int current, String help, final Pick pick) {
        LinearLayout r = Ui.column(this);
        r.setPadding(0, Ui.dp(this, 8), 0, Ui.dp(this, 8));
        LinearLayout line = Ui.row(this);
        line.addView(Ui.text(this, label, 15, Ui.FG, false), Ui.fill());
        line.addView(Ui.text(this, current >= 0 && current < names.length ? names[current] : "—", 15, Ui.TEAL_TEXT, false));
        r.addView(line, Ui.wide());
        if (help != null && !help.isEmpty()) r.addView(Ui.text(this, help, 13, Ui.MUTED, false));
        final int cur = current;
        r.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                new AlertDialog.Builder(SettingsActivity.this).setTitle(label).setSingleChoiceItems(names, cur, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int which) {
                        d.dismiss();
                        pick.picked(which);
                        render();
                    }
                }).show();
            }
        });
        r.setBackground(getDrawable(android.R.drawable.list_selector_background));
        parent.addView(r, Ui.wide());
    }

    private void toggle(LinearLayout parent, String label, String help, final String key, boolean dflt, final boolean rerender) {
        LinearLayout r = Ui.column(this);
        r.setPadding(0, Ui.dp(this, 6), 0, Ui.dp(this, 6));
        Switch s = new Switch(this);
        s.setText(label);
        s.setTextColor(Ui.FG);
        s.setTextSize(15);
        s.setChecked(prefs.getBoolean(key, dflt));
        s.setOnCheckedChangeListener(new android.widget.CompoundButton.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(android.widget.CompoundButton b, boolean on) {
                prefs.edit().putBoolean(key, on).apply();
                if (Prefs.AUDIO.equals(key) && on && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO}, 3);
                }
                if (rerender) render();
            }
        });
        r.addView(s, Ui.wide());
        if (help != null) r.addView(Ui.text(this, help, 13, Ui.MUTED, false));
        parent.addView(r, Ui.wide());
    }

    interface Slide {
        /** The value's words for a slider position. */
        String label(int pos);

        void done(int pos);
    }

    private void slider(LinearLayout parent, String label, int max, int pos, final Slide slide) {
        LinearLayout r = Ui.column(this);
        r.setPadding(0, Ui.dp(this, 8), 0, Ui.dp(this, 4));
        LinearLayout line = Ui.row(this);
        line.addView(Ui.text(this, label, 15, Ui.FG, false), Ui.fill());
        final TextView value = Ui.text(this, slide.label(pos), 15, Ui.TEAL_TEXT, false);
        line.addView(value);
        r.addView(line, Ui.wide());
        SeekBar bar = new SeekBar(this);
        bar.setMax(max);
        bar.setProgress(pos);
        bar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar s, int p, boolean user) {
                value.setText(slide.label(p));
                if (user) slide.done(p);
            }

            @Override
            public void onStartTrackingTouch(SeekBar s) { }

            @Override
            public void onStopTrackingTouch(SeekBar s) {
                slide.done(s.getProgress());
            }
        });
        r.addView(bar, Ui.wide());
        parent.addView(r, Ui.wide());
    }

    private Button button(LinearLayout parent, String label, boolean primary, View.OnClickListener click) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextColor(primary ? 0xFFFFFFFF : Ui.TEAL_TEXT);
        b.setBackground(primary ? Ui.round(Ui.TEAL, Ui.dp(this, 8)) : Ui.round(Ui.BORDER, Ui.dp(this, 8)));
        b.setOnClickListener(click);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(this, 40));
        lp.setMargins(0, Ui.dp(this, 6), Ui.dp(this, 8), Ui.dp(this, 6));
        Ui.pad(b, this, 16, 0);
        parent.addView(b, lp);
        return b;
    }

    /** "Advanced": folded until opened (stays open while this page is). */
    private LinearLayout fold(LinearLayout parent, final String key) {
        final LinearLayout inner = Ui.column(this);
        final TextView head = Ui.text(this, (open.contains(key) ? "▾ " : "▸ ") + "Advanced", 14, Ui.TEAL_TEXT, true);
        head.setPadding(0, Ui.dp(this, 10), 0, Ui.dp(this, 6));
        head.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (!open.remove(key)) open.add(key);
                inner.setVisibility(open.contains(key) ? View.VISIBLE : View.GONE);
                head.setText((open.contains(key) ? "▾ " : "▸ ") + "Advanced");
            }
        });
        parent.addView(head);
        inner.setVisibility(open.contains(key) ? View.VISIBLE : View.GONE);
        parent.addView(inner, Ui.wide());
        return inner;
    }

    // ---- The sections ----

    private void connection() {
        LinearLayout c = card("Connection");
        final Pairing p = Prefs.pairing(this);
        final TextView state = Ui.text(this, "", 17, Ui.FG, true);
        state.setPadding(0, Ui.dp(this, 6), 0, Ui.dp(this, 2));
        c.addView(state);
        final TextView why = note(c, "");
        if (p == null) {
            state.setText("Not paired");
            why.setText("In Rhema: Production → Cameras → add a camera → \"Rhema Camera app\". Scan its QR code with this phone's camera, or copy the link and paste it here.");
        } else {
            info(c, "Rhema", p.host + ":" + p.port);
            info(c, "This camera", p.title());
        }
        final TextView sent = p == null ? null : info(c, "Picture sent", "—");
        final TextView rate = p == null ? null : info(c, "Bitrate", "—");
        final TextView fps = p == null ? null : info(c, "Frames a second sent", "—");
        final TextView drops = p == null ? null : info(c, "Dropped frames", "—");
        live.add(new Runnable() {
            @Override
            public void run() {
                CameraService s = service;
                if (p == null) return;
                boolean on = s != null && s.sending;
                Publisher pub = s == null ? null : s.publisher();
                boolean isLive = pub != null && pub.live();
                state.setText(isLive ? "● Sending to Rhema" : on ? "Connecting…" : "Not sending");
                state.setTextColor(isLive ? Ui.LIVE : on ? Ui.AMBER : Ui.FG);
                why.setText(s == null ? "" : s.cameraError != null ? s.cameraError : on && !isLive ? s.status : on ? "" : "Press Start sending, or tap the dot on the viewfinder.");
                why.setVisibility(why.getText().length() == 0 ? View.GONE : View.VISIBLE);
                Plan.Shape sh = s == null ? null : s.shape;
                sent.setText(sh == null ? "—" : sh.height + "p · " + sh.fps + " fps · " + (sh.hevc ? "HEVC" : "H.264"));
                rate.setText(sh == null ? "—" : String.format(Locale.ROOT, "%.1f of %.1f Mbit/s", s.mbps, sh.bitrate / 1e6));
                fps.setText(isLive ? String.format(Locale.ROOT, "%.1f", s.fpsSent) : "—");
                drops.setText(pub == null ? "—" : pub.framesDropped + (pub.reconnects > 0 ? " · reconnected " + pub.reconnects + "×" : ""));
            }
        });
        LinearLayout buttons = Ui.row(this);
        buttons.setGravity(Gravity.START);
        if (p != null) {
            final boolean on = service != null && service.sending;
            button(buttons, on ? "Stop sending" : "Start sending", !on, new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    if (service == null) return;
                    if (service.sending) service.stopSending();
                    else {
                        String err = service.startSending();
                        if (err != null) why.setText(err);
                    }
                    ui.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            render();
                        }
                    }, 300);
                }
            });
        }
        button(buttons, p == null ? "Paste the pairing link" : "Pair again", p == null, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                paste();
            }
        });
        c.addView(buttons, Ui.wide());
        toggle(c, "Start sending when the app opens", "Open Rhema Camera on the stand and it goes live by itself.", Prefs.AUTO_START, true, false);
        if (p != null) {
            LinearLayout adv = fold(c, "connection");
            note(adv, "Sends RTSP over TLS (RTSPS) to " + p.url() + " as " + p.user + ", picture and sound interleaved over TCP. Only Rhema's certificate is accepted (SHA-256 " + p.fp.substring(0, 16) + "…); there is no unencrypted fallback.");
            button(adv, "Forget this Rhema", false, new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    if (service != null) service.stopSending();
                    prefs.edit().remove(Prefs.PAIR).apply();
                    render();
                }
            });
        }
    }

    // ---- The look ----

    private static final int PICK_CUBE = 7;
    private int sampleTick;

    private void look() {
        LinearLayout c = card("Look");
        note(c, "The colour grade every frame gets on this phone's graphics chip before it is sent. What the viewfinder shows is what Rhema gets.");
        final String current = prefs.getString(Prefs.LOOK, "studio");
        final boolean hasCube = new java.io.File(getFilesDir(), "look.cube").isFile();
        final List<String> ids = new ArrayList<String>(java.util.Arrays.asList(Looks.IDS));
        if (hasCube) ids.add("cube");
        android.widget.HorizontalScrollView hs = new android.widget.HorizontalScrollView(this);
        hs.setHorizontalScrollBarEnabled(false);
        LinearLayout chips = Ui.row(this);
        hs.addView(chips);
        final List<android.widget.ImageView> images = new ArrayList<android.widget.ImageView>();
        for (final String id : ids) {
            LinearLayout chip = Ui.column(this);
            chip.setGravity(Gravity.CENTER_HORIZONTAL);
            Ui.pad(chip, this, 4, 4);
            boolean on = id.equals(current);
            android.widget.ImageView img = new android.widget.ImageView(this);
            img.setScaleType(android.widget.ImageView.ScaleType.CENTER_CROP);
            img.setBackground(Ui.round(on ? Ui.TEAL_TEXT : Ui.BORDER, Ui.dp(this, 8)));
            int pad = Ui.dp(this, on ? 3 : 1);
            img.setPadding(pad, pad, pad, pad);
            img.setContentDescription(Looks.name(id));
            chip.addView(img, new LinearLayout.LayoutParams(Ui.dp(this, 112), Ui.dp(this, 63)));
            TextView t = Ui.text(this, "cube".equals(id) ? prefs.getString(Prefs.CUBE_NAME, "Your look") : Looks.name(id), 13, on ? Ui.TEAL_TEXT : Ui.FG, on);
            t.setPadding(0, Ui.dp(this, 4), 0, 0);
            chip.addView(t);
            chip.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    prefs.edit().putString(Prefs.LOOK, id).apply();
                    render();
                }
            });
            chips.addView(chip);
            images.add(img);
        }
        c.addView(hs, Ui.wide());
        int ai = java.util.Arrays.asList(Looks.IDS).indexOf(current);
        note(c, ai >= 0 ? Looks.ABOUT[ai] : "Your own .cube look, mixed in by Strength.");
        // The chips show this camera's picture now in each look (the same maths as the GPU), every two seconds.
        live.add(new Runnable() {
            @Override
            public void run() {
                if (service == null || sampleTick++ % 2 != 0) return;
                service.sample(new Gpu.Pixels() {
                    @Override
                    public void got(final int[] px, final int w, final int h) {
                        ui.post(new Runnable() {
                            @Override
                            public void run() {
                                Lut cube = hasCube ? readCube() : null;
                                for (int i = 0; i < ids.size(); i++) images.get(i).setImageBitmap(preview(ids.get(i), px, w, h, cube));
                            }
                        });
                    }
                });
            }
        });
        if (!"off".equals(current)) {
            slider(c, "Strength", 100, prefs.getInt(Prefs.STRENGTH, 100), new Slide() {
                @Override
                public String label(int pos) {
                    return pos + " %";
                }

                @Override
                public void done(int pos) {
                    prefs.edit().putInt(Prefs.STRENGTH, pos).apply();
                }
            });
        }
        slider(c, "Warmth", 200, prefs.getInt(Prefs.WARMTH, 0) + 100, new Slide() {
            @Override
            public String label(int pos) {
                int v = pos - 100;
                return v == 0 ? "As the look" : (v > 0 ? "Warmer +" : "Cooler ") + v;
            }

            @Override
            public void done(int pos) {
                prefs.edit().putInt(Prefs.WARMTH, pos - 100).apply();
            }
        });
        slider(c, "Tint", 200, prefs.getInt(Prefs.TINT, 0) + 100, new Slide() {
            @Override
            public String label(int pos) {
                int v = pos - 100;
                return v == 0 ? "As the look" : (v > 0 ? "Magenta +" : "Green ") + v;
            }

            @Override
            public void done(int pos) {
                prefs.edit().putInt(Prefs.TINT, pos - 100).apply();
            }
        });
        toggle(c, "Film grain", "A fine, moving grain, as film has. Off by default.", Prefs.GRAIN, false, false);
        final String[] bars = {"none", "239", "185"};
        String b = prefs.getString(Prefs.BARS, "none");
        choice(c, "Letterbox", new String[] {"None", "2.39 : 1 (cinema scope)", "1.85 : 1 (cinema flat)"}, java.util.Arrays.asList(bars).indexOf(b),
                "A framing guide on this screen.", new Pick() {
                    @Override
                    public void picked(int which) {
                        prefs.edit().putString(Prefs.BARS, bars[which]).apply();
                    }
                });
        if (!"none".equals(b)) toggle(c, "Burn the bars into the picture sent", "Off: the bars are only a guide here, and Rhema gets the whole 16:9 picture.", Prefs.BURN, false, false);
        LinearLayout adv = fold(c, "look");
        note(adv, "Your own look: a 3D .cube file (from DaVinci Resolve, Premiere or a LUT pack), up to 64 points, for Rec.709 pictures. It replaces the built-in grade; Strength mixes it in.");
        LinearLayout row = Ui.row(this);
        button(row, hasCube ? "Load another .cube look" : "Load a .cube look", false, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                try {
                    startActivityForResult(i, PICK_CUBE);
                } catch (RuntimeException e) {
                    android.widget.Toast.makeText(SettingsActivity.this, "No file picker on this phone", android.widget.Toast.LENGTH_SHORT).show();
                }
            }
        });
        if (hasCube) {
            button(row, "Remove it", false, new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    new java.io.File(getFilesDir(), "look.cube").delete();
                    SharedPreferences.Editor e = prefs.edit().remove(Prefs.CUBE_NAME);
                    if ("cube".equals(prefs.getString(Prefs.LOOK, "studio"))) e.putString(Prefs.LOOK, "studio");
                    e.apply();
                    render();
                }
            });
        }
        adv.addView(row, Ui.wide());
        note(adv, "Every look is one pass on the graphics chip at the sending size; the viewfinder is drawn only while the screen is on. Off sends the camera's own picture (still through the graphics chip, unchanged).");
    }

    private Lut readCube() {
        try {
            java.io.File f = new java.io.File(getFilesDir(), "look.cube");
            return Lut.parse(new String(java.nio.file.Files.readAllBytes(f.toPath()), java.nio.charset.StandardCharsets.UTF_8));
        } catch (java.io.IOException | RuntimeException e) {
            return null;
        }
    }

    /** The camera's small picture in one look (the GPU's maths, in Java). */
    private android.graphics.Bitmap preview(String id, int[] px, int w, int h, Lut cube) {
        float strength = prefs.getInt(Prefs.STRENGTH, 100) / 100f;
        float warmth = prefs.getInt(Prefs.WARMTH, 0) / 100f, tint = prefs.getInt(Prefs.TINT, 0) / 100f;
        Looks.Params p = "cube".equals(id) ? Looks.at("off", 0f, warmth, tint) : Looks.at(id, strength, warmth, tint);
        int[] out = new int[px.length];
        float[] c = new float[3];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int v = px[x + y * w];
                c[0] = ((v >> 16) & 255) / 255f;
                c[1] = ((v >> 8) & 255) / 255f;
                c[2] = (v & 255) / 255f;
                if ("cube".equals(id) && cube != null) {
                    float[] o = c.clone();
                    cube.apply(o);
                    for (int i = 0; i < 3; i++) c[i] += (o[i] - c[i]) * strength;
                }
                if (!"off".equals(id)) Looks.apply(p, c, (x + 0.5f) / w, (y + 0.5f) / h);
                out[x + y * w] = 0xff000000 | (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255);
            }
        }
        return android.graphics.Bitmap.createBitmap(out, w, h, android.graphics.Bitmap.Config.ARGB_8888);
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != PICK_CUBE || result != RESULT_OK || data == null || data.getData() == null) return;
        try {
            java.io.InputStream in = getContentResolver().openInputStream(data.getData());
            if (in == null) throw new java.io.IOException("The file could not be opened");
            java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
            byte[] b = new byte[16384];
            int n;
            while ((n = in.read(b)) > 0) {
                buf.write(b, 0, n);
                if (buf.size() > 8 * 1024 * 1024) throw new java.io.IOException("The file is too big for a .cube look");
            }
            in.close();
            String text = new String(buf.toByteArray(), java.nio.charset.StandardCharsets.UTF_8);
            Lut.parse(text);
            java.nio.file.Files.write(new java.io.File(getFilesDir(), "look.cube").toPath(), buf.toByteArray());
            String name = data.getData().getLastPathSegment();
            name = name == null ? "Your look" : name.substring(name.lastIndexOf('/') + 1).replaceAll("(?i)\\.cube$", "");
            if (name.length() > 24) name = name.substring(0, 24);
            prefs.edit().putString(Prefs.CUBE_NAME, name).putString(Prefs.LOOK, "cube").apply();
            render();
        } catch (java.io.IOException | RuntimeException e) {
            new AlertDialog.Builder(this).setTitle("Not a look Rhema Camera can use").setMessage(e.getMessage()).setPositiveButton("OK", null).show();
        }
    }

    private void paste() {
        final EditText field = new EditText(this);
        field.setHint("rhema-camera://pair?…");
        field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        ClipboardManager cb = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        ClipData clip = cb == null ? null : cb.getPrimaryClip();
        if (clip != null && clip.getItemCount() > 0) {
            CharSequence t = clip.getItemAt(0).coerceToText(this);
            if (t != null && t.toString().trim().toLowerCase(Locale.ROOT).startsWith("rhema-camera://")) field.setText(t.toString().trim());
        }
        new AlertDialog.Builder(this).setTitle("Pairing link").setMessage("Copy the link from the camera's card in Rhema (Production → Cameras → Rhema Camera app) and paste it here.")
                .setView(field)
                .setPositiveButton("Pair", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int which) {
                        MainActivity.ask(SettingsActivity.this, field.getText().toString(), new Runnable() {
                            @Override
                            public void run() {
                                render();
                            }
                        });
                    }
                }).setNegativeButton("Cancel", null).show();
    }

    private void picture(CameraManager cm, String id) {
        LinearLayout c = card("Picture");
        if (chars == null) {
            note(c, "No camera found that Rhema Camera can use.");
            return;
        }
        final List<Plan.Preset> presets = Caps.presets(chars);
        String presetId = prefs.getString(Prefs.PRESET, "cine24");
        Plan.Preset preset = Plan.preset(presetId);
        if (preset == null || !presets.contains(preset)) preset = presets.isEmpty() ? Plan.preset("smooth30") : presets.contains(Plan.preset("cine24")) ? Plan.preset("cine24") : presets.get(presets.size() - 1);
        String[] names = new String[presets.size()];
        for (int i = 0; i < names.length; i++) names[i] = presets.get(i).label;
        List<String> missing = new ArrayList<String>();
        for (Plan.Preset x : Plan.PRESETS) if (!presets.contains(x)) missing.add(x.label);
        choice(c, "Look", names, presets.indexOf(preset), preset.about + (missing.isEmpty() ? "" : ". This phone cannot hold " + join(missing) + "."), new Pick() {
            @Override
            public void picked(int which) {
                prefs.edit().putString(Prefs.PRESET, presets.get(which).id).apply();
            }
        });
        final String codec = prefs.getString(Prefs.CODEC, "auto");
        final List<Integer> heights = Caps.sizes(chars, preset.fps, codec);
        String[] sizes = new String[heights.size()];
        for (int i = 0; i < sizes.length; i++) sizes[i] = Plan.sizeLabel(heights.get(i));
        int h = prefs.getInt(Prefs.HEIGHT, 0);
        int cur = heights.indexOf(h);
        if (cur < 0) cur = 0;
        String sizeHelp = heights.contains(2160) ? "" : "This phone's camera and encoder go up to " + (heights.isEmpty() ? "—" : Plan.sizeLabel(heights.get(0))) + " at " + preset.fps + " frames a second; 4K needs a phone that encodes it.";
        choice(c, "Size", sizes, cur, sizeHelp, new Pick() {
            @Override
            public void picked(int which) {
                prefs.edit().putInt(Prefs.HEIGHT, heights.get(which)).apply();
            }
        });
        final List<Caps.Lens> lenses = Caps.lenses(cm);
        String[] lensNames = new String[lenses.size()];
        int lensIndex = 0;
        for (int i = 0; i < lensNames.length; i++) {
            lensNames[i] = lenses.get(i).label;
            if (lenses.get(i).id.equals(id)) lensIndex = i;
        }
        choice(c, "Camera", lensNames, lensIndex, null, new Pick() {
            @Override
            public void picked(int which) {
                prefs.edit().putString(Prefs.CAMERA, lenses.get(which).id).apply();
            }
        });
        if (Caps.opticalStabilisation(chars)) toggle(c, "Optical stabilisation", "Steadies a hand-held phone. Leave off on a tripod.", Prefs.STAB_OPTICAL, false, false);
        if (Caps.videoStabilisation(chars)) toggle(c, "Electronic stabilisation", "Steadier when hand-held, but crops the picture a little. Leave off on a tripod.", Prefs.STAB_VIDEO, false, false);

        LinearLayout adv = fold(c, "picture");
        boolean hevcHw = Caps.encoder(Caps.HEVC) != null;
        final String[] codecIds = hevcHw ? new String[] {"auto", "h264", "hevc"} : new String[] {"auto", "h264"};
        String[] codecNames = hevcHw ? new String[] {"Automatic (H.264)", "H.264 High", "HEVC (best quality, for OBS only — Rhema screens and TVs may not show it)"} : new String[] {"Automatic (H.264)", "H.264 High"};
        int ci = 0;
        for (int i = 0; i < codecIds.length; i++) if (codecIds[i].equals(codec)) ci = i;
        choice(adv, "Codec", codecNames, ci, hevcHw ? "Automatic is always H.264, which every Rhema screen, Google TV and OBS plays. HEVC gives a better picture for the same bitrate, but only OBS is sure to show it: Rhema's screens and TVs may show nothing. 8-bit colour (never HDR)."
                : "This phone has no hardware HEVC encoder, so it sends H.264 (8-bit colour).", new Pick() {
                    @Override
                    public void picked(int which) {
                        prefs.edit().putString(Prefs.CODEC, codecIds[which]).apply();
                    }
                });
        int width = Caps.widthFor(heights.isEmpty() ? 1080 : heights.get(Math.max(0, cur)));
        int height = heights.isEmpty() ? 1080 : heights.get(Math.max(0, cur));
        String mime = Caps.codecFor(codec, width, height, preset.fps);
        boolean hevc = Caps.HEVC.equals(mime);
        int auto = Plan.autoBitrate(width, height, preset.fps, hevc);
        int encMax = Caps.maxBitrate(Caps.encoder(mime == null ? Caps.AVC : mime), mime == null ? Caps.AVC : mime);
        final int[] mbps = {0, 6, 8, 10, 12, 16, 20, 25, 30, 40, 50, 60, 80};
        List<String> rn = new ArrayList<String>();
        final List<Integer> rv = new ArrayList<Integer>();
        for (int m : mbps) {
            if (m > 0 && encMax > 0 && m * 1_000_000 > encMax) continue;
            rv.add(m);
            rn.add(m == 0 ? String.format(Locale.ROOT, "Automatic (%.1f Mbit/s)", Plan.capBitrate(auto, service == null ? 0 : service.wifiUplinkMbps(), encMax) / 1e6) : m + " Mbit/s");
        }
        int bi = Math.max(0, rv.indexOf(prefs.getInt(Prefs.BITRATE, 0)));
        choice(adv, "Bitrate", rn.toArray(new String[0]), bi, "Automatic works it out from size and frame rate (4K24 about 48, 1080p30 about 14 Mbit/s), never above this phone's encoder (" + (encMax / 1_000_000) + " Mbit/s) or about 45 % of the Wi-Fi link.", new Pick() {
            @Override
            public void picked(int which) {
                prefs.edit().putInt(Prefs.BITRATE, rv.get(which)).apply();
            }
        });
        note(adv, "A full picture every second, no B-frames, constant bitrate where the encoder offers it. Encoder: " + (Caps.encoder(mime == null ? Caps.AVC : mime) == null ? "none" : Caps.encoder(mime == null ? Caps.AVC : mime).getName()) + " (hardware).");
    }

    private static String join(List<String> l) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < l.size(); i++) sb.append(i == 0 ? "" : i == l.size() - 1 ? " or " : ", ").append(l.get(i));
        return sb.toString();
    }

    private void whiteBalance() {
        LinearLayout c = card("White balance");
        if (chars == null) return;
        boolean manualPost = Caps.manualPost(chars);
        final String[] ids = manualPost ? new String[] {"auto", "daylight", "cloudy", "tungsten", "fluorescent", "kelvin"} : new String[] {"auto", "daylight", "cloudy", "tungsten", "fluorescent"};
        String[] names = manualPost ? new String[] {"Automatic", "Daylight", "Cloudy", "Tungsten (warm bulbs)", "Fluorescent", "Kelvin"} : new String[] {"Automatic", "Daylight", "Cloudy", "Tungsten (warm bulbs)", "Fluorescent"};
        String mode = prefs.getString(Prefs.WB, "auto");
        int i = 0;
        for (int k = 0; k < ids.length; k++) if (ids[k].equals(mode)) i = k;
        choice(c, "White balance", names, i, manualPost ? "Choose Kelvin to match the church lights exactly (LED stage lights are often 5600 K, warm bulbs 3200 K)." : "This phone does not let apps set kelvin; the presets cover most rooms.", new Pick() {
            @Override
            public void picked(int which) {
                prefs.edit().putString(Prefs.WB, ids[which]).apply();
            }
        });
        if ("kelvin".equals(mode) && manualPost) {
            slider(c, "Colour temperature", (10000 - 2500) / 100, (prefs.getInt(Prefs.KELVIN, 5600) - 2500) / 100, new Slide() {
                @Override
                public String label(int pos) {
                    return (2500 + pos * 100) + " K";
                }

                @Override
                public void done(int pos) {
                    prefs.edit().putInt(Prefs.KELVIN, 2500 + pos * 100).apply();
                }
            });
            LinearLayout adv = fold(c, "wb");
            note(adv, "Kelvin is worked out from the camera's own Daylight and Tungsten measurements (taken once per camera, about a second).");
            button(adv, "Measure again", false, new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    prefs.edit().remove(Prefs.ANCHORS + Caps.camera((CameraManager) getSystemService(CAMERA_SERVICE), prefs.getString(Prefs.CAMERA, null))).apply();
                    if (service != null) service.controlsChanged();
                }
            });
        }
        if ("auto".equals(mode)) toggle(c, "Hold white balance", "Keeps the colour as it is now, so it does not drift when someone in bright clothes walks in.", Prefs.WB_LOCK, false, false);
    }

    private void exposure() {
        LinearLayout c = card("Exposure");
        if (chars == null) return;
        final boolean manualOk = Caps.manualSensor(chars);
        String mode = manualOk ? prefs.getString(Prefs.AE, "film") : "auto";
        final String[] modes = {"film", "auto", "manual"};
        choice(c, "Exposure", manualOk ? new String[] {"Film shutter (ISO follows the light)", "Automatic", "Manual (ISO and shutter)"} : new String[] {"Automatic"},
                manualOk ? java.util.Arrays.asList(modes).indexOf(mode) : 0,
                manualOk ? "Film shutter keeps the shutter at about 180 degrees (1/48 or 1/50 at 24 frames), the motion of cinema, and lets the ISO follow the light." : "This phone does not let apps set ISO and shutter.", new Pick() {
                    @Override
                    public void picked(int which) {
                        SharedPreferences.Editor e = prefs.edit().putString(Prefs.AE, manualOk ? modes[which] : "auto");
                        if (manualOk && which == 2) matchLight(e);
                        e.apply();
                    }
                });
        final int fps = fpsNow();
        if ("film".equals(mode)) {
            shutterChoice(c, fps);
            button(c, "Measure the light again", false, new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    if (service != null) service.remeasure();
                }
            });
            note(c, "At the start the camera measures the light for a moment; then the white balance holds (as a cinema camera's does) and the ISO follows the light. Measure again when the lights change a lot.");
        }
        if ("manual".equals(mode)) {
            final Range<Integer> iso = chars.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE);
            if (iso != null) {
                final int lo = iso.getLower(), hi = iso.getUpper();
                int now = prefs.getInt(Prefs.ISO, 0);
                if (now <= 0 && service != null) now = service.rig().iso();
                slider(c, "ISO", (hi - lo) / 10, (Math.max(lo, Math.min(hi, now)) - lo) / 10, new Slide() {
                    @Override
                    public String label(int pos) {
                        return String.valueOf(lo + pos * 10);
                    }

                    @Override
                    public void done(int pos) {
                        prefs.edit().putInt(Prefs.ISO, lo + pos * 10).apply();
                    }
                });
            }
            shutterChoice(c, fps);
            button(c, "Match the light now", false, new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    SharedPreferences.Editor e = prefs.edit();
                    matchLight(e);
                    e.apply();
                    render();
                }
            });
            note(c, "Sets the ISO from what automatic exposure last used, at this shutter.");
        }
        if (!"manual".equals(mode)) {
            Range<Integer> ev = chars.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_RANGE);
            android.util.Rational step = chars.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_STEP);
            if (ev != null && step != null && ev.getUpper() > ev.getLower()) {
                final int lo = ev.getLower();
                final double st = step.doubleValue();
                slider(c, "Brightness", ev.getUpper() - lo, prefs.getInt(Prefs.EV, 0) - lo, new Slide() {
                    @Override
                    public String label(int pos) {
                        double v = (lo + pos) * st;
                        return (v > 0 ? "+" : "") + String.format(Locale.ROOT, "%.1f", v) + " EV";
                    }

                    @Override
                    public void done(int pos) {
                        prefs.edit().putInt(Prefs.EV, lo + pos).apply();
                    }
                });
            }
            if ("auto".equals(mode)) toggle(c, "Hold exposure", "Keeps the brightness as it is now (useful when lights change during worship).", Prefs.AE_LOCK, false, false);
        }
        final String[] fl = {"auto", "50", "60", "off"};
        String f = prefs.getString(Prefs.FLICKER, "auto");
        int fi = 0;
        for (int k = 0; k < fl.length; k++) if (fl[k].equals(f)) fi = k;
        choice(c, "Mains lights (anti-flicker)", new String[] {"Automatic (50 Hz if unsure)", "50 Hz (Nigeria, UK, Europe, most of Africa)", "60 Hz (Americas, parts of Asia)", "Off"}, fi, null, new Pick() {
            @Override
            public void picked(int which) {
                prefs.edit().putString(Prefs.FLICKER, fl[which]).apply();
            }
        });
        if (service != null) {
            final TextView now = info(c, "Now", "—");
            live.add(new Runnable() {
                @Override
                public void run() {
                    String s = service == null ? "" : service.rig().now();
                    now.setText(s.isEmpty() ? "—" : s);
                }
            });
        }
    }

    private void shutterChoice(LinearLayout c, final int fps) {
        final int hz = Prefs.mainsHz(prefs);
        final long auto = Plan.shutterNs(fps, hz);
        final long[] times = {0, 1_000_000_000L / 50, 1_000_000_000L / 60, 1_000_000_000L / 100, 1_000_000_000L / 120, 1_000_000_000L / 250, 1_000_000_000L / 500, 1_000_000_000L / 1000};
        final List<Long> tv = new ArrayList<Long>();
        List<String> tn = new ArrayList<String>();
        for (long t : times) {
            if (t > 1_000_000_000L / fps) continue;
            tv.add(t);
            tn.add(t == 0 ? "Film shutter: " + Plan.shutterLabel(auto) + " (" + Plan.angle(auto, fps) + "°" + (hz > 0 ? ", no flicker at " + hz + " Hz" : "") + ")" : Plan.shutterLabel(t) + " (" + Plan.angle(t, fps) + "°)");
        }
        int ti = Math.max(0, tv.indexOf(prefs.getLong(Prefs.SHUTTER, 0)));
        choice(c, "Shutter", tn.toArray(new String[0]), ti, "Film shutter is about 180 degrees (half of each frame), adjusted so mains lights do not flicker.", new Pick() {
            @Override
            public void picked(int which) {
                prefs.edit().putLong(Prefs.SHUTTER, tv.get(which)).apply();
            }
        });
    }

    private int fpsNow() {
        Plan.Preset p = Plan.preset(prefs.getString(Prefs.PRESET, "cine24"));
        List<Plan.Preset> list = Caps.presets(chars);
        if (p == null || !list.contains(p)) p = list.isEmpty() ? Plan.preset("smooth30") : list.contains(Plan.preset("cine24")) ? Plan.preset("cine24") : list.get(list.size() - 1);
        return p.fps;
    }

    /** Manual ISO that gives the same brightness as automatic exposure just did, at the chosen shutter. */
    private void matchLight(SharedPreferences.Editor e) {
        if (service == null) return;
        Rig r = service.rig();
        if (r.lastIso <= 0 || r.lastExposureNs <= 0) return;
        long shutter = prefs.getLong(Prefs.SHUTTER, 0);
        if (shutter <= 0) shutter = Plan.shutterNs(fpsNow(), Prefs.mainsHz(prefs));
        long iso = Math.round(r.lastIso * (double) r.lastExposureNs / shutter);
        Range<Integer> range = chars.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE);
        if (range != null) iso = Math.max(range.getLower(), Math.min(range.getUpper(), iso));
        e.putInt(Prefs.ISO, (int) (iso / 10 * 10));
    }

    private void focus() {
        LinearLayout c = card("Focus and zoom");
        if (chars == null) return;
        boolean manualOk = Caps.manualFocus(chars);
        String mode = manualOk ? prefs.getString(Prefs.AF, "continuous") : "continuous";
        choice(c, "Focus", manualOk ? new String[] {"Follows the scene", "Manual distance"} : new String[] {"Follows the scene"}, "manual".equals(mode) ? 1 : 0,
                "Tap the viewfinder to focus there (it then holds); double-tap to follow the scene again.", new Pick() {
                    @Override
                    public void picked(int which) {
                        prefs.edit().putString(Prefs.AF, which == 1 ? "manual" : "continuous").apply();
                    }
                });
        if ("manual".equals(mode)) {
            Float minD = chars.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE);
            final float max = minD == null ? 10f : minD;
            slider(c, "Distance", 100, Math.round(prefs.getFloat(Prefs.FOCUS, 0f) / max * 100), new Slide() {
                @Override
                public String label(int pos) {
                    float dio = max * pos / 100f;
                    return dio <= 0.01f ? "Far (infinity)" : String.format(Locale.ROOT, "%.2f m", 1 / dio);
                }

                @Override
                public void done(int pos) {
                    prefs.edit().putFloat(Prefs.FOCUS, max * pos / 100f).apply();
                }
            });
        }
        final float maxZoom = service == null ? 1f : service.maxZoom();
        if (maxZoom > 1.01f) {
            slider(c, "Zoom", Math.round((maxZoom - 1) * 10), Math.round((prefs.getFloat(Prefs.ZOOM, 1f) - 1) * 10), new Slide() {
                @Override
                public String label(int pos) {
                    return String.format(Locale.ROOT, "%.1f×", 1 + pos / 10f);
                }

                @Override
                public void done(int pos) {
                    prefs.edit().putFloat(Prefs.ZOOM, 1 + pos / 10f).apply();
                    if (service != null) service.zoom(1 + pos / 10f);
                }
            });
            note(c, "Zoom crops the sensor, so the picture softens as you zoom in; pinch on the viewfinder too.");
        }
    }

    private void onScreen() {
        LinearLayout c = card("On screen");
        note(c, "Only on this phone's screen, never in the picture sent.");
        toggle(c, "Rule of thirds", null, Prefs.GRID_THIRDS, false, false);
        toggle(c, "Centre cross", null, Prefs.GRID_CENTRE, false, false);
        toggle(c, "Safe areas", "Title-safe (90 %) and action-safe (93 %) frames for words and lower thirds.", Prefs.GRID_SAFE, false, false);
        toggle(c, "Level", "A line that turns green when the phone is level.", Prefs.LEVEL, false, false);
        toggle(c, "Histogram", "How bright the picture is, darkest on the left.", Prefs.HISTOGRAM, false, false);
        toggle(c, "Show over the lock screen", "The viewfinder appears when the phone is locked, as the phone's own camera does; Settings still needs the PIN.", Prefs.OVER_LOCK, true, false);
    }

    private void sound() {
        LinearLayout c = card("Sound");
        toggle(c, "Send this phone's microphone", "Off by default: the church sound desk has the sound. Turn on only for a room microphone (it hears the room, not the mixer).", Prefs.AUDIO, false, false);
    }

    private void battery() {
        LinearLayout c = card("Battery and heat");
        final TextView level = info(c, "Battery", "—");
        final TextView heat = info(c, "Temperature", "—");
        final TextView draw = info(c, "Battery current", "—");
        final TextView state = note(c, "");
        live.add(new Runnable() {
            @Override
            public void run() {
                if (service == null) return;
                float[] b = service.battery();
                level.setText(b[0] < 0 ? "—" : Math.round(b[0]) + " %" + (b[2] > 0 ? " · charging" : ""));
                heat.setText(b[1] < -5 ? "—" : String.format(Locale.ROOT, "%.0f °C", b[1]));
                int ma = service.batteryMilliamps();
                // Phones differ on the sign, so only the size is shown.
                draw.setText(ma == 0 ? "—" : Math.abs(ma) + " mA");
                String n = Plan.thermalNote(service.thermalStep);
                state.setText(n.isEmpty() ? "Cool enough: sending as chosen." : n);
            }
        });
        note(c, "To save battery: keep the phone on a charger, use Screen off (the moon button: the screen goes black and the camera feeds only the encoder), or press the power button: sending carries on with the screen off. A smaller size or a lower frame rate uses less.");
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        boolean free = pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
        note(c, free ? "Android lets Rhema Camera run with the screen off." : "Some phones stop apps with the screen off to save battery. If sending stops when the screen is off, let Rhema Camera run unrestricted:");
        if (!free) {
            button(c, "Battery settings", false, new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    try {
                        startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                    } catch (RuntimeException e) {
                        startActivity(new Intent(Settings.ACTION_SETTINGS));
                    }
                }
            });
        }
        LinearLayout adv = fold(c, "battery");
        note(adv, "While sending, Rhema Camera is a foreground service (its notification says so) with a partial wake lock and a high-performance Wi-Fi lock. Android " + Build.VERSION.RELEASE + ". From Android 9 only a foreground service may use the camera with the screen off; Android 14 asks for the camera and microphone service types, which this app declares. Some makers (Xiaomi, Huawei, Samsung's \"sleeping apps\") still stop apps unless allowed above. When the phone gets hot (Android 10+), sending steps down: bitrate 30 % lower, then 1080p and 30 frames a second, then 720p.");
    }

    private void about() {
        LinearLayout c = card("About");
        String version = "1.0.0.0";
        try {
            version = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException ignored) {
            // The built-in value.
        }
        info(c, "Rhema Camera", version);
        info(c, "This phone", Build.MANUFACTURER + " " + Build.MODEL + " · Android " + Build.VERSION.RELEASE);
        note(c, "Sends this phone's camera to Rhema Studio's camera router on the church network. Nothing goes to the internet.");
        LinearLayout adv = fold(c, "about");
        StringBuilder sb = new StringBuilder();
        for (Plan.Preset p : Plan.PRESETS) {
            List<Integer> h = chars == null ? new ArrayList<Integer>() : Caps.sizes(chars, p.fps, "auto");
            sb.append(p.label).append(": ").append(chars != null && Caps.fixedFps(chars, p.fps) && !h.isEmpty() ? "up to " + h.get(0) + "p" : "not on this phone").append('\n');
        }
        sb.append("HEVC encoder: ").append(Caps.encoder(Caps.HEVC) != null ? "yes" : "no").append('\n');
        sb.append("H.264 encoder: ").append(Caps.encoder(Caps.AVC) != null ? Caps.encoder(Caps.AVC).getName() + ", up to " + Caps.maxBitrate(Caps.encoder(Caps.AVC), Caps.AVC) / 1_000_000 + " Mbit/s" : "none").append('\n');
        sb.append("Manual ISO and shutter: ").append(Caps.manualSensor(chars) ? "yes" : "no").append('\n');
        sb.append("Kelvin white balance and cinematic curve: ").append(Caps.manualPost(chars) ? "yes" : "no").append('\n');
        sb.append("Manual focus: ").append(Caps.manualFocus(chars) ? "yes" : "no");
        note(adv, sb.toString());
    }
}
