package com.openbezal.rhema.camera;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;

/**
 * The addresses waiting for a TLS check in one browse (Rhema Studio Cam 1.6, doc 48; the same as the
 * Receiver's). Anyone can announce the public
 * k= hint, so one announcer must not use up the checks the real Rhema Studio needs:
 * - each announced service gets at most PER_SERVICE addresses checked per browse;
 * - at most MAX_WAITING wait; a newcomer that does not fit is not marked but kept aside (at most
 *   MAX_LATER; when that is full a random one of them gives way, so a flood of fake announcements
 *   cannot always push the real one out), and it moves up as checks are taken (next()), so a service
 *   resolved once is not lost for the rest of the browse;
 * - the last-known Rhema Studio (its last address, or the service name it was found under) goes
 *   first, and the rest are taken in a random order, so a fixed set of fake announcements cannot
 *   always stand in front of the real one;
 * - a check that could not be started is released (unmarked) and kept aside to be tried again.
 * Main thread only. Plain Java only, so build.sh's KeyPinCheck tests it.
 */
final class ProbeQueue {
    static final int PER_SERVICE = 2;
    static final int MAX_WAITING = 8;
    static final int MAX_LATER = 32;

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
    /** Turned away for want of room (or released): offered again as room is made. */
    private final List<Candidate> later = new ArrayList<Candidate>();
    private final Set<String> tried = new HashSet<String>();
    private final Map<String, Integer> perService = new HashMap<String, Integer>();
    private final Random random;

    ProbeQueue(Random random) {
        this.random = random;
    }

    /**
     * Offers an address. True when it now waits for its check; false when it was already tried in
     * this browse, its service has had PER_SERVICE, or there is no room (a preferred one makes room
     * by moving a waiting one that is not preferred aside). One turned away for want of room is kept
     * aside (later) and offered again when a check is taken.
     */
    boolean offer(String service, String ip, int port, boolean preferred) {
        Candidate c = new Candidate(service == null ? "" : service, ip, port, preferred);
        if (ip == null || port < 1 || tried.contains(c.key()) || count(c.service) >= PER_SERVICE) return false;
        if (waiting.size() >= MAX_WAITING) {
            int drop = -1;
            for (int i = waiting.size() - 1; preferred && i >= 0; i--) {
                if (!waiting.get(i).preferred) {
                    drop = i;
                    break;
                }
            }
            if (drop < 0) {
                aside(c);
                return false;
            }
            release(waiting.remove(drop));
        }
        removeLater(c.key());
        tried.add(c.key());
        perService.put(c.service, count(c.service) + 1);
        waiting.add(c);
        return true;
    }

    /** The next address to check (a preferred one first, else one at random), or null; one kept aside moves up. */
    Candidate next() {
        if (waiting.isEmpty()) return null;
        Candidate out = null;
        for (int i = 0; i < waiting.size(); i++) {
            if (waiting.get(i).preferred) {
                out = waiting.remove(i);
                break;
            }
        }
        if (out == null) out = waiting.remove(random.nextInt(waiting.size()));
        refill();
        return out;
    }

    /** A check that could not be started (or was moved aside): unmarked and kept aside to be offered again. */
    void release(Candidate c) {
        if (c == null) return;
        tried.remove(c.key());
        int n = count(c.service) - 1;
        if (n <= 0) perService.remove(c.service);
        else perService.put(c.service, n);
        aside(c);
    }

    int waiting() {
        return waiting.size();
    }

    /** How many are kept aside for want of room. */
    int later() {
        return later.size();
    }

    /** Something is still to be checked in this browse (waiting, or kept aside). */
    boolean pending() {
        return !waiting.isEmpty() || !later.isEmpty();
    }

    /** A new browse: nothing tried yet. */
    void clear() {
        waiting.clear();
        later.clear();
        tried.clear();
        perService.clear();
    }

    /** Keeps a turned-away address aside; when that is full, a random one there gives way (a preferred one never to one that is not). */
    private void aside(Candidate c) {
        for (Candidate x : later) {
            if (x.key().equals(c.key())) return;
        }
        if (later.size() < MAX_LATER) {
            later.add(c);
            return;
        }
        int i = random.nextInt(later.size());
        if (later.get(i).preferred && !c.preferred) return;
        later.set(i, c);
    }

    private void removeLater(String key) {
        for (int i = 0; i < later.size(); i++) {
            if (later.get(i).key().equals(key)) {
                later.remove(i);
                return;
            }
        }
    }

    /** Moves those kept aside up while there is room (preferred first, else at random); ones no longer allowed are dropped. */
    private void refill() {
        while (waiting.size() < MAX_WAITING && !later.isEmpty()) {
            int pick = -1;
            for (int i = 0; i < later.size(); i++) {
                if (later.get(i).preferred) {
                    pick = i;
                    break;
                }
            }
            if (pick < 0) pick = random.nextInt(later.size());
            Candidate c = later.remove(pick);
            if (tried.contains(c.key()) || count(c.service) >= PER_SERVICE) continue;
            tried.add(c.key());
            perService.put(c.service, count(c.service) + 1);
            waiting.add(c);
        }
    }

    private int count(String service) {
        Integer n = perService.get(service);
        return n == null ? 0 : n;
    }
}
