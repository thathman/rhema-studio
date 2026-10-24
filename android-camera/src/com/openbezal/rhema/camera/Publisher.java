package com.openbezal.rhema.camera;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.OutputStream;
import java.net.ConnectException;
import java.net.InetSocketAddress;
import java.net.NoRouteToHostException;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.ArrayDeque;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLException;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/**
 * Sends the camera to Rhema's camera router: RTSP over TLS (RTSPS) to the camera's own name,
 * signed in as the camera, with the picture and sound interleaved on the same connection
 * (RTP over TCP). Only the certificate whose fingerprint is in the pairing link is accepted;
 * there is no plain-RTSP fallback. If the connection drops it connects again by itself, waiting
 * longer each time; stop() ends the session cleanly (TEARDOWN). Plain Java, no Android.
 */
final class Publisher {
    interface Listener {
        /** Sending now (live) or not, with what to tell the person in plain words. */
        void onState(boolean live, String message);

        /** A reader needs a full picture to start from (after connecting, or after dropping frames). */
        void onNeedKeyFrame();

        /** The network could not keep up and frames were dropped: send less for a while. */
        void onCongested();
    }

    /** The clock the encoder's timestamps use, in microseconds. */
    interface Clock {
        long nowUs();
    }

    private static final class Frame {
        final boolean video;
        final byte[] data;
        final int len;
        final long ptsUs;
        final boolean key;

        Frame(boolean video, byte[] data, int len, long ptsUs, boolean key) {
            this.video = video;
            this.data = data;
            this.len = len;
            this.ptsUs = ptsUs;
            this.key = key;
        }
    }

    private final Pairing pair;
    private final String sdp;
    private final boolean hevc;
    private final boolean audio;
    private final int audioRate;
    private final Listener listener;
    private final Clock clock;
    private final int maxQueueBytes;
    private final ArrayDeque<Frame> queue = new ArrayDeque<Frame>();
    private int queuedBytes;
    private final SecureRandom random = new SecureRandom();

    private volatile boolean stopped;
    private volatile boolean live;
    private volatile Socket socket;
    private volatile OutputStream out;
    private volatile String session;
    private volatile Auth auth;
    private volatile boolean pinFailed;
    private volatile long writeStartedNs;
    private boolean needKey = true;
    /** Frames are being dropped because the network could not keep up (not just waiting for a first full picture). */
    private boolean congested;
    private int cseq;
    private Thread thread;
    private Rtp videoRtp;
    private Rtp audioRtp;
    private long clockBaseUs = Long.MIN_VALUE;
    private long lastReportMs;

    volatile long bytesSent;
    volatile long framesSent;
    volatile long framesDropped;
    volatile int reconnects;
    volatile String message = "Connecting to Rhema…";

    Publisher(Pairing pair, String sdp, boolean hevc, boolean audio, int audioRate, int bitrate, Listener listener, Clock clock) {
        this.pair = pair;
        this.sdp = sdp;
        this.hevc = hevc;
        this.audio = audio;
        this.audioRate = audioRate;
        this.listener = listener;
        this.clock = clock;
        // About two seconds of picture may wait for the network before frames are dropped.
        this.maxQueueBytes = Math.max(1 << 20, bitrate / 4);
    }

    boolean live() {
        return live;
    }

    void start() {
        thread = new Thread(new Runnable() {
            @Override
            public void run() {
                loop();
            }
        }, "rhema-rtsp");
        thread.start();
    }

    /** One encoded picture (Annex B) to send. */
    void video(byte[] data, int len, long ptsUs, boolean key) {
        offer(new Frame(true, data, len, ptsUs, key));
    }

    /** One AAC access unit to send. */
    void audio(byte[] data, int len, long ptsUs) {
        if (audio) offer(new Frame(false, data, len, ptsUs, false));
    }

    private void offer(Frame f) {
        boolean askKey = false;
        synchronized (queue) {
            if (!live) return;
            if (f.video && needKey && !f.key) {
                if (congested) framesDropped++;
                return;
            }
            if (queuedBytes + f.len > maxQueueBytes) {
                // The network cannot keep up: drop what waits and start again from a full picture.
                for (Frame q : queue) if (q.video) framesDropped++;
                queue.clear();
                queuedBytes = 0;
                if (f.video) framesDropped++;
                needKey = true;
                congested = true;
                askKey = true;
            } else {
                if (f.video && f.key) {
                    needKey = false;
                    congested = false;
                }
                queue.add(f);
                queuedBytes += f.len;
                queue.notifyAll();
            }
        }
        if (askKey) {
            listener.onNeedKeyFrame();
            listener.onCongested();
        }
    }

    /** Called about once a second: a write stuck for several seconds means the Wi-Fi is gone. */
    void checkStall() {
        long started = writeStartedNs;
        if (started != 0 && System.nanoTime() - started > 6_000_000_000L) {
            message = "The network stopped taking the picture; connecting again…";
            closeSocket();
        }
    }

    /** End the session with TEARDOWN, close the connection and stop trying. */
    void stop() {
        stopped = true;
        final Thread t = thread;
        Thread closer = new Thread(new Runnable() {
            @Override
            public void run() {
                if (live && out != null) {
                    try {
                        request("TEARDOWN", pair.url(), null, null);
                    } catch (IOException ignored) {
                        // Closing anyway.
                    }
                }
                closeSocket();
                if (t != null) t.interrupt();
                synchronized (queue) {
                    queue.notifyAll();
                }
            }
        }, "rhema-rtsp-stop");
        closer.start();
        try {
            closer.join(1500);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private void loop() {
        int failures = 0;
        while (!stopped) {
            long started = System.currentTimeMillis();
            try {
                connect();
                handshake();
                synchronized (queue) {
                    queue.clear();
                    queuedBytes = 0;
                    needKey = true;
                    congested = false;
                    live = true;
                }
                message = "Sending to Rhema";
                listener.onState(true, message);
                listener.onNeedKeyFrame();
                startReader();
                writeLoop();
            } catch (IOException e) {
                if (!stopped) message = plain(e);
            } finally {
                boolean was = live;
                live = false;
                closeSocket();
                if (was || !stopped) listener.onState(false, stopped ? "Stopped" : message);
            }
            if (stopped) break;
            if (System.currentTimeMillis() - started > 30_000) failures = 0;
            long wait = Math.min(30, 1L << Math.min(failures, 5));
            failures++;
            reconnects++;
            String why = message;
            message = why + " Trying again in " + wait + " s.";
            listener.onState(false, message);
            try {
                Thread.sleep(wait * 1000);
            } catch (InterruptedException e) {
                break;
            }
        }
    }

    private void connect() throws IOException {
        pinFailed = false;
        session = null;
        auth = null;
        cseq = 0;
        SSLContext ctx;
        try {
            ctx = SSLContext.getInstance("TLS");
            ctx.init(null, new TrustManager[] {new Pin()}, null);
        } catch (java.security.GeneralSecurityException e) {
            throw new IOException("This phone cannot make a secure connection", e);
        }
        Socket plain = new Socket();
        plain.setTcpNoDelay(true);
        plain.setSendBufferSize(1 << 20);
        plain.setKeepAlive(true);
        plain.connect(new InetSocketAddress(pair.host, pair.port), 5000);
        SSLSocket s = (SSLSocket) ctx.getSocketFactory().createSocket(plain, pair.host, pair.port, true);
        s.setSoTimeout(10000);
        socket = s;
        s.startHandshake();
        out = new BufferedOutputStream(s.getOutputStream(), 64 * 1024);
        reader = new RtspReader(new BufferedInputStream(s.getInputStream(), 16 * 1024));
        int base = random.nextInt();
        videoRtp = new Rtp(hevc ? Rtp.Kind.H265 : Rtp.Kind.H264, Sdp.VIDEO_PT, random.nextInt(), base);
        audioRtp = new Rtp(Rtp.Kind.AAC, Sdp.AUDIO_PT, random.nextInt(), base >> 3);
        videoBase = random.nextInt() & 0xffffffffL;
        audioBase = random.nextInt() & 0xffffffffL;
    }

    private RtspReader reader;
    private long videoBase;
    private long audioBase;

    private void handshake() throws IOException {
        String url = pair.url();
        RtspReader.Response r = request("ANNOUNCE", url, new String[] {"Content-Type", "application/sdp"}, sdp.getBytes(StandardCharsets.US_ASCII));
        expect(r, "ANNOUNCE");
        r = request("SETUP", url + "/trackID=0", new String[] {"Transport", "RTP/AVP/TCP;unicast;interleaved=0-1;mode=record"}, null);
        expect(r, "SETUP");
        String s = r.header("Session");
        if (s == null) throw new IOException("Rhema's camera router gave no session");
        session = s.split(";")[0].trim();
        if (audio) expect(request("SETUP", url + "/trackID=1", new String[] {"Transport", "RTP/AVP/TCP;unicast;interleaved=2-3;mode=record"}, null), "SETUP");
        expect(request("RECORD", url, new String[] {"Range", "npt=0.000-"}, null), "RECORD");
        socket.setSoTimeout(0);
    }

    /** Sends a request and reads its reply; signs in when the router asks to (once). */
    private RtspReader.Response request(String method, String url, String[] extra, byte[] body) throws IOException {
        RtspReader.Response r = send(method, url, extra, body);
        if (r != null && r.status == 401 && auth == null) {
            auth = Auth.choose(r.all("WWW-Authenticate"));
            if (auth == null) throw new IOException("Rhema's camera router asked for a sign-in this app does not know");
            r = send(method, url, extra, body);
        }
        return r;
    }

    private RtspReader.Response send(String method, String url, String[] extra, byte[] body) throws IOException {
        StringBuilder sb = new StringBuilder();
        sb.append(method).append(' ').append(url).append(" RTSP/1.0\r\n");
        sb.append("CSeq: ").append(++cseq).append("\r\n");
        sb.append("User-Agent: Rhema Camera 1.0.0.0\r\n");
        if (auth != null) sb.append("Authorization: ").append(auth.header(method, url, pair.user, pair.token)).append("\r\n");
        if (session != null) sb.append("Session: ").append(session).append("\r\n");
        if (extra != null) for (int i = 0; i + 1 < extra.length; i += 2) sb.append(extra[i]).append(": ").append(extra[i + 1]).append("\r\n");
        if (body != null) sb.append("Content-Length: ").append(body.length).append("\r\n");
        sb.append("\r\n");
        OutputStream o = out;
        if (o == null) throw new IOException("Not connected");
        synchronized (this) {
            o.write(sb.toString().getBytes(StandardCharsets.UTF_8));
            if (body != null) o.write(body);
            o.flush();
        }
        if (method.equals("TEARDOWN")) return null;
        return reader.next();
    }

    private void expect(RtspReader.Response r, String what) throws IOException {
        if (r.status == 200) return;
        if (r.status == 401) throw new Refused("Rhema did not accept this camera's link: it was renewed, or the camera was removed. Scan the camera's new link in Rhema.");
        if (r.status == 400 && what.equals("ANNOUNCE")) throw new Refused("Rhema's camera router did not take this phone's picture format (" + r.status + " " + r.reason + ").");
        throw new Refused("Rhema's camera router refused the camera (" + what + ": " + r.status + " " + r.reason + ").");
    }

    private static final class Refused extends IOException {
        Refused(String m) {
            super(m);
        }
    }

    /** After RECORD the router only sends its RTCP reports; reading them also notices a closed connection. */
    private void startReader() {
        final RtspReader r = reader;
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    while (true) r.next();
                } catch (IOException e) {
                    if (!stopped && live) {
                        message = e instanceof EOFException ? "Rhema closed the connection; connecting again…" : "The connection to Rhema dropped; connecting again…";
                        closeSocket();
                    }
                }
            }
        }, "rhema-rtsp-read");
        t.setDaemon(true);
        t.start();
    }

    private final Rtp.Sink videoSink = new Rtp.Sink() {
        @Override
        public void packet(byte[] buf, int off, int len) throws IOException {
            write(0, buf, off, len);
        }
    };

    private final Rtp.Sink audioSink = new Rtp.Sink() {
        @Override
        public void packet(byte[] buf, int off, int len) throws IOException {
            write(2, buf, off, len);
        }
    };

    private void write(int channel, byte[] buf, int off, int len) throws IOException {
        buf[off - 4] = '$';
        buf[off - 3] = (byte) channel;
        buf[off - 2] = (byte) (len >> 8);
        buf[off - 1] = (byte) len;
        out.write(buf, off - 4, len + 4);
        bytesSent += len + 4;
    }

    private void writeLoop() throws IOException {
        while (!stopped) {
            Frame f;
            synchronized (queue) {
                while (queue.isEmpty() && !stopped && socket != null) {
                    try {
                        queue.wait(500);
                    } catch (InterruptedException e) {
                        return;
                    }
                    if (socket == null || socket.isClosed()) throw new IOException(message);
                }
                if (stopped) return;
                f = queue.poll();
                if (f == null) continue;
                queuedBytes -= f.len;
            }
            if (socket == null || socket.isClosed()) throw new IOException(message);
            writeStartedNs = System.nanoTime();
            try {
                synchronized (this) {
                    if (clockBaseUs == Long.MIN_VALUE) clockBaseUs = f.ptsUs;
                    long dt = f.ptsUs - clockBaseUs;
                    if (f.video) {
                        videoRtp.picture(f.data, 0, f.len, (videoBase + dt * 9 / 100) & 0xffffffffL, videoSink);
                        framesSent++;
                    } else {
                        audioRtp.aac(f.data, 0, f.len, (audioBase + dt * audioRate / 1_000_000) & 0xffffffffL, audioSink);
                    }
                    reports();
                    out.flush();
                }
            } catch (IOException e) {
                if (socket == null || socket.isClosed()) throw new IOException(message, e);
                throw e;
            } finally {
                writeStartedNs = 0;
            }
        }
    }

    /** RTCP sender reports every two seconds, so readers can line sound up with the picture. */
    private void reports() throws IOException {
        long now = System.currentTimeMillis();
        if (now - lastReportMs < 2000 || clockBaseUs == Long.MIN_VALUE) return;
        lastReportMs = now;
        long dt = clock.nowUs() - clockBaseUs;
        byte[] b = new byte[4 + 28];
        Rtp.senderReport(b, 4, videoRtp.ssrc, now, (videoBase + dt * 9 / 100) & 0xffffffffL, videoRtp.packets, videoRtp.octets);
        write(1, b, 4, 28);
        if (audio && audioRtp.packets > 0) {
            byte[] a = new byte[4 + 28];
            Rtp.senderReport(a, 4, audioRtp.ssrc, now, (audioBase + dt * audioRate / 1_000_000) & 0xffffffffL, audioRtp.packets, audioRtp.octets);
            write(3, a, 4, 28);
        }
    }

    private void closeSocket() {
        Socket s = socket;
        socket = null;
        out = null;
        if (s != null) {
            try {
                s.close();
            } catch (IOException ignored) {
                // Already closed.
            }
        }
        synchronized (queue) {
            queue.notifyAll();
        }
    }

    /** What went wrong, in words the person can act on (never the password). */
    private String plain(IOException e) {
        if (pinFailed) return "This is not the Rhema this camera was paired with: its certificate does not match. Scan the camera's link in Rhema again.";
        if (e instanceof Refused) return e.getMessage();
        if (e instanceof ConnectException || e instanceof NoRouteToHostException || e instanceof SocketTimeoutException) {
            return "Cannot reach Rhema at " + pair.host + ":" + pair.port + ". Is the camera router on, and is this phone on the church Wi-Fi?";
        }
        if (e instanceof SSLException) return "The secure connection to Rhema failed. Check Rhema's camera router is on and up to date.";
        String m = e.getMessage();
        return m == null || m.isEmpty() ? "The connection to Rhema dropped." : m;
    }

    /** Accepts only the certificate whose SHA-256 is in the pairing link. */
    private final class Pin implements X509TrustManager {
        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            throw new CertificateException("No client certificates");
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            if (chain == null || chain.length == 0 || !Pairing.pinned(chain[0].getEncoded(), pair.fp)) {
                pinFailed = true;
                throw new CertificateException("Not the paired Rhema's certificate");
            }
        }

        @Override
        public X509Certificate[] getAcceptedIssuers() {
            return new X509Certificate[0];
        }
    }
}
