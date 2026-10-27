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

    static State resolve(boolean paired, boolean sending, boolean live) {
        if (sending) return new State(live ? "LIVE" : "CONNECTING", "");
        return new State("NOT SENDING", paired ? "SEND" : "CONNECT");
    }
}
