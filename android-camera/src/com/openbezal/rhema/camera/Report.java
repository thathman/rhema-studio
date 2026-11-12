package com.openbezal.rhema.camera;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.Locale;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSession;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/**
 * The phone's battery and heat, told to Rhema every 30 s while sending (#213), so the operator sees
 * a phone about to run flat or slowing down before its picture stops. Sent over https to Rhema's
 * secure listener, trusting only the paired certificate (as the picture does), signed in with the
 * camera's own secret in a header (never in the address, which can end up in logs). Plain Java
 * (no Android), so build.sh can test it.
 */
final class Report {
    private Report() { }

    /** How often the report goes while sending (ms). */
    static final long EVERY_MS = 30000;

    /**
     * The report: battery level (0–100, or below 0 when unknown), plugged in, battery temperature
     * (°C, or below -30 when unknown), Android's thermal status (0–6, or below 0 before Android 10)
     * and whether the app is cooling the phone (a smaller or slower picture).
     */
    static String body(float battery, boolean charging, float temperature, int thermal, boolean cooling) {
        StringBuilder b = new StringBuilder("{");
        if (battery >= 0 && battery <= 100) b.append("\"battery\":").append(String.format(Locale.ROOT, "%.0f", battery)).append(',');
        b.append("\"charging\":").append(charging).append(',');
        if (temperature > -30 && temperature < 120) b.append("\"temperature\":").append(String.format(Locale.ROOT, "%.1f", temperature)).append(',');
        if (thermal >= 0 && thermal <= 6) b.append("\"thermal\":").append(thermal).append(',');
        b.append("\"cooling\":").append(cooling).append('}');
        return b.toString();
    }

    /** The sign-in header's value: the camera's own secret. */
    static String authorization(Pairing p) {
        return "Bearer " + p.token;
    }

    /** Only the paired Rhema's certificate. */
    static final class Pin implements X509TrustManager {
        private final String fp;

        Pin(String fp) {
            this.fp = fp;
        }

        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            throw new CertificateException("No client certificates");
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            if (chain == null || chain.length == 0 || !Pairing.pinned(chain[0].getEncoded(), fp)) throw new CertificateException("Not the paired Rhema's certificate");
        }

        @Override
        public X509Certificate[] getAcceptedIssuers() {
            return new X509Certificate[0];
        }
    }

    /**
     * Send one report; returns the HTTP status (204 when Rhema took it), or throws when Rhema could
     * not be reached. Nothing happens for a link without a report port (an older Rhema).
     */
    static int send(Pairing p, String body) throws IOException {
        String url = p.statusUrl();
        if (url == null) return 0;
        HttpsURLConnection c = open(p, url);
        try {
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            c.setFixedLengthStreamingMode(bytes.length);
            OutputStream out = c.getOutputStream();
            try {
                out.write(bytes);
            } finally {
                out.close();
            }
            int code = c.getResponseCode();
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in != null) in.close();
            return code;
        } finally {
            c.disconnect();
        }
    }

    /** How often the tally is read while sending (ms), and how old a tally may be before it is unknown. */
    static final long TALLY_EVERY_MS = 2000;
    static final long TALLY_FRESH_MS = 6000;

    /**
     * Read the camera's tally (#209): CamAction.ONLINE and/or CONGREGATION, 0 for neither, or
     * CamAction.TALLY_UNKNOWN when Rhema could not say (an older Rhema answers 404). Throws when
     * Rhema could not be reached. Same pinned https and header sign-in as the report.
     */
    static int tally(Pairing p) throws IOException {
        return ask(p).tally;
    }

    /** The quality Rhema Studio suggests for this camera (#838): at most this tall and this many Mbit/s. */
    static final class Suggest {
        final String id;
        final int height;
        final int mbps;
        final String words;

        Suggest(String id, int height, int mbps, String words) {
            this.id = id;
            this.height = height;
            this.mbps = mbps;
            this.words = words;
        }
    }

    /** Rhema's whole tally reply: the tally, and what newer Rhemas add (#836, #838, #850). */
    static final class Answer {
        /** The HTTP status (403: the camera was removed or given a new link; 503: Rhema is starting). */
        final int code;
        final int tally;
        /** CamAction.RECEIVED / NOT_RECEIVED / RECEIVING_UNKNOWN. */
        final int receiving;
        /** What Rhema Studio calls this camera ("" when it does not say). */
        final String name;
        /** null: no suggestion (the phone's own choice). */
        final Suggest suggest;

        Answer(int code, int tally, int receiving, String name, Suggest suggest) {
            this.code = code;
            this.tally = tally;
            this.receiving = receiving;
            this.name = name;
            this.suggest = suggest;
        }

        /** Rhema answered that it does not know this camera (with this secret). */
        boolean forbidden() {
            return code == HttpURLConnection.HTTP_FORBIDDEN;
        }
    }

    /**
     * Ask Rhema for the camera's tally and the rest of its reply. Throws when Rhema could not be
     * reached. Same pinned https and header sign-in as the report.
     */
    static Answer ask(Pairing p) throws IOException {
        String url = p.tallyUrl();
        if (url == null) return new Answer(0, CamAction.TALLY_UNKNOWN, CamAction.RECEIVING_UNKNOWN, "", null);
        HttpsURLConnection c = open(p, url);
        try {
            c.setRequestMethod("GET");
            int code = c.getResponseCode();
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            byte[] buf = new byte[4096];
            int n = 0;
            if (in != null) {
                try {
                    for (int r; n < buf.length && (r = in.read(buf, n, buf.length - n)) > 0; ) n += r;
                } finally {
                    in.close();
                }
            }
            return parseAnswer(code, new String(buf, 0, n, StandardCharsets.UTF_8));
        } finally {
            c.disconnect();
        }
    }

    /** Rhema's tally reply ({"online":true,"congregation":false}); unknown if it is not one. */
    static int parseTally(String json) {
        return parseAnswer(HttpURLConnection.HTTP_OK, json).tally;
    }

    /** A reply as Answer; anything but a 200 with a JSON object knows nothing (never "off air"). */
    static Answer parseAnswer(int code, String json) {
        java.util.Map<String, Object> o = code == HttpURLConnection.HTTP_OK ? Json.object(json) : null;
        if (o == null) return new Answer(code, CamAction.TALLY_UNKNOWN, CamAction.RECEIVING_UNKNOWN, "", null);
        Object on = o.get("online"), room = o.get("congregation"), rec = o.get("receiving"), name = o.get("name"), sug = o.get("suggest");
        int tally = on instanceof Boolean && room instanceof Boolean
                ? ((Boolean) on ? CamAction.ONLINE : 0) | ((Boolean) room ? CamAction.CONGREGATION : 0) : CamAction.TALLY_UNKNOWN;
        int receiving = rec instanceof Boolean ? ((Boolean) rec ? CamAction.RECEIVED : CamAction.NOT_RECEIVED) : CamAction.RECEIVING_UNKNOWN;
        String label = name instanceof String ? clean((String) name) : "";
        Suggest suggest = null;
        if (sug instanceof java.util.Map) {
            java.util.Map<?, ?> s = (java.util.Map<?, ?>) sug;
            int h = whole(s.get("height")), m = whole(s.get("mbps"));
            // Only sizes and bitrates a phone can send; anything else is no suggestion.
            if (h >= 360 && h <= 2160 && m >= 1 && m <= 100) {
                Object id = s.get("id"), words = s.get("words");
                suggest = new Suggest(id instanceof String ? clean((String) id) : "", h, m, words instanceof String ? clean((String) words) : h + "p, at most " + m + " Mbit/s");
            }
        }
        return new Answer(code, tally, receiving, label, suggest);
    }

    /** A whole number from a JSON number, or 0. */
    private static int whole(Object v) {
        if (!(v instanceof Double)) return 0;
        double d = (Double) v;
        return d == Math.rint(d) && Math.abs(d) < 1e6 ? (int) d : 0;
    }

    /** Text from Rhema for the screen: no control characters, at most 60 characters. */
    private static String clean(String s) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < s.length() && b.length() < 60; i++) {
            char ch = s.charAt(i);
            if (!Character.isISOControl(ch)) b.append(ch);
        }
        return b.toString().trim();
    }

    /** A connection to the paired Rhema only (its pinned certificate), signed in with the camera's secret. */
    private static HttpsURLConnection open(Pairing p, String url) throws IOException {
        SSLContext ctx;
        try {
            ctx = SSLContext.getInstance("TLS");
            ctx.init(null, new TrustManager[] {new Pin(p.fp)}, null);
        } catch (GeneralSecurityException e) {
            throw new IOException("This phone cannot make a secure connection", e);
        }
        HttpsURLConnection c = (HttpsURLConnection) new URL(url).openConnection();
        c.setSSLSocketFactory(ctx.getSocketFactory());
        // The certificate is pinned (above), so its name need not match the address.
        c.setHostnameVerifier(new HostnameVerifier() {
            @Override
            public boolean verify(String hostname, SSLSession session) {
                return true;
            }
        });
        c.setConnectTimeout(4000);
        c.setReadTimeout(4000);
        c.setUseCaches(false);
        c.setRequestProperty("Authorization", authorization(p));
        return c;
    }

    /** Whether Rhema took the report. */
    static boolean ok(int code) {
        return code == HttpURLConnection.HTTP_NO_CONTENT || code == HttpURLConnection.HTTP_OK;
    }
}
