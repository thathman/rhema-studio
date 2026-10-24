package com.openbezal.rhema.receiver;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

/**
 * What Rhema asks a receiver (#198): POST /challenge {"x"} → {"ok","y","proof"} (the code check,
 * CodeProof, 1.2), then POST /show {"url","proof"} → {"ok","name"|"error"}; and
 * (#213, 1.1) GET /status → {"ok","name","feed","problem"}: the id of the feed shown, never its
 * secret link. One request at a time, small bodies only; nothing else is served.
 */
final class ShowServer extends Thread {
    private static final int MAX_BODY = 8 * 1024;
    private final int port;
    private final MainActivity app;
    private volatile ServerSocket socket;

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
                    try (Socket c = s.accept()) {
                        c.setSoTimeout(5_000);
                        handle(c);
                    } catch (Exception ignored) {
                        // a broken request: wait for the next one
                    }
                }
            } catch (Exception e) {
                // The port is busy (the last run still closing): try again shortly.
                try { Thread.sleep(2_000); } catch (InterruptedException stop) { return; }
            }
        }
    }

    void close() {
        interrupt();
        try { if (socket != null) socket.close(); } catch (Exception ignored) { }
    }

    private void handle(Socket c) throws Exception {
        InputStream in = c.getInputStream();
        String head = readHead(in);
        String[] lines = head.split("\r\n");
        String[] request = lines[0].split(" ");
        int length = 0;
        for (String l : lines) {
            int colon = l.indexOf(':');
            if (colon > 0 && l.substring(0, colon).trim().equalsIgnoreCase("content-length")) length = Integer.parseInt(l.substring(colon + 1).trim());
        }
        JSONObject reply = new JSONObject();
        int status = 200;
        String path = request.length >= 2 ? request[1] : "";
        boolean post = "POST".equals(request[0]) && ("/challenge".equals(path) || "/show".equals(path));
        if ("GET".equals(request[0]) && "/status".equals(path)) {
            reply.put("ok", true).put("name", app.name()).put("feed", app.feedShown()).put("problem", app.problem());
        } else if (!post) {
            status = 404;
            reply.put("ok", false).put("error", "Rhema Receiver only takes POST /challenge, POST /show and GET /status");
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
            JSONObject req = new JSONObject(new String(body, StandardCharsets.UTF_8));
            String peer = c.getInetAddress().getHostAddress();
            if ("/challenge".equals(path)) {
                // The address Rhema reached this TV at, as Rhema names it ("192.168.3.37:8095").
                String local = c.getLocalAddress().getHostAddress() + ":" + c.getLocalPort();
                String[] why = new String[1];
                String[] answer = app.challenge(req.optString("x", ""), peer, local, why);
                if (answer != null) {
                    reply.put("ok", true).put("y", answer[0]).put("proof", answer[1]);
                } else {
                    status = 403;
                    reply.put("ok", false).put("error", why[0]);
                }
            } else {
                String why = app.show(peer, req.optString("url", ""), req.optString("proof", ""));
                if (why == null) {
                    reply.put("ok", true).put("name", app.name());
                } else {
                    status = 403;
                    reply.put("ok", false).put("error", why);
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
            if (x < 0 || b.size() > MAX_BODY) throw new IllegalStateException("bad request");
            b.write(x);
            state = (x == '\r' && (state == 0 || state == 2)) || (x == '\n' && (state == 1 || state == 3)) ? state + 1 : 0;
        }
        return b.toString("US-ASCII");
    }
}
