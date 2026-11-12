package com.openbezal.rhema.receiver;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;

/**
 * The addresses waiting for a TLS check in one browse (1.8, doc 48). Anyone can announce the public
 * k= hint, so one announcer must not use up the checks the real Rhema Studio needs:
 * - each announced service gets at most PER_SERVICE addresses checked per browse;
 * - at most MAX_WAITING wait; a newcomer that does not fit is not marked, so it can be offered again;
 * - the last-known Rhema Studio (its last address, or the service name it was found under) goes
 *   first, and the rest are taken in a random order, so a fixed set of fake announcements cannot
 *   always stand in front of the real one;
 * - a check that could not be started is released (unmarked) and can be offered again.
 * Screen thread only. Plain Java only, so build.sh's KeyPinCheck tests it.
 */
final class ProbeQueue {
    static final int PER_SERVICE = 2;
    static final int MAX_WAITING = 8;

    /** One address to check: ip:port, announced as service. */
    static final class Candidate {
        final String service;
        final String ip;
        final int port;
        final boolean preferred;

        Candidate(String service, String ip, int port, boolean preferred) {
            this.service = service;
            this.ip = ip;
            this.port = port;
            this.preferred = preferred;
        }

        String key() {
            return ip + ":" + port;
        }
    }

    private final List<Candidate> waiting = new ArrayList<Candidate>();
    private final Set<String> tried = new HashSet<String>();
    private final Map<String, Integer> perService = new HashMap<String, Integer>();
    private final Random random;

    ProbeQueue(Random random) {
        this.random = random;
    }

    /**
     * Offers an address. True when it now waits for its check; false when it was already tried in
     * this browse, its service has had PER_SERVICE, or there is no room (a preferred one makes room
     * by dropping, and releasing, a waiting one that is not preferred).
     */
    boolean offer(String service, String ip, int port, boolean preferred) {
        Candidate c = new Candidate(service == null ? "" : service, ip, port, preferred);
        if (ip == null || port < 1 || tried.contains(c.key()) || count(c.service) >= PER_SERVICE) return false;
        if (waiting.size() >= MAX_WAITING) {
            if (!preferred) return false;
            int drop = -1;
            for (int i = waiting.size() - 1; i >= 0; i--) {
                if (!waiting.get(i).preferred) {
                    drop = i;
                    break;
                }
            }
            if (drop < 0) return false;
            release(waiting.remove(drop));
        }
        tried.add(c.key());
        perService.put(c.service, count(c.service) + 1);
        waiting.add(c);
        return true;
    }

    /** The next address to check (a preferred one first, else one at random), or null. */
    Candidate next() {
        if (waiting.isEmpty()) return null;
        for (int i = 0; i < waiting.size(); i++) {
            if (waiting.get(i).preferred) return waiting.remove(i);
        }
        return waiting.remove(random.nextInt(waiting.size()));
    }

    /** A check that could not be started: unmarked, so the address can be offered again. */
    void release(Candidate c) {
        if (c == null) return;
        tried.remove(c.key());
        int n = count(c.service) - 1;
        if (n <= 0) perService.remove(c.service);
        else perService.put(c.service, n);
    }

    int waiting() {
        return waiting.size();
    }

    /** A new browse: nothing tried yet. */
    void clear() {
        waiting.clear();
        tried.clear();
        perService.clear();
    }

    private int count(String service) {
        Integer n = perService.get(service);
        return n == null ? 0 : n;
    }
}
