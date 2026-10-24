package com.openbezal.rhema.receiver;

import android.app.Activity;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
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
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

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
 * code with this TV (CodeProof) and only then sends the feed's link (Outputs → a browser feed → Show on
 * a Google TV), so only someone who can see this screen assigns it. OK on the remote shows the address and a new code again. It
 * also tells the network it is here (mDNS/NSD), so Rhema can list it without anyone typing the address.
 *
 * Since 1.3 the link is Rhema's https page, sent encrypted with the fingerprint of Rhema's own
 * certificate; the TV opens the page only from a computer showing exactly that certificate, so
 * nobody on the network can read the link or stand in for Rhema.
 */
public class MainActivity extends Activity {
    static final int PORT = 8095;
    /** What Rhema looks for on the network to list this TV (Show on a Google TV → Find TVs). */
    static final String SERVICE_TYPE = "_rhema-tv._tcp";
    private static final int MAX_TRIES = 5;
    private static final long INFO_MS = 20_000;
    private static final long PENDING_MS = 30_000;
    /** How long a code still works after it leaves the screen (time to finish typing it). */
    private static final long GRACE_MS = 120_000;
    private static final String NOT_THAT_RHEMA = "This TV did not open the feed: the computer answering is not the Rhema Studio that sent it, or Rhema Studio made a new certificate. Send the feed again: in Rhema Studio, Outputs → the feed → Show on a Google TV.";

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final SecureRandom random = new SecureRandom();
    private SharedPreferences prefs;
    private WebView web;
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
    /** The code check waiting for its /show (see challenge). */
    private byte[] pendingKey;
    private String pendingPeer;
    private long pendingUntil;
    private NsdManager.RegistrationListener advert;
    /** The last page load stopped because the certificate was not the one Rhema sent. */
    private boolean certRefused;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        prefs = getSharedPreferences("receiver", MODE_PRIVATE);

        // A debug build (RECEIVER_DEBUG=1) lets chrome://inspect read the page: WebRTC stats, console.
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        // Cameras in scenes are video: they start by themselves, muted (no echo in the room).
        s.setMediaPlaybackRequiresUserGesture(false);
        // The feed page is https now, but cameras in scenes still ask the camera router over plain
        // http (as before); nothing secret goes there, and the browser sends it no link.
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
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
                    problem = "This screen's link no longer works (a new link was made in Rhema Studio). Send the feed again.";
                    showInfo(true);
                } else {
                    retry("Rhema Studio answered " + res.getStatusCode() + "; trying again…");
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (problem == null && shown() != null) hideInfo();
            }
        });

        info = new TextView(this);
        info.setTextColor(Color.WHITE);
        info.setTextSize(28);
        info.setLineSpacing(0, 1.25f);
        info.setGravity(Gravity.CENTER);

        // The approved landscape logo (brand/02_Product_Logos/Rhema-Studio-Receiver-White-Text.png, as is).
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.receiver_logo);
        logo.setAdjustViewBounds(true);
        logo.setContentDescription("Rhema Studio Receiver");
        float dp = getResources().getDisplayMetrics().density;
        panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER_HORIZONTAL);
        panel.setBackgroundColor(Color.argb(230, 0, 0, 0));
        panel.setPadding(80, 48, 80, 60);
        LinearLayout.LayoutParams logoSize = new LinearLayout.LayoutParams((int) (360 * dp), -2);
        logoSize.bottomMargin = (int) (16 * dp);
        panel.addView(logo, logoSize);
        panel.addView(info, new LinearLayout.LayoutParams(-2, -2));

        FrameLayout root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        root.addView(panel, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
        setContentView(root);
        immersive();

        newCode();
        // A feed sent by Rhema before 1.3 (a plain http link, no certificate): sent again, it comes secure.
        if (shown() != null && (!Guard.feedLink(shown()) || !Guard.fingerprint(prefs.getString("pin", null)))) {
            prefs.edit().remove("url").remove("pin").apply();
            problem = "Rhema Studio Receiver was updated and now opens only Rhema Studio's secure page. Send the feed again: in Rhema Studio, Outputs → the feed → Show on a Google TV.";
        }
        server = new ShowServer(PORT, this);
        server.start();
        advertise();
        if (shown() != null) {
            web.loadUrl(shown());
            panel.setVisibility(View.GONE);
        } else {
            showInfo(true);
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
        pendingKey = null;
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
        problem = why;
        showInfo(true);
        ui.removeCallbacks(reload);
        ui.postDelayed(reload, 5_000);
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
        String ip = address();
        StringBuilder t = new StringBuilder();
        if (problem != null) t.append(problem).append("\n\n");
        t.append(shown() == null ? "To show a screen here: in Rhema Studio, Outputs → a browser feed → Show on a Google TV.\n\n" : "To show another screen: in Rhema Studio, Outputs → a browser feed → Show on a Google TV.\n\n");
        t.append("TV name   ").append(name()).append("\n");
        t.append("TV address   ").append(ip == null ? "not on a network" : ip).append("\n");
        t.append(triesLeft > 0 ? "Code   " + code.digits : "Too many tries: press OK for a new code");
        info.setText(t);
        panel.setVisibility(View.VISIBLE);
        codeOnScreen(true);
        ui.removeCallbacks(hide);
        if (!stay) ui.postDelayed(hide, INFO_MS);
    }

    /** Before the page sees it: the feed page has focus and would take OK for itself. */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int k = event.getKeyCode();
        if (k == KeyEvent.KEYCODE_DPAD_CENTER || k == KeyEvent.KEYCODE_ENTER || k == KeyEvent.KEYCODE_MENU) {
            if (event.getAction() == KeyEvent.ACTION_UP) okPressed();
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
        if (focus) immersive();
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
     * /show from the same computer within 30 seconds. A code no longer on screen (GRACE_MS after it
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
        if (triesLeft == 0) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    showInfo(shown() == null);
                }
            });
        }
        CodeProof.Answer a;
        try {
            a = CodeProof.answer(x, code, local, CodeProof.randomExponent(random));
        } catch (RuntimeException e) {
            why[0] = "That was not a Rhema Studio code check";
            return null;
        }
        pendingKey = a.enc;
        pendingPeer = peer;
        pendingUntil = SystemClock.elapsedRealtime() + PENDING_MS;
        return new String[] {a.y, a.proof};
    }

    /**
     * From the server thread, the second half: the feed's https link and Rhema's certificate
     * fingerprint, encrypted with the key of the check just made. Only Rhema that took part in the
     * check with the same code could seal it. Null when shown, else why not.
     */
    synchronized String show(String peer, String nonce, String data) {
        // Only the computer that did the check can use (or spend) it: another device's /show in
        // between must not break Rhema's exchange.
        if (pendingKey == null || !peer.equals(pendingPeer)) return "Rhema Studio must check the code first (update Rhema Studio if this keeps happening)";
        byte[] key = pendingKey;
        pendingKey = null;
        if (SystemClock.elapsedRealtime() >= pendingUntil) return "Rhema Studio must check the code first (update Rhema Studio if this keeps happening)";
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
        ui.post(new Runnable() {
            @Override
            public void run() {
                prefs.edit().putString("url", url).putString("pin", pin).apply();
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
