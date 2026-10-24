package com.openbezal.rhema.receiver;

import android.app.Activity;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.net.Uri;
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
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.List;

/**
 * Rhema Receiver (#198): shows one Rhema browser feed full screen and keeps showing it, across
 * restarts and network drops. Until it has one, it shows its address and a code; Rhema checks that
 * code with this TV (CodeProof) and only then sends the feed's link (Outputs → a browser feed → Show on
 * a Google TV), so only someone who can see this screen assigns it. OK on the remote shows the address and a new code again. It
 * also tells the network it is here (mDNS/NSD), so Rhema can list it without anyone typing the address.
 */
public class MainActivity extends Activity {
    static final int PORT = 8095;
    /** What Rhema looks for on the network to list this TV (Show on a Google TV → Find TVs). */
    static final String SERVICE_TYPE = "_rhema-tv._tcp";
    private static final int MAX_TRIES = 5;
    private static final long INFO_MS = 20_000;
    private static final long PENDING_MS = 30_000;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final SecureRandom random = new SecureRandom();
    private SharedPreferences prefs;
    private WebView web;
    private TextView info;
    private ShowServer server;
    private String code;
    private int triesLeft;
    private volatile String problem;
    private NsdManager nsd;
    /** The code check waiting for its /show (see challenge). */
    private byte[] pendingKey;
    private String pendingPeer;
    private long pendingUntil;
    private NsdManager.RegistrationListener advert;

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
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) retry("Looking for Rhema at " + Uri.parse(shown()).getAuthority() + "…");
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest req, WebResourceResponse res) {
                if (!req.isForMainFrame()) return;
                if (res.getStatusCode() == 403) {
                    problem = "This screen's link no longer works (a new link was made in Rhema). Send the feed again.";
                    showInfo(true);
                } else {
                    retry("Rhema answered " + res.getStatusCode() + "; trying again…");
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (problem == null && shown() != null) info.setVisibility(View.GONE);
            }
        });

        info = new TextView(this);
        info.setTextColor(Color.WHITE);
        info.setTextSize(28);
        info.setLineSpacing(0, 1.25f);
        info.setGravity(Gravity.CENTER);
        info.setBackgroundColor(Color.argb(230, 0, 0, 0));
        info.setPadding(80, 60, 80, 60);

        FrameLayout root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        root.addView(info, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
        setContentView(root);
        immersive();

        newCode();
        server = new ShowServer(PORT, this);
        server.start();
        advertise();
        if (shown() != null) {
            web.loadUrl(shown());
            info.setVisibility(View.GONE);
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
        code = String.format("%06d", random.nextInt(1_000_000));
        triesLeft = MAX_TRIES;
        pendingKey = null;
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
            if (shown() != null) web.loadUrl(shown());
        }
    };

    private final Runnable hide = new Runnable() {
        @Override
        public void run() {
            if (shown() != null && problem == null) info.setVisibility(View.GONE);
        }
    };

    /** The address and code; kept up until there is something to show, or for a while. */
    private void showInfo(boolean stay) {
        String ip = address();
        StringBuilder t = new StringBuilder("Rhema Receiver\n\n");
        if (problem != null) t.append(problem).append("\n\n");
        t.append(shown() == null ? "To show a screen here: in Rhema, Outputs → a browser feed → Show on a Google TV.\n\n" : "To show another screen: in Rhema, Outputs → a browser feed → Show on a Google TV.\n\n");
        t.append("TV name   ").append(name()).append("\n");
        t.append("TV address   ").append(ip == null ? "not on a network" : ip).append("\n");
        t.append(triesLeft > 0 ? "Code   " + code : "Too many tries: press OK for a new code");
        info.setText(t);
        info.setVisibility(View.VISIBLE);
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
        if (info.getVisibility() == View.VISIBLE && shown() != null && problem == null && triesLeft > 0) {
            info.setVisibility(View.GONE);
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
     * /show from the same computer within 30 seconds.
     */
    synchronized String[] challenge(String x, String peer, String local, String[] why) {
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
            why[0] = "That was not a Rhema code check";
            return null;
        }
        pendingKey = a.key;
        pendingPeer = peer;
        pendingUntil = SystemClock.elapsedRealtime() + PENDING_MS;
        return new String[] {a.y, a.proof};
    }

    /**
     * From the server thread, the second half: the link and Rhema's proof that it took part in the
     * check with the same code. Null when shown, else why not.
     */
    synchronized String show(String peer, final String url, String proof) {
        byte[] key = pendingKey;
        boolean fresh = key != null && peer.equals(pendingPeer) && SystemClock.elapsedRealtime() < pendingUntil;
        pendingKey = null;
        if (!fresh) return "Rhema must check the code first (update Rhema if this keeps happening)";
        if (!CodeProof.deskProofMatches(key, url, proof)) return "Rhema's code check did not match: try again";
        Uri u = Uri.parse(url);
        if (!("http".equals(u.getScheme()) || "https".equals(u.getScheme())) || u.getPath() == null || !u.getPath().startsWith("/feed/")) {
            return "That is not a Rhema feed link";
        }
        newCode();
        ui.post(new Runnable() {
            @Override
            public void run() {
                prefs.edit().putString("url", url).apply();
                problem = null;
                ui.removeCallbacks(reload);
                web.loadUrl(url);
            }
        });
        return null;
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
