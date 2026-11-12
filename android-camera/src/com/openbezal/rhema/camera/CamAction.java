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
     * naming which as Rhema Studio and its Companion do (#822): "ON AIR · OBS" for OBS's program,
     * "ON AIR · CONGREGATION" for a congregation TV, both as "ON AIR · OBS, CONGREGATION"; SENDING otherwise, and SENDING · NO
     * TALLY when Rhema has not said, so a camera is never told it is off air when nobody knows.
     */
    static State resolve(boolean paired, boolean sending, boolean live, int tally) {
        return resolve(paired, sending, live, tally, RECEIVING_UNKNOWN);
    }

    /** Whether Rhema says its router is getting the picture (#850): unknown from an older Rhema. */
    static final int RECEIVING_UNKNOWN = -1;
    static final int NOT_RECEIVED = 0;
    static final int RECEIVED = 1;

    /** The tally's words, as on Rhema Studio and its Companion: ON AIR · then the screen (#822). */
    static final String ON_AIR = "ON AIR · ";

    /** Shown while Rhema confirms it is getting the picture, on no Program (#850). */
    static final String RECEIVING = "RHEMA RECEIVING";
    /** Sending, but Rhema says its router has not got the picture (yet). */
    static final String NOT_RECEIVED_YET = "SENDING · NOT RECEIVED YET";

    /**
     * As above, and "sending" is not "received" (#850): once Rhema says its router gets the picture
     * the light says RHEMA RECEIVING; while Rhema says it does not, SENDING · NOT RECEIVED YET. An
     * older Rhema says neither, and the light says SENDING as before.
     */
    static State resolve(boolean paired, boolean sending, boolean live, int tally, int receiving) {
        if (!sending) return new State("NOT SENDING", paired ? "SEND" : "CONNECT");
        if (!live) return new State("CONNECTING", "");
        if (tally < 0) return new State("SENDING · NO TALLY", "");
        boolean online = (tally & ONLINE) != 0, room = (tally & CONGREGATION) != 0;
        if (online && room) return new State(ON_AIR + "OBS, CONGREGATION", "");
        if (online) return new State(ON_AIR + "OBS", "");
        if (room) return new State(ON_AIR + "CONGREGATION", "");
        if (receiving == RECEIVED) return new State(RECEIVING, "");
        if (receiving == NOT_RECEIVED) return new State(NOT_RECEIVED_YET, "");
        return new State("SENDING", "");
    }

    /** Whether the status is on air (the red light). */
    static boolean onAir(State s) {
        return s.status.startsWith("ON AIR");
    }
}
