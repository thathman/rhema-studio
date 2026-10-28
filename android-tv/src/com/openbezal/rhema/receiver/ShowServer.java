package com.openbezal.rhema.receiver;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * What Rhema asks a receiver (#198): POST /challenge {"x"} → {"ok","v","y","proof"} (the code
 * check, CodeProof, 1.2; "v": 2 since 1.3), then POST /show {"nonce","data"} → {"ok","name"|"error"}:
 * the feed's https link and Rhema's certificate fingerprint, encrypted with the check's key (1.3;
 * the plain {"url","proof"} of 1.2 is refused); and (#213, 1.1) GET /status →
 * {"ok","name","feed","problem"} (and, 1.5, "width","height": the display's size): the id of the
 * feed shown, never its secret link. Small bodies
 * only; nothing else is served.
 *
 * Any device on the network can reach this port, so (1.3): a few requests are served at a time and
 * each one has 5 seconds in all, so a slow sender cannot keep Rhema out; nothing a request does can
 * stop the server; and only Rhema's own kind of request is answered: JSON, sent to this TV's
 * address, not from a web page.
 */
final class ShowServer extends Thread {
    private static final int MAX_HEAD = 8 * 1024;
    private static final int MAX_BODY = 8 * 1024;
    /** The whole request, first byte to answer. */
    private static final long DEADLINE_MS = 5_000;
    private static final int WORKERS = 3;
    private final int port;
    private final MainActivity app;
    private volatile ServerSocket socket;
    private final ThreadPoolExecutor pool = new ThreadPoolExecutor(WORKERS, WORKERS, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<Runnable>(8), new ThreadFactory() {
        @Override
        public Thread newThread(Runnable r) {
            Thread t = new Thread(r, "rhema-show-request");
            t.setDaemon(true);
            return t;
        }
    });

    ShowServer(int port, MainActivity app) {
        super("rhema-show-server");
        setDaemon(true);
        this.port = port;
        this.app = app;
    }

    @Override
    public void run() {
        while (!isInterrupted()) {
            try (ServerSocket s = new ServerSocket(port)) {
                socket = s;
                while (!isInterrupted()) {
                    final Socket c;
                    try {
                        c = s.accept();
                    } catch (Throwable broken) {
                        if (s.isClosed()) break;
                        continue;
                    }
                    try {
                        pool.execute(new Runnable() {
                            @Override
                            public void run() {
                                serve(c);
                            }
                        });
                    } catch (Throwable busy) {
                        // Every worker busy and the queue full: this one is turned away.
                        closeQuietly(c);
                    }
                }
            } catch (Throwable e) {
                // The port is busy (the last run still closing): try again shortly.
                try { Thread.sleep(2_000); } catch (InterruptedException stop) { return; }
            }
        }
    }

    void close() {
        interrupt();
        pool.shutdownNow();
        try { if (socket != null) socket.close(); } catch (Exception ignored) { }
    }

    private void serve(Socket c) {
        try {
            handle(c, System.nanoTime() + DEADLINE_MS * 1_000_000L);
        } catch (Throwable ignored) {
            // A broken, slow or hostile request: drop it and serve the next one.
        } finally {
            closeQuietly(c);
        }
    }

    private static void closeQuietly(Socket c) {
        try { c.close(); } catch (Throwable ignored) { }
    }

    private void handle(Socket c, long deadline) throws Exception {
        InputStream in = new BufferedInputStream(new Deadline(c, deadline), 1024);
        String[] lines = readHead(in).split("\r\n");
        String[] request = lines[0].split(" ");
        Map<String, String> headers = new HashMap<String, String>();
        for (int i = 1; i < lines.length; i++) {
            int colon = lines[i].indexOf(':');
            if (colon > 0) headers.put(lines[i].substring(0, colon).trim().toLowerCase(Locale.ROOT), lines[i].substring(colon + 1).trim());
        }
        String lengthHeader = headers.get("content-length");
        int length = lengthHeader == null ? 0 : Integer.parseInt(lengthHeader);
        String type = headers.get("content-type");
        JSONObject reply = new JSONObject();
        int status = 200;
        String path = request.length >= 2 ? request[1] : "";
        boolean post = "POST".equals(request[0]) && ("/challenge".equals(path) || "/show".equals(path));
        if (headers.containsKey("origin")) {
            // A web page on some computer here (Rhema itself never sends one).
            status = 403;
            reply.put("ok", false).put("error", "Rhema Studio Receiver does not answer web pages");
        } else if (!Guard.ipLiteralHost(headers.get("host"))) {
            status = 403;
            reply.put("ok", false).put("error", "Ask this TV by its address, e.g. 192.168.1.40:8095");
        } else if ("GET".equals(request[0]) && "/status".equals(path)) {
            int[] size = app.displaySize();
            reply.put("ok", true).put("name", app.name()).put("feed", app.feedShown()).put("problem", app.problem());
            // 1.5: the display's size, for the host's TV list.
            if (size[0] > 0 && size[1] > 0) reply.put("width", size[0]).put("height", size[1]);
        } else if (!post) {
            status = 404;
            reply.put("ok", false).put("error", "Rhema Studio Receiver only takes POST /challenge, POST /show and GET /status");
        } else if (type == null || !"application/json".equalsIgnoreCase(type.split(";")[0].trim())) {
            // A web page can send text without asking first, but not JSON.
            status = 415;
            reply.put("ok", false).put("error", "Rhema Studio Receiver takes JSON only");
        } else if (length <= 0 || length > MAX_BODY) {
            status = 400;
            reply.put("ok", false).put("error", "Nothing was sent");
        } else {
            byte[] body = new byte[length];
            int read = 0;
            while (read < length) {
                int n = in.read(body, read, length - read);
                if (n < 0) throw new IllegalStateException("short body");
                read += n;
            }
            String text = new String(body, StandardCharsets.UTF_8);
            if (!Guard.flatObject(text)) {
                status = 400;
                reply.put("ok", false).put("error", "That is not what Rhema Studio sends");
            } else {
                JSONObject req = new JSONObject(text);
                String peer = c.getInetAddress().getHostAddress();
                if ("/challenge".equals(path)) {
                    // The address Rhema reached this TV at, as Rhema names it ("192.168.3.37:8095").
                    String local = c.getLocalAddress().getHostAddress() + ":" + c.getLocalPort();
                    String[] why = new String[1];
                    String[] answer = app.challenge(req.optString("x", ""), peer, local, why);
                    if (answer != null) {
                        // v 2: this receiver takes only the encrypted /show (Rhema refuses older ones).
                        reply.put("ok", true).put("v", 2).put("y", answer[0]).put("proof", answer[1]);
                    } else {
                        status = 403;
                        reply.put("ok", false).put("error", why[0]);
                    }
                } else if (req.has("url")) {
                    // Rhema before 1.3's form: the link in clear text, which this TV no longer takes.
                    status = 403;
                    reply.put("ok", false).put("error", "This Rhema Studio Receiver takes only Rhema Studio's secure link: update Rhema Studio on the computer");
                } else {
                    String why = app.show(peer, req.optString("nonce", ""), req.optString("data", ""));
                    if (why == null) {
                        reply.put("ok", true).put("name", app.name());
                    } else {
                        status = 403;
                        reply.put("ok", false).put("error", why);
                    }
                }
            }
        }
        byte[] out = reply.toString().getBytes(StandardCharsets.UTF_8);
        OutputStream o = c.getOutputStream();
        o.write(("HTTP/1.1 " + status + (status == 200 ? " OK" : " Error") + "\r\nContent-Type: application/json\r\nContent-Length: " + out.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
        o.write(out);
        o.flush();
    }

    /** The request line and headers, up to the blank line. */
    private static String readHead(InputStream in) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int state = 0;
        while (state < 4) {
            int x = in.read();
            if (x < 0 || b.size() > MAX_HEAD) throw new IllegalStateException("bad request");
            b.write(x);
            state = (x == '\r' && (state == 0 || state == 2)) || (x == '\n' && (state == 1 || state == 3)) ? state + 1 : 0;
        }
        return b.toString("US-ASCII");
    }

    /** The socket's input, which gives up once the request's time is over (not per read). */
    private static final class Deadline extends InputStream {
        private final Socket socket;
        private final InputStream in;
        private final long until;

        Deadline(Socket socket, long until) throws IOException {
            this.socket = socket;
            this.in = socket.getInputStream();
            this.until = until;
        }

        @Override
        public int read() throws IOException {
            byte[] one = new byte[1];
            int n = read(one, 0, 1);
            return n < 0 ? -1 : one[0] & 0xff;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            long left = (until - System.nanoTime()) / 1_000_000L;
            if (left <= 0) throw new SocketTimeoutException("request took too long");
            socket.setSoTimeout((int) Math.max(1, Math.min(left, DEADLINE_MS)));
            return in.read(b, off, len);
        }
    }
}
