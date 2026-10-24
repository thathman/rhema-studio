package com.openbezal.rhema.receiver;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

/**
 * What Rhema asks a receiver (#198): POST /show {"code","url"} → {"ok","name"|"error"}, and
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
        if (request.length >= 2 && "GET".equals(request[0]) && "/status".equals(request[1])) {
            reply.put("ok", true).put("name", app.name()).put("feed", app.feedShown()).put("problem", app.problem());
        } else if (request.length < 2 || !"POST".equals(request[0]) || !"/show".equals(request[1])) {
            status = 404;
            reply.put("ok", false).put("error", "Rhema Receiver only takes POST /show and GET /status");
        } else if (length <= 0 || length > MAX_BODY) {
            status = 400;
            reply.put("ok", false).put("error", "No link was sent");
        } else {
            byte[] body = new byte[length];
            int read = 0;
            while (read < length) {
                int n = in.read(body, read, length - read);
                if (n < 0) throw new IllegalStateException("short body");
                read += n;
            }
            JSONObject req = new JSONObject(new String(body, StandardCharsets.UTF_8));
            String why = app.show(req.optString("code", "").trim(), req.optString("url", ""));
            if (why == null) {
                reply.put("ok", true).put("name", app.name());
            } else {
                status = 403;
                reply.put("ok", false).put("error", why);
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
