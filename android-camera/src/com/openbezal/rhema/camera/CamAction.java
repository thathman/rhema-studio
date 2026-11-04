package com.openbezal.rhema.camera;

/** The truthful viewfinder status and the next action for the current pairing/send state. */
final class CamAction {
    private CamAction() { }

    static final class State {
        final String status;
        final String action;

        private State(String status, String action) {
            this.status = status;
            this.action = action;
        }
    }

    /** Rhema says what the camera is on (#209, Report.tally): unknown (an older Rhema, no answer lately). */
    static final int TALLY_UNKNOWN = -1;
    static final int ONLINE = 1;
    static final int CONGREGATION = 2;

    static State resolve(boolean paired, boolean sending, boolean live) {
        return resolve(paired, sending, live, TALLY_UNKNOWN);
    }

    /**
     * Sending is not on air (#209): ON AIR, red, only when Rhema says a Program shows this camera,
     * naming which (online through OBS, congregation on a TV); SENDING otherwise, and SENDING · NO
     * TALLY when Rhema has not said, so a camera is never told it is off air when nobody knows.
     */
    static State resolve(boolean paired, boolean sending, boolean live, int tally) {
        if (!sending) return new State("NOT SENDING", paired ? "SEND" : "CONNECT");
        if (!live) return new State("CONNECTING", "");
        if (tally < 0) return new State("SENDING · NO TALLY", "");
        boolean online = (tally & ONLINE) != 0, room = (tally & CONGREGATION) != 0;
        if (online && room) return new State("ON AIR · ONLINE + CONGREGATION", "");
        if (online) return new State("ON AIR · ONLINE", "");
        if (room) return new State("ON AIR · CONGREGATION", "");
        return new State("SENDING", "");
    }

    /** Whether the status is on air (the red light). */
    static boolean onAir(State s) {
        return s.status.startsWith("ON AIR");
    }
}
