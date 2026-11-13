package com.airixmedia.rhema.camera;

import java.util.Locale;

/**
 * The heat and battery warning the viewfinder keeps showing (#837): hot (Android's thermal status
 * moderate or worse), cooling (the app sends less to cool the phone) and a low battery (under 20 %
 * and not charging). Never hidden after a few seconds: it goes only when the phone is fine again.
 * Plain Java (no Android), so build.sh can test it.
 */
final class Health {
    private Health() { }

    /** Android's PowerManager.THERMAL_STATUS_MODERATE and _CRITICAL. */
    static final int MODERATE = 2;
    static final int CRITICAL = 4;
    static final float LOW_BATTERY = 20f;

    /**
     * The badge's words ("HOT · COOLING · BATTERY 15%"), or "" when there is nothing to warn about.
     * thermal below 0: not known (before Android 10); battery below 0: not known.
     */
    static String badge(int thermal, boolean cooling, float battery, boolean charging) {
        StringBuilder b = new StringBuilder();
        if (thermal >= CRITICAL) b.append("VERY HOT");
        else if (thermal >= MODERATE) b.append("HOT");
        if (cooling) b.append(b.length() > 0 ? " · " : "").append("COOLING");
        if (lowBattery(battery, charging)) b.append(b.length() > 0 ? " · " : "").append("BATTERY ").append(String.format(Locale.ROOT, "%.0f", battery)).append('%');
        return b.toString();
    }

    static boolean lowBattery(float battery, boolean charging) {
        return battery >= 0 && battery < LOW_BATTERY && !charging;
    }

    /** What to do about it, in a sentence (a tap on the badge says it). */
    static String advice(int thermal, boolean cooling, float battery, boolean charging) {
        StringBuilder b = new StringBuilder();
        if (thermal >= CRITICAL) b.append("The phone is critically hot and may stop sending: give it air or shade now.");
        else if (thermal >= MODERATE || cooling) b.append("The phone is hot").append(cooling ? ", so it sends a smaller or slower picture to cool down" : "").append(". Give it air or shade, or take it out of its case.");
        if (lowBattery(battery, charging)) b.append(b.length() > 0 ? " " : "").append("The battery is low and not charging: plug the phone in.");
        return b.toString();
    }
}
