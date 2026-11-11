package com.openbezal.rhema.receiver;

/** build.sh runs this before it makes the app: one waiting code check per computer. */
public final class PendingCheck {
    private static int failed;

    private PendingCheck() { }

    public static void main(String[] args) {
        byte[] rhema = {1};
        byte[] other = {2};
        Pending p = new Pending();
        p.put("192.168.3.90", rhema, 0);
        p.put("192.168.3.56", other, 1_000);
        check("another device's check leaves Rhema's in place", p.take("192.168.3.90", 2_000) == rhema);
        check("a check is spent by its /show", p.take("192.168.3.90", 2_000) == null);
        check("the other device keeps its own", p.take("192.168.3.56", 2_000) == other);

        p.put("192.168.3.90", rhema, 0);
        check("too late: refused", p.take("192.168.3.90", Pending.MS) == null);
        check("and spent", p.take("192.168.3.90", 1) == null);

        p.put("192.168.3.90", rhema, 0);
        p.clear();
        check("a new code drops the old checks", p.take("192.168.3.90", 1) == null);

        if (failed > 0) {
            System.err.println(failed + " pending check(s) failed");
            System.exit(1);
        }
        System.out.println("PendingCheck: all passed");
    }

    private static void check(String what, boolean ok) {
        if (!ok) {
            failed++;
            System.err.println("FAIL: " + what);
        }
    }
}
