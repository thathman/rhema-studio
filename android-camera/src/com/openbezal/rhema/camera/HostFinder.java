package com.openbezal.rhema.camera;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Build;
import android.os.Handler;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.security.SecureRandom;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Finds the paired Rhema Studio at a new address (1.6, doc 48), the way the Receiver does: browses
 * _rhema-host._tcp, resolves one announced service at a time, skips any whose TXT k= is not the
 * first 16 hex of the key pin, and checks each IPv4 address left (at most ProbeQueue.PER_SERVICE
 * per service, the last-known one first) with a full TLS handshake on the camera router's port
 * that only the pinned server key completes (KeyPin.probe, 4 s in all). Only then is it reported.
 * One browse at a time; CameraService says when (Rediscovery) and how long. Main thread only.
 */
final class HostFinder {
    /** Rhema Studio's announcement (host_advert.rs). */
    static final String HOST_SERVICE = "_rhema-host._tcp";
    /** One TLS check's whole time (connect and handshake). */
    static final int PROBE_MS = 4_000;

    interface Listener {
        /** The paired Rhema (keyPin) completed TLS at ip (announced as service). */
        void found(String ip, String service, String keyPin);

        /** The browse could not start (no network yet): rest, then try again. */
        void cannotBrowse();
    }

    private final Context context;
    private final Handler main;
    private final Listener listener;
    private NsdManager nsd;
    private NsdManager.DiscoveryListener browse;
    /** Counts browses, so a late answer from one that ended is ignored (also on the prober's thread). */
    private final AtomicInteger gen = new AtomicInteger();
    /** Announced services waiting to be resolved (one at a time: Android allows no more before 14). */
    private final ArrayDeque<NsdServiceInfo> toResolve = new ArrayDeque<NsdServiceInfo>();
    private boolean resolving;
    /** Services already resolved in this browse. */
    private final Set<String> seen = new HashSet<String>();
    /** Addresses waiting for their TLS check in this browse (capped per service, last-known first, fair). */
    private final ProbeQueue probes = new ProbeQueue(new SecureRandom());
    /** A TLS check is running (one at a time; the next starts when it ends). */
    private boolean probing;
    /**
     * Runs the TLS checks off the main thread. Only one is handed to it at a time (pump); the small
     * queue only holds a check from a browse that just ended, which is skipped at its start.
     */
    private final ExecutorService prober = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<Runnable>(4));

    /** What this browse looks for: the key pin, the router's port, where it was last, and its last service name. */
    private String keyPin;
    private int port;
    private String lastIp;
    private String lastService;

    HostFinder(Context context, Handler main, Listener listener) {
        this.context = context;
        this.main = main;
        this.listener = listener;
    }

    boolean browsing() {
        return browse != null;
    }

    /** Services still to be resolved, or addresses still to be checked, in this browse. */
    boolean pending() {
        return browse != null && (resolving || probing || !toResolve.isEmpty() || probes.pending());
    }

    /** Starts a browse for this key pin, checking the camera router's port; false when it could not start. */
    boolean start(String keyPin, int port, String lastIp, String lastService) {
        stop();
        if (!KeyPin.fingerprint(keyPin) || port < 1 || port > 65535) return false;
        if (nsd == null) nsd = (NsdManager) context.getSystemService(Context.NSD_SERVICE);
        if (nsd == null) return false;
        this.keyPin = keyPin;
        this.port = port;
        this.lastIp = lastIp;
        this.lastService = lastService;
        final int g = gen.incrementAndGet();
        browse = new NsdManager.DiscoveryListener() {
            @Override
            public void onStartDiscoveryFailed(String type, int error) {
                main.post(new Runnable() {
                    @Override
                    public void run() {
                        if (g != gen.get()) return;
                        browse = null;
                        listener.cannotBrowse();
                    }
                });
            }

            @Override
            public void onStopDiscoveryFailed(String type, int error) { }

            @Override
            public void onDiscoveryStarted(String type) { }

            @Override
            public void onDiscoveryStopped(String type) { }

            @Override
            public void onServiceFound(final NsdServiceInfo info) {
                main.post(new Runnable() {
                    @Override
                    public void run() {
                        if (g != gen.get() || !seen.add(String.valueOf(info.getServiceName()))) return;
                        toResolve.add(info);
                        resolveNext(g);
                    }
                });
            }

            @Override
            public void onServiceLost(NsdServiceInfo info) { }
        };
        try {
            nsd.discoverServices(HOST_SERVICE, NsdManager.PROTOCOL_DNS_SD, browse);
        } catch (RuntimeException e) {
            browse = null;
            return false;
        }
        return true;
    }

    /** Ends the browse now (found, its time over, sending stopped, or a new pairing). */
    void stop() {
        gen.incrementAndGet();
        if (browse != null) {
            try { nsd.stopServiceDiscovery(browse); } catch (RuntimeException ignored) { }
            browse = null;
        }
        toResolve.clear();
        resolving = false;
        seen.clear();
        probes.clear();
        probing = false;
    }

    /** The service is going away. */
    void shutdown() {
        stop();
        prober.shutdownNow();
    }

    /** Resolves the next announced service (one at a time). */
    private void resolveNext(final int g) {
        if (g != gen.get() || resolving || toResolve.isEmpty()) return;
        resolving = true;
        NsdServiceInfo next = toResolve.poll();
        try {
            nsd.resolveService(next, new NsdManager.ResolveListener() {
                @Override
                public void onResolveFailed(NsdServiceInfo info, int error) {
                    main.post(new Runnable() {
                        @Override
                        public void run() {
                            if (g != gen.get()) return;
                            resolving = false;
                            resolveNext(g);
                        }
                    });
                }

                @Override
                public void onServiceResolved(final NsdServiceInfo info) {
                    main.post(new Runnable() {
                        @Override
                        public void run() {
                            if (g != gen.get()) return;
                            resolving = false;
                            candidate(info, g);
                            resolveNext(g);
                        }
                    });
                }
            });
        } catch (RuntimeException e) {
            // This one could not be asked: on to the next (it was taken off the queue).
            resolving = false;
            resolveNext(g);
        }
    }

    /** An announced Rhema Studio: when its hint (TXT k=) fits the key pin, its addresses wait for a TLS check. */
    private void candidate(NsdServiceInfo info, int g) {
        Map<String, byte[]> txt;
        try {
            txt = info.getAttributes();
        } catch (RuntimeException e) {
            return;
        }
        if (!KeyPin.hintMatches(KeyPin.txt(txt, "k"), keyPin)) return;
        String service = String.valueOf(info.getServiceName());
        boolean sameName = service.equals(lastService);
        // Each of its IPv4 addresses (a computer on Wi-Fi and Ethernet announces both), ProbeQueue-capped;
        // one turned away for want of room is kept aside and offered again as checks are taken.
        for (String ip : ipv4s(info)) probes.offer(service, ip, port, sameName || ip.equals(lastIp));
        pump(g);
    }

    /** Starts the next TLS check when none is running; when it ends, the next one starts. */
    private void pump(final int g) {
        if (probing || g != gen.get()) return;
        final ProbeQueue.Candidate c = probes.next();
        if (c == null) return;
        final String pin = keyPin;
        probing = true;
        try {
            prober.execute(new Runnable() {
                @Override
                public void run() {
                    // Its browse ended while it waited: not checked at all.
                    final boolean ok = g == gen.get() && KeyPin.probe(c.ip, c.port, pin, PROBE_MS);
                    main.post(new Runnable() {
                        @Override
                        public void run() {
                            if (g != gen.get()) return;
                            probing = false;
                            if (ok) listener.found(c.ip, c.service, pin);
                            else pump(g);
                        }
                    });
                }
            });
        } catch (RuntimeException full) {
            // Could not be started (a check of an ended browse still holds the queue, or shutting
            // down): unmarked, so it can be offered again, and tried after the running one.
            probing = false;
            probes.release(c);
        }
    }

    /** The service's IPv4 addresses (the pairing names Rhema by one), maybe none: every one from Android 14. */
    private static List<String> ipv4s(NsdServiceInfo info) {
        List<String> out = new ArrayList<String>();
        if (Build.VERSION.SDK_INT >= 34) {
            for (InetAddress a : info.getHostAddresses()) {
                if (a instanceof Inet4Address && !out.contains(a.getHostAddress())) out.add(a.getHostAddress());
            }
        } else {
            InetAddress a = info.getHost();
            if (a instanceof Inet4Address) out.add(a.getHostAddress());
        }
        return out;
    }
}
