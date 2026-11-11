package com.openbezal.rhema.receiver;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/**
 * When Identify TV (#849, GET/POST /identify) may flash this TV's name. Any device on the network can
 * reach the TV's port, so a flash is never extended: one per SHOW_MS window, then COOLDOWN_MS of
 * quiet, and each computer at most once per PER_PEER_MS. A refused call changes nothing (it does not
 * push its own wait further out). Thread-safe: the server's threads call it. Plain Java, so build.sh's
 * IdentifyGateCheck tests it. Times are elapsedRealtime ms.
 */
final class IdentifyGate {
    static final long SHOW_MS = 6_000;
    static final long COOLDOWN_MS = 4_000;
    static final long PER_PEER_MS = 10_000;
    /** Computers remembered at most (older ones are forgotten first once out of their wait). */
    static final int MAX_PEERS = 64;

    private final Map<String, Long> lastByPeer = new HashMap<>();
    private boolean any;
    private long until;

    /**
     * While a feed shows: whether peer may identify the TV over it. Only the computer that sent the
     * feed (kept since 1.7). A feed sent before 1.7 kept no sender: then the computer its saved link
     * points to (the host's address in it), which is the sender in practice.
     */
    static boolean mayAskOverFeed(String sender, String linkHost, String peer) {
        if (peer == null) return false;
        return sender != null ? sender.equals(peer) : peer.equals(linkHost);
    }

    /** Whether peer may flash the name now; when true, the flash runs SHOW_MS from now. */
    synchronized boolean allow(String peer, long now) {
        Long last = lastByPeer.get(peer);
        if (last != null && now - last < PER_PEER_MS) return false;
        if (any && now < until + COOLDOWN_MS) return false;
        if (lastByPeer.size() >= MAX_PEERS) {
            for (Iterator<Long> it = lastByPeer.values().iterator(); it.hasNext(); ) {
                if (now - it.next() >= PER_PEER_MS) it.remove();
            }
            // Still full of computers inside their wait: a flood, refused until they age out.
            if (lastByPeer.size() >= MAX_PEERS) return false;
        }
        lastByPeer.put(peer, now);
        any = true;
        until = now + SHOW_MS;
        return true;
    }
}
