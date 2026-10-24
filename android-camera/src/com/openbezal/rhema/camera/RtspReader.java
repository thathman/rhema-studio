package com.openbezal.rhema.camera;

import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Reads what the camera router sends back on the RTSP connection: replies to requests, and
 * interleaved packets ($, channel, length; its RTCP reports), which are read and set aside.
 * Plain Java (no Android), so build.sh can test it.
 */
final class RtspReader {
    static final class Response {
        final int status;
        final String reason;
        final List<String[]> headers;
        final byte[] body;

        Response(int status, String reason, List<String[]> headers, byte[] body) {
            this.status = status;
            this.reason = reason;
            this.headers = headers;
            this.body = body;
        }

        String header(String name) {
            for (String[] h : headers) if (h[0].equalsIgnoreCase(name)) return h[1];
            return null;
        }

        List<String> all(String name) {
            List<String> out = new ArrayList<String>();
            for (String[] h : headers) if (h[0].equalsIgnoreCase(name)) out.add(h[1]);
            return out;
        }
    }

    /** Replies and packets bigger than this are not the router's: the connection is closed. */
    static final int MAX = 256 * 1024;

    private final InputStream in;
    /** Interleaved packets seen (RTCP receiver reports from the router). */
    long packetsSkipped;

    RtspReader(InputStream in) {
        this.in = in;
    }

    /** The next reply, skipping any interleaved packets before it. */
    Response next() throws IOException {
        while (true) {
            int b = read();
            if (b == '$') {
                read();
                int len = (read() << 8) | read();
                skip(len);
                packetsSkipped++;
                continue;
            }
            if (b == '\r' || b == '\n') continue;
            String status = (char) b + line();
            if (!status.startsWith("RTSP/")) throw new IOException("Not an RTSP reply");
            String[] parts = status.split(" ", 3);
            int code;
            try {
                code = Integer.parseInt(parts[1]);
            } catch (RuntimeException e) {
                throw new IOException("Not an RTSP reply");
            }
            List<String[]> headers = new ArrayList<String[]>();
            int total = 0;
            while (true) {
                String l = line();
                if (l.isEmpty()) break;
                total += l.length();
                if (total > MAX || headers.size() > 100) throw new IOException("RTSP reply too long");
                int colon = l.indexOf(':');
                if (colon > 0) headers.add(new String[] {l.substring(0, colon).trim(), l.substring(colon + 1).trim()});
            }
            int length = 0;
            for (String[] h : headers) {
                if (h[0].toLowerCase(Locale.ROOT).equals("content-length")) {
                    try {
                        length = Integer.parseInt(h[1]);
                    } catch (NumberFormatException e) {
                        throw new IOException("Bad Content-Length");
                    }
                }
            }
            if (length < 0 || length > MAX) throw new IOException("RTSP reply too long");
            byte[] body = new byte[length];
            for (int i = 0; i < length; i++) body[i] = (byte) read();
            return new Response(code, parts.length > 2 ? parts[2] : "", headers, body);
        }
    }

    private int read() throws IOException {
        int b = in.read();
        if (b < 0) throw new EOFException("Rhema closed the connection");
        return b;
    }

    private void skip(int n) throws IOException {
        for (int i = 0; i < n; i++) read();
    }

    private String line() throws IOException {
        StringBuilder sb = new StringBuilder();
        while (true) {
            int b = read();
            if (b == '\n') break;
            if (b != '\r') sb.append((char) b);
            if (sb.length() > 8192) throw new IOException("RTSP line too long");
        }
        return new String(sb.toString().getBytes(StandardCharsets.ISO_8859_1), StandardCharsets.UTF_8);
    }
}
