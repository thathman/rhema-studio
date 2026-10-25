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
        SSLContext ctx;
        try {
            ctx = SSLContext.getInstance("TLS");
            ctx.init(null, new TrustManager[] {new Pin(p.fp)}, null);
        } catch (GeneralSecurityException e) {
            throw new IOException("This phone cannot make a secure connection", e);
        }
        HttpsURLConnection c = (HttpsURLConnection) new URL(url).openConnection();
        try {
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
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setUseCaches(false);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("Authorization", authorization(p));
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

    /** Whether Rhema took the report. */
    static boolean ok(int code) {
        return code == HttpURLConnection.HTTP_NO_CONTENT || code == HttpURLConnection.HTTP_OK;
    }
}
