package com.openbezal.rhema.receiver;

/**
 * What the code screen says about tries of its code (#841 S17). The TV cannot tell a right code from
 * a wrong one when Rhema Studio checks it (that is what keeps the code from being guessed offline),
 * but it can tell that a check happened and whether a feed followed: a right code's /show comes
 * within seconds. So the screen says "a code was tried" and how many tries are left, never anything
 * about what was typed. Plain Java, so build.sh's CodeTriesCheck tests it. Times are elapsedRealtime ms.
 */
final class CodeTries {
    /** How long a right code's feed takes to follow its check (Rhema Studio sends /show at once). */
    static final long FOLLOW_MS = 8_000;

    private long triedAt = -1;
    private int left;

    /** A code check was made at now; left tries remain. */
    void tried(long now, int left) {
        this.triedAt = now;
        this.left = left;
    }

    /** A feed was sent or a new code made: nothing to report any more. */
    void clear() {
        triedAt = -1;
    }

    /** When the words change next (the check's wait running out), or -1. */
    long changesAt() {
        return triedAt < 0 ? -1 : triedAt + FOLLOW_MS;
    }

    /** One line for the code screen, or null. No tries left is said by the code line itself. */
    String words(long now) {
        if (triedAt < 0 || left <= 0) return null;
        String tries = left + (left == 1 ? " try" : " tries") + " left";
        if (now < triedAt + FOLLOW_MS) return "A code was just tried in Rhema Studio, checking… (" + tries + ")";
        return "A code was tried in Rhema Studio and did not open a feed. Check the code and try again (" + tries + ").";
    }
}
