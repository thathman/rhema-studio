package com.airixmedia.rhema.receiver;

import java.util.HashMap;
import java.util.Map;

/**
 * The code checks waiting for their /show, one per computer that asked: another device's /challenge
 * in between must not replace Rhema's (it would then be told to check the code first). Each check
 * costs one of the code's tries, so there are never more than that many here. Not thread-safe: the
 * Receiver calls it under its own lock. Times are elapsedRealtime milliseconds.
 */
final class Pending {
    static final long MS = 30_000;

    private static final class Entry {
        final byte[] key;
        final long until;

        Entry(byte[] key, long until) {
            this.key = key;
            this.until = until;
        }
    }

    private final Map<String, Entry> byPeer = new HashMap<>();

    /** A check just made by peer: good for one /show from it within MS. */
    void put(String peer, byte[] key, long now) {
        byPeer.put(peer, new Entry(key, now + MS));
    }

    /** Peer's check, spent whether or not it is still in time; null when it has none or it is too old. */
    byte[] take(String peer, long now) {
        Entry e = byPeer.remove(peer);
        return e == null || now >= e.until ? null : e.key;
    }

    /** A new code: every check made with the old one goes. */
    void clear() {
        byPeer.clear();
    }
}
