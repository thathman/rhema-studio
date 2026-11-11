package com.openbezal.rhema.receiver;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.Uri;
import android.net.http.SslCertificate;
import android.net.http.SslError;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.RelativeSizeSpan;
import android.view.Display;
import android.view.Gravity;
import android.view.PixelCopy;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceResponse;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebSettings;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.Collections;
import java.util.List;

/**
 * Rhema Studio Receiver (#198, formerly Rhema Receiver): shows one Rhema browser feed full screen and keeps showing it, across
 * restarts and network drops. Until it has one, it shows its address and a code; Rhema checks that
 * code with this TV (CodeProof) and only then sends the feed's link (Outputs → the feed's settings →
 * Device → Show on a Google TV), so only someone who can see this screen assigns it. OK on the remote shows the address and a new code again. It
 * also tells the network it is here (mDNS/NSD), so Rhema can list it without anyone typing the address.
 *
 * Since 1.3 the link is Rhema's https page, sent encrypted with the fingerprint of Rhema's own
 * certificate; the TV opens the page only from a computer showing exactly that certificate, so
 * nobody on the network can read the link or stand in for Rhema.
 *
 * Since 1.5: the link carries this TV's own key (Rhema can revoke this TV alone; the page then
 * goes back to this code screen); GET /status says the display's size; the last picture of the
 * feed is kept (one bounded JPEG in the app's own storage) and shown at start until Rhema Studio
 * answers; and "Start with the TV" (on after the first pairing since 1.7) is turned on and off on the code screen with
 * ← or → on the remote.
 *
 * Since 1.7 (the 11 Nov review): Start with the TV turns on by itself after the first pairing (#834);
 * an output switched off in Rhema Studio shows a calm hold, not a fault (#835); no plain http and no
 * mixed content (#840); the code screen says when a code was tried and how many tries are left
 * (#841); and (#849) Identify TV (/identify), an edge inset for TVs that crop, and 60 Hz asked for.
 */
public class MainActivity extends Activity {
    static final int PORT = 8095;
    /** What Rhema looks for on the network to list this TV (Show on a Google TV → Find TVs). */
    static final String SERVICE_TYPE = "_rhema-tv._tcp";
    private static final int MAX_TRIES = 5;
    private static final long INFO_MS = 20_000;
    /** How long a code still works after it leaves the screen (time to finish typing it). */
    private static final long GRACE_MS = 120_000;
    private static final String REVOKED = "This screen's link no longer works (this TV was revoked, or a new link was made in Rhema Studio). Send the feed again.";
    /** Where a feed is sent to a TV in Rhema Studio (output-editor-dialog.tsx, Device tab). */
    static final String SEND_PATH = "Outputs → the feed's settings → Device → Show on a Google TV";
    private static final String NOT_THAT_RHEMA = "This TV did not open the feed: the main computer answering is not the Rhema Studio that sent it, or Rhema Studio made a new certificate. Send the feed again: in Rhema Studio, " + SEND_PATH + ".";

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final SecureRandom random = new SecureRandom();
    private SharedPreferences prefs;
    private WebView web;
    /** What the screen is made of: the page, the kept picture over it, the note, the code panel. */
    private FrameLayout root;
    /** The idle/code screen: the Rhema Studio Receiver logo over the TV's name, address and code. */
    private LinearLayout panel;
    private TextView info;
    private ShowServer server;
    private CodeProof.Code code;
    private int triesLeft;
    /**
     * Until when (elapsedRealtime) the code works: always while it is on screen, then GRACE_MS more.
     * Seeing the screen is what lets someone send it a feed, so a code seen once (or photographed,
     * or caught on a livestream of the stage) must not work days later.
     */
    private long codeUntil;
    private volatile String problem;
    private NsdManager nsd;
    /** The code checks waiting for their /show, one per computer (see challenge). */
    private final Pending pending = new Pending();
    private NsdManager.RegistrationListener advert;
    /** The last page load stopped because the certificate was not the one Rhema sent. */
    private boolean certRefused;
    /** The last picture of the feed (1.5), shown at start until the page is up. */
    private ImageView still;
    /** A small line over the kept picture while Rhema Studio does not answer. */
    private TextView note;
    /** The display's size in pixels, for GET /status (the server thread reads it). */
    private volatile int displayW;
    private volatile int displayH;
    /** How often the picture is kept while a feed shows. */
    private static final long STILL_EVERY_MS = 60_000;
    /** Whether the page has drawn a frame since it loaded (#604): until then the kept picture stays. */
    private final Ready ready = new Ready();
    /** Counts page loads, so an acknowledgement queued by the page before a reload is not the new one's. */
    private volatile int loads;
    /** What the code screen says about tries of its code (#841); guarded by this. */
    private final CodeTries tries = new CodeTries();
    /** The calm hold for an output switched off in Rhema Studio (#835): logo and one line, full screen. */
    private LinearLayout hold;
    /** The page says its output is off (and it is hearing Rhema Studio). */
    private boolean pageOff;
    /** The output's own overscan as the page says it (#849): when set, the TV-side inset is not added. */
    private double pageOverscan;
    /** The inset applied around the page now (percent of each edge). */
    private int insetShown = -1;
    /** Identify TV (#849): the TV's name, big, for a few seconds. */
    private TextView ident;
    /** The display's refresh rate (Hz), for GET /status. */
    private volatile float displayHz;
    /** At this start: the last boot's launch was refused by the TV (#834). */
    private boolean bootBlocked;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        prefs = getSharedPreferences("receiver", MODE_PRIVATE);

        // A debug build (RECEIVER_DEBUG=1) lets chrome://inspect read the page: WebRTC stats, console.
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
        web = newWeb();

        info = new TextView(this);
        info.setTextColor(Color.WHITE);
        info.setTextSize(24);
        info.setLineSpacing(0, 1.25f);
        info.setGravity(Gravity.CENTER);

        // The approved landscape logo (brand/02_Product_Logos/Rhema-Studio-Receiver-Light-Text.png, as is).
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.receiver_logo);
        logo.setAdjustViewBounds(true);
        logo.setContentDescription("Rhema Studio Receiver");
        float dp = getResources().getDisplayMetrics().density;
        panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER_HORIZONTAL);
        panel.setBackgroundColor(PANEL_BLACK);
        panel.setPadding(80, 48, 80, 60);
        LinearLayout.LayoutParams logoSize = new LinearLayout.LayoutParams((int) (300 * dp), -2);
        logoSize.bottomMargin = (int) (12 * dp);
        panel.addView(logo, logoSize);
        panel.addView(info, new LinearLayout.LayoutParams(-2, -2));

        still = new ImageView(this);
        still.setScaleType(ImageView.ScaleType.FIT_CENTER);
        still.setBackgroundColor(Color.BLACK);
        still.setVisibility(View.GONE);
        note = new TextView(this);
        note.setTextColor(Color.rgb(255, 197, 71));
        note.setTextSize(16);
        note.setBackgroundColor(Color.argb(160, 0, 0, 0));
        note.setPadding(24, 10, 24, 10);
        note.setVisibility(View.GONE);

        // The hold for an output that is off (#835): the same logo, one calm line, no countdown or error.
        ImageView holdLogo = new ImageView(this);
        holdLogo.setImageResource(R.drawable.receiver_logo);
        holdLogo.setAdjustViewBounds(true);
        holdLogo.setAlpha(0.85f);
        holdLogo.setContentDescription("Rhema Studio Receiver");
        TextView holdWords = new TextView(this);
        holdWords.setTextColor(Color.rgb(220, 220, 220));
        holdWords.setTextSize(26);
        holdWords.setGravity(Gravity.CENTER);
        holdWords.setText("This screen is off in Rhema Studio\n\nIt comes on by itself when the output is turned on.");
        hold = new LinearLayout(this);
        hold.setOrientation(LinearLayout.VERTICAL);
        hold.setGravity(Gravity.CENTER);
        hold.setBackgroundColor(Color.BLACK);
        LinearLayout.LayoutParams holdLogoSize = new LinearLayout.LayoutParams((int) (300 * dp), -2);
        holdLogoSize.bottomMargin = (int) (24 * dp);
        hold.addView(holdLogo, holdLogoSize);
        hold.addView(holdWords, new LinearLayout.LayoutParams(-2, -2));
        hold.setVisibility(View.GONE);

        ident = new TextView(this);
        ident.setTextColor(Color.WHITE);
        ident.setTextSize(64);
        ident.setGravity(Gravity.CENTER);
        ident.setBackgroundColor(IDENT_BLUE);
        ident.setPadding((int) (48 * dp), (int) (28 * dp), (int) (48 * dp), (int) (28 * dp));
        ident.setVisibility(View.GONE);

        root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        root.addView(still, new FrameLayout.LayoutParams(-1, -1));
        root.addView(hold, new FrameLayout.LayoutParams(-1, -1));
        FrameLayout.LayoutParams corner = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.END);
        corner.topMargin = (int) (16 * dp);
        corner.rightMargin = (int) (16 * dp);
        root.addView(note, corner);
        root.addView(panel, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
        root.addView(ident, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
        setContentView(root);
        immersive();
        // The inset follows the screen's size (it is a share of each edge).
        root.addOnLayoutChangeListener(new View.OnLayoutChangeListener() {
            @Override
            public void onLayoutChange(View v, int l, int t, int r, int b, int ol, int ot, int or, int ob) {
                if (r - l != or - ol || b - t != ob - ot) {
                    insetShown = -1;
                    applyInset();
                }
            }
        });

        // Start with the TV (#834): was the last boot's launch refused? And a TV already paired turns it on.
        bootBlocked = BootStart.launchWasBlocked(prefs.getLong("bootTriedAt", -1), SystemClock.elapsedRealtime());
        prefs.edit().remove("bootTriedAt").apply();

        newCode();
        // A feed sent by Rhema before 1.3 (a plain http link, no certificate): sent again, it comes secure.
        if (shown() != null && (!Guard.feedLink(shown()) || !Guard.fingerprint(prefs.getString("pin", null)))) {
            prefs.edit().remove("url").remove("pin").apply();
            problem = "Rhema Studio Receiver was updated and now opens only Rhema Studio's secure page. Send the feed again: in Rhema Studio, " + SEND_PATH + ".";
        }
        askFrameRate();
        // After the request: /status says the rate the TV runs at (measured again on focus, once it switched).
        measureDisplay();
        if (BootStart.turnOnAfterPairing(bootChosen(), startsWithTv(), shown() != null)) setStartWithTv(true);
        server = new ShowServer(PORT, this);
        server.start();
        advertise();
        watchNetwork();
        if (shown() != null) {
            // The last picture of this feed, until Rhema Studio answers (1.5).
            showStill();
            web.loadUrl(shown());
            panel.setVisibility(View.GONE);
        } else {
            showInfo(true);
        }
        ui.post(watchPage);
    }

    /** The feed page's WebView, with its checks (a new one when the renderer dies). */
    private WebView newWeb() {
        final WebView w = new WebView(this);
        w.setBackgroundColor(Color.BLACK);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        // Cameras in scenes are video: they start by themselves, muted (no echo in the room).
        s.setMediaPlaybackRequiresUserGesture(false);
        // No mixed content (#840): the feed page is https, and cameras on Rhema Studio's own router play
        // through it (/api/v1/feed/<id>/camera/<name>/whep, src/lib/whep.ts). A camera relayed by
        // another computer over plain http does not play here, as in any browser on the https page.
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        w.setWebChromeClient(new WebChromeClient());
        w.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) retry(certRefused ? NOT_THAT_RHEMA : "Looking for Rhema Studio at " + Uri.parse(shown()).getAuthority() + "…");
            }

            /**
             * Rhema's certificate is its own (no public authority vouches for a church computer), so
             * WebView always asks here. Open the page only when the certificate is exactly the one
             * Rhema sent in its encrypted /show; anything else is refused.
             */
            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                String pin = prefs.getString("pin", null);
                String seen = fingerprint(error.getCertificate());
                if (pin != null && seen != null && MessageDigest.isEqual(pin.getBytes(StandardCharsets.US_ASCII), seen.getBytes(StandardCharsets.US_ASCII))) {
                    handler.proceed();
                    return;
                }
                handler.cancel();
                certRefused = true;
                problem = NOT_THAT_RHEMA;
                showInfo(true);
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest req, WebResourceResponse res) {
                if (!req.isForMainFrame()) return;
                if (res.getStatusCode() == 403) {
                    // Revoked (1.5) or a new link: its kept picture goes too, and whatever it had shown.
                    forgetStill();
                    forgetReady();
                    // The page's own "not valid" words must not show at the screen's edge behind ours.
                    view.setVisibility(View.INVISIBLE);
                    problem = REVOKED;
                    showInfo(true);
                } else {
                    retry("Rhema Studio answered " + res.getStatusCode() + "; trying again…");
                }
            }

            /** Every load, ours or the page's own reload: it must draw again before it counts as shown (#604). */
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                loads++;
                // A refused link's page starts after its 403 (onReceivedHttpError): it stays hidden.
                view.setVisibility(REVOKED.equals(problem) ? View.INVISIBLE : View.VISIBLE);
                ui.removeCallbacks(hideStill);
                ui.removeCallbacks(keepStill);
                ui.removeCallbacks(noFrame);
                ui.postDelayed(noFrame, ready.started());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                // Loaded is not shown (#604): the HTML can arrive without its script. The kept
                // picture goes when the page acknowledges a frame it drew (frameDrawn).
                if (problem == null && shown() != null) hideInfo();
            }

            /**
             * Watched, never answered here: the page's acknowledgement of a drawn frame (Guard.ackOf),
             * sent to Rhema Studio with this screen's key, is the proof a picture is up (#604).
             */
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                final String url = req.getUrl().toString();
                if (url.contains("/ack") && "POST".equalsIgnoreCase(req.getMethod())) {
                    final int load = loads;
                    ui.post(new Runnable() {
                        @Override
                        public void run() {
                            // Checked against the link shown now (a new feed's page must prove itself).
                            if (load == loads && Guard.ackOf(shown(), "POST", url)) frameDrawn();
                        }
                    });
                }
                return null;
            }

            /**
             * The page's renderer died (out of memory on a small TV, or a crash). Unhandled, Android
             * closes the app and the TV drops to its home screen mid-service (#198). A new WebView
             * takes the dead one's place; the kept picture stays up, labelled, until the new page draws.
             */
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (view == web) rendererGone();
                return true;
            }
        });
        return w;
    }

    /** After onRenderProcessGone: a new WebView, then the page again after a backoff (Ready.rendererGone). */
    private void rendererGone() {
        long wait = ready.rendererGone(SystemClock.elapsedRealtime());
        WebView dead = web;
        web = newWeb();
        root.removeView(dead);
        dead.destroy();
        root.addView(web, 0, new FrameLayout.LayoutParams(-1, -1));
        // The new page keeps the edge inset (#849).
        insetShown = -1;
        applyInset();
        // Acknowledgements queued by the dead page are not the new one's.
        loads++;
        ui.removeCallbacks(noFrame);
        ui.removeCallbacks(hideStill);
        ui.removeCallbacks(keepStill);
        // Revoked is final (the 403 handler loads nothing more): its word stays, no reload.
        if (shown() == null || REVOKED.equals(problem)) return;
        showStill();
        // A refused certificate keeps its reason (the new page is checked against the pin again).
        retry(certRefused ? NOT_THAT_RHEMA : "this screen's page stopped (the TV may be short of memory); starting it again", wait);
    }

    private ConnectivityManager.NetworkCallback net;

    /**
     * The network coming back loads a page that is not showing at once (#213), instead of after the
     * rest of its reload wait (up to 75 s on a stale picture after the Wi-Fi returns). Ready decides.
     */
    private void watchNetwork() {
        net = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onLost(Network n) {
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        ready.networkLost();
                    }
                });
            }

            @Override
            public void onAvailable(Network n) {
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        // Asked first, so a loss is used up even when nothing loads.
                        boolean back = ready.networkBack(SystemClock.elapsedRealtime());
                        if (!back || shown() == null || REVOKED.equals(problem)) return;
                        ui.removeCallbacks(reload);
                        reload.run();
                    }
                });
            }
        };
        try {
            ((ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE)).registerDefaultNetworkCallback(net);
        } catch (RuntimeException e) {
            net = null;
        }
    }

    private String shown() {
        return prefs.getString("url", null);
    }

    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    private synchronized void newCode() {
        code = new CodeProof.Code(String.format("%06d", random.nextInt(1_000_000)));
        triesLeft = MAX_TRIES;
        pending.clear();
        tries.clear();
    }

    private synchronized void codeOnScreen(boolean on) {
        codeUntil = on ? Long.MAX_VALUE : SystemClock.elapsedRealtime() + GRACE_MS;
    }

    /** Takes the address and code off the screen; the code works GRACE_MS longer. */
    private void hideInfo() {
        if (panel.getVisibility() != View.VISIBLE) return;
        panel.setVisibility(View.GONE);
        codeOnScreen(false);
    }

    private void retry(String why) {
        retry(why, 5_000);
    }

    private void retry(String why, long wait) {
        problem = why;
        if (still.getVisibility() == View.VISIBLE && panel.getVisibility() != View.VISIBLE) {
            // The last picture stays up (1.5); a small line says it is not live. OK shows the code.
            showStillNotice(why);
        } else {
            showInfo(true);
        }
        ui.removeCallbacks(reload);
        ui.postDelayed(reload, wait);
    }

    /** The kept picture of the feed (1.5): one JPEG in the app's own storage. */
    private File stillFile() {
        return new File(getFilesDir(), "last-screen.jpg");
    }

    /** Shows the kept picture, when it is of the feed shown now. */
    private void showStill() {
        File f = stillFile();
        if (!Guard.stillFits(prefs.getString("stillOf", null), shown(), f.length())) return;
        try {
            Bitmap b = BitmapFactory.decodeFile(f.getPath());
            if (b == null) return;
            still.setImageBitmap(b);
            still.setVisibility(View.VISIBLE);
            showStillNotice(null);
        } catch (Throwable e) {
            // A broken file: start without it.
        }
    }

    /** Labels the cached picture as stale while it is standing in for the live feed. */
    private void showStillNotice(String why) {
        if (still.getVisibility() != View.VISIBLE) return;
        String age = Guard.stillAgeLabel(
                prefs.getString("stillOf", null), shown(),
                prefs.getLong("stillCapturedAt", 0L), System.currentTimeMillis());
        // No picture under the label: the black cover over an old feed's page (show()).
        String message = still.getDrawable() == null ? "Not live" : "Not updating · last picture " + age;
        if (why != null && !why.trim().isEmpty()) message += " · " + why.trim();
        note.setText(message);
        note.setVisibility(View.VISIBLE);
    }

    /** The page drew a frame (#604): the first time since it loaded, the kept picture gives way to it. */
    private void frameDrawn() {
        if (!ready.drew()) return;
        ui.removeCallbacks(noFrame);
        if (problem != null) return;
        // Drawn after the wait ran out but before its reload: the healthy page is not loaded again.
        // (A reload for a load error is retry()'s, with problem set, and is kept.)
        if (ready.cancelQueuedReload()) ui.removeCallbacks(reload);
        if (still.getVisibility() != View.VISIBLE) note.setVisibility(View.GONE);
        // The acknowledgement follows the drawing; a moment more lets the screen show it.
        ui.removeCallbacks(hideStill);
        ui.postDelayed(hideStill, 300);
        ui.removeCallbacks(keepStill);
        ui.postDelayed(keepStill, 8_000);
    }

    /**
     * The page loaded but drew nothing in Ready.FIRST_FRAME_MS (#604; its script did not arrive, or
     * it never heard from Rhema Studio). The kept picture stays, labelled; the page loads again
     * after a wait that grows to a minute.
     */
    private final Runnable noFrame = new Runnable() {
        @Override
        public void run() {
            // An output that is off shows its hold (#835): nothing is wrong, nothing to load again.
            if (shown() == null || problem != null || pageOff) return;
            long wait = ready.noFrame();
            if (wait < 0) return;
            // Also what an output that is off looks like before its first change (the page acknowledges
            // frames only once something is published), so it says no more than it knows.
            String why = "no picture from Rhema Studio yet (its output may be off); trying again in " + (wait / 1000) + " s";
            if (still.getVisibility() == View.VISIBLE) {
                showStillNotice(why);
            } else if (panel.getVisibility() != View.VISIBLE) {
                note.setText("Not live · " + why);
                note.setVisibility(View.VISIBLE);
            }
            ui.removeCallbacks(reload);
            ui.postDelayed(reload, wait);
        }
    };

    /** A revoked or replaced link: no proof, wait or pending reload of the old one carries over. */
    private void forgetReady() {
        ready.forget();
        ui.removeCallbacks(noFrame);
        ui.removeCallbacks(hideStill);
    }

    private final Runnable hideStill = new Runnable() {
        @Override
        public void run() {
            if (problem != null) return;
            still.setVisibility(View.GONE);
            still.setImageDrawable(null);
            note.setVisibility(View.GONE);
        }
    };

    /** Forgets the kept picture (a revoked or replaced feed). */
    private void forgetStill() {
        ui.removeCallbacks(keepStill);
        still.setVisibility(View.GONE);
        still.setImageDrawable(null);
        note.setVisibility(View.GONE);
        prefs.edit().remove("stillOf").remove("stillCapturedAt").apply();
        //noinspection ResultOfMethodCallIgnored
        stillFile().delete();
    }

    /**
     * Keeps a picture of the screen while a feed shows (1.5), every STILL_EVERY_MS: what a TV
     * started without Rhema Studio shows first. Only of the live page (no code, no message on it).
     */
    private final Runnable keepStill = new Runnable() {
        @Override
        public void run() {
            ui.removeCallbacks(keepStill);
            ui.postDelayed(keepStill, STILL_EVERY_MS);
            final String url = shown();
            if (!stillWanted(url)) return;
            // Never of the page's "Not updating" mark or lost-host cover: it would be what the TV
            // starts with next time. A page from an older Rhema Studio says nothing and is kept as before.
            web.evaluateJavascript("document.documentElement.dataset.stale === 'true'", new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String stale) {
                    if (!"true".equals(stale) && url.equals(shown()) && stillWanted(url)) takeStill(url);
                }
            });
        }
    };

    /** Only of a page that has drawn (#604): a loaded-but-black page is never kept. */
    private boolean stillWanted(String url) {
        return url != null && ready.drawn() && problem == null && !certRefused && !pageOff && panel.getVisibility() != View.VISIBLE && still.getVisibility() != View.VISIBLE
                && hold.getVisibility() != View.VISIBLE && ident.getVisibility() != View.VISIBLE;
    }

    private void takeStill(final String url) {
        int[] size = Guard.stillSize(web.getWidth(), web.getHeight());
        if (size == null) return;
        final Bitmap bmp;
        try {
            bmp = Bitmap.createBitmap(size[0], size[1], Bitmap.Config.ARGB_8888);
        } catch (Throwable noMemory) {
            return;
        }
        if (Build.VERSION.SDK_INT >= 26) {
            // The window as shown (the page's canvas included); it is scaled to the bitmap.
            try {
                PixelCopy.request(getWindow(), bmp, new PixelCopy.OnPixelCopyFinishedListener() {
                    @Override
                    public void onPixelCopyFinished(int result) {
                        if (result == PixelCopy.SUCCESS) saveStill(bmp, url, System.currentTimeMillis());
                        else bmp.recycle();
                    }
                }, ui);
            } catch (Throwable e) {
                bmp.recycle();
            }
        } else {
            Canvas c = new Canvas(bmp);
            c.scale((float) size[0] / web.getWidth(), (float) size[1] / web.getHeight());
            web.draw(c);
            saveStill(bmp, url, System.currentTimeMillis());
        }
    }

    /** Writes the picture away from the screen's thread, whole or not at all. */
    private void saveStill(final Bitmap bmp, final String url, final long capturedAtMillis) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                File tmp = new File(getFilesDir(), "last-screen.tmp");
                boolean ok = false;
                try (FileOutputStream out = new FileOutputStream(tmp)) {
                    ok = bmp.compress(Bitmap.CompressFormat.JPEG, 80, out);
                } catch (Throwable e) {
                    ok = false;
                } finally {
                    bmp.recycle();
                }
                final boolean fits = ok && tmp.length() > 0 && tmp.length() <= Guard.STILL_MAX_BYTES;
                if (!fits || !tmp.renameTo(stillFile())) {
                    //noinspection ResultOfMethodCallIgnored
                    tmp.delete();
                    return;
                }
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        // Kept only for the feed it was taken of (a new one may have come meanwhile).
                        if (url.equals(shown())) {
                            prefs.edit().putString("stillOf", url).putLong("stillCapturedAt", capturedAtMillis).apply();
                        }
                    }
                });
            }
        }, "rhema-keep-picture").start();
    }

    /** The display's size (its mode: a 4K TV says 3840×2160 even when apps draw at 1080p). */
    private void measureDisplay() {
        try {
            Display d = getWindowManager().getDefaultDisplay();
            Display.Mode m = d.getMode();
            displayW = m.getPhysicalWidth();
            displayH = m.getPhysicalHeight();
            displayHz = m.getRefreshRate();
        } catch (Throwable e) {
            displayW = getResources().getDisplayMetrics().widthPixels;
            displayH = getResources().getDisplayMetrics().heightPixels;
        }
    }

    /** For GET /status: the display's width and height in pixels (0 when not known). */
    int[] displaySize() {
        return new int[] {displayW, displayH};
    }

    /** For GET /status: the display's refresh rate in Hz (0 when not known). */
    float displayHz() {
        return displayHz;
    }

    /**
     * Asks for 60 Hz at the TV's present resolution when the TV runs slower (#849 G5): the page draws
     * at the display's rate, and a TV left at 24 or 30 Hz makes lyrics and cameras stutter. Android
     * decides (the TV may refuse, or not have the mode); nothing else changes.
     */
    private void askFrameRate() {
        try {
            Display d = getWindowManager().getDefaultDisplay();
            Display.Mode now = d.getMode();
            Display.Mode[] modes = d.getSupportedModes();
            int n = modes.length;
            int[] ids = new int[n];
            int[] ws = new int[n];
            int[] hs = new int[n];
            float[] hz = new float[n];
            for (int i = 0; i < n; i++) {
                ids[i] = modes[i].getModeId();
                ws[i] = modes[i].getPhysicalWidth();
                hs[i] = modes[i].getPhysicalHeight();
                hz[i] = modes[i].getRefreshRate();
            }
            int want = ScreenFit.preferredMode(now.getPhysicalWidth(), now.getPhysicalHeight(), now.getRefreshRate(), ids, ws, hs, hz);
            if (want < 0) return;
            WindowManager.LayoutParams a = getWindow().getAttributes();
            a.preferredDisplayModeId = want;
            getWindow().setAttributes(a);
        } catch (Throwable e) {
            // An older or unusual TV: it stays as it is.
        }
    }

    /** The TV-side edge inset (percent of each edge), for TVs that crop when the output has none (#849). */
    private int tvInset() {
        return ScreenFit.tvInset(prefs.getInt("inset", 0));
    }

    /** Keeps the page inside the inset: the output's own overscan if it has one, else the TV's. */
    private void applyInset() {
        int pct = ScreenFit.applied(pageOverscan, tvInset());
        int w = root.getWidth();
        int h = root.getHeight();
        if (pct == insetShown || w <= 0 || h <= 0) return;
        insetShown = pct;
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) web.getLayoutParams();
        int x = w * pct / 100;
        int y = h * pct / 100;
        lp.setMargins(x, y, x, y);
        web.setLayoutParams(lp);
    }

    /**
     * Every second while a feed shows: whether the page says its output is off (#835) and the output's
     * own overscan (#849). An older page says neither; a page that has lost Rhema Studio is not "off".
     */
    private final Runnable watchPage = new Runnable() {
        @Override
        public void run() {
            ui.removeCallbacks(watchPage);
            ui.postDelayed(watchPage, 1_000);
            // No feed, or something wrong (its words show instead): no hold.
            if (shown() == null || problem != null) {
                showHold(false);
                if (shown() == null) return;
            }
            final WebView asked = web;
            asked.evaluateJavascript(ScreenFit.PAGE_QUERY, new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String answer) {
                    if (asked != web || isDestroyed()) return;
                    int off = ScreenFit.pageOffState(answer);
                    if (off < 0) return;
                    double was = pageOverscan;
                    pageOverscan = ScreenFit.pageOverscan(answer);
                    applyInset();
                    if (was != pageOverscan && panel.getVisibility() == View.VISIBLE) renderInfo();
                    showHold(off == 1);
                }
            });
        }
    };

    /** The calm hold on or off (only while nothing is wrong: a problem says itself). */
    private void showHold(boolean off) {
        boolean on = off && problem == null && shown() != null;
        if (on == pageOff && (hold.getVisibility() == View.VISIBLE) == on) return;
        pageOff = on;
        if (on) {
            hold.setVisibility(View.VISIBLE);
            note.setVisibility(View.GONE);
            // Nothing is wrong and nothing needs loading again: the output is off.
            ui.removeCallbacks(noFrame);
            ui.removeCallbacks(reload);
        } else {
            hold.setVisibility(View.GONE);
            // Turned on again: the page's next frame takes the kept picture off (frameDrawn); if none comes, noFrame.
            if (shown() != null && problem == null && !ready.drawn()) {
                ui.removeCallbacks(noFrame);
                ui.postDelayed(noFrame, Ready.FIRST_FRAME_MS);
            }
        }
    }

    /**
     * Identify TV (#849, from the server thread): this TV's name and address, big, for a few seconds,
     * so someone at the main computer can tell which TV in the room is which. Any device can reach
     * this, so (IdentifyGate) a flash is never extended, is followed by a quiet spell, and each
     * computer may ask once per 10 s; and while a feed shows, only the computer that sent it may ask,
     * so no other device puts words over a service. The pairing code is never covered: with the code
     * screen up, the code screen itself lights up instead. Returns the name, or null with why[0] and
     * the HTTP status in status[0].
     */
    String identify(String peer, String[] why, int[] status) {
        String from = prefs.getString("host", null);
        // A feed sent before 1.7 kept no sender: the computer its saved link points to may.
        String link = shown();
        if (link != null && !IdentifyGate.mayAskOverFeed(from, Uri.parse(link).getHost(), peer)) {
            status[0] = 403;
            why[0] = "This TV is showing a feed: only the Rhema Studio that sent it can identify it";
            return null;
        }
        if (!identifyGate.allow(peer, SystemClock.elapsedRealtime())) {
            status[0] = 429;
            why[0] = "This TV was just identified: try again in a few seconds";
            return null;
        }
        ui.post(new Runnable() {
            @Override
            public void run() {
                if (panel.getVisibility() == View.VISIBLE) {
                    // The code screen already says the TV's name: light it up, the code stays readable.
                    panel.setBackgroundColor(IDENT_BLUE);
                } else {
                    String ip = address();
                    ident.setText(name() + (ip == null ? "" : "\n" + ip));
                    ident.setVisibility(View.VISIBLE);
                }
                ui.removeCallbacks(identOff);
                ui.postDelayed(identOff, IdentifyGate.SHOW_MS);
            }
        });
        return name();
    }

    private static final int PANEL_BLACK = Color.argb(230, 0, 0, 0);
    private static final int IDENT_BLUE = Color.argb(235, 20, 60, 140);
    private final IdentifyGate identifyGate = new IdentifyGate();

    private final Runnable identOff = new Runnable() {
        @Override
        public void run() {
            ident.setVisibility(View.GONE);
            panel.setBackgroundColor(PANEL_BLACK);
        }
    };

    /** Whether the app opens by itself when the TV starts (off unless turned on here). */
    private boolean startsWithTv() {
        return prefs.getBoolean("boot", false);
    }

    /**
     * Whether a person chose Start with the TV on or off: this release marks it, and before 1.7 the
     * "boot" setting was written only by that choice, so an Off from 1.6 is never forced On (#834).
     */
    private boolean bootChosen() {
        return BootStart.chosen(prefs.getBoolean("bootChosen", false), prefs.contains("boot"));
    }

    /** ← or → on the code screen: Start with the TV on or off; the person's choice is kept (#834). */
    private void toggleStartWithTv() {
        boolean on = !startsWithTv();
        prefs.edit().putBoolean("bootChosen", true).apply();
        setStartWithTv(on);
        // Turned on where the TV blocks it: its setting, where the TV has one (it comes back here after).
        if (on && startsWithTv() && !mayOpenByItself()) {
            try {
                startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())));
            } catch (ActivityNotFoundException | SecurityException noSetting) {
                // Google TV often hides it: the code screen says how to allow it instead.
            }
        }
    }

    /** Start with the TV on or off, the boot receiver with it. */
    private void setStartWithTv(boolean on) {
        prefs.edit().putBoolean("boot", on).apply();
        try {
            getPackageManager().setComponentEnabledSetting(new ComponentName(this, BootReceiver.class),
                    on ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
        } catch (RuntimeException e) {
            prefs.edit().putBoolean("boot", false).apply();
        }
    }

    /**
     * Whether Android lets this app open by itself after a start (#834): before Android 10 always;
     * from Android 10 only with "Display over other apps" allowed (the background-launch exemption).
     */
    private boolean mayOpenByItself() {
        return Build.VERSION.SDK_INT < 29 || Settings.canDrawOverlays(this);
    }

    /** ↑ or ↓ on the code screen: the TV-side edge inset one percent more or less (#849). */
    private void stepInset(int by) {
        prefs.edit().putInt("inset", ScreenFit.tvInset(tvInset() + by)).apply();
        applyInset();
    }

    private final Runnable reload = new Runnable() {
        @Override
        public void run() {
            problem = null;
            certRefused = false;
            if (shown() != null) web.loadUrl(shown());
        }
    };

    private final Runnable hide = new Runnable() {
        @Override
        public void run() {
            if (shown() != null && problem == null) hideInfo();
        }
    };

    /** The address and code; kept up until there is something to show, or for a while. */
    private void showInfo(boolean stay) {
        renderInfo();
        // Identify TV never covers the code (#849): its overlay goes when the code screen comes up.
        ident.setVisibility(View.GONE);
        panel.setVisibility(View.VISIBLE);
        codeOnScreen(true);
        ui.removeCallbacks(hide);
        if (!stay) ui.postDelayed(hide, INFO_MS);
    }

    /** The code screen's words, as they are now. */
    private void renderInfo() {
        String ip = address();
        // Fits a 1080p TV with every line present (device check, 1.7): the settings are a smaller block.
        SpannableStringBuilder t = new SpannableStringBuilder();
        if (problem != null) t.append(problem).append("\n\n");
        t.append(shown() == null ? "To show a screen here: in Rhema Studio on the main computer, " : "To show another screen: in Rhema Studio on the main computer, ").append(SEND_PATH).append(".\n\n");
        t.append("TV   ").append(name()).append("   ·   ").append(ip == null ? "not on a network" : ip).append("\n");
        String tried;
        long changes;
        synchronized (this) {
            t.append(triesLeft > 0 ? "Code   " + code.digits : "Too many tries: press OK for a new code").append("\n");
            tried = tries.words(SystemClock.elapsedRealtime());
            changes = tries.changesAt();
        }
        // A code tried in Rhema Studio (#841): said here, never what was typed.
        if (tried != null) t.append(tried).append("\n");
        ui.removeCallbacks(refreshInfo);
        if (changes > SystemClock.elapsedRealtime()) ui.postAtTime(refreshInfo, changes + 50);
        t.append("\n");
        int small = t.length();
        t.append("Start with the TV   ").append(startsWithTv() ? "On" : "Off").append("   (← →)");
        if (startsWithTv() && !mayOpenByItself()) {
            t.append("\n").append(bootBlocked ? "Blocked at the last start: " : "May be blocked: ")
                    .append("allow \"Display over other apps\" (Settings → Apps → Special app access)");
        }
        double own = pageOverscan;
        t.append("\nEdge inset   ").append(own > 0 ? "set in Rhema Studio (" + trim(own) + "%)" : tvInset() + "%   (↑ ↓, for a TV that cuts off the edges)");
        t.setSpan(new RelativeSizeSpan(0.72f), small, t.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        t.setSpan(new ForegroundColorSpan(Color.rgb(190, 190, 190)), small, t.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        info.setText(t);
    }

    private static String trim(double v) {
        return v == Math.rint(v) ? String.valueOf((long) v) : String.valueOf(v);
    }

    /** The code screen's words again when they change (a code check's wait running out), if it is up. */
    private final Runnable refreshInfo = new Runnable() {
        @Override
        public void run() {
            if (panel.getVisibility() == View.VISIBLE) renderInfo();
        }
    };

    /** Before the page sees it: the feed page has focus and would take OK for itself. */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int k = event.getKeyCode();
        if (k == KeyEvent.KEYCODE_DPAD_CENTER || k == KeyEvent.KEYCODE_ENTER || k == KeyEvent.KEYCODE_MENU) {
            if (event.getAction() == KeyEvent.ACTION_UP) okPressed();
            return true;
        }
        // On the code screen only: ← or → turns Start with the TV on or off (1.5).
        if ((k == KeyEvent.KEYCODE_DPAD_LEFT || k == KeyEvent.KEYCODE_DPAD_RIGHT) && panel.getVisibility() == View.VISIBLE) {
            if (event.getAction() == KeyEvent.ACTION_UP) {
                toggleStartWithTv();
                showInfo(shown() == null || problem != null);
            }
            return true;
        }
        // On the code screen only: ↑ or ↓ changes the TV-side edge inset (#849).
        if ((k == KeyEvent.KEYCODE_DPAD_UP || k == KeyEvent.KEYCODE_DPAD_DOWN) && panel.getVisibility() == View.VISIBLE) {
            if (event.getAction() == KeyEvent.ACTION_UP) {
                stepInset(k == KeyEvent.KEYCODE_DPAD_UP ? 1 : -1);
                showInfo(shown() == null || problem != null);
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    /** OK: hide the address and code, or show them with a new code (also after too many wrong ones). */
    private synchronized void okPressed() {
        if (panel.getVisibility() == View.VISIBLE && shown() != null && problem == null && triesLeft > 0) {
            hideInfo();
        } else {
            newCode();
            showInfo(shown() == null || problem != null);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus) {
            immersive();
            measureDisplay();
        }
    }

    /**
     * Tells the network this TV is a Rhema Receiver, by its name, so Rhema's Find TVs lists it. If
     * that fails (no network yet), it tries again shortly; typing the address still works meanwhile.
     */
    private void advertise() {
        if (nsd == null) nsd = (NsdManager) getSystemService(NSD_SERVICE);
        if (nsd == null) return;
        // Android TV already announces the plain name (its remote service) and refuses the same name twice.
        String n = name();
        n = (n.length() > 52 ? n.substring(0, 52) : n) + " · Rhema";
        NsdServiceInfo service = new NsdServiceInfo();
        service.setServiceName(n);
        service.setServiceType(SERVICE_TYPE);
        service.setPort(PORT);
        advert = new NsdManager.RegistrationListener() {
            @Override
            public void onServiceRegistered(NsdServiceInfo info) { }

            @Override
            public void onRegistrationFailed(NsdServiceInfo info, int error) {
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        advert = null;
                        ui.removeCallbacks(readvertise);
                        ui.postDelayed(readvertise, 10_000);
                    }
                });
            }

            @Override
            public void onServiceUnregistered(NsdServiceInfo info) { }

            @Override
            public void onUnregistrationFailed(NsdServiceInfo info, int error) { }
        };
        try {
            nsd.registerService(service, NsdManager.PROTOCOL_DNS_SD, advert);
        } catch (RuntimeException e) {
            advert = null;
        }
    }

    private final Runnable readvertise = new Runnable() {
        @Override
        public void run() {
            if (advert == null && !isDestroyed()) advertise();
        }
    };

    @Override
    protected void onDestroy() {
        if (net != null) {
            try { ((ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE)).unregisterNetworkCallback(net); } catch (RuntimeException ignored) { }
            net = null;
        }
        if (advert != null) {
            try { nsd.unregisterService(advert); } catch (RuntimeException ignored) { }
            advert = null;
        }
        server.close();
        ui.removeCallbacksAndMessages(null);
        web.destroy();
        super.onDestroy();
    }

    /** For Rhema's Check TV (GET /status): the id of the feed shown (never its secret link), or null. */
    String feedShown() {
        String url = shown();
        if (url == null) return null;
        List<String> p = Uri.parse(url).getPathSegments();
        return p.size() >= 2 && "feed".equals(p.get(0)) ? p.get(1) : null;
    }

    /** What the screen says is wrong now (Rhema not found, link no longer works), or null. */
    String problem() {
        return problem;
    }

    /** What this TV is called on the network, for Rhema's reply. */
    String name() {
        String n = Settings.Global.getString(getContentResolver(), Settings.Global.DEVICE_NAME);
        return n == null || n.isEmpty() ? Build.MODEL : n;
    }

    /**
     * From the server thread, the first half of the code check (#198, CodeProof): Rhema's value X,
     * the address Rhema reached this TV at and who asked. Returns {y, proof}, or null with why in
     * why[0]. Each exchange is one try, whatever code Rhema typed: the TV cannot tell a wrong code
     * from a right one here (that is what keeps the code from being guessed offline), so five
     * exchanges without a shown feed lock the code until OK is pressed. The answer is good for one
     * /show from the same computer within 30 seconds, whatever other computers ask meanwhile. A code no longer on screen (GRACE_MS after it
     * left) is refused at once, before any maths and without using a try.
     */
    synchronized String[] challenge(String x, String peer, String local, String[] why) {
        if (SystemClock.elapsedRealtime() > codeUntil) {
            why[0] = "No code is on the TV's screen: press OK on the TV's remote to show one, then type it";
            return null;
        }
        if (triesLeft <= 0) {
            why[0] = "Too many tries: press OK on the TV's remote for a new code";
            return null;
        }
        triesLeft--;
        tries.tried(SystemClock.elapsedRealtime(), triesLeft);
        if (triesLeft == 0) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    showInfo(shown() == null);
                }
            });
        } else {
            // Said on the code screen when it is up (#841); a TV showing its feed is not interrupted.
            ui.post(refreshInfo);
        }
        CodeProof.Answer a;
        try {
            a = CodeProof.answer(x, code, local, CodeProof.randomExponent(random));
        } catch (RuntimeException e) {
            why[0] = "That was not a Rhema Studio code check";
            return null;
        }
        pending.put(peer, a.enc, SystemClock.elapsedRealtime());
        return new String[] {a.y, a.proof};
    }

    /**
     * From the server thread, the second half: the feed's https link and Rhema's certificate
     * fingerprint, encrypted with the key of the check just made. Only Rhema that took part in the
     * check with the same code could seal it. Null when shown, else why not.
     */
    synchronized String show(String peer, String nonce, String data) {
        // Only the computer that did the check can use (or spend) it: another device's /challenge or
        // /show in between must not break Rhema's exchange.
        byte[] key = pending.take(peer, SystemClock.elapsedRealtime());
        if (key == null) return "Rhema Studio must check the code first (update Rhema Studio if this keeps happening)";
        String sent = CodeProof.open(key, nonce, data);
        if (sent == null) return "Rhema Studio's code check did not match: try again";
        final String url;
        final String pin;
        try {
            if (!Guard.flatObject(sent)) return "That is not a Rhema Studio feed link";
            JSONObject o = new JSONObject(sent);
            url = o.optString("url", "");
            pin = o.optString("certFingerprint", "");
        } catch (Exception e) {
            return "That is not a Rhema Studio feed link";
        }
        if (!Guard.feedLink(url) || !Guard.fingerprint(pin)) return "That is not a Rhema Studio secure feed link (update Rhema Studio if this keeps happening)";
        newCode();
        // The code worked: no "a code was tried" left on the code screen (#841; newCode clears it too).
        tries.clear();
        ui.post(new Runnable() {
            @Override
            public void run() {
                // Another feed (or this TV's new key): the picture kept of the last one goes, and its proof.
                if (!url.equals(shown())) {
                    forgetStill();
                    forgetReady();
                    // The old feed's page stays up until the new one starts loading, and loading is not
                    // drawing (#604): cover it in black until the new feed's own acknowledgement
                    // (frameDrawn, checked against the new link and this load) takes the cover off.
                    still.setVisibility(View.VISIBLE);
                }
                // Also who sent it: only that computer may Identify this TV over its feed (#849).
                prefs.edit().putString("url", url).putString("pin", pin).putString("host", peer).apply();
                // Paired: a TV that loses power comes back to this feed by itself (#834), unless a person chose Off.
                if (BootStart.turnOnAfterPairing(bootChosen(), startsWithTv(), true)) setStartWithTv(true);
                problem = null;
                certRefused = false;
                ui.removeCallbacks(reload);
                // Forget certificates let through for an earlier feed: only this one counts now.
                web.clearSslPreferences();
                web.loadUrl(url);
            }
        });
        return null;
    }

    /** SHA-256 of a page's certificate (lowercase hex), as Rhema writes it, or null. */
    static String fingerprint(SslCertificate cert) {
        if (cert == null) return null;
        byte[] der = null;
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                X509Certificate x = cert.getX509Certificate();
                if (x != null) der = x.getEncoded();
            } else {
                // Before Android 10 the certificate's bytes are only in its saved state.
                Bundle b = SslCertificate.saveState(cert);
                if (b != null) der = b.getByteArray("x509-certificate");
            }
        } catch (Exception e) {
            return null;
        }
        return der == null ? null : CodeProof.hex(CodeProof.sha256(der));
    }

    /** This TV's address on the church network (IPv4, as people type it). */
    static String address() {
        try {
            for (NetworkInterface n : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!n.isUp() || n.isLoopback()) continue;
                for (InetAddress a : Collections.list(n.getInetAddresses())) {
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) return a.getHostAddress();
                }
            }
        } catch (Exception ignored) {
            // no network yet
        }
        return null;
    }
}
